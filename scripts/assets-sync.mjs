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
];

const CHECK_ONLY = process.argv.includes('--check');
const FROM_ARG = (() => {
  const i = process.argv.indexOf('--from');
  return i >= 0 ? process.argv[i + 1] : undefined;
})();
const SOURCE = FROM_ARG ?? process.env.ASSETS_SOURCE ?? DEFAULT_SOURCE;

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

// 来源：本地目录直接用；否则 clone 到临时目录
let sourceDir;
let tmpDir = null;
if (fs.existsSync(SOURCE) && fs.statSync(SOURCE).isDirectory()) {
  sourceDir = path.resolve(SOURCE);
  console.log(`    源：${sourceDir}（本地目录）`);
} else {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aao-deps-'));
  const cloned = path.join(tmpDir, 'repo');
  console.log(`    源：${SOURCE}（临时目录克隆）`);
  try {
    execFileSync('git', ['clone', '--depth', '1', SOURCE, cloned], { stdio: ['ignore', 'pipe', 'inherit'] });
  } catch {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fail(`取件失败：访问不了来源（离线 / 本机无 git 凭据 / 地址失效）`);
  }
  sourceDir = cloned;
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
