// chart-preview 05 的接线看守（票面锁测③）：
//   - 仿真场**不 import `pages/`**（单向依赖：preview → rendering / chart / audio / playback）；
//   - 仿真场**不 import 编辑器画布那套出帧**（`renderChart` / `RenderTarget` / 面板画家 / 宽图导出）——
//     它是预览专用画法，不是"编辑器画布的第二种形态"；允许复用的是**精灵与选款原语**
//     （`rendering/skin/noteSkin` / `rendering/primitives/noteMetrics` / `singleIconConfig` 一族）；
//   - 场地素材走**运行时素材树** `public/assets/sim/`（站内前缀 `/assets/sim/`），随 dist 出包；
//   - 一帧的出帧实现只有一份（实时回放与 07 的离线导出共用 `drawSimFrameAt`）；
//   - 设计面算术 / 音符速度白名单各自只有一处（口径不漂）。
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readStripped, repoRoot } from '@/tests/support/source';

/** src/ 下全部 .ts/.tsx（相对仓库根的路径） */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) out.push(...sourceFiles(abs));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(relative(repoRoot, abs).split('\\').join('/'));
  }
  return out;
}

const SIM_DIR = 'src/preview/video/sim';
const simFiles = sourceFiles(join(repoRoot, SIM_DIR));
const GEOMETRY = `${SIM_DIR}/simGeometry.ts`;
/** 编辑器画布那套"整帧出图"的入口：仿真场一个都不许碰 */
const CANVAS_ENTRY = /\b(renderChart|createRenderTarget|frameFor|createPanelPainter|createStaticLayerCache|createNoteLayerCache|renderSheet|exportSheetAs)\b/;

