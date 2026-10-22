#!/usr/bin/env node
// 运行时资源包**取件**：本仓不含这些产物（二进制 + 生成物），它们由外部快照仓库提供。
//
// 来源地址**不直写明文**（编码存在脚本内的常量里），可用环境变量或参数覆盖：
//   ASSETS_SOURCE=<本地目录|git 地址>   node scripts/assets-sync.mjs
//   node scripts/assets-sync.mjs --from <本地目录|git 地址>
//
// 用法：
//   node scripts/assets-sync.mjs                 # 取件（缺才拉；按根整取，快照为准）
//   node scripts/assets-sync.mjs --check         # 只检查是否已取件（setup.sh / dev.sh 用）
//
// 凭据自举（不依赖任何 shell 配置——环境重建后 export / rc 全部丢失，本链按优先级自动换候选）：
//   1) 环境变量 ASSETS_TOKEN / CNB_ASSETS_TOKEN
//   2) 本地漫游文件 ~/.cnb/.env.local（CNB_TOKEN_FILE 可换路径）里的 CNB_TOKEN
//      （~/.cnb/ 按用户维度漫游，环境销毁重建自动恢复；export / ~/.zshenv 不留存）
//   3) 环境变量 CNB_TOKEN（平台注入 / 流水线内置；作用域仅限当前仓，读不了外部素材源）
// clone 失败自动换下一个候选；已带凭据（URL 含 @）/ 非 CNB 地址 / 本地目录原样使用。
// CI 路径不变：ASSETS_SOURCE 由 CI secret 注入（地址内嵌凭据）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

/** 默认来源（编码存储，不写明文；可用 ASSETS_SOURCE / --from 覆盖） */
const SOURCE_HINT = 'cm9ycmlNLXN0ZXNzQS1yb3RpZEUtT0FBL3Jla2NpUHJldHNBL2xvb2MuYm5jLy86c3B0dGg=';
const DEFAULT_SOURCE = Buffer.from(SOURCE_HINT, 'base64').toString('utf8').split('').reverse().join('');

/** 取回的产物根（相对仓根；均为 .gitignore 忽略；整根替换，快照为准） */
const ROOTS = [
  'public/assets/skins',
  'public/assets/sim',
  'src/assets/audio/keysounds',
  'src/rendering/skin/gen',
  'src/audio/gen',
  'src/preview/video/sim/gen',
];

const CHECK_ONLY = process.argv.includes('--check');
const FROM_ARG = (() => {
  const i = process.argv.indexOf('--from');
  return i >= 0 ? process.argv[i + 1] : undefined;
})();

/**
 * 最终来源：显式 --from / ASSETS_SOURCE > 内置默认（凭据不在这里拼，见 sourceCandidates）。
 * 注意：不出现 scheme 字面量——本文件受 issue 02「来源不写明文」静态锁约束。
 */
const SOURCE = FROM_ARG ?? process.env.ASSETS_SOURCE ?? DEFAULT_SOURCE;

/**
 * 凭据候选链（去重保序）：环境 ASSETS_TOKEN / CNB_ASSETS_TOKEN > 漫游文件
 * ~/.cnb/.env.local（CNB_TOKEN_FILE 可换路径）里的 CNB_TOKEN > 环境 CNB_TOKEN。
 * 文件不在 / 读不了 / 无令牌行：跳过该候选，不影响后续。
 */
function credentialTokens() {
  const tokens = [];
  const seen = new Set();
  const push = (token) => {
    const value = (token ?? '').trim();
    if (value && !seen.has(value)) {
      seen.add(value);
      tokens.push(value);
    }
  };
  push(process.env.ASSETS_TOKEN);
  push(process.env.CNB_ASSETS_TOKEN);
  push(readTokenFile(process.env.CNB_TOKEN_FILE || path.join(os.homedir(), '.cnb/.env.local')));
  push(process.env.CNB_TOKEN);
  return tokens;
}

/** 读漫游 dotenv 里的令牌：兼容 `KEY=value` 与 `export KEY=value`，取首个令牌行 */
function readTokenFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return undefined; // 文件不在（未漫游 / 本地机）：跳过该候选
  }
  for (const line of text.split('\n')) {
    const matched = line.match(/^\s*(?:export\s+)?(?:ASSETS_TOKEN|CNB_ASSETS_TOKEN|CNB_TOKEN)\s*=\s*(.*)$/);
    if (matched) return matched[1].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return undefined;
}

