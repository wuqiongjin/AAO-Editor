// 谱面结束后的**结尾段**（chart-preview 52）：中央章 → 黑幕转场 → 结算。
//
// 版式已定稿（票 52「最终版式 · 原型 v9」，2026-10-26 用户：「最终定稿」）——
// `ENDING_SPEC` 就是用户交回的那份参数 JSON，**键名照抄**；运行时没有参数面板，
// 只有 `settings.export.ending.{enabled, stamp}` 两个开关。
//
// 两条硬口径：
//   - **几何按帧的百分比定义**：`%H` = 帧高、`%W` = 帧宽（1920×1080 下 1%H = 10.8px）。
//   - **三段时长钉死**（首期不可调）：章 3.0 + 黑幕转场 1.55 + 结算停留 2.95 = 7.5s。

/** 中央章形态：AP 彩虹字样 / FC / 普通 Clear（无章） */
export type EndingStamp = 'ap' | 'fc' | 'clear';

/** 中央章候选（导出弹窗「结算形态」三档；顺序即 UI 顺序） */
export const ENDING_STAMPS: readonly EndingStamp[] = ['ap', 'fc', 'clear'];

/** 爆炸配色（`cycle` = 用 5 个 `burstC*` 自定义色；其余 = 内置 5 色预设） */
export type EndingPalette = 'cycle' | 'warm' | 'cool' | 'pink' | 'mix';

/**
 * 定稿参数表（票 52 · 最终版式 · 原型 v9 的整份 JSON）。
 *
 * 改版式时对着票面改这里，别在绘制里散落魔数：`endingUnits()` 负责 % → px 的换算，
 * 其余（计数 / 字重 / 配色）直接读本表。
 */
