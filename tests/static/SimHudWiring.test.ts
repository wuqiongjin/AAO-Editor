// chart-preview 51 落点锁：判定字 + AP combo 变色的**接线事实**（DOM / 逐帧观感测不到的那几条）。
//
//   ① 判定字位置固定在场中央（不是"该轨正中"，第 3 轮定案已回改）；
//   ② 判定字与 combo 都画在仿真场帧里 ⇒ 实时预览与导出**同一份**（不新开只导出的分支）；
//   ③ 素材 = 游戏 `judgeskin`，缺图走纯字 / 留空，不画假徽章（Q12）；
//   ④ AP 续航态：数字按形状填**竖向虹彩**（实机采样色）+ 白描边 + 粉/青辉光，
//      「COMBO」小字保持白；近 1.05s 叠辉光。旧版「整串染紫」保留为 `flat` 档做对照。
//   ⑤ 判定字 / combo / 轨道三层都可由调用方传 alpha（结尾段要分层收）。
import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

const field = readStripped('src/preview/video/sim/simField.ts');
const hud = readStripped('src/preview/video/sim/simHud.ts');
const assets = readStripped('src/preview/video/sim/simAssets.ts');

describe('51 · 判定字画在仿真场帧里（预览 / 导出同一份）', () => {
  it('出帧入口里顶栏 → 判定字 → combo（HUD 三件都在 `drawSimFrameAt` 这一条路上）', () => {
    expect(field).toMatch(/if \(layers\?\.hud !== false\) \{/);
    expect(field).toMatch(/drawTopBar\(ctx, metrics, chart, seconds, input\.assets\.hud, autoMode\)/);
    expect(field).toMatch(
      /drawJudgement\(ctx, metrics, chart, seconds, input\.assets\.judge, autoMode, layers\?\.judge\)/,
    );
    // AP 态由场景带入（`settings.preview.apCombo`），AUTO 下强制素白
    expect(field).toMatch(
      /drawCombo\(ctx, metrics, chart, seconds, input\.assets\.sprites, layers\?\.comboAlpha \?\? 1, \{\s*ap: comboApActive\(input\.scene\.apCombo \?\? true, autoMode\),/,
    );
    expect(field.indexOf('drawTopBar(ctx')).toBeLessThan(field.indexOf('drawJudgement(ctx'));
    // combo 在判定字之后调（免得字块压在数字上）
    expect(field.indexOf('drawJudgement(ctx')).toBeLessThan(field.indexOf('drawCombo(ctx'));
  });

  it('位置固定：横向取场地中线比例，**不**碰轨道中心 / 判字跟随', () => {
    // 样式先合并成 `js`，再按比例落位（`js` 缺省 = `SIM_JUDGE`）
    expect(field).toMatch(/const js: SimJudgeStyle = \{ \.\.\.SIM_JUDGE, \.\.\.style \};/);
    expect(field).toMatch(/const cx = m\.w \* js\.cx;/);
    expect(field).toMatch(/const cy = m\.laneHeight - m\.h \* js\.dy;/);
    // 「该轨正中」那一版已作废：判定字不查轨道
    const judgement = field.slice(field.indexOf('function drawJudgement'), field.indexOf('function drawCombo'));
    expect(judgement).not.toMatch(/laneCenterX|elementPoint|mirrorLane/);
  });

  it('AUTO / PERFECT 两档共用同一条判定链，不按漏判分档、不自造 `AUTO PLAY`', () => {
    expect(hud).toMatch(/life: number = SIM_JUDGE\.life,/);
    expect(hud).toMatch(/return judgeStateAt\(chart, seconds, life\)\?\.age \?\? null;/);
    expect(hud).toMatch(/auto: \{ x: 289, y: 177, w: 205, h: 79 \}/);
    expect(hud).toMatch(/return auto \? JUDGE_BOXES\.auto : JUDGE_BOXES\.perfect;/);
    // 停留时长可由调用方覆盖（结尾段 / 原型调参），但只有两档
    expect(field).toMatch(/judgeStateAt\(chart, seconds, js\.life\)/);
    expect(field).toMatch(/const box = judgeSprite\(auto\);/);
    expect(field).toMatch(/const autoMode = input\.scene\.autoMode \?\? true;/);
    expect(field).not.toMatch(/judge_great|judge_miss|AUTO PLAY|judgeAutoPlay/);
    expect(hud).not.toMatch(/AUTO PLAY/);
  });

  it('缺 `judgeskin` ⇒ 纯字（Q12：留空或纯字，不画假徽章）', () => {
    expect(field).toMatch(/ctx\.fillText\(auto \? 'AUTO' : 'PERFECT', cx, cy\)/);
    expect(assets).toMatch(/loadImage\(simJudgeUrl\(\)\)\.catch\(\(\) => null\)/);
    expect(assets).toMatch(/judge: HTMLImageElement \| null/);
    // 缺判定图集**不置 missing**（场地照画、判定字退纯字）
    expect(assets).toMatch(/judge,\n\s+missing: false/);
  });
});

describe('52 · AP combo（按 `.cache/Combo-Style.mov` 重做：白芯 + 渐变描边 + 脉动光晕）', () => {
  it('默认 AP 态：`ap: true`，光晕有强度与脉动周期', () => {
    expect(field).toMatch(/ap: true,/);
    expect(field).toMatch(/pop: 0\.2,/);
    expect(field).toMatch(/glow: 1,/);
    expect(field).toMatch(/glowPeriod: 1,/);
  });

  it('色值 = 录屏采样：描边 洋红 → 紫 → 青', () => {
    expect(field).toMatch(/top: '#e35bd2'/);
    expect(field).toMatch(/mid: '#a163d8'/);
    expect(field).toMatch(/bottom: '#3fc9c7'/);
  });

  it('字芯是白的、描边是渐变的（不再是"渐变字 + 白描边"）', () => {
    // 环 = 白色剪影铺 8 向（扩张）→ destination-out 挖掉字形 → source-in 灌竖向渐变
    expect(field).toMatch(/for \(let i = 0; i < 8; i\+\+\) \{/);
    expect(field).toMatch(/globalCompositeOperation = 'destination-out'/);
    expect(field).toMatch(/globalCompositeOperation = 'source-in'/);
    // 白芯最后压回中间
    expect(field).toMatch(/g\.globalCompositeOperation = 'source-over';\n {2}g\.drawImage\(white, pad, pad\)/);
    // 旧的白色描边（用户点名要删的那圈白）不许回来
    expect(field).not.toMatch(/strokeStyle = '#ffffff'/);
  });

  it('「COMBO」也吃同一套特效（不是白字），但描边更细', () => {
    expect(field).toMatch(/apTile\(sprites\.combo, labelRect, labelW, labelH, 0\.045\)/);
    expect(field).toMatch(/const labelRect = \{ sx: 0, sy: 0, sw: sprites\.combo\.width/);
  });

  it('「COMBO」也有光晕与呼吸（上一版只给了数字）', () => {
    // 光晕那一趟里必须同时铺标签
    expect(field).toMatch(/const labelGlow = glowTile\(sprites\.combo, labelRect, labelW, labelH, 0\.08\)/);
    const pass = field.slice(field.indexOf('const glowPass ='), field.indexOf("glowPass('behind'"));
    expect(pass).toContain('labelGlow');
    expect(pass).toContain('mod.scale');
  });

  it('光晕**沿字形边缘**糊开（不是中心一团圆光）', () => {
    // 用画布滤镜糊字形本身，而不是画一个 radialGradient
    expect(field).toMatch(/g\.filter = `blur\(\$\{/);
    expect(field).toMatch(/g\.drawImage\(img, rect\.sx, rect\.sy, rect\.sw, rect\.sh, pad, pad, tw, th\)/);
    expect(field).not.toMatch(/createRadialGradient/);
    // 前后各铺一层：后面是主光晕，正面薄薄一层 = 向内渗透
    expect(field).toMatch(/glowPass\('behind', 2\)/);
    expect(field).toMatch(/glowPass\('front', 1\)/);
  });

  it('居中按**墨迹**算（字宽居中在 2 位以上会偏）', () => {
    expect(field).toMatch(/function glyphInk\(/);
    expect(field).toMatch(/const inkShift = -\(inkSpanLeft \+ inkSpanRight\) \/ 2;/);
    expect(field).toMatch(/let dx = \(-cells\.length \/ 2\) \* digitW \+ inkShift;/);
  });

  it('整串仍以锚点居中（`Ae = -length/2`；不许再整体左移半格）', () => {
    expect(field).toMatch(/const inkShift = -\(inkSpanLeft \+ inkSpanRight\) \/ 2;/);
    expect(field).toMatch(/const left = x \+ dx \* scale;/);
    expect(field).not.toMatch(/const left = x \+ dx \* scale - dw \/ 2/);
  });

  it('光晕会脉动：常亮底 + 余弦相位 + 命中闪一下', () => {
    // 相位走**绝对秒**（不然每来一个音就把呼吸打断），深度调满才看得出
    expect(field).toMatch(/const phase = period > 0 \? 0\.5 - 0\.5 \* Math\.cos\(\(seconds \/ period\) \* Math\.PI \* 2\) : 0\.75;/);
    expect(field).toMatch(/const flash = Math\.exp\(-since \/ 0\.12\)/);
    expect(field).toMatch(/alpha = clamp01\(\(0\.14 \+ 0\.95 \* phase\) \* cs\.glow \+ 0\.4 \* flash \* cs\.glow\)/);
    // 峰顶连光晕范围一起涨 ⇒ 像"呼吸"而不是单纯调亮度
    expect(field).toMatch(/scale: 1 \+ 0\.06 \* phase/);
    // 光晕是加色叠（发光），不是半透明色块
    expect(field).toMatch(/ctx\.globalCompositeOperation = 'lighter';/);
  });

  it('叠字不淡入：`stacked` 时 alpha 直接满强度（高密度谱不再一闪一闪）', () => {
    expect(field).toMatch(/const fadeInA = stacked \|\| js\.fadeIn <= 0 \? 1 : Math\.min\(1, age \/ js\.fadeIn\);/);
    expect(field).toMatch(/const alpha = fadeInA \* fadeOutA;/);
  });

  it('combo 的 AP 态由 `settings.preview.apCombo` 与 `autoMode` 共同决定（缺省 = 开 / AUTO 开）', () => {
    expect(field).toMatch(/ap: comboApActive\(input\.scene\.apCombo \?\? true, autoMode\),/);
    expect(field).toMatch(/apCombo\?: boolean;/);
    expect(hud).toMatch(/return apCombo && !autoMode;/);
  });

  it('判定字也"弹一下"（与 combo 同一条 `comboPopScale` 曲线）', () => {
    expect(field).toMatch(/const pop = js\.pop > 0 \? comboPopScale\(age\) : 1;/);
    expect(field).toMatch(/const h = m\.h \* js\.h \* pop;/);
    expect(hud).toMatch(/pop: 0\.2,/);
  });

  it('非 AP（`ap: false`）就是纯白原图，不套瓦片也不发光', () => {
    expect(field).toMatch(/const mod = cs\.ap \? apGlowModulation\(seconds, since, cs\) : \{ alpha: 0, scale: 1 \};/);
    expect(field).toMatch(/const tile = cs\.ap \? apTile\(sprites\.digits, cell\.rect, digitW, digitH\) : null;/);
  });
});

describe('63 · 官方 HUD 顶栏（原型定稿参数 / 官方切图 / 归一分）', () => {
  it('取景坐标照 `README.txt` §六，逐件来自官方图集 / 用户自备件', () => {
    expect(hud).toMatch(/barA: \[1, 393, 661, 22\]/);
    expect(hud).toMatch(/pause: \[828, 318, 63, 60\]/);
    expect(hud).toMatch(/star: \[0, 266, 110, 100\]/);
    expect(hud).toMatch(/scoreBand: \{ x: 64, y: 10, w: 521, h: 41 \}/);
    expect(hud).toMatch(/lifeBand: \{ x: 78, y: 9, w: 451, h: 50 \}/);
    expect(field).toMatch(/HUD_SPRITES\.barA/);
    expect(field).toMatch(/HUD_SPRITES\.star/);
  });

  it('分数 = floor(满分 × 已命中 / 总数)，最后一音补齐；7 位定宽', () => {
    expect(hud).toMatch(/if \(hits >= total\) return SCORE_MAX;/);
    expect(hud).toMatch(/return Math\.floor\(\(SCORE_MAX \* hits\) \/ total\);/);
    expect(hud).toMatch(/padStart\(SCORE_DIGITS, '0'\)/);
    expect(field).toMatch(/scoreAt\(chart, seconds\)/);
  });

  it('6 档条一律取官方渐变条 A 的窗口；`+增量` 与 SS+ 星点按时间轴走', () => {
    expect(field).toMatch(/const tierIndex = scoreTierAt\(score\);/);
    expect(field).toMatch(/const tier = SCORE_TIERS\[tierIndex\];/);
    expect(field).toMatch(/plusAgesAt\(chart, seconds, SIM_HUD\.plusDur\)/);
    expect(field).toMatch(/HUD_SPRITES\.star/);
    // 不许自造 `AUTO PLAY` 字样，也不许拿程序化径向渐变冒充官方分数条
    expect(field).not.toMatch(/AUTO PLAY/);
    expect(hud).not.toMatch(/AUTO PLAY/);
  });

  it('缺 `score-bar` / `life-bar` 只降级描边框，不抛错、不画假组件', () => {
    expect(field).toMatch(/if \(!hud\.scoreBar\) \{/);
    expect(field).toMatch(/if \(!hud\.lifeBar\) \{/);
    expect(field).toMatch(/if \(!autoMode \|\| !assets\.autoLive\) return;/);
  });
});

describe('51 · 素材路径与既有素材树同一条规则', () => {
  it('判定图集在 `assets/game-ui/judgeskin/skin00/judge.png`（拼 BASE_URL，file:// 下也能读）', () => {
    expect(assets).toMatch(/GAME_UI_ASSET_BASE = `\$\{import\.meta\.env\.BASE_URL\}assets\/game-ui`/);
    expect(assets).toMatch(/`\$\{GAME_UI_ASSET_BASE\}\/judgeskin\/skin00\/judge\.png`/);
  });

  it('AUTO 提示只读用户自备 `auto-live.png`（缺件留空，不画自造字样）', () => {
    expect(assets).toMatch(/autoLive: `\$\{GAME_UI_ASSET_BASE\}\/hud\/auto-live\.png`/);
    expect(field).toMatch(/if \(!autoMode \|\| !assets\.autoLive\) return;/);
    expect(field).toMatch(/ctx\.drawImage\(assets\.autoLive, 0, 0, 512, 113,/);
    expect(field).not.toMatch(/judgeEnabled|apComboEnabled/);
  });

  it('判定字不做档位开关（只有 AUTO / PERFECT 两档，其余四档 / FAST / SLOW 不接）', () => {
    expect(hud).not.toMatch(/setting|enabled|toggle/i);
    expect(hud).not.toMatch(/judge_great|judge_miss|fast|slow/i);
  });
});
