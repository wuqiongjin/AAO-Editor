#!/usr/bin/env node
// issue 29 音符皮肤·构建期脚本（grill 2026-08-24 定案 Q1/Q2）：
// - 从 docs/resource/bestdori 归档（gitignore，仅研究用）把**选定**皮肤包的 PNG 拷入
//   `public/assets/skins/<packId>/`（产物入库，离线零配置）；
// - 解析包内 `.sprites`（Unity 序列化 JSON，含每张精灵的官方 m_Name/m_Rect），
//   生成 `src/renderer/noteSkinRegistry.gen.ts`（入库，运行时唯一皮肤数据源）；
// - 归档目录本身不进 git、不进运行时，版权边界（docs/resource/bestdori/README.md）不破。
//
// 用法：
//   node scripts/build-note-skins.mjs           # 拷贝 + 生成注册表
//   node scripts/build-note-skins.mjs --check   # 只校验（不写文件），CI 可用
//
// 扩容（issue 29 定案 Q5：验证后扩至 7 普通 + 5 方向）：在 NOTE_PACKS / DIR_PACKS 加一行重跑即可。
// 手工覆写口（Q2）：可选 `scripts/note-skin-overrides.json`，形如
//   { "packs": { "<packId>": { "inkL": [42, 67], "inkR": [55, 53] } } }
// inkL/inkR = 方向键精灵 [左墨迹缩进, 右墨迹缩进]（源像素），供同时点击线贴墨迹边缘；深合并进注册表。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const CHECK_ONLY = process.argv.includes('--check');

const ARCHIVE_ROOT = 'docs/resource/bestdori';
const SERVER = 'jp';
const PUBLIC_ROOT = 'public/assets/skins';
const REGISTRY_OUT = 'src/renderer/noteSkinRegistry.gen.ts';
const OVERRIDES_FILE = 'scripts/note-skin-overrides.json';

// ---- 内置清单（issue 29 2026-08-24 grill 定案 Q5：先 skin00 + directionalflickskin00 打通管线，
//   验证后扩至 7 普通（skin00–06）+ 5 方向（directionalflickskin00–04）。
//   扩容即在本清单加行，**无需改脚本**。） ----
const NOTE_PACKS = [
  { id: 'skin00', dir: 'rhythm-note-skins/skin00_rip', label: 'Skin 00' },
  { id: 'skin01', dir: 'rhythm-note-skins/skin01_rip', label: 'Skin 01' },
  { id: 'skin02', dir: 'rhythm-note-skins/skin02_rip', label: 'Skin 02' },
  { id: 'skin03', dir: 'rhythm-note-skins/skin03_rip', label: 'Skin 03' },
  { id: 'skin04', dir: 'rhythm-note-skins/skin04_rip', label: 'Skin 04' },
  { id: 'skin05', dir: 'rhythm-note-skins/skin05_rip', label: 'Skin 05' },
  { id: 'skin06', dir: 'rhythm-note-skins/skin06_rip', label: 'Skin 06' },
];
// 方向键包面向用户与普通包同名（用户不感知"两种包"；同编号天然配对；按条目覆盖区按 eligibility 自动分流）
const DIR_PACKS = [
  { id: 'directionalflickskin00', dir: 'directional-flick-skins/directionalflickskin00_rip', label: 'Skin 00' },
  { id: 'directionalflickskin01', dir: 'directional-flick-skins/directionalflickskin01_rip', label: 'Skin 01' },
  { id: 'directionalflickskin02', dir: 'directional-flick-skins/directionalflickskin02_rip', label: 'Skin 02' },
  { id: 'directionalflickskin03', dir: 'directional-flick-skins/directionalflickskin03_rip', label: 'Skin 03' },
  { id: 'directionalflickskin04', dir: 'directional-flick-skins/directionalflickskin04_rip', label: 'Skin 04' },
];

const LANES = 7;
const failures = [];

function fail(msg) {
  failures.push(msg);
}

function readArchiveFile(packDir, filename) {
  const p = path.join(ARCHIVE_ROOT, SERVER, packDir, filename);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p);
}

function pngSize(buf) {
  // PNG 头：8 字节签名 + 4 长度 + 4 'IHDR' + 宽高各 4 字节（大端）
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) fail('不是有效 PNG（缺 IHDR）');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * 解码 8-bit 调色板 PNG（colorType 3，Bestdori 图集均为该格式），返回 {w,h,alpha}。
 * 仅用于构建期墨迹测量，不支持其他位深/隔行（遇到即返回 null，调用方跳过墨迹）。
 */
