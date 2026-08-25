#!/usr/bin/env node
/**
 * fetch-bestdori-skins.mjs —— Bestdori 音游皮肤/键音资源归档脚本
 *
 * 用途（对应计划：爬取 Bestdori 皮肤资源 / issue29 前置准备）：
 *   从 Bestdori 公开接口发现并归档四类资源：
 *     1. rhythm-note-skin          普通节奏图示样式包（ingameskin/noteskin/skin* 等）
 *     2. directional-flick-skin    方向滑键样式包（ingameskin/noteskin/directionalflickskin*）
 *     3. rhythm-note-se            击打音效（sound/tapseskin/*）与技能键音效（sound/common）
 *     4. reference-only/judgeskin  判定结果参考资源（仅研究用，不接入渲染器）
 *
 * 特性：
 *   - 按 Bestdori 文件清单下载（不猜测文件名），自动适配多图/缺文件包
 *   - 校验 HTTP 状态、Content-Type 与扩展名一致性、PNG 魔数、SHA-256
 *   - HTTP 200 的 HTML SPA 回退页一律判为失败
 *   - 断点重跑：已存在且哈希与 manifest 一致的文件自动跳过
 *   - 低并发 + 有限重试；失败写入 failures.json，不静默丢失
 *
 * 用法：
 *   node scripts/fetch-bestdori-skins.mjs [--server jp|en|tw|cn|kr]
 *                                         [--output docs/resource/bestdori]
 *                                         [--dry-run] [--concurrency 3]
 *
 * 约定：
 *   - 不下载 .bundle（Unity 二进制包），作为“按策略跳过”记录进 failures.json
 *   - 归档只写 docs/resource/bestdori/，不触碰 src/、public/assets/skins/ 等运行时资源
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

const BASE_URL = 'https://bestdori.com';
const SERVERS = ['jp', 'en', 'tw', 'cn', 'kr'];
const DEFAULT_SERVER = 'jp';
const DEFAULT_OUTPUT_REL = 'docs/resource/bestdori';

const USER_AGENT =
  'bestdori-skin-archive/1.0 (local research archive for a fan chart editor; low-rate fetching)';
const REQUEST_TIMEOUT_MS = 60_000;
const JSON_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 800;

// ---------------------------------------------------------------------------
// 资源类别定义
// ---------------------------------------------------------------------------

/** 常规类别：从 _info.json 的某个子树收集叶子包 */
const CATEGORY_DEFS = [
  {
    id: 'rhythm-note-skin',
    dir: 'rhythm-note-skins',
    infoSegments: ['ingameskin', 'noteskin'],
    select: (name) => !name.startsWith('directionalflickskin'),
    referenceOnly: false,
  },
  {
    id: 'directional-flick-skin',
    dir: 'directional-flick-skins',
    infoSegments: ['ingameskin', 'noteskin'],
    select: (name) => name.startsWith('directionalflickskin'),
    referenceOnly: false,
  },
  {
    id: 'rhythm-note-se',
    dir: 'rhythm-note-se',
    infoSegments: ['sound', 'tapseskin'],
    select: () => true,
    referenceOnly: false,
  },
  {
    id: 'reference-only/judgeskin',
    dir: 'reference-only/judgeskin',
    infoSegments: ['ingameskin', 'judgeskin'],
    select: () => true,
    referenceOnly: true,
  },
];

/** 特殊包：不在子树里、而是直接以叶子形式存在的资源包 */
const SPECIAL_PACKAGES = [
  {
    categoryId: 'rhythm-note-se',
    dir: 'rhythm-note-se',
    segments: ['sound', 'common'],
    packageName: 'common',
    referenceOnly: false,
  },
];

/** 判断包名是否为目录预览 sample 包（如 skin00sample / habahiro_sample） */
function isSamplePackageName(name) {
  return /_?sample$/.test(name);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`Bestdori 音游皮肤/键音资源归档脚本

用法:
  node scripts/fetch-bestdori-skins.mjs [选项]

选项:
  --server <code>       Bestdori 服务器: ${SERVERS.join('|')}（默认: ${DEFAULT_SERVER}）
  --output <dir>        归档输出根目录（默认: ${DEFAULT_OUTPUT_REL}，相对仓库根；
                        显式相对路径则相对当前工作目录解析）
  --dry-run             只做目录发现并列出待下载清单，不写任何文件
  --concurrency <n>     并发请求数，2-4（默认: 3）
  -h, --help            显示本帮助

示例:
  node scripts/fetch-bestdori-skins.mjs --server jp --output docs/resource/bestdori
  node scripts/fetch-bestdori-skins.mjs --dry-run
`);
}

