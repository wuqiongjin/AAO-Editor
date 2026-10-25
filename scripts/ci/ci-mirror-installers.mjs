#!/usr/bin/env node
// 国内下载副本（ADR-0022 §7 / release-pipeline 07 + 16）：把 GitHub 最新正式 Release 的
// 安装包转载到 CNB release，并改写 latest*.yml 为可匿名 GET 的 generic feed（下载源 CNB）。
//
// 由 .cnb.yml 触发：crontab 每天 22:00 一轮（CNB cron 固定 Asia/Shanghai，平台行为非配置项），
// 或 web_trigger 手动触发（页面「构建 → 手动触发构建」/ 分支详情页按钮，发版后即时补镜像）。
// 幂等（目标 tag 附件齐 → 跳过，可重复跑）；单轮失败不影响后续轮次，下一轮自然重试。
//
// CNB OpenAPI 端点与口径（2026-10-22 按 cnbcool/attachments 插件 TS / Go 两版实现交叉校准）：
//   路径  仓库级路由一律 /{repo}/-/…，base 与 slug 间无前缀层（2026-10-21：多一层全站 404，
//         且 GET 的 404 被当「release 不存在」吞掉、POST 创建才暴露——票 15）
//   媒体  Accept 必须显式带版本化类型——Node fetch 默认 */* 被网关 406 拒（2026-10-22 实测），
//         本脚本全链统一 vnd.cnb.api+json
//   鉴权  Authorization: Bearer（官方示例与 SDK 口径；GitHub 式 token scheme 是 GitHub 主义）
//   GET  /{repo}/-/releases/tags/{tag}             查 release（404 = 不存在）
//   POST /{repo}/-/releases                        建 release（体 tag_name/name/body/draft/prerelease；409 = 已存在）
//   POST /{repo}/-/releases/{id}/asset-upload-url  发起附件上传（体 asset_name/size/ttl；返 upload_url + verify_url）
//   PUT  <upload_url>                              COS 直传（octet-stream + Content-Length，链接一次性）
//   POST <verify_url>                              回认（响应给的绝对地址；缺这步附件不挂 release）
// 别走 python-cnb SDK 的 AssetsApi.upload_releases 那套（Accept web+json、按 tag 发起）：
// 响应没有 verify_url、confirm 无从拼起，2026-10-22 实测走到确认步即 400。
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
import {
  cnbReleaseAssetUrl,
  isFeedYmlName,
  rewriteGenericFeedYml,
} from './cnbGenericFeed.mjs';

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

/** CNB 失败时把服务端错误体一起打出来（插件同型：光有状态码没法定位，2026-10-22 加） */
const failHttp = async (res, msg) => {
  const text = await res.text().catch(() => '');
  fail(`${msg}：HTTP ${res.status}${text ? `；${text.slice(0, 300)}` : ''}`);
};

if (!CNB_SLUG) fail('缺少 CNB_REPO_SLUG（流水线自动注入；本地运行需自备）');
if (!CNB_TOKEN) fail('缺少 CNB_TOKEN');

const ghHeaders = {
  accept: 'application/vnd.github+json',
  'user-agent': 'aao-editor-ci',
  ...(GH_TOKEN ? { authorization: `Bearer ${GH_TOKEN}` } : {}),
};
// 见文件头「媒体 / 鉴权」口径：全链统一 vnd.cnb.api+json；Bearer 鉴权
const cnbHeaders = {
  authorization: `Bearer ${CNB_TOKEN}`,
  accept: 'application/vnd.cnb.api+json',
};

/** GitHub 最新**正式** release（/latest 天然排除 draft 与 prerelease，与 updater 口径一致） */
async function githubLatestRelease() {
  const res = await fetch(`${GH_API}/repos/${GH_REPO}/releases/latest`, { headers: ghHeaders });
  if (res.status === 404) return null;
  if (!res.ok) fail(`GitHub latest release 查询失败：HTTP ${res.status}`);
  return res.json();
}

async function cnbReleaseByTag(tag) {
  const res = await fetch(`${CNB_API}/${CNB_SLUG}/-/releases/tags/${encodeURIComponent(tag)}`, {
    headers: cnbHeaders,
  });
  if (res.status === 404) return null;
  if (!res.ok) await failHttp(res, `CNB release 查询失败（${tag}）`);
  return res.json();
}

