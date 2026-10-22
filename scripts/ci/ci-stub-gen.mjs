#!/usr/bin/env node
// PR 门禁（无素材快照环境）最小合法桩生成（release-pipeline 10）。
//
// 背景：运行时素材快照由外部镜像仓提供、不入 git（scripts/assets-sync.mjs 取件到
// src/audio/gen、src/rendering/skin/gen 等 .gitignore 目录），其中 *.gen.ts 是构建
// 脚本产物——缺失会让 tsc / vitest 整片加载失败。PR 事件流水线不注入密钥仓库，
// 拿不到快照；本脚本写入「API 与真产物一致、数据取最小合法集」的占位模块，
// 使门禁的 test + build 在无快照环境可执行。
//
// 口径：仅对真实快照数据有效的守约套件（注册表坐标钉子、真实采样结构等）由
// tests/support/assetSnapshot.ts 判别后跳过，交 push / tag_push 门禁（有真快照）
// 全量验证；行为类测试不跳过，PR 阶段照常全量跑。
//
// 幂等（逐注册表判别）：真快照（文件存在且无 CI-STUB 标记）则不动；缺文件或仍是
// 桩则写——防「键音真 / 皮肤桩」类部分态被误判为已就绪，也防反向覆盖写真注册表。
// assets:sync 取件为整根替换，真快照落地后桩（含标记）自然被替换掉。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MARKER = 'CI-STUB';

const KEY_SOUND_REGISTRY = 'src/audio/gen/keySoundRegistry.gen.ts';
const NOTE_SKIN_REGISTRY = 'src/rendering/skin/gen/noteSkinRegistry.gen.ts';
const SIM_PACK_REGISTRY = 'src/preview/video/sim/gen/simAssetPacks.gen.ts';

/** 该注册表是真快照产物（存在且无 CI-STUB 标记）→ 不介入；缺文件 / 是桩 → 写 */
function isRealSnapshot(rel) {
  try {
    return !fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').includes(MARKER);
  } catch {
    return false;
  }
}

const KEY_SOUND_STUB = `// ${MARKER} · PR 门禁（无素材快照）占位模块：API 同真产物，数据为最小合法集。勿手改；真产物见 scripts/assets-sync.mjs。
import type { KeySoundSet, KeySoundSetEntry } from '../KeySound';

const samples = () => ({
  tap: { src: 'data:audio/mp3;base64,ci-stub' },
  flick: { src: 'data:audio/mp3;base64,ci-stub' },
  slide: { src: 'data:audio/mp3;base64,ci-stub' },
  skill: { src: 'data:audio/mp3;base64,ci-stub' },
  directional: { tierSrcs: { 1: 'data:audio/mp3;base64,ci-stub', 2: 'data:audio/mp3;base64,ci-stub', 3: 'data:audio/mp3;base64,ci-stub' } },
});

export const GENERATED_KEY_SOUND_PACKS: KeySoundSetEntry[] = Array.from({ length: 4 }, (_, i) => {
  const id = \`skin0\${i}\`;
  return {
    id,
    label: \`CI 桩键音 \${i}\`,
    load: async (): Promise<KeySoundSet> => ({ id, label: \`CI 桩键音 \${i}\`, samples: samples() }),
  };
});
`;