export const ENDING_SPEC = {
  // 时序（三段总长 = ENDING_SECONDS）
  stampDur: 3,
  transDur: 1.55,
  resultDur: 2.95,
  // 顶栏（票 64：收窄给右上 SCORE RANK 徽章让位）
  barX: 8.25,
  barY: 12.9,
  barW: 74,
  barH: 5.2,
  barR: 0.8,
  starSize: 4,
  starDX: 3.3,
  diffX: 6.5,
  diffH: 3.2,
  diffFont: 2.08,
  diffPadX: 1.45,
  titleX: 18.85,
  titleFont: 3.1,
  titleWeight: 400,
  lvRight: 2.35,
  lvNumFont: 2.35,
  lvLabelFont: 2.35,
  // 白卡（票 64：首行让给 Score 行，五行判定整体下移）
  cardRight: 12,
  cardW: 66.7,
  cardTop: 32,
  cardR: 1,
  rowFirst: 12,
  rowPitch: 5.9,
  labelH: 4.6,
  labelX: 2.5,
  countRight: 33,
  countFont: 3.6,
  countWeight: 400,
  countDY: 0.7,
  lineInset: 2.25,
  lineLen: 20,
  lineOffset: 2.1,
  padBottom: 3.5,
  comboX: 40,
  /** 随 `rowFirst` 同差值下移（5 → 11.4），否则 MAX COMBO 压住 Score 行 */
  comboY: 11.4,
  comboW: 20,
  comboH: 18.2,
  comboDark: 0.575,
  comboFont: 3,
  comboValueFont: 3.6,
  apH: 5,
  apGap: 4.05,
  apDX: 0.1,
  /** 结算角标 AP / FC 各自倍率（2026-11-07 票 55：原本共用 `apH` 高度，AP 看着偏大） */
  markApScale: 0.88,
  markFcScale: 1,
  // 封面
  coverSize: 45,
  coverX: 21.2,
  coverY: 50,
  coverFrame: 0.3,
  coverShadow: 0.45,
  bgBlur: 6,
  bgBright: 65,
  bgScrim: 42,
  bgFadeFrom: 30,
  bgFadeTo: 56,
  // 中央章
  stampW: 62.2,
  stampY: 50.5,
  /** 入场总时长（秒）：逐字母落位 + 星标飞行的整条时间轴都按它缩放 */
  stampIn: 1.3,
  stampOut: 0.25,
  partCount: 65,
  partSize: 3.5,
  partSpeed: 1,
  /** `cycle` = 用下面 5 个 `burstC*` 自定义色；其余 = 内置 5 色池 */
  palette: 'cycle' as EndingPalette,
  burst2At: 26,
  burst2X: 34,
  burst2Y: 62,
  burst3At: 32,
  burst3X: 66,
  burst3Y: 36,
  burst4At: 52,
  burst4Points: 4,
  burst5At: 66,
  burst5Points: 5,
  wordGlow: 0,
  // 2026-11-07（票 55）· 普通烟花（一爆点一色）
  burstC1: '#ffe27a' as string,
  burstC2: '#8fe9ff' as string,
  burstC3: '#ff9fd2' as string,
  burstC4: '#9dffc4' as string,
  burstC5: '#ffffff' as string,
  /** 波数（最多 6 波） */
  burstWaveCount: 6,
  /** 同一波内相邻爆点的起爆间隔（秒）—— 0 = 一口气齐爆 */
  burstStagger: 0.075,
  /** 每爆点星数的总倍率 */
  burstDensity: 1,
  /** 单颗粒子寿命基数（秒）—— 拉长才看得出波与波的重叠 */
  partLife: 1.05,
  /** 粒子淡出曲线指数（越小，尾段越亮、重叠越明显） */
  partFadePow: 0.85,
  /** 散点椭圆横 / 纵半径（%W / %H） */
  burstScatterX: 33.5,
  burstScatterY: 30,
  /** 散点角度抖动（弧度） */
  burstJitter: 0.28,
  burst6At: 78,
  burst6Points: 2,
  /** CLEAR 形态也放普通烟花（沿用同一套波表 / 配色） */
  clearBurst: 1,
  // 中央章入场（2026-10-28）：字母像排队一样阶梯落下 + `!` 下的星标从正中飞出。
  // 时间类凡是 `%stampIn` 的，都随「入场总时长」等比缩放，改一个数不用逐个调。
  /** 字母依次落位的跨度（%stampIn；首字起点 → 末字落定） */
  letterSpan: 50,
  /** 单字的落位用时（秒）—— `letterDur / 相邻间隔` ≈ 同时在空中的字块数（3~6） */
  letterDur: 0.2,
  /** 每字从上方落下的距离（% 字块高） */
  letterDrop: 32,
  /** 落位回弹（0 = 直接停住，1 = 回弹约落距 25%） */
  letterBounce: 0,
  /** 刚入队时的透明度（0 = 从无到有，0.5 = 半透明排在队尾，落位时补齐到 1） */
  letterInAlpha: 0.5,
  /** 星标在字块正中出现的时刻（%stampIn） */
  starAt: 7,
  /** 星标变大 + 旋转的用时（%stampIn） */
  starGrow: 35,
  /** 变大结束 → 起飞之间的停顿（%stampIn；0 = 立刻起飞） */
  starHold: 0,
  /** 星标飞到 `!` 下方的用时（%stampIn） */
  starFly: 40,
  /** 变大到终态尺寸的几倍（字块高 ≈ 字母高，1.38× ≈ 字母的 2/3） */
  starBig: 3,
  /** 变大期间转过的角度（度，落地前会转正） */
  starSpin: 90,
  /** 飞行时留在正中的影子：不透明度（影子是纯色圆角五角星，不是原图贴图） */
  ghostAlpha: 0.7,
  /** 影子的终点尺寸（× 终态；不会小于 `starBig`） */
  ghostGrow: 10,
  /** 影子继续转过的角度（度） */
  ghostSpin: 50,
  /** 飞行影子的颜色（`auto` = 按星贴图的代表色自动取；也可以写 `#rrggbb`） */
  ghostTint: 'auto' as string,
  /** 影子淡出用时（秒） */
  ghostDur: 0.55,
  /** 落位后外围影子的放大倍数（× 终态；这枚影子仍用原图贴图） */
  landGrow: 2.3,
  /** 落位后影子的不透明度 */
  landAlpha: 0.55,
  /** 落位后单次影子的用时（秒） */
  landDur: 0.4,
  /** 落位后影子连续出现的次数 */
  landPulses: 1,
  // 2026-11-07（票 55）· `!` 飞镖式入场
  /** 起场时刻相对星标落定的偏移（秒；负值 = 星还没落定就开始） */
  bangAt: -0.2,
  /** 从右上滑到过冲点的用时（秒） */
  bangWipe: 0.22,
  /** 摇摆 + 退回终位的用时（秒） */
  bangSettle: 0.46,
  /** 起点相对终位偏右 / 偏上（%H） */
  bangFromX: 6,
  bangFromY: 5,
  /** 过冲点相对终位偏左 / 偏下（%H） */
  bangOverX: 1.6,
  bangOverY: 1,
  /** 摇摆幅度（度） */
  bangWobble: 9,
  /** 摇摆来回次数 */
  bangWobbles: 2,
  /** 摇摆阻尼指数（越大衰减越快） */
  bangDamp: 2.2,
  /**
   * 星标尺寸归一化基准（× 字块高，2026-11-07 修 FC BUG）。
   * `stamp-ap` / `stamp-fc` 里那颗小星原图就不等大（彩色字芯 69px vs 62px），
   * 按各自 `inkW` 取尺寸会让 FC 的落位星、纯色影子星、外环、菱形整圈都比 AP 小一圈。
   * 统一按字块高定基准，再按各图的 `inkW` 反算缩放，AP ≈ 1×、FC ≈ 1.11×。
   */
  starSizeRef: 0.37,
  // 2026-11-07（票 55 第三轮）· 中心两层烟花
  haloOn: 1,
  haloAlpha: 1,
  /** 外围层比影子星多存活的时长（秒） */
  haloSurvive: 0.3,
  /** 外围层跟随影子星长到的倍数（× 星标基准）；不直接取 `ghostGrow` —— 10× 时早已淡出画外 */
  haloGrow: 9,
  /** 烟花色彩 = 影子星颜色 × 此系数（比影子星深一点）；另一种是纯白 */
  haloDarken: 0.9,
  /** 外围大圆环半径（× 影子星外接半径） */
  haloRingRadius: 1.65,
  /** 圆环线宽（%H，有实体宽度，不是细线） */
  haloRingWidth: 0.9,
  haloRingAlpha: 0.85,
  /** 环外缘的星点数 */
  haloRingStars: 32,
  /** 环外缘星点的大小（%H）—— 与普通爆炸烟花同形状，只是尺寸独立可调 */
  haloRingStarSize: 6.8,
  /** 星点离环外缘的距离（× 环半径，不贴合） */
  haloRingOffset: 0.07,
  /** 菱形层的菱形个数 */
  haloDiaCount: 24,
  /** 菱形高度（%H） */
  haloDiaSize: 3,
  /** 起爆时刻（秒，相对影子星起飞 `flyStart`） */
  haloDiaAt: 0.2,
  /** 由中心向外扩散的用时（秒）—— 短 = 快 */
  haloDiaDur: 0.3,
  /** 淡出起点（占扩散用时的比例）：0 = 一起飞就淡、1 = 到最外侧才淡（票 55 第四轮定案） */
  haloDiaFadeAt: 0,
  /** 淡出用时（秒，从 `haloDiaFadeAt` 那个时刻起算） */
  haloDiaFade: 0.5,
  /** 起始 / 终点半径（× 星标基准尺寸） */
  haloDiaFrom: 0.35,
  haloDiaTo: 8.5,
  /** 排布规则：`ring` 均匀环 / `spokes` 放射条带 / `scatter` 环带内全随机 */
  haloDiaLayout: 'ring' as string,
  /** 排布随机种子（拖到看着顺眼的那组；同种子导出可复现） */
  haloDiaSeed: 135,
  /** 随机强度 0..1（角度 + 半径 + 尺寸） */
  haloDiaJitter: 0.18,
  // 舞台两层在结尾段里的收场（秒，相对结尾段起点）：
  //   - combo `dur = 0` ⇒ **瞬时消失**（结尾段第一帧就不画），游戏里也是打完就收；
  //   - 轨道 1.0s 慢慢退，结算只剩背景（2026-10-27 原型回填）。
  comboFadeAt: 0,
  comboFadeDur: 0,
  trackFadeAt: 0,
  trackFadeDur: 1,
  // 票 64 · 结算 Score 行（原型定稿 2026-11-08；几何按 %H，时间键是 %入场轴 q）
  /** 「Score」标签字号（%H；原型 34px @1080p） */
  resultFont: 3.15,
  /** 分数字号（%H；原型 40px @1080p） */
  resultScoreFont: 3.7,
  /** 卡内左右内距（%H；原型 16 × 卡宽/720） */
  resultPadX: 1.48,
  /** Score 行高（%H；原型 96 × 卡宽/720） */
  resultRowH: 8.89,
  /** 整行上下微调（%H；原型 −12 × 卡宽/720，负数 = 更贴卡片上沿） */
  resultRowDY: -1.11,
  /** 行出现的时刻 / 淡入跨度（%入场轴 q，与 `drawSettlement` 的 `at()` 同一把尺） */
  resultInAt: 24,
  resultInDur: 24,
  // 票 64 · 右上 SCORE RANK 徽章（原型按帧宽缩 ⇒ 一律 %W）
  /** 太阳纹圆盘宽（%W；原型 156px @1920） */
  rankSize: 8.125,
  /** 距右缘（%W；原型 150px） */
  rankRight: 7.8125,
  /** 距上缘（%W；原型 126px） */
  rankTop: 6.5625,
  /** 字母层相对圆盘的倍率 */
  rankLetterScale: 0.6,
  /** 缎带宽（%W；原型 200px） */
  ribbonW: 10.4167,
  /** 缎带离圆盘下沿（%W；原型 4px） */
  ribbonBelow: 0.2083,
  /** 徽章单独的出现时刻 / 淡入跨度（%入场轴 q） */
  rankInAt: 20,
  rankInDur: 20,
} as const;