function decodePalettePng(buf) {
  if (buf[24] !== 8 || buf[25] !== 3 || buf[28] !== 0) return null;
  let off = 8;
  let w = 0, h = 0;
  let trns = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w; // 8-bit 调色板：每像素 1 字节索引
  const alpha = Buffer.alloc(w * h, 255);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= 1 ? cur[x - 1] : 0;
      const b = prev[x];
      const c = x >= 1 ? prev[x - 1] : 0;
      let v = line[x];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      cur[x] = v;
    }
    prev = cur;
    for (let x = 0; x < w; x++) {
      const idx = cur[x];
      alpha[y * w + x] = trns && idx < trns.length ? trns[idx] : 255;
    }
  }
  return { w, h, alpha };
}

/** 精灵矩形内的不透明墨迹边界（源像素缩进 {left,top,right,bottom}）；无墨迹/无法解码返回 null */
function measureInk(img, rect) {
  if (!img) return null;
  const x0 = Math.max(0, Math.round(rect.x)), y0 = Math.max(0, Math.round(rect.y));
  const x1 = Math.min(img.w, Math.round(rect.x + rect.w)), y1 = Math.min(img.h, Math.round(rect.y + rect.h));
  let minX = x1, minY = y1, maxX = x0 - 1, maxY = y0 - 1;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (img.alpha[y * img.w + x] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return null;
  return { left: minX - x0, top: minY - y0, right: x1 - 1 - maxX, bottom: y1 - 1 - maxY };
}

/** 对整张 .sprites 名册测墨迹，返回 Record<name, ink>（仅含有墨迹的条目） */
function measureAllInk(img, sprites) {
  const out = {};
  for (const [name, rect] of sprites) {
    const ink = measureInk(img, rect);
    if (ink) out[name] = ink;
  }
  return out;
}

/** 拷贝文件（内容不变则跳过）；返回 { skipped } 供汇总 */
function copyIfChanged(srcBuf, destPath) {
  if (CHECK_ONLY) return { skipped: true };
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  if (fs.existsSync(destPath)) {
    const existing = fs.readFileSync(destPath);
    if (sha256(existing) === sha256(srcBuf)) return { skipped: true };
  }
  fs.writeFileSync(destPath, srcBuf);
  return { skipped: false };
}

/**
 * 解析 .sprites（Unity SpriteAtlas 序列化 JSON，顶层数组，每元素 Base.{m_Name,m_Rect}）。
 * **坐标系转换**：Unity 的 m_Rect.y 以图集**左下角**为原点（自底向上），而 canvas drawImage 以
 * 左上角为原点——此处统一翻转为顶部原点：y' = atlasH - y - h。
 * （实证：翻转后 skin00 note_normal_3 → (1550,904)，与 issue 40/41 时代在真实 PNG 上手量的
 * 旧 tap 矩形 (1553,912) 吻合；note_flick_l_3 → (0,782) 与旧 leftFlick (0,782) 完全一致。）
 * 返回 Map<name, {x,y,w,h}>（已是顶部原点）。
 */
function parseSprites(buf, packDir, atlas) {
  const json = JSON.parse(buf.toString('utf8'));
  if (!Array.isArray(json)) throw new Error(`${packDir}/.sprites 顶层数组缺失`);
  const map = new Map();
  for (const entry of json) {
    const b = entry?.Base;
    if (!b?.m_Name || !b.m_Rect) continue;
    map.set(b.m_Name, {
      x: b.m_Rect.x,
      y: atlas.h - b.m_Rect.y - b.m_Rect.height,
      w: b.m_Rect.width,
      h: b.m_Rect.height,
    });
  }
  return map;
}

function rectInAtlas(rect, atlas, ctx) {
  if (!rect) return;
  const { w: AW, h: AH } = atlas;
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > AW || rect.y + rect.h > AH) {
    fail(`${ctx}: 矩形越界 ${JSON.stringify(rect)} 超出图集 ${AW}x${AH}`);
  }
}

