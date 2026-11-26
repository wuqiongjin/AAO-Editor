// chart-preview 52 落点锁：结尾段（中央章 → 黑幕转场 → 结算）的**接线事实**。
//
// 手法照 VideoExportWiring.test.ts：读源码做字符串断言。锁的是票面 / 交接文档里的硬约定：
//   ① 结尾段是**纯后置**（开场 6.75 若开 + 前导 + 谱面 + 7.5），音轨一样长（短了音画错位）；
//   ② 章铺**仿真场末帧**（不是原型那种 bgskin cover 裁切），UI 画在**整帧**上；
//   ③ 缺游戏素材 = 留空 / 纯字，**不画假徽章**；AP / FC 各有**两套**材质（章用大的、结算用小的）；
//   ④ 只在导出里演（实时预览不接后置段），导出弹窗有「结尾画面」组（总开关 + 三档形态下拉）；
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
const hud = readStripped('src/preview/video/sim/simHud.ts');
const zh = readStripped('src/i18n/messages/zh-CN.json');
const en = readStripped('src/i18n/messages/en.json');

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

  it('导出总长 = 开场 + 前导 + 谱面 + 末击尾段 + 结尾；关掉结尾不减前导 / 尾段', () => {
    expect(exportVideo).toMatch(/req\.ending \? ENDING_SECONDS : 0/);
    expect(exportVideo).toMatch(/buildExportTimeline\(\{/);
    expect(exportVideo).toMatch(/chartDurationSeconds: req\.durationSeconds/);
    expect(exportVideo).toMatch(/endingSeconds,/);
  });

  it('音轨长度跟着拉到结尾段末尾（轨长必须与视频等长，否则封装时音画错位）', () => {
    expect(exportVideo).toMatch(/endingSeconds,/);
    expect(exportVideo).toMatch(/chartTailSeconds,/);
    expect(renderAudio).toMatch(/const chartTail = Number\.isFinite\(req\.chartTailSeconds\)/);
    expect(renderAudio).toMatch(
      /audioFramesFor\(req\.durationSeconds \+ chartTail \+ offset \+ endingSeconds, sampleRate\)/,
    );
  });
});

