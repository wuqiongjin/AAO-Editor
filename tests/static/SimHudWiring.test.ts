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
const panel = readStripped('src/pages/preview/PreviewDisplayPanel.tsx');
const zh = readStripped('src/i18n/messages/zh-CN.json');
const en = readStripped('src/i18n/messages/en.json');

describe('51 · 判定字画在仿真场帧里（预览 / 导出同一份）', () => {
  it('出帧入口里顶栏 → 判定字 → combo（HUD 三件都在 `drawSimFrameAt` 这一条路上）', () => {
    expect(field).toMatch(/if \(layers\?\.hud !== false && showGameUi\) \{/);
    // 票 76：顶栏多一个整层 alpha 倍率（缺省 1，实时回放不走淡入淡出）
    expect(field).toMatch(
      /drawTopBar\(ctx, metrics, chart, seconds, input\.assets\.hud, autoMode,\s*clamp01\(layers\?\.hudAlpha \?\? 1\), seconds, layers\?\.lifeGauge\)/,
    );
    expect(field).toMatch(/hudAlpha\?: number/);
    expect(field).toMatch(/export function drawSimHudLayer\(/);
    expect(field).toMatch(
      /drawJudgement\(ctx, metrics, chart, seconds, input\.assets\.judge, autoMode, layers\?\.judge\)/,
    );
    // AP 态由场景带入（`settings.preview.apCombo`），与 AUTO 无关
    expect(field).toMatch(
      /drawCombo\(ctx, metrics, chart, seconds, input\.assets\.sprites, layers\?\.comboAlpha \?\? 1, \{\s*ap: comboApActive\(input\.scene\.apCombo \?\? true\),/,
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
    expect(field).toMatch(/const autoMode = input\.scene\.autoMode \?\? false;/);
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

  it('2026-11-08 验收：combo 的 AP 态**只**由 `apCombo` 决定，AUTO 不参与', () => {
    expect(field).toMatch(/ap: comboApActive\(input\.scene\.apCombo \?\? true\),/);
    expect(field).toMatch(/apCombo\?: boolean;/);
    expect(hud).toMatch(/return apCombo;/);
    expect(hud).not.toMatch(/apCombo && !autoMode/);
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

describe('72 · 官方 HUD 顶栏（原型定稿参数 / 官方切图 / 归一分）', () => {
  it('取景坐标：派生件取整图（从 0 起），用户自备件仍是切片', () => {
    // 票 83：三格已裁成独立小图 ⇒ 源矩形从 (0,0) 起，尺寸 = 派生件尺寸
    expect(hud).toMatch(/barA: \[0, 0, 661, 22\]/);
    expect(hud).toMatch(/pause: \[0, 0, 64, 64\]/);
    expect(hud).toMatch(/star: \[0, 0, 110, 100\]/);
    expect(hud).toMatch(/scoreBand: \{ x: 64, y: 10, w: 521, h: 41 \}/);
    expect(hud).toMatch(/lifeBand: \{ x: 78, y: 9, w: 451, h: 50 \}/);
    expect(field).toMatch(/HUD_SPRITES\.barA/);
    expect(field).toMatch(/HUD_SPRITES\.star/);
    // 图集不再被读取（票 83：MenuAtlas / RhythmGameUI / tex_parSet_fever 不进包体）
    expect(hud).not.toMatch(/MenuAtlas|rankDisc|rankLetter|ribbon|medal/);
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

  it('验收修正 · 两条竖线：切点对齐**物理像素列** + 相邻切片同源重叠（不只按 CSS 取整）', () => {
    expect(field).toMatch(/ctx\.getTransform\(\)/);
    expect(field).toMatch(/Math\.round\(v \* a \+ e\)/);
    expect(field).toMatch(/snap\(acc\)/);
    expect(field).toMatch(/w0 \+ left \+ right, dh/);
  });

  it('2026-11-22 · 半透明整层走离屏合成（接缝重叠只合成一次，成片淡入段不再有白线）', () => {
    const bar = field.slice(field.indexOf('function drawTopBar('), field.indexOf('function drawTopBarParts('));
    // alpha = 1（实时回放常态 / 导出常驻段）仍是直画：不多开画布、不多一次合成
    expect(bar).toMatch(/if \(layerAlpha >= 0\.999\) \{\s*drawTopBarParts\(ctx,/);
    // 半透明才开层：层内 alpha 恒 1，整层倍率只在贴回时用一次
    expect(bar).toMatch(/drawTopBarParts\(g, m, hud, s, flowSeconds, score, inc, ages, 1,/);
    expect(bar).toMatch(/ctx\.globalAlpha = layerAlpha;\s*ctx\.drawImage\(layer\.canvas, layer\.ox, layer\.oy\)/);
    // 层与目标对齐到设备像素栅格（含 dpr / 场地原点）
    expect(field).toMatch(/g\.setTransform\(layer\.sx, 0, 0, layer\.sy, -layer\.ox, -layer\.oy\)/);
    // 兜底：没有离屏画布（Node）仍按旧法画，不抛错
    expect(bar).toMatch(/if \(!layer\) \{/);
  });

  it('验收修正 · 0 分时分数条必须是空槽（不留左端底珠、不叠星点）', () => {
    expect(field).toMatch(/const fillW = frac <= 0 \? 0 : Math\.max\(band\.h \* 1\.7, band\.w \* frac\)/);
    expect(field).toMatch(/if \(hud\.scoreFill && fillW > 0\)/);
  });

  it('验收修正 · 生命 gauge 按实机截图走亮绿 / 深绿两段渐变，不用洋红色块', () => {
    expect(hud).toMatch(/lifeGaugeTop: '#6eff69'/);
    expect(hud).toMatch(/lifeGaugeBottom: '#47aa43'/);
    expect(field).toMatch(/SIM_HUD\.lifeGaugeTop/);
    expect(field).toMatch(/SIM_HUD\.lifeGaugeBottom/);
    expect(field).not.toMatch(/lifeGaugePink|lifeGaugeGreen|lifeGaugePinkFrac/);
  });

  it('2026-11-14 · 生命填充内缩露出素材暗框，不再铺满 bbox', () => {
    // life-bar.png 的空槽自带 4~5 素材 px 深色框；填充必须内缩才看得见
    expect(hud).toMatch(/lifeGaugeInset: 4/);
    expect(field).toMatch(/SIM_HUD\.lifeGaugeInset/);
    // 填充已收进 paintLifeGauge（rect 由 lifeGaugeRect 内缩），不再铺满 bbox
    expect(field).toMatch(/const \{ x, y, w, h, radius \} = rect;/);
    expect(field).toMatch(/ctx\.fillRect\(x, y, w, h\)/);
    expect(field).not.toMatch(/ctx\.fillRect\(gx, gy, gw, gh\)/);
  });

  it('验收修正 · 顶栏只留一枚总开关，「分数条与生命条显示」自解释、不挂 ? 提示', () => {
    expect(field).toMatch(/const showGameUi = input\.scene\.showGameUi \?\? true/);
    expect(field).toMatch(/if \(layers\?\.hud !== false && showGameUi\)/);
    expect(field).not.toMatch(/SimHudRegions|hudScore|hudLife|hudPause|hudAutoLive/);
    expect(panel).toMatch(/preview\.display\.showGameUi/);
    expect(panel).not.toMatch(/preview\.display\.showGameUi\.hint|HelpHint|pdp__row-label--with-hint/);
    expect(panel).not.toMatch(/preview\.display\.group\.hud|HUD 组件/);
    expect(zh).toMatch(/"preview\.display\.showGameUi": "分数条与生命条显示"/);
    expect(en).toMatch(/"preview\.display\.showGameUi": "Score & life bars display"/);
    expect(zh).not.toMatch(/preview\.display\.showGameUi\.hint/);
    expect(en).not.toMatch(/preview\.display\.showGameUi\.hint/);
  });

  it('验收修正 · `+增量` 回退合并、恢复逐命中；两段运动走同一条曲线', () => {
    expect(hud).toMatch(/export function plusAgesAt\(chart: SimChart, seconds: number, duration: number\)/);
    expect(hud).toMatch(/export function plusMotionAt\(age: number, params: PlusMotionParams\): PlusMotion/);
    expect(hud).not.toMatch(/plusBurstsAt|SimPlusBurst|plusMaxCount|PLUS_EPS|plusFadeOutFrac/);
    expect(field).toMatch(/const text = `\+\$\{inc\}`;/);
    expect(field).not.toMatch(/b\.hits \* inc/);
    // 用户明确要保留的观感旋钮：底亮度 / 位移 / 逐条错开 / 密集演示；
    // 2026-11-14 定案：冲刺占比 + 淡出位移（右边的缓移过程即淡出）；
    // 同日第三版快照把 dur .4→.5 / dash .18→.2 / DX .34→.37 定为新缺省；
    // 2026-11-22 用户把 Y 119→111（与整组顶栏一起上移 8）。
    for (const re of [
      /plusBaseAlpha: 0\.85/,
      /plusDashFrac: 0\.2/,
      /plusDriftDX: 0\.02/,
      /plusDur: 0\.5/,
      /plusX: 0\.45/,
      /plusDX: 0\.37/,
      /plusY: 111/,
      /plusFont: 36/,
      /plusRise: 0/,
      /plusSpreadX: 0/,
      /plusSpreadY: 0/,
      /plusMotionAt\(/,
    ]) expect(hud).toMatch(re);
    expect(field).toMatch(/i \* SIM_HUD\.plusSpreadX/);
    expect(field).toMatch(/dashFrac: SIM_HUD\.plusDashFrac/);
    expect(field).toMatch(/driftDX: SIM_HUD\.plusDriftDX/);
  });

  it('2026-11-22 · 顶栏五项 Y 整组上移 8', () => {
    for (const re of [/boxY: 30/, /lifeY: 30/, /pauseY: 30/, /autoY: 142/, /plusY: 111/]) {
      expect(hud).toMatch(re);
    }
  });

  it('验收修正 · ▽ 刻度图标大小可调', () => {
    expect(hud).toMatch(/tickH: 4\.24/);
    expect(field).toMatch(/SIM_HUD\.tickH \* s/);
    expect(field).not.toMatch(/Math\.max\(2\.5 \* s, band\.h \* 0\.13\)/);
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