/** 普通音符皮肤包 → 注册表条目 */
function buildNotePack(spec, overrides) {
  const atlasBuf = readArchiveFile(spec.dir, 'RhythmGameSprites.png');
  if (!atlasBuf) { fail(`${spec.id}: 缺 RhythmGameSprites.png`); return null; }
  const atlas = pngSize(atlasBuf);
  const atlasImg = decodePalettePng(atlasBuf);
  const spritesBuf = readArchiveFile(spec.dir, '.sprites');
  if (!spritesBuf) { fail(`${spec.id}: 缺 .sprites`); return null; }
  const sprites = parseSprites(spritesBuf, spec.dir, atlas);
  if (!atlasImg) console.warn(`[build-note-skins] ${spec.id}: PNG 非调色板格式，跳过墨迹测量（箭头组合几何退回缺省）`);
  const ink = atlasImg ? measureAllInk(atlasImg, sprites) : {};

  const perLane = (prefix) => {
    const arr = [];
    for (let lane = 0; lane < LANES; lane++) {
      const r = sprites.get(`${prefix}_${lane}`);
      if (!r) { fail(`${spec.id}: 缺精灵 ${prefix}_${lane}`); arr.push(null); continue; }
      rectInAtlas(r, atlas, `${spec.id} ${prefix}_${lane}`);
      arr.push(r);
    }
    return arr;
  };

  const tap = perLane('note_normal');
  const flick = perLane('note_flick');
  const skill = perLane('note_skill');
  const long = perLane('note_long');
  const slideAmong = sprites.get('note_slide_among') ?? null;
  const flickTop = sprites.get('note_flick_top') ?? null;
  if (!slideAmong) fail(`${spec.id}: 缺 note_slide_among（滑条中间结点）`);
  if (!flickTop) console.warn(`[build-note-skins] ${spec.id}: 缺 note_flick_top（滑键箭头），该包滑键将无箭头装饰`);
  rectInAtlas(slideAmong, atlas, `${spec.id} slideAmong`);
  rectInAtlas(flickTop, atlas, `${spec.id} flickTop`);

  const bandBuf = readArchiveFile(spec.dir, 'longNoteLine.png');
  if (!bandBuf) { fail(`${spec.id}: 缺 longNoteLine.png（滑条连接带）`); return null; }
  const band = pngSize(bandBuf);
  const bandSpBuf = readArchiveFile(spec.dir, 'longNoteLine2.png');
  const bandSp = bandSpBuf ? pngSize(bandSpBuf) : null;
  const simBuf = readArchiveFile(spec.dir, 'simultaneous_line.png');
  const simultaneous = simBuf ? pngSize(simBuf) : null;

  // 配对方向包（整包预设用）：按尾部编号匹配 directionalflickskin<N>
  const m = spec.id.match(/(\d+)$/);
  const pairedDir = m ? DIR_PACKS.find((d) => d.id === `directionalflickskin${m[1]}`)?.id ?? null : null;

  return {
    kind: 'note',
    id: spec.id,
    label: spec.label,
    atlas: `./assets/skins/${spec.id}/RhythmGameSprites.png`,
    atlasW: atlas.w,
    atlasH: atlas.h,
    tap, flick, skill, long,
    flickTop, slideAmong,
    /** 精灵墨迹边界（源像素缩进，Record<精灵名, ink>），供运行时精确组合箭头/贴边 */
    ink,
    band: `./assets/skins/${spec.id}/longNoteLine.png`,
    bandW: band.w, bandH: band.h,
    bandSp: bandSp ? `./assets/skins/${spec.id}/longNoteLine2.png` : null,
    bandSpW: bandSp?.w ?? 0, bandSpH: bandSp?.h ?? 0,
    simultaneous: simBuf ? `./assets/skins/${spec.id}/simultaneous_line.png` : null,
    simultaneousW: simultaneous?.w ?? 0, simultaneousH: simultaneous?.h ?? 0,
    pairedDir,
    ...overrides,
  };
}