/**
 * 拼出待尝试的来源 URL 列表（多候选，clone 失败自动换下一个）：
 * CNB 源且未带凭据 → 逐候选拼 `cnb:<令牌>@`；
 * 已带凭据、非 CNB 地址、本地目录 → 原样单候选（公开源 / CI secret 注入的地址）。
 */
function sourceCandidates(url, tokens) {
  if (url.includes('@') || !url.includes('://cnb.cool/')) return [url];
  const withCredentials = tokens.map((token) => url.replace('://cnb.cool/', `://cnb:${token}@cnb.cool/`));
  return withCredentials.length ? withCredentials : [url]; // 无任何候选时原样试一次
}

/** 日志用：剥掉 URL 里的凭据——令牌（含打码形式）一律不进日志 */
function stripCredential(url) {
  return url.replace(/\/\/[^/@]*@/, '//');
}

const fail = (msg) => {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
};

/** 工作区里缺/空的产物根 */
function missingRoots() {
  return ROOTS.filter((rel) => {
    const abs = path.join(REPO_ROOT, rel);
    return !fs.existsSync(abs) || fs.readdirSync(abs).length === 0;
  });
}

const missing = missingRoots();

if (CHECK_ONLY) {
  if (missing.length) {
    for (const rel of missing) console.error(`  ✗ ${rel}`);
    fail(`产物未取件（${missing.length}/${ROOTS.length} 个目录缺/空）。修复：npm run assets:sync`);
  }
  console.log(`==> 产物已取件（${ROOTS.length} 个目录）`);
  process.exit(0);
}

if (!missing.length) {
  console.log('==> 产物已取件，跳过（要强制刷新：删掉上述目录后重跑）');
  process.exit(0);
}
console.log(`==> 产物缺 ${missing.length}/${ROOTS.length} 个目录，开始取件…`);

// 来源：本地目录直接用；否则 clone 到临时目录（凭据候选逐个试，失败自动换下一个）
let sourceDir;
let tmpDir = null;
if (fs.existsSync(SOURCE) && fs.statSync(SOURCE).isDirectory()) {
  sourceDir = path.resolve(SOURCE);
  console.log(`    源：${sourceDir}（本地目录）`);
} else {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aao-deps-'));
  const cloned = path.join(tmpDir, 'repo');
  const candidates = sourceCandidates(SOURCE, credentialTokens());
  console.log(`    源：${stripCredential(SOURCE)}（临时目录克隆；${candidates.length} 个凭据候选）`);
  for (const [index, url] of candidates.entries()) {
    try {
      // -c credential.helper= ：URL 内嵌凭据只用于本次 clone，禁止被 store 类助手存盘
      // （本地 .git/.git-credentials 会把它当成 git 凭据顶掉原 token，读公共仓无恙、写直接 403）
      execFileSync('git', ['-c', 'credential.helper=', 'clone', '--depth', '1', url, cloned], { stdio: ['ignore', 'pipe', 'inherit'] });
      sourceDir = cloned;
      break;
    } catch {
      if (index < candidates.length - 1) console.error(`  ! 凭据候选 ${index + 1} 访问失败，尝试下一个…`);
    }
  }
  if (!sourceDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fail(
      `取件失败：${candidates.length} 个凭据候选都访问不了来源（离线 / 令牌无素材源读权限 / 地址失效）。修复口径：\n` +
        '  1) 写漫游文件（跨环境重建保留）：echo \'export CNB_TOKEN=<有素材源读权限的令牌>\' >> ~/.cnb/.env.local\n' +
        '  2) 临时注入：ASSETS_TOKEN=<令牌> node scripts/assets-sync.mjs\n' +
        '  3) 换来源：ASSETS_SOURCE=<本地目录|git 地址> node scripts/assets-sync.mjs',
    );
  }
}

try {
  for (const rel of ROOTS) {
    const src = path.join(sourceDir, rel);
    const dest = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(src)) {
      console.warn(`  ! 快照里没有 ${rel}，跳过`);
      continue;
    }
    fs.rmSync(dest, { recursive: true, force: true }); // 整根替换：快照为准
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
    console.log(`  ✓ ${rel}`);
  }
} finally {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
}

const stillMissing = missingRoots();
if (stillMissing.length) fail(`取件后仍缺：${stillMissing.join(', ')}`);
console.log('==> 取件完成');