describe('52 · 两端的声（开场人潮 / 结尾章双声）', () => {
  const sfx = readStripped('src/preview/video/sfx.ts');

  it('编排层组装两张 cue 表：开场人潮 + 结尾章（票 75 起 at = 新 endingAt）', () => {
    expect(exportVideo).toMatch(/openingSfxCues\(openingSeconds\)/);
    expect(exportVideo).toMatch(/endingSfxCues\(timeline\.endingAt, req\.ending\.stamp\)/);
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
      /drawEndingFrameAt\(ctx, geometry\.width, geometry\.height, ending, t - endingAt,/,
    );
    // 票 76：结尾段把跨段 HUD 交给 drawEndingFrameAt 插在舞台与烟花之间
    expect(frameDriver).toMatch(/drawHudLayer\(hudCtx, chartSeconds, hudAlpha, t - simStartSeconds\)/);
    // 谱面段仍是 05 的同一份出帧（encode/ 里 `drawSimFrameAt` 仍只有一处）
    expect(frameDriver).toMatch(/drawSimFrameAt\(ctx, input, t - simStartSeconds, \{ noteAlpha, hudAlpha \}\)/);
  });

  it('结尾层的舞台直接调 drawSimFrameAt 画谱面末帧（同一份渲染真相）', () => {
    // 2026-10-27 起舞台**分层**：不再烤成一张整帧快照，按层给 alpha
    expect(frame).toMatch(/drawSimFrameAt\(ctx, frame, stage\.seconds, \{/);
    expect(frame).toMatch(/trackAlpha: layerAlpha\(elapsed, u\.spec\.trackFadeAt, u\.spec\.trackFadeDur\)/);
    expect(frame).toMatch(/comboAlpha: layerAlpha\(elapsed, u\.spec\.comboFadeAt, u\.spec\.comboFadeDur\)/);
    // 结尾段不画判定字 / 打歌顶栏（那是打歌时的东西）
    expect(frame).toMatch(/judge: null,/);
    expect(frame).toMatch(/hud: false,/);
    // 票 89：切点与 SE 读 builder 的 endingAt，不再入口自加 / 帧驱动倒推
    expect(exportVideo).toMatch(/endingSfxCues\(timeline\.endingAt, req\.ending\.stamp\)/);
    expect(frameDriver).toMatch(/const endingAt = timeline\.endingAt/);
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
  it('十四件素材逐件兜底（读不到 = null，不整组作废、不抛错）', () => {
    expect(assets).toMatch(/stampAp: HTMLImageElement \| null/);
    expect(assets).toMatch(/stampFc: HTMLImageElement \| null/);
    expect(assets).toMatch(/markAp: HTMLImageElement \| null/);
    expect(assets).toMatch(/markFc: HTMLImageElement \| null/);
    expect(assets).toMatch(/judge: HTMLImageElement \| null/);
    expect(assets).toMatch(/particles: HTMLImageElement \| null/);
    expect(assets).toMatch(/maxCombo: HTMLImageElement \| null/);
    expect(assets).toMatch(/badgeAp: HTMLImageElement \| null/);
    expect(assets).toMatch(/badgeFc: HTMLImageElement \| null/);
    expect(assets).toMatch(/badgeClear: HTMLImageElement \| null/);
    expect(assets).toMatch(/rankDisc: HTMLImageElement \| null/);
    expect(assets).toMatch(/rankLetterSs: HTMLImageElement \| null/);
    expect(assets).toMatch(/rankRibbon: HTMLImageElement \| null/);
    expect(assets).toMatch(/scoreMedal: HTMLImageElement \| null/);
    expect(assets).toMatch(/loadImage\(urls\[key\]\)\.catch\(\(\) => null\)/);
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

  it('顶栏星徽三态各读自己的派生件（虹彩 / 粉 / 金），同比例尺同中心', () => {
    expect(assets).toMatch(/badgeAp: `\$\{ENDING_ASSET_BASE\}\/result\/badge-ap\.png`/);
    expect(assets).toMatch(/badgeFc: `\$\{ENDING_ASSET_BASE\}\/result\/badge-fc\.png`/);
    expect(assets).toMatch(/badgeClear: `\$\{ENDING_ASSET_BASE\}\/result\/badge-clear\.png`/);
    expect(frame).toMatch(/ap: \[57, 55\]/);
    expect(frame).toMatch(/fc: \[57, 55\]/);
    expect(frame).toMatch(/clear: \[47, 45\]/);
    // 比例尺由最大那格定死（不是每格各自缩到同高）
    expect(frame).toMatch(/const k = u\.hp\('starSize'\) \/ BADGE_INK_W;/);
    // 换回旧图集那三格视为回归（`RhythmGameUI` 现在只切 Score 行的圆星章，不是星徽）
    expect(frame).not.toMatch(/badgeStar|star-64/);
  });

  it('MAX COMBO：有韩服真件时直接贴图，缺件才画两行文字', () => {
    expect(frame).toMatch(/const label = input\.assets\.maxCombo;/);
    expect(frame).toMatch(/if \(label\) \{/);
    expect(frame).toMatch(/ctx\.fillText\('MAX'/);
  });

  it('普通 Clear = 无章：章段不画字、结算不画角标（票 55 起仍放普通烟花）', () => {
    expect(frame).toMatch(/if \(input\.stamp !== 'clear'\) drawStampWord\(/);
    expect(frame).toMatch(/const bursts = spec\.clearBurst > 0\.5 \|\| input\.stamp !== 'clear';/);
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

  it('导出弹窗的「结尾画面」组：总开关 + 结算形态三档（AP / FC / CLEAR）', () => {
    expect(control).toMatch(/preview\.video\.export\.ending'/);
    expect(control).toMatch(/onEndingChange\(\{ enabled: v \}\)/);
    // 2026-11-09 用户验收：CLEAR 正式暴露（渲染层 clear 分支早已存在）
    expect(control).toMatch(/const ENDING_STAMP_CHOICES = \['ap', 'fc', 'clear'\] as const/);
    expect(control).toMatch(/onEndingChange\(\{ stamp \}\)/);
    expect(page).toMatch(/ending=\{settings\.export\.ending\}/);
    expect(zh).toMatch(/"preview\.video\.export\.ending\.stamp\.clear": "CLEAR"/);
    expect(en).toMatch(/"preview\.video\.export\.ending\.stamp\.clear": "CLEAR"/);
  });

  it('实时预览不接后置段（只在导出里演）：回放层不 import ending', () => {
    const playback = readStripped('src/preview/video/sim/simPlayback.ts');
    const stage = readStripped('src/pages/preview/PreviewVideoStage.tsx');
    // 按"结尾段"这个名字判，不按子串：`pending` 里也含 ending
    expect(playback).not.toMatch(/drawEndingFrameAt|video\/ending|endingSpec/);
    expect(stage).not.toMatch(/drawEndingFrameAt|video\/ending|endingSpec/);
  });
});

describe('54 · 中央章入场分层（逐字母 + 星标单飞）', () => {
  it('三层齐备：字形切块 / 逐字母波 / 星标单画，缺图仍退回整块擦入', () => {
    // 切块的产物与用法都在同一份绘制里；`drawWordWipe` 是缺件 / 拆不开的兜底，不能删
    expect(frame).toMatch(/function splitImage\(/);
    expect(frame).toMatch(/function drawGlyphWave\(/);
    expect(frame).toMatch(/function drawStampStar\(/);
    expect(frame).toMatch(/function drawWordWipe\(/);
    // 星标从字母层摘出去，否则会跟着某个字一起落
    expect(frame).toMatch(/if \(p\.star\) star = sprite;/);
  });

  it('星标影子按**字芯**取基准（FC 描边比 AP 厚，用整块框会大一圈）', () => {
    expect(frame).toMatch(/inkW/);
    expect(frame).toMatch(/inkSize \* \(big \+ \(ghostTo - big\) \* ge\)/);
    // 飞行影子是纯色矢量星，落位影子才是原图贴图
    expect(frame).toMatch(/drawSolidStar\(/);
    expect(frame).toMatch(/paint\(homeX, homeY, 1, 0, alpha\)/);
  });

  it('时间轴有三段可调：变大 → 停顿（`starHold`）→ 飞行，且飞行不再带缓坡', () => {
    expect(spec).toMatch(/starHold: 0,/);
    expect(frame).toMatch(/const flyStart = growEnd \+ \(Math\.max\(0, u\.spec\.starHold\) \/ 100\) \* inSec;/);
    // 「变大」用 smooth：easeOutCubic 会让 60% 的时长就长到 95%，尾段读作"停住了"
    expect(frame).toMatch(/const e = smooth\(q\);/);
  });
});

describe('55 · 结束中央章烟花与 `!` 飞镖式入场', () => {
  it('`!` 从字母层摘出，字母队列仍按原枚数算 stagger（前面的字时序不变）', () => {
    expect(frame).toMatch(/if \(last\.nx > 0\.78\) bang = glyphs\.pop\(\)!;/);
    expect(frame).toMatch(/waveCount: glyphs\.length \+ \(bang \? 1 : 0\)/);
    expect(frame).toMatch(/const n = Math\.max\(word\.glyphs\.length, word\.waveCount \|\| 0\);/);
    expect(frame).toMatch(/function drawStampBang\(/);
  });

  it('`!` 以字形左下角为支点摇摆，过冲后逐渐退回终位', () => {
    expect(frame).toMatch(/const py = \(g\.ny \+ g\.nh\) \* word\.h - word\.h \/ 2;/);
    expect(frame).toMatch(/Math\.sin\(q \* Math\.PI \* 2 \* Math\.max\(0\.5, u\.spec\.bangWobbles\)\)/);
  });

  it('双层烟花跟纯色影子星同起、随它长大外扩，并比它多活一段', () => {
    expect(frame).toMatch(/function drawStampHalo\(/);
    expect(frame).toMatch(/function drawBulgeDiamond\(/);
    expect(frame).toMatch(/const total = T\.ghostDur \+ Math\.max\(0, u\.spec\.haloSurvive\);/);
    expect(frame).toMatch(/const starSize = inkSize \* \(T\.big \+ \(ghostTo - T\.big\) \* ge\);/);
  });

  it('星标按字块高归一化（修 FC 星星比 AP 小），环外缘星尺寸独立可调', () => {
    expect(frame).toMatch(/const inkSize = Math\.max\(1, word\.h \* u\.spec\.starSizeRef\);/);
    expect(frame).toMatch(/const norm = inkSize \/ Math\.max\(1, star\.inkW \* word\.w\);/);
    expect(frame).toMatch(/const ringStarPx = u\.hp\('haloRingStarSize'\);/);
  });

  it('菱形层 = 中心晚起快扩的另一层爆炸；环形随机排布、种子可调，不再按顶点分扇区', () => {
    expect(frame).toMatch(/const diaAt = T\.flyStart \+ Math\.max\(0, u\.spec\.haloDiaAt\);/);
    expect(frame).toMatch(/easeOutCubic\(dq\)/);
    expect(frame).toMatch(/mulberry32\(Math\.round\(u\.spec\.haloDiaSeed\)/);
    expect(frame).toMatch(/layout === 'scatter'/);
    expect(frame).not.toMatch(/haloVertexPer|haloVertexRadius|haloVertexSpread/);
  });

  it('菱形淡出与向外扩散同时开始（不再到位后才淡），起点可调', () => {
    expect(frame).toMatch(/const fadeAt = clamp01\(u\.spec\.haloDiaFadeAt\) \* diaDur;/);
    expect(frame).toMatch(/const vanish = Math\.pow\(1 - clamp01\(\(diaAge - fadeAt\) \/ diaFade\), 1\.15\);/);
    expect(spec).toMatch(/haloDiaFadeAt: 0,/);
  });

  it('普通烟花：5 色池 / 单色爆点 / 逐点错峰 / CLEAR 也放 / 缓存键含 spec', () => {
    expect(frame).toMatch(/function burstPool\(/);
    expect(frame).toMatch(/ats: d\.points\.map\(\(_, pi\) => d\.at \+ pi \* stagger\)/);
    expect(frame).toMatch(/const color = grp\.colors\[pi\] \?\? '#ffffff';/);
    expect(frame).toMatch(/JSON\.stringify\(u\.spec\)/);
    expect(frame).toMatch(/const bursts = spec\.clearBurst > 0\.5 \|\| input\.stamp !== 'clear';/);
  });

  it('星标 / `!` / 两层烟花共用一份 `starTimeline`（landAt 不再各算一遍）', () => {
    // 三处绘制都消费同一份：改 stampIn / starGrow 时不会互相漂
    expect(frame.match(/const T = starTimeline\(u\);/g)).toHaveLength(3);
    expect(frame).toMatch(/const \{ at, growDur, growEnd, flyStart, flyDur, landAt, ghostDur \} = T;/);
    expect(frame.match(/function starTimeline\(/g)).toHaveLength(1);
  });
});

describe('73 · 结算 Score 行 + SCORE RANK 徽章（推翻 ADR-0016 §5.2）', () => {
  it('三项版式常量必须一起改：顶栏 74%W / 首行 12%H / MAX COMBO 同步下移', () => {
    expect(spec).toMatch(/barW: 74,/);
    expect(spec).toMatch(/rowFirst: 12,/);
    expect(spec).toMatch(/comboY: 11\.4,/);
  });

  it('标签固定 `Score`（不做 i18n）；得分 = 归一最终分，从数据面一路接进 `EndingFrameInput`', () => {
    expect(frame).toMatch(/const RESULT_LABEL = 'Score';/);
    expect(frame).toMatch(/ctx\.fillText\(RESULT_LABEL, tx, cy \+ 1\)/);
    expect(frame).toMatch(/ctx\.fillText\(String\(input\.score\), sx, cy \+ 1\)/);
    expect(exportVideo).toMatch(/score: req\.ending\.score/);
    expect(page).toMatch(/score: SCORE_MAX/);
    expect(frame).not.toMatch(/preview\.ending\.score|i18n/);
  });

  it('SCORE RANK = 10 档（顶端 SS，实机没有 SS+ 徽章），与打歌 6 档独立；缺件走纯字降级', () => {
    expect(frame).toMatch(/scoreRankAt\(input\.score\)/);
    expect(frame).toMatch(/input\.assets\.rankDisc/);
    expect(frame).toMatch(/input\.assets\.rankRibbon/);
    expect(frame).toMatch(/RANK_LETTER_RANKS\.has\(rank\)/);
    expect(frame).toMatch(/ctx\.fillText\(rank,/);
    expect(hud).not.toMatch(/'SS', 'SS\+'/); // 结算 rank 表不接图集里那枚 SS+
    // 星徽三态是三张整图（票 83），尺寸表仍在绘制侧，不拿 RhythmGameUI 冒充
    expect(frame).toMatch(/ap: \[57, 55\]/);
    expect(frame).toMatch(/input\.assets\.scoreMedal/);
    // 票 83：图集不再进绘制侧（不再有 MenuAtlas 切图坐标）
    expect(frame).not.toMatch(/MenuAtlas|HUD_SPRITES\.rank|HUD_SPRITES\.ribbon|HUD_SPRITES\.medal/);
  });

  it('出场时机复用结算入场的 `q` 尺（行 24%/24%、徽章 20%/20%），不是判完五行才出现', () => {
    expect(spec).toMatch(/resultInAt: 24,/);
    expect(spec).toMatch(/resultInDur: 24,/);
    expect(spec).toMatch(/rankInAt: 20,/);
    expect(spec).toMatch(/rankInDur: 20,/);
    expect(frame).toMatch(/drawResultRow\(ctx, u, input, card, scoreP\)/);
    // 票 82：徽章不再吃一个整体 alpha，改成窗口内三层各自推进
    expect(frame).toMatch(/drawRankBadge\(ctx, u, input, rankBadgeProgressAt\(u\.spec, rankQ\)\)/);
    expect(spec).toMatch(/rankDiscInTo: 55,/);
    expect(spec).toMatch(/rankLetterScaleFrom: 1\.28,/);
    expect(spec).toMatch(/rankRibbonRise: 0\.3125,/);
  });
});
