// chart-preview 52 落点锁：结尾段（中央章 → 黑幕转场 → 结算）的**接线事实**。
//
// 手法照 VideoExportWiring.test.ts：读源码做字符串断言。锁的是票面 / 交接文档里的硬约定：
//   ① 结尾段是**纯后置**（开场 5.0 若开 + 谱面 + 7.5），音轨尾部留静音；
//   ② 章铺**仿真场末帧**（不是原型那种 bgskin cover 裁切），UI 画在**整帧**上；
//   ③ 缺游戏素材 = 留空 / 纯字，**不画假徽章**；
//   ④ 只在导出里演（实时预览不接后置段），导出弹窗有「结尾画面」组（总开关 + 结算形态）。
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readStripped, repoRoot } from '@/tests/support/source';

const ENDING_DIR = 'src/preview/video/ending';
const endingFiles = readdirSync(join(repoRoot, ENDING_DIR)).filter((f) => f.endsWith('.ts')).sort();

const file = (name: string) => readStripped(`${ENDING_DIR}/${name}`);
const spec = file('endingSpec.ts');
const frame = file('endingFrame.ts');
const assets = file('endingAssets.ts');
const frameDriver = readStripped('src/preview/video/encode/frameDriver.ts');
const exportVideo = readStripped('src/preview/video/encode/exportVideo.ts');
const renderAudio = readStripped('src/preview/video/encode/renderAudioTrack.ts');
const control = readStripped('src/pages/preview/VideoExportControl.tsx');
const page = readStripped('src/pages/preview/PreviewPage.tsx');
const hook = readStripped('src/pages/preview/useVideoExport.ts');
const settings = readStripped('src/settings/AppSettings.ts');