describe('chart-preview 05 · 仿真场的依赖方向与素材通道', () => {
  it('仿真场四个模块都在（几何 / 一帧绘制 / 素材 / 回放）', () => {
    expect(simFiles).toEqual(expect.arrayContaining([
      `${SIM_DIR}/simGeometry.ts`,
      `${SIM_DIR}/simField.ts`,
      `${SIM_DIR}/simAssets.ts`,
      `${SIM_DIR}/simPlayback.ts`,
      `${SIM_DIR}/index.ts`,
    ]));
  });

  it('预览域（含仿真场）不 import pages/', () => {
    const offenders = sourceFiles(join(repoRoot, 'src/preview'))
      .filter((f) => /from\s+['"][^'"]*pages\//.test(readStripped(f)));
    expect(offenders).toEqual([]);
  });

  it('仿真场不 import 编辑器画布那套出帧（自己画自己的一帧）', () => {
    const offenders = simFiles.filter((f) => CANVAS_ENTRY.test(readStripped(f)));
    expect(offenders).toEqual([]);
  });

  it('场地素材走运行时素材树 /assets/sim（不再是 dev 中间件直读）', () => {
    const assets = readStripped(`${SIM_DIR}/simAssets.ts`);
    expect(assets).toMatch(/export const SIM_ASSET_BASE = '\/assets\/sim'/);
    expect(assets).not.toMatch(/__bestdori-assets/);
    // 仿真场只引用 URL、不 import 本地素材（不出现 public/assets 一类源码路径）
    for (const file of simFiles) {
      expect(readStripped(file)).not.toMatch(/public\/assets|\.\/assets\//);
    }
  });

  it('一帧的实现只有一份：实时回放调 drawSimFrameAt，自己不摸绘制 API', () => {
    const playback = readStripped(`${SIM_DIR}/simPlayback.ts`);
    expect(playback).toMatch(/drawSimFrameAt\s*\(/);
    expect(playback).not.toMatch(/ctx\.(fillRect|fillText|beginPath|drawImage|arc)\s*\(/);
  });

  it('combo 走画布那份枚举（`comboNodePreciseBeats`），不是键音事件表', () => {
    // 两者刻意不同：`beat < 0` 的击打物**不键音但计 combo**（开播即已过线，ADR-0014）。
    // 按 `buildKeyEvents` 数 = 负 beat 那批永远不进 combo —— 这条锁防它回潮。
    const field = readStripped(`${SIM_DIR}/simField.ts`);
    expect(field).toMatch(/comboNodePreciseBeats/);
    expect(field).not.toMatch(/buildKeyEvents/);
  });

  it('页面是消费方：组装层不碰画布 2d 上下文（画法全在预览域）', () => {
    const stage = readStripped('src/pages/preview/PreviewVideoStage.tsx');
    expect(stage).toMatch(/from '\.\.\/\.\.\/preview'/);
    expect(stage).not.toMatch(/getContext|drawImage|fillRect/);
  });

  it('设计面算术只在 simGeometry 一处（别的仿真场模块不写 1334 / 154 / 0.82）', () => {
    const offenders = simFiles
      .filter((f) => f !== GEOMETRY)
      .filter((f) => /\b1334\b|\b154\b|\b0\.82\b/.test(readStripped(f)));
    expect(offenders).toEqual([]);
    const geometry = readStripped(GEOMETRY);
    expect(geometry).toMatch(/DESIGN_SURFACE = \{ w: 1334, h: 750 \}/);
    expect(geometry).toMatch(/LANE_DESIGN_W = 154/);
    expect(geometry).toMatch(/LANE_HEIGHT_RATIO = 0\.82/);
  });

  it('场地图 / 判定线的矩形只从 simGeometry 取（不拉满画布，chart-preview 18 问题 4）', () => {
    const field = readStripped(`${SIM_DIR}/simField.ts`);
    expect(field).toMatch(/fieldImageRect\(/);
    expect(field).toMatch(/playLineRect\(/);
    // 回潮守卫：两张图不许再按画布尺寸绘制（拉满 = 素材自带的轨道标记 / 车道线与音符错位）
    expect(field).not.toMatch(/drawImage\(assets\.(field|playLine),\s*0,\s*0,\s*m\.w/);
    const geometry = readStripped(GEOMETRY);
    expect(geometry).toMatch(/FIELD_IMAGE_RATIO = \{ w: 0\.875, h: 0\.82 \* 0\.983 \}/);
    expect(geometry).toMatch(/PLAY_LINE_RATIO = \{ w: 1\.35 \}/);
  });

  it('播放器控件（chart-preview 20）：音量 / 倍速都走 simPlayback.setOptions，不自己摸引擎', () => {
    const stage = readStripped('src/pages/preview/PreviewVideoStage.tsx');
    expect(stage).toMatch(/setOptions\(\{\s*density,\s*seVolume,\s*keySetId,\s*volume,\s*rate\s*\}\)/);
    // 回放那一层的循环能力还在，但 UI 不再传它（"不需要回到开头和循环的按钮"）
    expect(stage).not.toMatch(/setOptions\(\{[^}]*loop/);
    expect(stage).not.toMatch(/restart\(/);
    expect(stage).not.toMatch(/preview\.video\.(restart|loop)/);
    // 倍速：不用原生 select，档位表 / 步长 / 越界钳回都从预览域来
    expect(stage).not.toMatch(/<select/);
    expect(stage).toMatch(/SIM_PLAYBACK_RATE_STEP/);
    expect(stage).toMatch(/SIM_PLAYBACK_RATE_PRESETS/);
    expect(stage).toMatch(/normalizePlaybackRate\(raw,/);
    // 音量落设置（`settings.audio.volume`），倍速是页面内 state
    expect(stage).toMatch(/onVolumeChange/);
    const page = readStripped('src/pages/preview/PreviewPage.tsx');
    expect(page).toMatch(/volume=\{settings\.audio\.volume\}/);
    expect(page).toMatch(/onVolumeChange=\{setAudioVolume\}/);
    // 循环 / 回开头已随 issue 22 收掉（零 UI 消费方）：回放那一层不再留这份能力，
    // 到谱面长度一律停在末帧（ADR-0005 第一性）
    const playback = readStripped(`${SIM_DIR}/simPlayback.ts`);
    expect(playback).not.toMatch(/\bloop\b/);
    expect(playback).not.toMatch(/\brestart\b/);
  });

  it('倍速面板是一列（不是横排），且按 max-content 撑开（不是靠 min-width 卡住）', () => {
    const css = readStripped('src/pages/preview/PreviewPage.css');
    expect(css).toMatch(/\.pv-rate__panel \{[\s\S]*?flex-direction: column/);
    expect(css).not.toMatch(/\.pv-rate__presets/);
    // 绝对定位会按"可用宽度"（= 触钮那点宽度）收缩：不给 max-content，最宽那行会顶出右缘
    expect(css).toMatch(/\.pv-rate__panel \{[\s\S]*?width: max-content/);
    const stage = readStripped('src/pages/preview/PreviewVideoStage.tsx');
    expect(stage).not.toMatch(/pv-rate__presets/);
    expect(stage).toMatch(/className="pv-rate__panel"/);
  });

  it('Bestdori 自家精灵走同一条运行时素材树（chart-preview 21）：三张 PNG 都在 `/assets/sim/sprites/` 下', () => {
    const assets = readStripped(`${SIM_DIR}/simAssets.ts`);
    expect(assets).toMatch(/SIM_SPRITE_CATEGORY = 'sprites'/);
    expect(assets).toMatch(/digits\.png/);
    expect(assets).toMatch(/combo\.png/);
    expect(assets).toMatch(/particles\.png/);
    // 素材边界（票面 + ADR-0016 §6）：仅供本地研究、不入 git、不进安装包 ⇒ 不许出现远程地址
    for (const file of simFiles) {
      expect(readStripped(file)).not.toMatch(/https?:\/\//);
    }
  });

  it('打击特效的窗口 / 尺寸 / α 只在 simGeometry 那张表里（chart-preview 21 落点）', () => {
    const geometry = readStripped(GEOMETRY);
    expect(geometry).toMatch(/export const SIM_SPRITE_EFFECT = \{/);
    const field = readStripped(`${SIM_DIR}/simField.ts`);
    expect(field).toMatch(/SIM_SPRITE_EFFECT/);
    // 回潮守卫：这几个数是表里誊自 bundle 的，绘制代码里不许再写一份（改表就得改两处 = 口径漂移）
    expect(field).not.toMatch(/1\.33|2\.25/);
  });

  it('音符速度档：白名单与默认值只在设置域，仿真场不另写一份', () => {
    const geometry = readStripped(GEOMETRY);
    expect(geometry).toMatch(/\{\s*normalizeNoteSpeed\s*\}\s*from\s*'\.\.\/\.\.\/\.\.\/chart\/config\/AppSettings'/);
    const offenders = simFiles.filter((f) => /\b9\.5\b/.test(readStripped(f)));
    expect(offenders).toEqual([]);
  });

  it('音符盒子 / 同时点击线 / 背景取景都从 simGeometry 取（票 23 #2 落点）', () => {
    const field = readStripped(`${SIM_DIR}/simField.ts`);
    expect(field).toMatch(/simNoteRect\(/);
    expect(field).toMatch(/simSpriteAspect\(/);
    expect(field).toMatch(/simDualLineThickness\(/);
    expect(field).toMatch(/backgroundRect\(/);
    // 细处的数由 unit 锁（`SimGeometry.test`）—— 这里只锁"消费点"（tests/README：static 留接线事实）
    expect(field).toMatch(/canvasHeight: simDualLineThickness\(m, a, scene\.noteSize\)/);
    // 回潮守卫：同时点击线不许再自己写粗细（旧写法 `laneWidth * 0.3 * a`，Bestdori ≈ 0.118），
    // 背景也不许回到 cover 裁切
    expect(field).not.toMatch(/laneWidth \* 0\.3/);
    expect(field).not.toMatch(/drawCover|sourceSize\(/);
  });

  it('带体沿带子行进只有一份实现（票 23 #1）：带体几何与按住位都走 `bandLaneAt`', () => {
    const geometry = readStripped(GEOMETRY);
    expect(geometry).toMatch(/export function bandLaneAt/);
    const field = readStripped(`${SIM_DIR}/simField.ts`);
    expect(field).toMatch(/bandLaneAt\(/);
    // 回潮守卫：两处消费方都不许自己再写一遍插值（漂移过一次就得再对一次账）
    expect(field).not.toMatch(/lane0 \+ \(band\.lane1 - band\.lane0\)/);
  });
});
