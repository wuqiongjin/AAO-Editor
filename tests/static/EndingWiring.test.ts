// chart-preview 52 落点锁：结尾段（中央章 → 黑幕转场 → 结算）的**接线事实**。
//
// 手法照 VideoExportWiring.test.ts：读源码做字符串断言。锁的是票面 / 交接文档里的硬约定：
//   ① 结尾段是**纯后置**（开场 5.0 若开 + 谱面 + 7.5），音轨一样长（短了音画错位）；
//   ② 章铺**仿真场末帧**（不是原型那种 bgskin cover 裁切），UI 画在**整帧**上；
//   ③ 缺游戏素材 = 留空 / 纯字，**不画假徽章**；AP / FC 各有**两套**材质（章用大的、结算用小的）；
//   ④ 只在导出里演（实时预览不接后置段），导出弹窗有「结尾画面」组（**只有总开关**）；
//   ⑤ 两端的声：开场人潮 0s 起、结尾章两层同起（具体 SE 名只在 `sfx.ts` 里）。
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

  it('三段时长钉死 3.0 / 1.55 / 2.95 = 7.5（2026-10-27 原型定稿回填）', () => {
    expect(spec).toMatch(/stampDur: 3,/);
    expect(spec).toMatch(/transDur: 1\.55,/);
    expect(spec).toMatch(/resultDur: 2\.95,/);
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

  it('音轨长度跟着拉到结尾段末尾（轨长必须与视频等长，否则封装时音画错位）', () => {
    expect(exportVideo).toMatch(/endingSeconds,/);
    expect(renderAudio).toMatch(/const tail = Number\.isFinite\(req\.endingSeconds\)/);
    expect(renderAudio).toMatch(/audioFramesFor\(req\.durationSeconds \+ offset \+ tail, sampleRate\)/);
  });
});