/** 方向滑键皮肤包 → 注册表条目 */
function buildDirPack(spec, overrides) {
  const atlasBuf = readArchiveFile(spec.dir, 'DirectionalFlickSprites.png');
  if (!atlasBuf) { fail(`${spec.id}: 缺 DirectionalFlickSprites.png`); return null; }
  const atlas = pngSize(atlasBuf);
  const atlasImg = decodePalettePng(atlasBuf);
  const spritesBuf = readArchiveFile(spec.dir, '.sprites');
  if (!spritesBuf) { fail(`${spec.id}: 缺 .sprites`); return null; }
  const sprites = parseSprites(spritesBuf, spec.dir, atlas);
  if (!atlasImg) console.warn(`[build-note-skins] ${spec.id}: PNG 非调色板格式，跳过墨迹测量`);
  const ink = atlasImg ? measureAllInk(atlasImg, sprites) : {};

  const perLane = (prefix) => {
    const arr = [];
    for (let lane = 0; lane < LANES; lane++) {
      const r = sprites.get(`${prefix}_${lane}`);
      if (!r) { fail(`${spec.id}: 缺精灵 ${prefix}_${lane}`); arr.push(null); continue; }
      rectInAtlas(r, atlas, `${spec.id} ${prefix}_${lane}`);
      arr.push(r);
    }
    return arr;
  };

  const dirL = perLane('note_flick_l');
  const dirR = perLane('note_flick_r');
  // 方向箭头（组装到方向滑键最外侧，用户定案 2026-08-24 问题4）
  const flickTopL = sprites.get('note_flick_top_l') ?? null;
  const flickTopR = sprites.get('note_flick_top_r') ?? null;
  rectInAtlas(flickTopL, atlas, `${spec.id} flickTopL`);
  rectInAtlas(flickTopR, atlas, `${spec.id} flickTopR`);

  return {
    kind: 'directional',
    id: spec.id,
    label: spec.label,
    atlas: `./assets/skins/${spec.id}/DirectionalFlickSprites.png`,
    atlasW: atlas.w,
    atlasH: atlas.h,
    dirL, dirR,
    flickTopL, flickTopR,
    ink,
    ...overrides,
  };
}

function copyPackFiles(spec, filenames) {
  for (const f of filenames) {
    const buf = readArchiveFile(spec.dir, f);
    if (!buf) { fail(`${spec.id}: 缺 ${f}（拷贝清单）`); continue; }
    copyIfChanged(buf, path.join(PUBLIC_ROOT, spec.id, f));
  }
}

/** 覆写归一化：inkL/inkR 允许写 [左,右] 数组（紧凑），生成时转成 NoteSkinInk 对象 */
function normalizeOverrides(raw) {
  const toInk = (v) => (Array.isArray(v) && v.length === 2 ? { inkLeft: v[0], inkRight: v[1] } : v);
  const out = { ...raw };
  if (out.inkL) out.inkL = toInk(out.inkL);
  if (out.inkR) out.inkR = toInk(out.inkR);
  return out;
}