describe('52 · 结尾段是纯后置（不占谱面时间、不与谱面重叠）', () => {
  it('模块落点：参数表 / 素材 / 一帧绘制 / barrel', () => {
    expect(endingFiles).toEqual(['endingAssets.ts', 'endingFrame.ts', 'endingSpec.ts', 'index.ts']);
  });

  it('三段时长钉死 3.0 / 1.5 / 3.0 = 7.5（首期不可调）', () => {
    expect(spec).toMatch(/stampDur: 3,/);
    expect(spec).toMatch(/transDur: 1\.5,/);
    expect(spec).toMatch(/resultDur: 3,/);
    expect(spec).toMatch(
      /ENDING_SECONDS = ENDING_SPEC\.stampDur \+ ENDING_SPEC\.transDur \+ ENDING_SPEC\.resultDur/,
    );
  });

  it('导出总长 = 开场（若开）+ 谱面 + 结尾；关掉结尾就回到旧行为', () => {
    expect(exportVideo).toMatch(/req\.ending \? ENDING_SECONDS : 0/);
    expect(exportVideo).toMatch(
      /buildExportTimeline\(\s*\n?\s*req\.durationSeconds \+ openingSeconds \+ endingSeconds/,
    );
  });

  it('音轨尾部留静音（轨长必须与视频等长，否则封装时音画错位）', () => {
    expect(exportVideo).toMatch(/endingSeconds,/);
    expect(renderAudio).toMatch(/const tail = Number\.isFinite\(req\.endingSeconds\)/);
    expect(renderAudio).toMatch(/audioFramesFor\(req\.durationSeconds \+ offset \+ tail, sampleRate\)/);
    // 结尾段不出声：只有"轨长"变了，键音 / BGM 的事件表一行没动
    expect(renderAudio).not.toMatch(/ENDING_SPEC|stamp|SE_RHYTHM/);
  });
});

describe('52 · 章的背景 = 仿真场末帧（不照搬原型的 bgskin 裁切）', () => {
  it('frameDriver 在谱面之后切到结尾段，并画在**整帧**上', () => {
    expect(frameDriver).toMatch(/t >= endingAt/);
    expect(frameDriver).toMatch(
      /drawEndingFrameAt\(ctx, geometry\.width, geometry\.height, ending, t - endingAt\)/,
    );
    // 谱面段仍是 05 的同一份出帧（encode/ 里 `drawSimFrameAt` 仍只有一处）
    expect(frameDriver).toMatch(/drawSimFrameAt\(ctx, input, t - \(req\.openingSeconds \?\? 0\)\)/);
  });

  it('结尾层的舞台直接调 drawSimFrameAt 画谱面末帧（同一份渲染真相）', () => {
    expect(frame).toMatch(/drawSimFrameAt\(g, input\.stage\.frame, input\.stage\.seconds\)/);
    expect(frameDriver).toMatch(/seconds: chartSeconds/);
    expect(frameDriver).toMatch(/x: geometry\.field\.x/);
    expect(frameDriver).toMatch(/y: geometry\.field\.y/);
  });

  it('不自己裁 bgskin 当章底（那是原型的做法，生产用仿真场末帧）', () => {
    expect(frame).not.toMatch(/bgskin|liveBG|backgroundRect/);
  });

  it('场地那张离屏图按对象身份只画一次（逐帧重画 1080p 场地是纯浪费）', () => {
    expect(frame).toMatch(/new WeakMap<EndingStageInput,/);
    expect(frame).toMatch(/stageCache\.get\(input\.stage\)/);
  });
});

describe('52 · 缺游戏素材 = 留空 / 纯字（不画假徽章）', () => {
  it('四件素材逐件兜底（读不到 = null，不整组作废、不抛错）', () => {
    expect(assets).toMatch(/stamp: HTMLImageElement \| null/);
    expect(assets).toMatch(/judge: HTMLImageElement \| null/);
    expect(assets).toMatch(/particles: HTMLImageElement \| null/);
    expect(assets).toMatch(/badgeStar: HTMLImageElement \| null/);
    expect(assets).toMatch(/loadImage\(urls\.stamp\)\.catch\(\(\) => null\)/);
    expect(assets).toMatch(/EMPTY_ENDING_ASSETS/);
  });

  it('素材路径拼 `BASE_URL`（Electron 打包态是 file://，写死绝对路径会上不了图）', () => {
    expect(assets).toMatch(/import\.meta\.env\.BASE_URL/);
    expect(assets).toMatch(/assets\/game-ui/);
  });

  it('AP 图缺件 / FC 无官方字样 ⇒ 纯字，位置与图版同一框', () => {
    expect(frame).toMatch(/input\.stamp === 'ap' \? 'ALL PERFECT!' : 'FULL COMBO'/);
    expect(frame).toMatch(/WORD_ASPECT/);
    // 判定五档图集缺件时，那一格不画标签（也不拿字去仿）
    expect(frame).toMatch(/if \(img && box\) \{/);
  });

  it('普通 Clear = 无章：章段不画字、不放粒子', () => {
    expect(frame).toMatch(/if \(input\.stamp !== 'clear'\) \{/);
    expect(frame).toMatch(/input\.stamp === 'clear' \|\| a <= 0\.002/);
  });
});

describe('52 · 只在导出里演 + 设置 / 弹窗接线', () => {
  it('设置是 additive 段：默认开 + ap，缺字段回落开（老数据不得被静默关掉）', () => {
    expect(settings).toMatch(/DEFAULT_ENDING: EndingSettings = \{ enabled: true, stamp: 'ap' \}/);
    expect(settings).toMatch(/ending: \{ \.\.\.DEFAULT_ENDING \}/);
    expect(settings).toMatch(/export function normalizeEnding\(/);
    expect(settings).toMatch(/enabled: typeof src\.enabled === 'boolean' \? src\.enabled : fallback\.enabled !== false/);
  });

  it('页面按 `settings.export.ending` 组装数据面：关掉传 null（播完切末帧）', () => {
    expect(page).toMatch(/if \(chart == null \|\| !settings\.export\.ending\.enabled\) return null;/);
    expect(page).toMatch(/stamp: settings\.export\.ending\.stamp/);
    expect(page).toMatch(/counts: \{ perfect: noteCount, great: 0, good: 0, bad: 0, miss: 0 \}/);
    expect(page).toMatch(/ending: endingInput/);
    expect(hook).toMatch(/ending: args\.ending \?\? null/);
  });

  it('导出弹窗有「结尾画面」组：总开关 + 缩进子项「结算形态」', () => {
    expect(control).toMatch(/preview\.video\.export\.ending'/);
    expect(control).toMatch(/onEndingChange\(\{ enabled: v \}\)/);
    expect(control).toMatch(/onEndingChange\(\{ stamp: v \}\)/);
    expect(control).toMatch(/disabled=\{!ending\.enabled\}/);
    expect(page).toMatch(/ending=\{settings\.export\.ending\}/);
  });

  it('实时预览不接后置段（只在导出里演）：回放层不 import ending', () => {
    const playback = readStripped('src/preview/video/sim/simPlayback.ts');
    const stage = readStripped('src/pages/preview/PreviewVideoStage.tsx');
    // 按"结尾段"这个名字判，不按子串：`pending` 里也含 ending
    expect(playback).not.toMatch(/drawEndingFrameAt|video\/ending|endingSpec/);
    expect(stage).not.toMatch(/drawEndingFrameAt|video\/ending|endingSpec/);
  });

  it('音效不落生产：录屏裁出来的 `stamp-sfx` / 官方 SE 都不进代码', () => {
    const src = endingFiles.map((f) => file(f)).join('\n') + frameDriver + exportVideo;
    expect(src).not.toMatch(/stamp-sfx|SE_RHYTHM|AudioContext|decodeAudioData/);
  });
});