function parseArgs(argv) {
  const args = {
    server: DEFAULT_SERVER,
    output: null,
    dryRun: false,
    concurrency: 3,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--server': {
        const value = argv[++i];
        if (!value) die('--server 需要一个参数');
        args.server = value.toLowerCase();
        break;
      }
      case '--output': {
        const value = argv[++i];
        if (!value) die('--output 需要一个参数');
        args.output = value;
        break;
      }
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--concurrency': {
        const value = Number(argv[++i]);
        if (!Number.isInteger(value) || value < 1 || value > 8) {
          die('--concurrency 需要 1-8 的整数');
        }
        args.concurrency = value;
        break;
      }
      case '-h':
      case '--help':
        args.help = true;
        break;
      default:
        die(`未知参数: ${arg}（使用 --help 查看用法）`);
    }
  }
  return args;
}

function die(message, code = 2) {
  console.error(`[bestdori-fetch] 错误: ${message}`);
  process.exit(code);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// 带重试的请求
// ---------------------------------------------------------------------------

/**
 * 发起带有限重试的 GET。
 * 仅对网络错误 / 5xx / 429 重试；404 等客户端错误直接返回响应交给调用方定性。
 */
async function fetchWithRetry(url, timeoutMs) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error(`请求超时（${timeoutMs}ms）`)),
      timeoutMs,
    );
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'user-agent': USER_AGENT },
      });
      if (res.status >= 500 || res.status === 429) {
        throw new Error(`HTTP ${res.status}（服务端/限流，可重试）`);
      }
      return res;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 250;
        await sleep(delay);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function fetchJson(url) {
  const res = await fetchWithRetry(url, JSON_TIMEOUT_MS);
  if (!res.ok) {
    throw Object.assign(new Error(`HTTP ${res.status}`), { statusCode: res.status });
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('响应不是合法 JSON（疑似 SPA 回退页）');
  }
}

// ---------------------------------------------------------------------------
// 目录发现
// ---------------------------------------------------------------------------

function getInfoNode(root, segments) {
  let node = root;
  for (const segment of segments) {
    if (node == null || typeof node !== 'object') return null;
    node = node[segment];
  }
  return node ?? null;
}

/** 深度优先收集子树里的叶子包（叶子 = 数字，表示该包声明的文件数量） */
function collectLeafPackages(node, segments, out = []) {
  if (typeof node === 'number') {
    out.push({
      segments,
      name: segments[segments.length - 1],
      declaredCount: node,
    });
    return out;
  }
  if (node && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      collectLeafPackages(node[key], [...segments, key], out);
    }
  }
  return out;
}

function buildPackageList(info, server) {
  const packages = [];
  for (const def of CATEGORY_DEFS) {
    const subtree = getInfoNode(info, def.infoSegments);
    if (subtree === null) {
      throw new Error(`目录树中缺少 ${def.infoSegments.join('/')}（服务器 ${server} 结构可能不同）`);
    }
    for (const pkg of collectLeafPackages(subtree, def.infoSegments)) {
      if (!def.select(pkg.name)) continue;
      packages.push({
        server,
        categoryId: def.id,
        categoryDir: def.dir,
        packageName: pkg.name,
        kind: isSamplePackageName(pkg.name) ? 'sample' : 'main',
        assetPath: pkg.segments.join('/'),
        referenceOnly: def.referenceOnly,
        declaredCount: pkg.declaredCount,
      });
    }
  }
  for (const special of SPECIAL_PACKAGES) {
    const node = getInfoNode(info, special.segments);
    if (typeof node !== 'number') {
      console.warn(
        `[bestdori-fetch] 注意: 目录树缺少 ${special.segments.join('/')}，跳过该特殊包`,
      );
      continue;
    }
    packages.push({
      server,
      categoryId: special.categoryId,
      categoryDir: special.dir,
      packageName: special.packageName,
      kind: 'main',
      assetPath: special.segments.join('/'),
      referenceOnly: special.referenceOnly,
      declaredCount: node,
    });
  }
  packages.sort(
    (a, b) =>
      a.categoryId.localeCompare(b.categoryId) || a.assetPath.localeCompare(b.assetPath),
  );
  return packages;
}

// ---------------------------------------------------------------------------
// 下载任务构建
// ---------------------------------------------------------------------------

/** 按扩展名期望的 Content-Type；null 表示只要求不是 text/html */
function expectedContentType(filename) {
  if (filename.endsWith('.png')) return 'image/png';
  if (filename.endsWith('.mp3')) return 'audio/mpeg';
  return null;
}

function toPosix(...parts) {
  return parts.join('/');
}