describe('52 · 两端的声（开场人潮 / 结尾章双声）', () => {
  const sfx = readStripped('src/preview/video/sfx.ts');

  it('编排层组装两张 cue 表：开场人潮 + 结尾章', () => {
    expect(exportVideo).toMatch(/openingSfxCues\(openingSeconds\)/);
    expect(exportVideo).toMatch(/endingSfxCues\(openingSeconds \+ req\.durationSeconds, req\.ending\.stamp\)/);
    expect(exportVideo).toMatch(/sfx,/);
    expect(renderAudio).toMatch(/req\.sfx/);
  });

  it('开场人潮 0s 起、收在开场段末尾并淡出（用户：快结束时音量递减）', () => {
    expect(sfx).toMatch(/OPENING_CROWD_SFX = 'SE_RHYTHM_GAYA'/);
    expect(sfx).toMatch(/at: 0,/);
    expect(sfx).toMatch(/endAt: openingSeconds,/);
    expect(sfx).toMatch(/fadeOut: OPENING_CROWD_FADE_OUT/);
  });

  it('结尾章两层同起在结尾段 t=0：人声固定 + 按形态选伴奏（clear 也有）', () => {
    expect(sfx).toMatch(/ENDING_VOICE_SFX = 'SE_RHYTHM_CLEAR_VO'/);
    expect(sfx).toMatch(/ENDING_CLEAR_SFX = 'SE_RHYTHM_CLEAR'/);
    expect(sfx).toMatch(/ENDING_FULLCOMBO_SFX = 'SE_RHYTHM_FULLCOMBO'/);
    expect(sfx).toMatch(/stamp === 'fc' \|\| stamp === 'ap' \? ENDING_FULLCOMBO_SFX : ENDING_CLEAR_SFX/);
    expect(sfx).toMatch(/at: atSeconds, gain: ENDING_SFX_GAIN_VOICE/);
  });

  it('音量只有一条口径：走 `se` 增益，不另开"结尾音量"设置', () => {
    expect(renderAudio).toMatch(/scheduleSfx\(ctx, se, req\.sfx/);
    expect(settings).not.toMatch(/endingVolume|sfxVolume|crowdVolume/);
    // 具体 SE 名只允许出现在 `sfx.ts`（encode/ 与绘制层不认识游戏素材名）
    const encodeSide = endingFiles.map((f) => file(f)).join('\n') + frameDriver + exportVideo + renderAudio;
    expect(encodeSide).not.toMatch(/SE_RHYTHM/);
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
    // 2026-10-27 起舞台**分层**：不再烤成一张整帧快照，按层给 alpha
    expect(frame).toMatch(/drawSimFrameAt\(ctx, stage\.frame, stage\.seconds, \{/);
    expect(frame).toMatch(/trackAlpha: layerAlpha\(elapsed, u\.spec\.trackFadeAt, u\.spec\.trackFadeDur\)/);
    expect(frame).toMatch(/comboAlpha: layerAlpha\(elapsed, u\.spec\.comboFadeAt, u\.spec\.comboFadeDur\)/);
    // 结尾段不画判定字（那是打歌时的东西）
    expect(frame).toMatch(/judge: null,/);
    expect(frameDriver).toMatch(/seconds: chartSeconds/);
    expect(frameDriver).toMatch(/x: geometry\.field\.x/);
    expect(frameDriver).toMatch(/y: geometry\.field\.y/);
  });

  it('不自己裁 bgskin 当章底（那是原型的做法，生产用仿真场末帧）', () => {
    expect(frame).not.toMatch(/bgskin|liveBG|backgroundRect/);
  });

  it('舞台不再缓存成整帧快照（combo / 轨道要能各自淡，烤进图里就收不掉了）', () => {
    expect(frame).not.toMatch(/stageCache|stageCanvas/);
    // 淡出走「层 alpha」，三层各一条（背景留 1，轨道 / combo 各自收）
    expect(frame).toMatch(/function layerAlpha\(elapsed: number, at: number, dur: number\): number/);
  });
});

describe('52 · 缺游戏素材 = 留空 / 纯字（不画假徽章）', () => {
  it('八件素材逐件兜底（读不到 = null，不整组作废、不抛错）', () => {
    expect(assets).toMatch(/stampAp: HTMLImageElement \| null/);
    expect(assets).toMatch(/stampFc: HTMLImageElement \| null/);
    expect(assets).toMatch(/markAp: HTMLImageElement \| null/);
    expect(assets).toMatch(/markFc: HTMLImageElement \| null/);
    expect(assets).toMatch(/judge: HTMLImageElement \| null/);
    expect(assets).toMatch(/particles: HTMLImageElement \| null/);
    expect(assets).toMatch(/maxCombo: HTMLImageElement \| null/);
    expect(assets).toMatch(/menu: HTMLImageElement \| null/);
    expect(assets).toMatch(/loadImage\(urls\.stampAp\)\.catch\(\(\) => null\)/);
    expect(assets).toMatch(/EMPTY_ENDING_ASSETS/);
  });

  it('素材路径拼 `BASE_URL`（Electron 打包态是 file://，写死绝对路径会上不了图）', () => {
    expect(assets).toMatch(/import\.meta\.env\.BASE_URL/);
    expect(assets).toMatch(/assets\/game-ui/);
  });

  it('AP / FC 两套材质：中央章读 stamp*、结算标读 mark*（互不顶替）', () => {
    expect(frame).toMatch(/if \(input\.stamp === 'ap'\) return input\.assets\.stampAp;/);
    expect(frame).toMatch(/if \(input\.stamp === 'fc'\) return input\.assets\.stampFc;/);
    expect(frame).toMatch(/if \(input\.stamp === 'ap'\) return input\.assets\.markAp;/);
    expect(frame).toMatch(/if \(input\.stamp === 'fc'\) return input\.assets\.markFc;/);
    expect(frame).toMatch(/input\.stamp === 'ap' \? 'ALL PERFECT!' : 'FULL COMBO'/);
    expect(frame).toMatch(/WORD_ASPECT/);
    // 判定五档图集缺件时，那一格不画标签（也不拿字去仿）
    expect(frame).toMatch(/if \(img && box\) \{/);
  });

  it('顶栏星徽切 `atlas/MenuAtlas.png` 三格（虹彩 / 粉 / 金），同比例尺同中心', () => {
    expect(assets).toMatch(/menu: `\$\{ENDING_ASSET_BASE\}\/atlas\/MenuAtlas\.png`/);
    expect(frame).toMatch(/ap: \[116, 218, 57, 55\]/);
    expect(frame).toMatch(/fc: \[60, 257, 57, 55\]/);
    expect(frame).toMatch(/clear: \[275, 230, 47, 45\]/);
    // 比例尺由最大那格定死（不是每格各自缩到同高）
    expect(frame).toMatch(/const k = u\.hp\('starSize'\) \/ BADGE_INK_W;/);
    // 换回旧图集那三格视为回归
    expect(frame).not.toMatch(/RhythmGameUI|badgeStar|star-64/);
  });

  it('MAX COMBO：有韩服真件时直接贴图，缺件才画两行文字', () => {
    expect(frame).toMatch(/const label = input\.assets\.maxCombo;/);
    expect(frame).toMatch(/if \(label\) \{/);
    expect(frame).toMatch(/ctx\.fillText\('MAX'/);
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

  it('导出弹窗的「结尾画面」组**只有总开关**（形态档 2026-10-27 暂时不上弹窗，固定 AP）', () => {
    expect(control).toMatch(/preview\.video\.export\.ending'/);
    expect(control).toMatch(/onEndingChange\(\{ enabled: v \}\)/);
    expect(control).not.toMatch(/onEndingChange\(\{ stamp: v \}\)/);
    expect(control).not.toMatch(/ENDING_STAMPS/);
    expect(page).toMatch(/ending=\{settings\.export\.ending\}/);
  });

  it('实时预览不接后置段（只在导出里演）：回放层不 import ending', () => {
    const playback = readStripped('src/preview/video/sim/simPlayback.ts');
    const stage = readStripped('src/pages/preview/PreviewVideoStage.tsx');
    // 按"结尾段"这个名字判，不按子串：`pending` 里也含 ending
    expect(playback).not.toMatch(/drawEndingFrameAt|video\/ending|endingSpec/);
    expect(stage).not.toMatch(/drawEndingFrameAt|video\/ending|endingSpec/);
  });
});
