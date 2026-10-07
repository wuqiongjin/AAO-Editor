// chart-preview 05 的接线看守（票面锁测③）：
//   - 仿真场**不 import `pages/`**（单向依赖：preview → rendering / chart / audio / playback）；
//   - 仿真场**不 import 编辑器画布那套出帧**（`renderChart` / `RenderTarget` / 面板画家 / 宽图导出）——
//     它是预览专用画法，不是"编辑器画布的第二种形态"；允许复用的是**精灵与选款原语**
//     （`rendering/skin/noteSkin` / `rendering/primitives/noteMetrics` / `singleIconConfig` 一族）；
//   - 场地素材**只走 04 的开发期直读通道**（防"顺手拷进 `public/assets/`"）；
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

  it('场地素材只走 04 的开发期直读通道（不出现 public/assets 一类路径）', () => {
    const assets = readStripped(`${SIM_DIR}/simAssets.ts`);
    expect(assets).toMatch(/export const SIM_ASSET_BASE = '\/__bestdori-assets'/);
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

  it('播放器控件（chart-preview 20）：音量 / 倍速 / 循环都走 simPlayback.setOptions，不自己摸引擎', () => {
    const stage = readStripped('src/pages/preview/PreviewVideoStage.tsx');
    expect(stage).toMatch(/setOptions\(\{\s*density,\s*seVolume,\s*keySetId,\s*volume,\s*rate,\s*loop\s*\}\)/);
    expect(stage).toMatch(/SIM_PLAYBACK_RATES/);
    // 音量落设置（`settings.audio.volume`），倍速 / 循环是页面内 state
    expect(stage).toMatch(/onVolumeChange/);
    const page = readStripped('src/pages/preview/PreviewPage.tsx');
    expect(page).toMatch(/volume=\{settings\.audio\.volume\}/);
    expect(page).toMatch(/onVolumeChange=\{setAudioVolume\}/);
    // 循环只让引擎 seek 回去（单一时钟），不另起 rAF/时钟
    const playback = readStripped(`${SIM_DIR}/simPlayback.ts`);
    expect(playback).toMatch(/if \(loop && duration > 0\)/);
    expect(playback).toMatch(/engine\.seek\(0\)/);
  });

  it('音符速度档：白名单与默认值只在设置域，仿真场不另写一份', () => {
    const geometry = readStripped(GEOMETRY);
    expect(geometry).toMatch(/\{\s*normalizeNoteSpeed\s*\}\s*from\s*'\.\.\/\.\.\/\.\.\/chart\/config\/AppSettings'/);
    const offenders = simFiles.filter((f) => /\b9\.5\b/.test(readStripped(f)));
    expect(offenders).toEqual([]);
  });
});