async function buildTasks(packages, server, outputRoot, fetchConcurrency) {
  const tasks = [];
  const skippedBundles = [];
  const packageFailures = [];

  // 小 JSON 清单，允许稍高并发
  let index = 0;
  async function manifestWorker() {
    while (index < packages.length) {
      const pkg = packages[index++];
      const manifestUrl = `${BASE_URL}/api/explorer/${server}/assets/${pkg.assetPath}.json`;
      try {
        pkg.files = await fetchJson(manifestUrl);
      } catch (error) {
        pkg.files = null;
        pkg.manifestError = error.message;
        packageFailures.push({
          level: 'package-manifest',
          outcome: 'failed',
          reason: `文件清单获取失败: ${error.message}`,
          server,
          categoryId: pkg.categoryId,
          packageName: pkg.packageName,
          assetPath: pkg.assetPath,
          url: manifestUrl,
        });
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(fetchConcurrency + 1, packages.length) }, manifestWorker),
  );

  for (const pkg of packages) {
    if (!Array.isArray(pkg.files)) continue;
    const ripDirName = `${pkg.packageName}_rip`;
    for (const filename of pkg.files) {
      if (filename.endsWith('.bundle')) {
        skippedBundles.push({
          level: 'file',
          outcome: 'skipped',
          reason: '按策略跳过 .bundle（Unity 二进制包不入档）',
          server,
          categoryId: pkg.categoryId,
          packageName: pkg.packageName,
          assetPath: pkg.assetPath,
          filename,
          url: `${BASE_URL}/assets/${server}/${pkg.assetPath}_rip/${filename}`,
        });
        continue;
      }
      const localRel = toPosix(
        server,
        pkg.categoryDir,
        ripDirName,
        filename,
      );
      tasks.push({
        pkg,
        filename,
        url: `${BASE_URL}/assets/${server}/${pkg.assetPath}_rip/${encodeURIComponent(filename)}`,
        localRel,
        localAbs: path.join(outputRoot, ...localRel.split('/')),
      });
    }
  }

  tasks.sort((a, b) => a.localRel.localeCompare(b.localRel));
  return { tasks, skippedBundles, packageFailures };
}

// ---------------------------------------------------------------------------
// 校验与哈希
// ---------------------------------------------------------------------------

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function hashExistingFile(absPath) {
  try {
    const buffer = await fs.readFile(absPath);
    return { ok: true, sha256: sha256Buffer(buffer), size: buffer.byteLength };
  } catch {
    return { ok: false };
  }
}

/** 对下载内容做全部校验；返回错误原因或 null */
function validateResponse(res, buffer, filename) {
  if (res.status !== 200) return `HTTP ${res.status}`;
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('text/html')) return 'HTML 回退页（非真实资源）';
  const expected = expectedContentType(filename);
  if (expected && !contentType.split(';')[0].trim().startsWith(expected)) {
    return `Content-Type 不匹配: 期望 ${expected}，实际 ${contentType || '空'}`;
  }
  if (buffer.byteLength === 0) return '空文件';
  if (
    filename.endsWith('.png') &&
    !buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'PNG 魔数不匹配（内容不是 PNG 图片）';
  }
  return null;
}

// ---------------------------------------------------------------------------
// 并发池
// ---------------------------------------------------------------------------