const NOTE_SKIN_STUB = `// ${MARKER} · PR 门禁（无素材快照）占位模块：API 同真产物，数据为最小合法集。勿手改；真产物见 scripts/assets-sync.mjs。
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
  tap: (NoteSkinRect | null)[];
  tapVirtual: (NoteSkinRect | null)[];
  flick: (NoteSkinRect | null)[];
  skill: (NoteSkinRect | null)[];
  long: (NoteSkinRect | null)[];
  flickTop: NoteSkinRect | null;
  slideAmong: NoteSkinRect | null;
  ink: Record<string, NoteSkinInkBox>;
  band: string;
  bandW: number;
  bandH: number;
  bandSp: string | null;
  bandSpW: number;
  bandSpH: number;
  simultaneous: string | null;
  simultaneousW: number;
  simultaneousH: number;
  pairedDir: string | null;
}

export interface NoteSkinPackDirectional {
  kind: 'directional';
  id: string;
  label: string;
  atlas: string;
  atlasW: number;
  atlasH: number;
  dirL: (NoteSkinRect | null)[];
  dirR: (NoteSkinRect | null)[];
  flickTopL: NoteSkinRect | null;
  flickTopR: NoteSkinRect | null;
  ink: Record<string, NoteSkinInkBox>;
  inkL?: NoteSkinInk;
  inkR?: NoteSkinInk;
}

export type NoteSkinPack = NoteSkinPackNote | NoteSkinPackDirectional;

// 逐轨异值：行为测试会校验「不同用途 / 不同轨位取不同精灵」，同值会误判。
const rects = (baseX: number): (NoteSkinRect | null)[] =>
  Array.from({ length: 7 }, (_, lane) => ({ x: baseX + lane * 100, y: 0, w: 100, h: 100 }));

const STUB_NOTE_PACK: NoteSkinPackNote = {
  kind: 'note',
  id: 'skin00',
  label: 'CI 桩皮肤',
  atlas: 'skins/skin00/atlas.png',
  atlasW: 1024,
  atlasH: 1024,
  tap: rects(0),
  tapVirtual: rects(200),
  flick: rects(0),
  skill: rects(0),
  long: rects(400),
  flickTop: { x: 0, y: 0, w: 100, h: 100 },
  slideAmong: { x: 0, y: 200, w: 100, h: 100 },
  ink: {
    note_flick_top: { left: 10, top: 10, right: 10, bottom: 10 },
  },
  band: 'skins/skin00/longNoteLine.png',
  bandW: 100,
  bandH: 20,
  bandSp: 'skins/skin00/longNoteLine2.png',
  bandSpW: 100,
  bandSpH: 20,
  simultaneous: null,
  simultaneousW: 0,
  simultaneousH: 0,
  pairedDir: 'directionalflickskin00',
};

const STUB_DIR_PACK: NoteSkinPackDirectional = {
  kind: 'directional',
  id: 'directionalflickskin00',
  label: 'CI 桩方向皮肤',
  atlas: 'skins/directionalflickskin00/atlas.png',
  atlasW: 1024,
  atlasH: 1024,
  dirL: rects(0),
  dirR: rects(0),
  flickTopL: { x: 0, y: 0, w: 100, h: 100 },
  flickTopR: { x: 0, y: 0, w: 100, h: 100 },
  ink: {
    note_flick_top_l: { left: 10, top: 10, right: 10, bottom: 10 },
    note_flick_top_r: { left: 10, top: 10, right: 10, bottom: 10 },
    note_flick_l_3: { left: 20, top: 10, right: 30, bottom: 10 },
    note_flick_r_3: { left: 30, top: 10, right: 20, bottom: 10 },
  },
};

export const NOTE_SKIN_PACKS: NoteSkinPack[] = [STUB_NOTE_PACK, STUB_DIR_PACK];

export const NOTE_SKIN_DEFAULT_SELECTION: Record<string, string> = {
  tap: 'skin00',
  flick: 'skin00',
  skill: 'skin00',
  slide: 'skin00',
  dirL: 'directionalflickskin00',
  dirR: 'directionalflickskin00',
};
`;

const SIM_PACK_STUB = `// ${MARKER} · PR 门禁（无素材快照）占位模块：API 同真产物，数据为最小合法集。勿手改；真产物见 scripts/assets-sync.mjs。
export interface SimFieldPackEntry { id: string; field: string; playLine: string; }
export interface SimBackgroundPackEntry { id: string; background: string; }
export interface SimAssetPackRegistry { field: SimFieldPackEntry[]; background: SimBackgroundPackEntry[]; }

export const SIM_ASSET_PACKS: SimAssetPackRegistry = {
  field: [{ id: 'skin00', field: 'bg_line_rhythm.png', playLine: 'game_play_line.png' }],
  background: [{ id: 'skin00', background: 'liveBG_normal.png' }],
};
`;

function write(rel, content) {
  const abs = path.join(REPO_ROOT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  console.log(`  ✓ ${rel}`);
}

const REGISTRIES = [
  [KEY_SOUND_REGISTRY, KEY_SOUND_STUB],
  [NOTE_SKIN_REGISTRY, NOTE_SKIN_STUB],
  [SIM_PACK_REGISTRY, SIM_PACK_STUB],
];

// 逐注册表判别：真的不动，缺 / 是桩的才写——部分态（如键音真、皮肤桩）不会被
// 误判为「已就绪」而整体跳过，也不会把真注册表覆盖成桩。
const pending = REGISTRIES.filter(([rel]) => !isRealSnapshot(rel));
if (pending.length === 0) {
  console.log('==> 素材快照已就绪，跳过桩生成');
} else {
  const reason = pending.length === REGISTRIES.length ? '无素材快照' : '部分注册表缺快照';
  console.log(`==> ${reason}，生成最小合法桩…`);
  for (const [rel, content] of pending) write(rel, content);
}
