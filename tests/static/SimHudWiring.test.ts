// chart-preview 51 落点锁：判定字 + AP combo 变色的**接线事实**（DOM / 逐帧观感测不到的那几条）。
//
//   ① 判定字位置固定在场中央（不是"该轨正中"，第 3 轮定案已回改）；
//   ② 判定字与 combo 都画在仿真场帧里 ⇒ 实时预览与导出**同一份**（不新开只导出的分支）；
//   ③ 素材 = 游戏 `judgeskin`，缺图走纯字 / 留空，不画假徽章（Q12）；
//   ④ AP 变色是把 Bestdori 数字**染色**，不是换一套精灵；近 1.05s 叠光环。
import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

const field = readStripped('src/preview/video/sim/simField.ts');
const hud = readStripped('src/preview/video/sim/simHud.ts');
const sprites = readStripped('src/preview/video/sim/simSprites.ts');
const assets = readStripped('src/preview/video/sim/simAssets.ts');

describe('51 · 判定字画在仿真场帧里（预览 / 导出同一份）', () => {
  it('出帧入口里先画判定字再画 combo（HUD 两件都在 `drawSimFrameAt` 这一条路上）', () => {
    expect(field).toMatch(/drawJudgement\(ctx, metrics, chart, seconds, input\.assets\.judge\)/);
    expect(field).toMatch(/drawCombo\(ctx, metrics, chart, seconds, input\.assets\.sprites\)/);
    expect(field.indexOf('drawJudgement(ctx')).toBeLessThan(field.indexOf('drawCombo(ctx'));
  });

  it('位置固定：横向取场地中线比例，**不**碰轨道中心 / 判字跟随', () => {
    expect(field).toMatch(/const cx = m\.w \* SIM_JUDGE\.cx;/);
    expect(field).toMatch(/const cy = m\.laneHeight - m\.h \* SIM_JUDGE\.dy;/);
    // 「该轨正中」那一版已作废：判定字不查轨道
    const judgement = field.slice(field.indexOf('function drawJudgement'), field.indexOf('function drawCombo'));
    expect(judgement).not.toMatch(/laneCenterX|elementPoint|mirrorLane/);
  });

  it('Auto 永远 PERFECT：只切 PERFECT 那一格，不按漏判分档', () => {
    expect(hud).toMatch(/export function judgeAt\(chart: SimChart, seconds: number\)/);
    expect(hud).toMatch(/return age <= SIM_JUDGE\.life \? age : null;/);
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

describe('51 · AP combo 变色（染色现有 digits，不换精灵）', () => {
  it('数字 / COMBO 标签都走同一份染色，颜色取 `SIM_AP_COMBO.tint`', () => {
    expect(field).toMatch(/tintedImage\(sprites\.digits, SIM_AP_COMBO\.tint\)/);
    expect(field).toMatch(/tintedImage\(sprites\.combo, SIM_AP_COMBO\.tint\)/);
  });

  it('命中后近 1.05s 叠光环（`apColorAt` 给色，窗口外不叠）', () => {
    expect(field).toMatch(/drawApComboGlow\(ctx, x, y, digitH, since\)/);
    expect(field).toMatch(/const color = apColorAt\(since\);/);
    expect(field).toMatch(/1 - clamp01\(since \/ SIM_AP_COMBO\.glow\)/);
  });

  it('染色不破坏透明底：`multiply` 上色 + `destination-in` 裁回字形 alpha', () => {
    expect(sprites).toMatch(/globalCompositeOperation = 'multiply'/);
    expect(sprites).toMatch(/globalCompositeOperation = 'destination-in'/);
    expect(sprites).toMatch(/tintedImageCache = new WeakMap/);
  });

  it('缺 Bestdori 精灵时纯字回落同样变色（不是白字一套、彩字另一套）', () => {
    expect(field).toMatch(/drawComboText\(ctx, m, combo, SIM_AP_COMBO\.tint, apColorAt\(since\), since\)/);
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
