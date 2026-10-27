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
const sprites = readStripped('src/preview/video/sim/simSprites.ts');
const assets = readStripped('src/preview/video/sim/simAssets.ts');

describe('51 · 判定字画在仿真场帧里（预览 / 导出同一份）', () => {
  it('出帧入口里先画判定字再画 combo（HUD 两件都在 `drawSimFrameAt` 这一条路上）', () => {
    expect(field).toMatch(
      /drawJudgement\(ctx, metrics, chart, seconds, input\.assets\.judge, layers\?\.judge\)/,
    );
    expect(field).toMatch(
      /drawCombo\(ctx, metrics, chart, seconds, input\.assets\.sprites, layers\?\.comboAlpha \?\? 1, layers\?\.combo\)/,
    );
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

  it('Auto 永远 PERFECT：只切 PERFECT 那一格，不按漏判分档', () => {
    expect(hud).toMatch(/life: number = SIM_JUDGE\.life,/);
    expect(hud).toMatch(/return age <= life \? age : null;/);
    // 停留时长可由调用方覆盖（结尾段 / 原型调参），但判定只有 PERFECT 一档
    expect(field).toMatch(/judgeAt\(chart, seconds, js\.life\)/);
    expect(field).toMatch(/const box = judgeSprite\(\);/);
    expect(field).not.toMatch(/judge_great|judge_miss|judge_auto/);
  });

  it('缺 `judgeskin` ⇒ 纯字 "PERFECT"（Q12：留空或纯字，不画假徽章）', () => {
    expect(field).toMatch(/ctx\.fillText\('PERFECT', cx, cy\)/);
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
    expect(field).toMatch(/g\.globalCompositeOperation = 'source-over';\n  g\.drawImage\(white, pad, pad\)/);
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

describe('51 · 素材路径与既有素材树同一条规则', () => {
  it('判定图集在 `assets/game-ui/judgeskin/skin00/judge.png`（拼 BASE_URL，file:// 下也能读）', () => {
    expect(assets).toMatch(/GAME_UI_ASSET_BASE = `\$\{import\.meta\.env\.BASE_URL\}assets\/game-ui`/);
    expect(assets).toMatch(/`\$\{GAME_UI_ASSET_BASE\}\/judgeskin\/skin00\/judge\.png`/);
  });

  it('本期不做开关 / 不做档位（Auto 恒 PERFECT；「未来可配置」只是登记）', () => {
    expect(hud).not.toMatch(/setting|enabled|toggle/i);
    expect(field).not.toMatch(/judgeEnabled|apComboEnabled/);
  });
});