async function cnbCreateRelease(tag, body) {
  const res = await fetch(`${CNB_API}/${CNB_SLUG}/-/releases`, {
    method: 'POST',
    headers: { ...cnbHeaders, 'content-type': 'application/json' },
    // draft/prerelease 显式 false：ADR-0022 §6 首个 Release 即正式 Release（updater 可见性口径）
    body: JSON.stringify({ tag_name: tag, name: tag, body, draft: false, prerelease: false }),
  });
  if (!res.ok && res.status !== 409) await failHttp(res, `CNB release 创建失败（${tag}）`);
  return res.ok ? res.json() : null;
}

async function download(url, dest) {
  const res = await fetch(url, { headers: ghHeaders });
  if (!res.ok) fail(`资产下载失败：HTTP ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

/** 三步上传（与 cnbcool/attachments 插件同型，TS / Go 两版实现交叉验证）：
 *  发起（asset-upload-url 换一次性 upload_url + verify_url）→ PUT 直传 → POST verify_url 回认 */
async function uploadAsset(releaseId, filePath) {
  const name = path.basename(filePath);
  const size = fs.statSync(filePath).size;
  const init = await fetch(
    `${CNB_API}/${CNB_SLUG}/-/releases/${encodeURIComponent(releaseId)}/asset-upload-url`,
    {
      method: 'POST',
      headers: { ...cnbHeaders, 'content-type': 'application/json' },
      // asset_name 才是文件名字段（SDK 的 name 服务端不识别）；ttl 0 = 永久保留（插件口径）
      body: JSON.stringify({ asset_name: name, size, ttl: 0 }),
    },
  );
  if (!init.ok) await failHttp(init, `发起上传失败（${name}）`);
  const { upload_url: uploadUrl, verify_url: verifyUrl } = await init.json();
  if (!uploadUrl || !verifyUrl) fail(`发起上传响应里没有上传 / 确认地址（${name}）`);
  // COS 预签名 PUT：裸字节 + octet-stream + 显式 Content-Length（对象存储拒 chunked）
  const up = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream', 'content-length': String(size) },
    body: fs.readFileSync(filePath),
  });
  if (!up.ok) await failHttp(up, `COS 直传失败（${name}）`);
  // 回认：POST 响应给的 verify_url 绝对地址——不自己拼 release_id/token/asset_path
  const confirm = await fetch(verifyUrl, { method: 'POST', headers: cnbHeaders });
  if (!confirm.ok) await failHttp(confirm, `上传确认失败（${name}）`);
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
  const genericMarker = `https://cnb.cool/${CNB_SLUG}/-/releases/download/`;
  const staleFeeds = [];
  for (const a of wanted.filter((x) => isFeedYmlName(x.name) && have.has(x.name))) {
    const url = cnbReleaseAssetUrl(CNB_SLUG, tag, a.name);
    const res = await fetch(url, { redirect: 'follow' });
    const text = res.ok ? await res.text() : '';
    if (!text.includes(genericMarker)) staleFeeds.push(a.name);
  }
  const missing = wanted.filter((a) => !have.has(a.name));
  if (existing && missing.length === 0 && staleFeeds.length === 0) {
    log(`${tag} 已镜像（${wanted.length} 个附件齐，generic feed 已改写），跳过`);
    return;
  }
  let release = existing;
  if (!release) {
    log(`创建 CNB release：${tag}`);
    release = await cnbCreateRelease(tag, latest.body ?? '');
    // 409（竞态已存在）时创建响应为空，回查一次——确认接口要 release_id
    if (!release) release = await cnbReleaseByTag(tag);
    if (!release) fail(`拿不到 CNB release（${tag}），无法上传附件`);
  }

  const stale = new Set(staleFeeds);
  const todo = wanted.filter((a) => !have.has(a.name) || stale.has(a.name));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aao-mirror-'));
  try {
    for (const a of todo) {
      log(`下载 ${a.name}`);
      const file = path.join(dir, a.name);
      await download(a.browser_download_url, file);
      if (isFeedYmlName(a.name)) {
        fs.writeFileSync(
          file,
          rewriteGenericFeedYml(fs.readFileSync(file, 'utf8'), { slug: CNB_SLUG, tag }),
        );
        log(`改写 generic feed ${a.name}`);
      }
      log(`上传 ${a.name} → CNB release ${tag}`);
      await uploadAsset(release.id, file);
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
