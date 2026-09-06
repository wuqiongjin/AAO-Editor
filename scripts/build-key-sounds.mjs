#!/usr/bin/env node
// issue 29 键音素材包·构建期脚本（2026-09-06 用户拍板：只收录普通包，按包动态分包懒加载）：
// - 从 docs/resource/bestdori 归档（gitignore，仅研究用）把**选定**键音包的 MP3 拷入
//   `src/assets/audio/keysounds/<packId>/`（产物入库，离线零配置）；
// - 生成 `src/audio/gen/samples.<packId>.gen.ts`（每包差异采样，静态 `?inline` 导入，被注册表
//   动态 import 后成为独立 chunk——延续 issue 20 约束：不产生任何 `.mp3` 网络请求，仅 JS chunk
//   懒下载）与 `src/audio/gen/keySoundRegistry.gen.ts`（运行时唯一键音数据源）；
// - 归档只写 docs/resource/bestdori/，本脚本只写 src/assets 与 src/audio/gen，版权边界不破。
//
// 口径（2026-09-06 确认）：
//   - 普通键音包 = skin00–03（skin00 为游戏默认；经 sha256 核实仓库原 perfect/flick.mp3 即 skin00）。
//   - 联动/限定包（miku/persona/cafe/coin/…）暂不收录，清单加行即可扩容。
//   - 技能键（SE_RHYTHM_TAP_SKILL）与方向键音效（directional_fl/_2/_3）无逐包变体，
//     作为共享采样放 `keysounds/shared/`，静态内联进主包（与旧版体积一致）。
//
// 用法：
//   node scripts/build-key-sounds.mjs           # 拷贝 + 生成注册表
//   node scripts/build-key-sounds.mjs --check   # 只校验（不写文件），CI 可用

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const CHECK_ONLY = process.argv.includes('--check');
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

const ARCHIVE_ROOT = path.join(REPO_ROOT, 'docs/resource/bestdori', 'jp', 'rhythm-note-se');
const AUDIO_OUT = path.join(REPO_ROOT, 'src/assets/audio/keysounds');
const REGISTRY_OUT = path.join(REPO_ROOT, 'src/audio/gen/keySoundRegistry.gen.ts');

// ---- 内置清单：加行即扩容（联动/限定包暂不收录，见文件头口径说明） ----
const PACKS = [
  { id: 'skin00', dir: 'skin00_rip', label: '官方键音 00' },
  { id: 'skin01', dir: 'skin01_rip', label: '官方键音 01' },
  { id: 'skin02', dir: 'skin02_rip', label: '官方键音 02' },
  { id: 'skin03', dir: 'skin03_rip', label: '官方键音 03' },
];
// 包内文件 → 运行时映射（kind 归属沿用 issue 18：tap+slide→perfect，flick→flick）
const PACK_FILE = { tap: 'perfect.mp3', flick: 'flick.mp3' };
const SHARED_FILES = [
  { from: 'common_rip/SE_RHYTHM_TAP_SKILL.mp3', as: 'skill', out: 'SE_RHYTHM_TAP_SKILL.mp3' },
  { from: 'directionalflickskin00_rip/directional_fl.mp3', as: 'dir1', out: 'directional_fl.mp3' },
  { from: 'directionalflickskin00_rip/directional_fl_2.mp3', as: 'dir2', out: 'directional_fl_2.mp3' },
  { from: 'directionalflickskin00_rip/directional_fl_3.mp3', as: 'dir3', out: 'directional_fl_3.mp3' },
];

const failures = [];
const fail = (msg) => failures.push(msg);

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** 校验是真实 MP3（ID3 帧或 MPEG 帧同步头），归档被 HTML 回退页污染时报错 */
function looksLikeMp3(buf) {
  if (buf.length < 4) return false;
  const id3 = buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33;
  const frame = (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) || buf.subarray(0, 3).toString('ascii') === 'ADT';
  return id3 || frame;
}