function main() {
  const overridesRaw = fs.existsSync(OVERRIDES_FILE)
    ? JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8')).packs ?? {}
    : {};
  const overrides = Object.fromEntries(Object.entries(overridesRaw).map(([k, v]) => [k, normalizeOverrides(v)]));

  const packs = [];
  for (const spec of NOTE_PACKS) {
    const pack = buildNotePack(spec, overrides[spec.id] ?? {});
    if (pack) packs.push(pack);
    copyPackFiles(spec, ['RhythmGameSprites.png', 'longNoteLine.png', 'longNoteLine2.png', 'simultaneous_line.png'].filter((f) => readArchiveFile(spec.dir, f)));
  }
  for (const spec of DIR_PACKS) {
    const pack = buildDirPack(spec, overrides[spec.id] ?? {});
    if (pack) packs.push(pack);
    copyPackFiles(spec, ['DirectionalFlickSprites.png', 'FlickNoteLine_l.png', 'FlickNoteLine_r.png'].filter((f) => readArchiveFile(spec.dir, f)));
  }

  if (failures.length > 0) {
    console.error(`[build-note-skins] ${failures.length} 个问题：`);
    for (const f of failures) console.error('  - ' + f);
    process.exit(1);
  }

  const defaults = {
    tap: NOTE_PACKS[0]?.id,
    flick: NOTE_PACKS[0]?.id,
    skill: NOTE_PACKS[0]?.id,
    dirL: DIR_PACKS[0]?.id,
    dirR: DIR_PACKS[0]?.id,
    slide: NOTE_PACKS[0]?.id,
  };

  const ts = `// 由 scripts/build-note-skins.mjs 从 docs/resource/bestdori 归档生成（issue 29）——勿手改。
// 坐标来源：各包 .sprites 的官方精灵矩形（源图像素，左上角原点）；扩容/重生成见脚本头部说明。
// 归档目录不入库不入运行时；此处产物（本文件 + public/assets/skins/<packId>/）已入库。

export interface NoteSkinRect { x: number; y: number; w: number; h: number; }

/** 方向键墨迹缩进（源像素）：同时点击线贴墨迹边缘用（issue 40 同名语义） */
export interface NoteSkinInk { inkLeft: number; inkRight: number; }

/** 精灵不透明墨迹边界（构建期对 PNG 实测的源像素缩进），供运行时精确组合箭头/贴边 */
export interface NoteSkinInkBox { left: number; top: number; right: number; bottom: number; }

export interface NoteSkinPackNote {
  kind: 'note';
  id: string;
  label: string;
  atlas: string;
  atlasW: number;
  atlasH: number;
  /** 单键 note_normal_<lane>，下标 = 轨道 0..6 */
  tap: (NoteSkinRect | null)[];
  /** 滑键主体 note_flick_<lane>（菱形本体，箭头为独立 flickTop） */
  flick: (NoteSkinRect | null)[];
  /** 技能键 note_skill_<lane> */
  skill: (NoteSkinRect | null)[];
  /** 长条端帽 note_long_<lane>（滑条端点基底，用户定案 2026-08-24 问题2） */
  long: (NoteSkinRect | null)[];
  /** 滑键顶部箭头 note_flick_top */
  flickTop: NoteSkinRect | null;
  /** 滑条中间结点 note_slide_among */
  slideAmong: NoteSkinRect | null;
  /** 精灵墨迹边界（Record<精灵名, ink>） */
  ink: Record<string, NoteSkinInkBox>;
  /** 滑条连接带 longNoteLine.png（整图拉伸） */
  band: string;
  bandW: number;
  bandH: number;
  /** SP 滑条连接带 longNoteLine2.png（本轮仅随包提供，渲染接线归 issue 09） */
  bandSp: string | null;
  bandSpW: number;
  bandSpH: number;
  /** 同时点击线贴图（本轮维持矢量线，仅随包提供） */
  simultaneous: string | null;
  simultaneousW: number;
  simultaneousH: number;
  /** 同编号配对的方向包（整包预设一键应用用）；无配对为 null */
  pairedDir: string | null;
}

export interface NoteSkinPackDirectional {
  kind: 'directional';
  id: string;
  label: string;
  atlas: string;
  atlasW: number;
  atlasH: number;
  /** 左方向键 note_flick_l_<lane>（完整外观，含箭头） */
  dirL: (NoteSkinRect | null)[];
  /** 右方向键 note_flick_r_<lane> */
  dirR: (NoteSkinRect | null)[];
  /** 左方向箭头 note_flick_top_l（组装到方向滑键最外侧，用户定案 2026-08-24 问题4） */
  flickTopL: NoteSkinRect | null;
  /** 右方向箭头 note_flick_top_r */
  flickTopR: NoteSkinRect | null;
  /** 精灵墨迹边界（Record<精灵名, ink>） */
  ink: Record<string, NoteSkinInkBox>;
  /** 可选墨迹覆写（overrides 注入） */
  inkL?: NoteSkinInk;
  inkR?: NoteSkinInk;
}

export type NoteSkinPack = NoteSkinPackNote | NoteSkinPackDirectional;

export const NOTE_SKIN_PACKS: NoteSkinPack[] = ${JSON.stringify(packs, null, 2)};

/** 默认选择（issue 29 定案 Q10）：六条目各指默认包 */
export const NOTE_SKIN_DEFAULT_SELECTION: Record<string, string> = ${JSON.stringify(defaults, null, 2)};
`;

  if (CHECK_ONLY) {
    console.log(`[build-note-skins] --check 通过：${packs.length} 个包校验无误`);
    return;
  }
  fs.mkdirSync(path.dirname(REGISTRY_OUT), { recursive: true });
  fs.writeFileSync(REGISTRY_OUT, ts);
  const copied = [];
  for (const spec of [...NOTE_PACKS, ...DIR_PACKS]) copied.push(`public/assets/skins/${spec.id}/`);
  console.log(`[build-note-skins] 完成：${packs.length} 个包 → ${REGISTRY_OUT}`);
  console.log(`[build-note-skins] 产物目录：${copied.join(', ')}`);
}

main();