async function runPool(items, limit, worker) {
  let index = 0;
  async function lane() {
    while (index < items.length) {
      const item = items[index++];
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  if (!SERVERS.includes(args.server)) {
    die(`--server 必须是 ${SERVERS.join('|')} 之一，收到: ${args.server}`);
  }

  const server = args.server;
  const outputRoot = args.output
    ? path.resolve(process.cwd(), args.output)
    : path.resolve(REPO_ROOT, DEFAULT_OUTPUT_REL);

  console.log(
    `[bestdori-fetch] 服务器=${server} 输出=${path.relative(process.cwd(), outputRoot) || '.'}${args.dryRun ? '（dry-run，不写文件）' : ''}`,
  );

  // 1. 目录发现 ------------------------------------------------------------
  const infoUrl = `${BASE_URL}/api/explorer/${server}/assets/_info.json`;
  let info;
  try {
    info = await fetchJson(infoUrl);
  } catch (error) {
    die(`目录树获取失败（${infoUrl}）: ${error.message}`, 2);
  }

  const packages = buildPackageList(info, server);
  const { tasks, skippedBundles, packageFailures } = await buildTasks(
    packages,
    server,
    outputRoot,
    args.concurrency,
  );

  // 2. dry-run 或汇总打印 ---------------------------------------------------
  const byCategory = new Map();
  for (const task of tasks) {
    const entry = byCategory.get(task.pkg.categoryId) ?? {
      dir: task.pkg.categoryDir,
      packages: new Set(),
      files: 0,
    };
    entry.packages.add(task.pkg.packageName);
    entry.files += 1;
    byCategory.set(task.pkg.categoryId, entry);
  }

  console.log('\n== 资源发现结果 ==');
  for (const [categoryId, entry] of byCategory) {
    console.log(
      `  ${categoryId.padEnd(26)} 包 ${String(entry.packages.size).padStart(2)} 个，待下载文件 ${String(entry.files).padStart(4)} 个（目录 ${server}/${entry.dir}/）`,
    );
    if (args.dryRun) {
      for (const pkg of packages.filter((p) => p.categoryId === categoryId)) {
        const fileCount =
          Array.isArray(pkg.files)
            ? pkg.files.filter((f) => !f.endsWith('.bundle')).length
            : '清单获取失败';
        console.log(
          `    - ${pkg.assetPath}（${pkg.kind}${pkg.referenceOnly ? ', reference-only' : ''}, ${fileCount} 文件）`,
        );
      }
    }
  }
  const bundleSkipCount = skippedBundles.length;
  console.log(
    `\n合计: 待下载 ${tasks.length} 个文件；另有 ${bundleSkipCount} 个 .bundle 按策略跳过。`,
  );
  if (packageFailures.length > 0) {
    console.warn(`注意: ${packageFailures.length} 个资源包的文件清单获取失败（将记入 failures）。`);
  }

  if (args.dryRun) {
    console.log('\n[dry-run] 结束，未写入任何文件。');
    process.exit(packageFailures.length > 0 ? 1 : 0);
  }

  // 3. 加载既有 manifest（断点重跑） ----------------------------------------
  const manifestPath = path.join(outputRoot, 'manifest.json');
  const failuresPath = path.join(outputRoot, 'failures.json');
  const previousEntries = [];
  try {
    const parsed = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    if (Array.isArray(parsed.entries)) {
      previousEntries.push(...parsed.entries.filter((e) => e.server === server));
    }
  } catch {
    // 无历史 manifest，正常首次运行
  }
  const previousByPath = new Map(previousEntries.map((entry) => [entry.localPath, entry]));

  // 4. 并发下载 -------------------------------------------------------------
  let doneCount = 0;
  const downloadedEntries = [];
  const unchangedEntries = [];
  const failures = [];

  await runPool(tasks, args.concurrency, async (task) => {
    doneCount += 1;
    const label = `${task.pkg.categoryId}/${task.pkg.packageName}/${task.filename}`;

    // 已存在且与上次 manifest 哈希一致 → 跳过
    const previous = previousByPath.get(task.localRel);
    if (previous) {
      const existing = await hashExistingFile(task.localAbs);
      if (existing.ok && existing.sha256 === previous.sha256) {
        unchangedEntries.push({ ...previous });
        process.stdout.write(
          `\r[${String(doneCount).padStart(String(tasks.length).length)}/${tasks.length}] 未变化跳过 ${label}`,
        );
        return;
      }
    }

    let res;
    try {
      res = await fetchWithRetry(task.url, REQUEST_TIMEOUT_MS);
    } catch (error) {
      failures.push({
        level: 'file',
        outcome: 'failed',
        reason: `网络错误（重试 ${MAX_ATTEMPTS} 次后仍失败）: ${error.message}`,
        server,
        categoryId: task.pkg.categoryId,
        packageName: task.pkg.packageName,
        assetPath: task.pkg.assetPath,
        filename: task.filename,
        url: task.url,
      });
      process.stdout.write(`\n[失败] ${label}: ${error.message}\n`);
      return;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const problem = validateResponse(res, buffer, task.filename);
    if (problem) {
      failures.push({
        level: 'file',
        outcome: 'failed',
        reason: problem,
        server,
        categoryId: task.pkg.categoryId,
        packageName: task.pkg.packageName,
        assetPath: task.pkg.assetPath,
        filename: task.filename,
        url: task.url,
        httpStatus: res.status,
        contentType: res.headers.get('content-type') || '',
      });
      process.stdout.write(`\n[失败] ${label}: ${problem}\n`);
      return;
    }

    // 先写临时文件再原子改名，避免中断留下半截文件
    const tmpAbs = `${task.localAbs}.part`;
    await fs.mkdir(path.dirname(task.localAbs), { recursive: true });
    await fs.writeFile(tmpAbs, buffer);
    await fs.rename(tmpAbs, task.localAbs);

    const oldEntry = previousByPath.get(task.localRel);
    downloadedEntries.push({
      server,
      categoryId: task.pkg.categoryId,
      packageId: task.pkg.packageName,
      packageKind: task.pkg.kind,
      referenceOnly: task.pkg.referenceOnly,
      assetPath: task.pkg.assetPath,
      filename: task.filename,
      url: task.url,
      localPath: task.localRel,
      httpStatus: res.status,
      contentType: res.headers.get('content-type') || '',
      size: buffer.byteLength,
      sha256: sha256Buffer(buffer),
      fetchedAt: new Date().toISOString(),
      refetchedFromPreviousRun: Boolean(oldEntry),
    });
    process.stdout.write(
      `\r[${String(doneCount).padStart(String(tasks.length).length)}/${tasks.length}] 已下载 ${label} (${Math.round(buffer.byteLength / 1024)}KB)${' '.repeat(20)}`,
    );
  });
  process.stdout.write('\n');

  // 清单获取失败的包：把上一轮仍然有效的条目继续保留在 manifest 中，
  // 保证“网络错误不会导致清单静默丢失”。
  const failedPackageIds = new Set(
    packageFailures.map((f) => `${f.categoryId}::${f.assetPath}`),
  );
  const carriedOver = previousEntries.filter((entry) => {
    const key = `${entry.categoryId}::${entry.assetPath}`;
    return failedPackageIds.has(key);
  });

  // 上轮有记录但本轮源上已消失的条目：从 manifest 移除并提示
  const plannedPaths = new Set(tasks.map((t) => t.localRel));
  const disappeared = previousEntries.filter(
    (entry) =>
      !plannedPaths.has(entry.localPath) &&
      !carriedOver.some((c) => c.localPath === entry.localPath),
  );
  for (const entry of disappeared) {
    console.warn(
      `[bestdori-fetch] 注意: 源上不再列出 ${entry.localPath}，已从 manifest 移除（本地文件未删除）`,
    );
  }

  // 5. 写 manifest / failures ----------------------------------------------
  const entries = [...unchangedEntries, ...downloadedEntries, ...carriedOver].sort((a, b) =>
    a.localPath.localeCompare(b.localPath),
  );
  const allFailures = [...packageFailures, ...failures, ...skippedBundles];

  const manifestDoc = {
    schemaVersion: 1,
    description: 'Bestdori 音游皮肤/键音资源归档清单（由 scripts/fetch-bestdori-skins.mjs 生成）',
    updatedAt: new Date().toISOString(),
    lastRun: {
      server,
      generatedAt: new Date().toISOString(),
      counts: {
        packagesDiscovered: packages.length,
        filesPlanned: tasks.length,
        downloaded: downloadedEntries.length,
        skippedUnchanged: unchangedEntries.length,
        carriedOverWhileManifestFailed: carriedOver.length,
        failed: failures.length + packageFailures.length,
        skippedBundles: bundleSkipCount,
      },
    },
    entries,
  };
  const failuresDoc = {
    schemaVersion: 1,
    description:
      'Bestdori 归档失败/跳过记录：outcome=failed 为真实失败，outcome=skipped 为按策略跳过（如 .bundle）',
    updatedAt: new Date().toISOString(),
    lastRun: { server },
    items: allFailures,
  };

  await fs.mkdir(outputRoot, { recursive: true });
  await fs.writeFile(manifestPath, `${JSON.stringify(manifestDoc, null, 2)}\n`, 'utf8');
  await fs.writeFile(failuresPath, `${JSON.stringify(failuresDoc, null, 2)}\n`, 'utf8');

  // 6. 汇总 -----------------------------------------------------------------
  const totalBytes = downloadedEntries.reduce((sum, entry) => sum + entry.size, 0);
  console.log('\n== 归档完成 ==');
  console.log(`  新下载: ${downloadedEntries.length}（共 ${(totalBytes / 1024 / 1024).toFixed(1)} MB）`);
  console.log(`  未变化跳过: ${unchangedEntries.length}`);
  if (carriedOver.length > 0) console.log(`  清单失败但本地有效而保留: ${carriedOver.length}`);
  console.log(`  失败: ${failures.length + packageFailures.length}`);
  console.log(`  按策略跳过(.bundle): ${bundleSkipCount}`);
  console.log(`  manifest: ${path.relative(process.cwd(), manifestPath)}`);
  console.log(`  failures: ${path.relative(process.cwd(), failuresPath)}`);

  if (failures.length + packageFailures.length > 0) {
    console.error('\n[bestdori-fetch] 存在失败项，详见 failures.json（退出码 1）');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`[bestdori-fetch] 未预期错误: ${error?.stack || error}`);
  process.exit(2);
});