/** 写入目标文件；--check 模式只比对哈希 */
function emit(relPath, content, label) {
  const abs = path.join(REPO_ROOT, relPath);
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  if (CHECK_ONLY) {
    if (!fs.existsSync(abs)) {
      fail(`${label}: 缺少产物 ${relPath}`);
      return;
    }
    if (sha256(fs.readFileSync(abs)) !== sha256(buf)) {
      fail(`${label}: ${relPath} 与归档/模板不一致（需重跑 build）`);
    }
    return;
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
}

function readArchive(relFrom) {
  const abs = path.join(ARCHIVE_ROOT, relFrom);
  if (!fs.existsSync(abs)) {
    fail(`归档缺失: ${abs}（先跑 scripts/fetch-bestdori-skins.mjs --category rhythm-note-se --package …）`);
    return null;
  }
  const buf = fs.readFileSync(abs);
  if (!looksLikeMp3(buf)) {
    fail(`归档文件不是有效 MP3: ${relFrom}`);
    return null;
  }
  return buf;
}

// ---------------------------------------------------------------------------
// 产物 1：每包 mp3 + samples.gen.ts（动态 import 的 chunk 单元）
// ---------------------------------------------------------------------------

const packEntries = [];
for (const pack of PACKS) {
  const tapBuf = readArchive(`${pack.dir}/${PACK_FILE.tap}`);
  const flickBuf = readArchive(`${pack.dir}/${PACK_FILE.flick}`);
  if (!tapBuf || !flickBuf) continue;
  emit(`src/assets/audio/keysounds/${pack.id}/perfect.mp3`, tapBuf, `${pack.id}/perfect`);
  emit(`src/assets/audio/keysounds/${pack.id}/flick.mp3`, flickBuf, `${pack.id}/flick`);

  const samplesGen = `// 自动生成（scripts/build-key-sounds.mjs）· ${pack.label} 键音包差异采样。勿手改。
// 静态 ?inline（issue 20：不产生 .mp3 网络请求）；本模块被注册表动态 import → 独立 chunk 懒下载。
import perfectSrc from '../../assets/audio/keysounds/${pack.id}/perfect.mp3?inline';
import flickSrc from '../../assets/audio/keysounds/${pack.id}/flick.mp3?inline';
import type { KeySoundSample } from '../KeySound';

/** 本包逐包差异采样（tap/slide→perfect，flick→flick；skill/directional 见注册表共享段） */
export const packSamples: Record<'tap' | 'slide' | 'flick', KeySoundSample> = {
  tap: { src: perfectSrc },
  slide: { src: perfectSrc },
  flick: { src: flickSrc },
};
`;
  emit(`src/audio/gen/samples.${pack.id}.gen.ts`, samplesGen, `samples.${pack.id}.gen`);
  packEntries.push(pack);
}

// ---------------------------------------------------------------------------
// 产物 2：共享 mp3（skill + 方向键 3 档；各包一致，静态内联进主包）
// ---------------------------------------------------------------------------

const sharedOk = [];
for (const f of SHARED_FILES) {
  const buf = readArchive(f.from);
  if (!buf) continue;
  emit(`src/assets/audio/keysounds/shared/${f.out}`, buf, `shared/${f.out}`);
  sharedOk.push(f);
}
if (sharedOk.length !== SHARED_FILES.length) {
  fail(`共享采样不全（${sharedOk.length}/${SHARED_FILES.length}），注册表不生成`);
}

// ---------------------------------------------------------------------------
// 产物 3：注册表 src/audio/gen/keySoundRegistry.gen.ts
// ---------------------------------------------------------------------------

function registrySource() {
  const sharedImports = SHARED_FILES.map(
    (f) => `import ${f.as}Src from '../../assets/audio/keysounds/shared/${f.out}?inline';`,
  ).join('\n');
  const packs = packEntries
    .map(
      (p) => `  {
    id: '${p.id}',
    label: '${p.label}',
    load: async () => {
      const { packSamples } = await import('./samples.${p.id}.gen');
      return { id: '${p.id}', label: '${p.label}', samples: { ...packSamples, ...SHARED_SAMPLES } };
    },
  },`,
    )
    .join('\n');
  return `// 自动生成（scripts/build-key-sounds.mjs）· 键音素材包注册表。勿手改。
// 每包的差异采样（tap/flick/slide）经动态 import 独立 chunk 懒下载（issue 20：零 .mp3 网络请求）；
// 共享采样（skill / directional 3 档）静态内联，各包一致。
// 扩容（追加官方普通/联动/限定包）：改 scripts/build-key-sounds.mjs 的 PACKS 清单重跑。
import type { KeySoundSample, KeySoundSetEntry } from '../KeySound';

${sharedImports}

/** 各包一致的共享采样（技能键 + 方向键按组合长度 1..3 分档） */
const SHARED_SAMPLES: Record<'skill' | 'directional', KeySoundSample> = {
  skill: { src: skillSrc },
  directional: { tierSrcs: { 1: dir1Src, 2: dir2Src, 3: dir3Src } },
};

export const GENERATED_KEY_SOUND_PACKS: KeySoundSetEntry[] = [
${packs}
];
`;
}

if (failures.length === 0) {
  emit('src/audio/gen/keySoundRegistry.gen.ts', registrySource(), 'keySoundRegistry.gen');
}

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`[build-key-sounds] ${CHECK_ONLY ? '校验' : '构建'}失败（${failures.length} 项）：`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `[build-key-sounds] ${CHECK_ONLY ? '校验通过' : '构建完成'}: ${packEntries.length} 包（${packEntries.map(p=>p.id).join(', ')}）×2 采样 + 4 共享采样 + 注册表`,
);
