#!/usr/bin/env node
// 国内下载副本（ADR-0022 §7 / release-pipeline 07）：把 GitHub 最新正式 Release 的
// 安装包转载到 CNB release，供国内网络直接下载。**非更新源**——updater 仍只认 GitHub。
//
// 由 .cnb.yml 触发：crontab 每天 22:00 一轮（CNB cron 固定 Asia/Shanghai，平台行为非配置项），
// 或 web_trigger 手动触发（页面「构建 → 手动触发构建」/ 分支详情页按钮，发版后即时补镜像）。
// 幂等（目标 tag 附件齐 → 跳过，可重复跑）；单轮失败不影响后续轮次，下一轮自然重试。
//
// CNB OpenAPI 端点（smoke 时按实际响应校准字段名，见文件末 TODO）：
//   GET  /repos/{repo}/-/releases/tags/{tag}    查 release（404 = 不存在）
//   POST /repos/{repo}/-/releases                建 release（409 = 已存在）
//   POST /repos/{repo}/-/upload/releases/{tag}  发起附件上传，返回 COS 直传 url + form
//
// 环境变量：
//   CNB_TOKEN          流水线内置（本地跑用个人访问令牌，git 用户名 cnb）
//   CNB_REPO_SLUG      CNB 流水线自动注入；本地跑需自备（形如 <org>/<repo>）
//   GITHUB_MIRROR_REPO  默认 wuqiongjin/AAO-Editor
//   GITHUB_TOKEN        可选（secret 经 .cnb.yml imports 注入，同镜像 job 共用），
//                       提高 GitHub API 配额；缺省匿名跑（每轮 1 次调用，60/h 限额够用）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GH_REPO = process.env.GITHUB_MIRROR_REPO ?? 'wuqiongjin/AAO-Editor';
const CNB_SLUG = process.env.CNB_REPO_SLUG;
const CNB_TOKEN = process.env.CNB_TOKEN;
const GH_TOKEN = process.env.GITHUB_TOKEN;

const GH_API = 'https://api.github.com';
const CNB_API = 'https://api.cnb.cool';

const fail = (msg) => {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
};
const log = (msg) => console.log(`==> ${msg}`);

if (!CNB_SLUG) fail('缺少 CNB_REPO_SLUG（流水线自动注入；本地运行需自备）');
if (!CNB_TOKEN) fail('缺少 CNB_TOKEN');

const ghHeaders = {
  accept: 'application/vnd.github+json',
  'user-agent': 'aao-editor-ci',
  ...(GH_TOKEN ? { authorization: `Bearer ${GH_TOKEN}` } : {}),
};
const cnbHeaders = { authorization: `token ${CNB_TOKEN}` };

/** GitHub 最新**正式** release（/latest 天然排除 draft 与 prerelease，与 updater 口径一致） */
async function githubLatestRelease() {
  const res = await fetch(`${GH_API}/repos/${GH_REPO}/releases/latest`, { headers: ghHeaders });
  if (res.status === 404) return null;
  if (!res.ok) fail(`GitHub latest release 查询失败：HTTP ${res.status}`);
  return res.json();
}

async function cnbReleaseByTag(tag) {
  const res = await fetch(`${CNB_API}/repos/${CNB_SLUG}/-/releases/tags/${encodeURIComponent(tag)}`, {
    headers: cnbHeaders,
  });
  if (res.status === 404) return null;
  if (!res.ok) fail(`CNB release 查询失败（${tag}）：HTTP ${res.status}`);
  return res.json();
}

async function cnbCreateRelease(tag, body) {
  const res = await fetch(`${CNB_API}/repos/${CNB_SLUG}/-/releases`, {
    method: 'POST',
    headers: { ...cnbHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ tag_name: tag, name: tag, body }),
  });
  if (!res.ok && res.status !== 409) fail(`CNB release 创建失败（${tag}）：HTTP ${res.status}`);
}

async function download(url, dest) {
  const res = await fetch(url, { headers: ghHeaders });
  if (!res.ok) fail(`资产下载失败：HTTP ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

/** 两步上传：CNB 发起（拿 COS 直传地址 + form）→ 直传 */
async function uploadAsset(tag, filePath) {
  const name = path.basename(filePath);
  const init = await fetch(
    `${CNB_API}/repos/${CNB_SLUG}/-/upload/releases/${encodeURIComponent(tag)}?filename=${encodeURIComponent(name)}`,
    { method: 'POST', headers: cnbHeaders },
  );
  if (!init.ok) fail(`发起上传失败（${name}）：HTTP ${init.status}`);
  // TODO(smoke): 校准响应字段名与鉴权头（Authorization: token）后去掉本注释
  const { url, form } = await init.json();
  if (!url) fail(`发起上传响应里没有直传地址（${name}）`);
  const body = new FormData();
  for (const [k, v] of Object.entries(form ?? {})) body.append(k, String(v));
  body.append('file', new Blob([fs.readFileSync(filePath)]), name);
  const up = await fetch(url, { method: 'POST', body });
  if (!up.ok) fail(`COS 直传失败（${name}）：HTTP ${up.status}`);
}

async function main() {
  const latest = await githubLatestRelease();
  if (!latest) {
    log('GitHub 尚无 release，跳过');
    return;
  }
  const tag = latest.tag_name;
  if (!tag) fail('GitHub latest release 没有 tag_name');

  const existing = await cnbReleaseByTag(tag);
  const wanted = (latest.assets ?? []).filter((a) => a.browser_download_url);
  // 幂等键 = tag + 附件名集合：缺谁补谁，部分上传中断的下一轮自动续
  const have = new Set((existing?.assets ?? []).map((a) => a.name));
  if (existing && wanted.every((a) => have.has(a.name))) {
    log(`${tag} 已镜像（${wanted.length} 个附件齐），跳过`);
    return;
  }
  if (!existing) {
    log(`创建 CNB release：${tag}`);
    await cnbCreateRelease(tag, latest.body ?? '');
  }

  const todo = wanted.filter((a) => !have.has(a.name));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aao-mirror-'));
  try {
    for (const a of todo) {
      log(`下载 ${a.name}`);
      const file = path.join(dir, a.name);
      await download(a.browser_download_url, file);
      log(`上传 ${a.name} → CNB release ${tag}`);
      await uploadAsset(tag, file);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  log(`${tag} 镜像完成（${todo.length} 个附件）`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
