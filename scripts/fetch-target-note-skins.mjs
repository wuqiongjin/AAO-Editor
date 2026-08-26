#!/usr/bin/env node
/**
 * fetch-target-note-skins.mjs —— 精准拉取 issue 29 扩容所需的 12 个皮肤包
 *
 * 与 fetch-bestdori-skins.mjs 的区别：
 *  - 不读 _info.json 全树、不生成 manifest（那些是全量归档脚本的职责）；
 *  - 目标包是写死的 7 普通（skin01..06） + 5 方向（directionalflickskin01..04）；
 *  - 拉取的文件清单与 build-note-skins.mjs 严格对齐，避免运行时缺资源：
 *      普通包：.sprites + RhythmGameSprites.png + longNoteLine.png + longNoteLine2.png + simultaneous_line.png
 *      方向包：.sprites + DirectionalFlickSprites.png + FlickNoteLine_l.png + FlickNoteLine_r.png
 *  - 输出位置：docs/resource/bestdori/jp/<category>/<id>_rip/<filename>（与 build-note-skins.mjs 的 ARCHIVE_ROOT 拼读对齐）
 *
 * 用法：node scripts/fetch-target-note-skins.mjs [--dry-run]
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const BASE_URL = 'https://bestdori.com';
const SERVER = 'jp';
const ARCHIVE_ROOT = path.join(REPO_ROOT, 'docs/resource/bestdori', SERVER);

const USER_AGENT =
  'bestdori-skin-archive/1.0 (local research archive for a fan chart editor; low-rate fetching)';
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 800;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DRY_RUN = process.argv.includes('--dry-run');

// ---- 目标包清单（issue 29 扩容 7+5：skin00..06 + directionalflickskin00..04） ----
// skin00 / directionalflickskin00 的 PNG 已在 public/assets/skins/<id>/ 入库运行时，
// 但本脚本也需要补拉 .sprites（build-note-skins.mjs 重新生成注册表必读）。
// skin01..06 + directionalflickskin01..04 = 11 个全新包，从 Bestdori 拉全套源。
// 与 build-note-skins.mjs 的清单同步；如需扩缩请改两处。
//
// 字段约定：
//   id   = Bestdori 包名（用于 build-note-skins.mjs 的 NOTE_PACKS / DIR_PACKS id）
//   urlDir = Bestdori URL 段：noteskin/<id>_rip（**不**含"rhythm-note-skins" / "directional-flick-skins"）
//   archiveDir = 本地归档目录相对路径：rhythm-note-skins/<id>_rip（与 manifest.example 的 localPath 对齐）
//   label = 用户视角下的同名（跨普通/方向包"同号同名"约定）
const NOTE_PACKS = [
  { id: 'skin00', urlDir: 'skin00_rip', archiveDir: 'rhythm-note-skins/skin00_rip', label: 'Skin 00', partial: true },
  { id: 'skin01', urlDir: 'skin01_rip', archiveDir: 'rhythm-note-skins/skin01_rip', label: 'Skin 01' },
  { id: 'skin02', urlDir: 'skin02_rip', archiveDir: 'rhythm-note-skins/skin02_rip', label: 'Skin 02' },
  { id: 'skin03', urlDir: 'skin03_rip', archiveDir: 'rhythm-note-skins/skin03_rip', label: 'Skin 03' },
  { id: 'skin04', urlDir: 'skin04_rip', archiveDir: 'rhythm-note-skins/skin04_rip', label: 'Skin 04' },
  { id: 'skin05', urlDir: 'skin05_rip', archiveDir: 'rhythm-note-skins/skin05_rip', label: 'Skin 05' },
  { id: 'skin06', urlDir: 'skin06_rip', archiveDir: 'rhythm-note-skins/skin06_rip', label: 'Skin 06' },
];
const DIR_PACKS = [
  { id: 'directionalflickskin00', urlDir: 'directionalflickskin00_rip', archiveDir: 'directional-flick-skins/directionalflickskin00_rip', label: 'Skin 00', partial: true },
  { id: 'directionalflickskin01', urlDir: 'directionalflickskin01_rip', archiveDir: 'directional-flick-skins/directionalflickskin01_rip', label: 'Skin 01' },
  { id: 'directionalflickskin02', urlDir: 'directionalflickskin02_rip', archiveDir: 'directional-flick-skins/directionalflickskin02_rip', label: 'Skin 02' },
  { id: 'directionalflickskin03', urlDir: 'directionalflickskin03_rip', archiveDir: 'directional-flick-skins/directionalflickskin03_rip', label: 'Skin 03' },
  { id: 'directionalflickskin04', urlDir: 'directionalflickskin04_rip', archiveDir: 'directional-flick-skins/directionalflickskin04_rip', label: 'Skin 04' },
];

// ---- 拉取文件清单（与 build-note-skins.mjs copyPackFiles 严格对齐） ----
const NOTE_FILES = ['.sprites', 'RhythmGameSprites.png', 'longNoteLine.png', 'longNoteLine2.png', 'simultaneous_line.png'];
const DIR_FILES = ['.sprites', 'DirectionalFlickSprites.png', 'FlickNoteLine_l.png', 'FlickNoteLine_r.png'];

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
        throw new Error(`HTTP ${res.status}`);
      }
      return res;
    } catch (err) {
      lastError = err;
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

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function fetchOne(pack, filename) {
  const url = `${BASE_URL}/assets/${SERVER}/ingameskin/noteskin/${pack.urlDir}/${encodeURIComponent(filename)}`;
  const destAbs = path.join(ARCHIVE_ROOT, pack.archiveDir, filename);
  const rel = path.relative(REPO_ROOT, destAbs);
  if (DRY_RUN) {
    console.log(`  - [dry-run] ${pack.id} :: ${filename}  →  ${rel}`);
    return { status: 'dry-run' };
  }
  // 已存在且非空 → 跳过（断点重跑）
  try {
    const stat = await fs.stat(destAbs);
    if (stat.size > 0) {
      console.log(`  · skip ${pack.id}/${filename}（已存在，${stat.size} bytes）`);
      return { status: 'skipped', size: stat.size };
    }
  } catch {
    // 不存在则下载
  }
  const res = await fetchWithRetry(url, REQUEST_TIMEOUT_MS);
  if (!res.ok) {
    console.error(`  ✗ ${pack.id}/${filename} → HTTP ${res.status}`);
    return { status: 'failed', code: res.status };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  // PNG 魔数校验（.sprites 是 application/octet-stream 跳过）
  if (filename.endsWith('.png')) {
    if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) {
      console.error(`  ✗ ${pack.id}/${filename} → 非 PNG（魔数错）`);
      return { status: 'failed', reason: 'png-magic' };
    }
  }
  await fs.mkdir(path.dirname(destAbs), { recursive: true });
  await fs.writeFile(destAbs, buf);
  console.log(`  ✓ ${pack.id}/${filename}  ${buf.length} bytes  sha=${sha256(buf).slice(0, 12)}…`);
  return { status: 'ok', size: buf.length };
}

async function fetchPack(pack, kind) {
  // partial = 该包 PNG 已在 public/ 入库运行时；本脚本只需补 .sprites（已存在的 PNG 不重下）
  const files = (kind === 'note' ? NOTE_FILES : DIR_FILES).filter((f) => !(pack.partial && f !== '.sprites'));
  console.log(`\n[${pack.id}]${pack.partial ? ' (partial: 仅补 .sprites)' : ''}`);
  let okCount = 0;
  for (const f of files) {
    const r = await fetchOne(pack, f);
    if (r.status === 'ok' || r.status === 'skipped' || r.status === 'dry-run') okCount++;
  }
  return okCount;
}

async function main() {
  console.log(`[fetch-target-note-skins] server=${SERVER} archive=${path.relative(REPO_ROOT, ARCHIVE_ROOT)}${DRY_RUN ? ' (dry-run)' : ''}`);
  console.log(`[fetch-target-note-skins] 目标：${NOTE_PACKS.length} 普通 + ${DIR_PACKS.length} 方向 = ${NOTE_PACKS.length + DIR_PACKS.length} 个包`);

  let totalOk = 0;
  for (const p of NOTE_PACKS) totalOk += await fetchPack(p, 'note');
  for (const p of DIR_PACKS) totalOk += await fetchPack(p, 'directional');

  console.log(`\n[fetch-target-note-skins] 完成。已就绪文件数：${totalOk}`);
  if (DRY_RUN) {
    console.log('[fetch-target-note-skins] dry-run 模式，未写任何文件。');
  }
}

main().catch((err) => {
  console.error(`[fetch-target-note-skins] 错误: ${err?.message ?? err}`);
  process.exit(1);
});