/**
 * 参数表的**可写宽化版**：`ENDING_SPEC` 是 `as const`（键名照抄票面、首期不可变），
 * 调参 / 原型要按同一套键覆盖，故派生一份可变形状。绘制一律收这个类型，
 * 缺省 = `ENDING_SPEC`，行为与以前逐像素一致。
 */
export type EndingSpec = {
  // `as const` 会把数值收成字面量（`stampIn: 1`），覆盖参数就写不进 1.2 这种值 ——
  // 数值一律宽化成 `number`，字符串键（`palette`）保留字面量联合。
  -readonly [K in keyof typeof ENDING_SPEC]: (typeof ENDING_SPEC)[K] extends number
    ? number
    : (typeof ENDING_SPEC)[K];
};

/** 参数表里出现的键 */
export type EndingSpecKey = keyof typeof ENDING_SPEC;
/** **数值**参数的键（`palette` 是字符串，不参与 % → px 换算） */
export type EndingUnitKey = {
  [K in EndingSpecKey]: (typeof ENDING_SPEC)[K] extends number ? K : never;
}[EndingSpecKey];

/** ① 中央章（含多波粒子，波数由 `burstWaveCount` 定） */
export const ENDING_STAMP_SECONDS = ENDING_SPEC.stampDur;
/** ② 黑幕转场（盖黑 → 停一拍 → 抬幕，组件逐个入场藏在幕布后） */
export const ENDING_TRANS_SECONDS = ENDING_SPEC.transDur;
/** ③ 结算停留 */
export const ENDING_RESULT_SECONDS = ENDING_SPEC.resultDur;
/** 结尾段总长；导出总长 =（开场 6.75，若开）+ 谱面 + 它 */
export const ENDING_SECONDS = ENDING_SPEC.stampDur + ENDING_SPEC.transDur + ENDING_SPEC.resultDur;

/**
 * 一帧的单位换算：`hp` = %H → px、`wp` = %W → px。
 *
 * 强调「按**帧**高缩放」而不是按场地：导出画布 1920×1080，场地是 1920×1078（上下各 1px 边），
 * 结尾 UI 画在整帧上，嵌进场地矩形会整体缩 0.2%（票 52 定案）。
 */
export interface EndingUnits {
  /** 画布宽（帧 px） */
  readonly w: number;
  /** 画布高（帧 px） */
  readonly h: number;
  /** %H → px */
  hp(key: EndingUnitKey): number;
  /** %W → px */
  wp(key: EndingUnitKey): number;
  /** 这一帧用的参数表（缺省 = `ENDING_SPEC`；原型 / 调参按同一套键覆盖） */
  readonly spec: EndingSpec;
}

export function endingUnits(w: number, h: number, spec: EndingSpec = ENDING_SPEC): EndingUnits {
  return {
    w,
    h,
    spec,
    hp: (key) => (spec[key] / 100) * h,
    wp: (key) => (spec[key] / 100) * w,
  };
}
