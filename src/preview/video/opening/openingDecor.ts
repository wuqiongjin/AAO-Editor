// 开场的装饰（chart-preview 30）：**程序化路径自绘**，固定布点、不随机、**不读时间与窗口尺寸**
// ⇒ 导出物逐帧可复现。零素材改动（`assets-sync` 不动）。
//
// 三条实测口径（详见 issue 30 的第三~六轮）：
//   ① **★ 不是独立元素**：每枚 ♪ / ♫ 右侧紧跟一枚 ★，配对偏移**固定** ——
//      星左缘 = 音符右缘 + 0.0084W、星顶缘 = 音符顶缘 + 0.0377H（三对独立实例互相印证）。
//      所以本表**只列音符**，配对星在绘制时算出来 ⇒ 结构上不可能缺配对星 / 出孤儿星。
//   ② **坐标相对白条上缘**：本原型封面 0.48H（游戏 0.383H）⇒ 白条位置不同；按绝对值摆会整链飘走。
//   ③ **定位一律用旋转后的外接**：♫ 倾角 +26°，旋转后外接比未旋转宽 27%，用未旋转坐标定会偏十几像素。

export type DecorKind = 0 | 1 | 2 | 3; // 0 ♪ / 1 ♫ / 2 ★ 顶尖位 / 3 ★ 平顶位

/** 每类装饰的**固定**倾角（度，画布坐标：+ = 顺时针；第四轮 IoU 逐实例拟合） */
const DECOR_ROT_DEG: Record<DecorKind, number> = { 0: -9, 1: 26, 2: -7, 3: 29 };

/**
 * 字形在 size = 1 时、**旋转之后**的局部外接（y 向上为负）：把"左缘 / 顶缘"换算成绘制锚点。
 * 由原型自带的量测脚本逐类量出，别拿未旋转的路径坐标顶替。
 */
const GLYPH_EXTENT: Record<DecorKind, { l: number; r: number; t: number; b: number }> = {
  0: { l: -0.255, r: 0.477, t: -0.555, b: 0.468 },
  1: { l: -0.62, r: 0.705, t: -0.49, b: 0.555 },
  2: { l: -0.525, r: 0.487, t: -0.53, b: 0.472 },
  3: { l: -0.487, r: 0.525, t: -0.472, b: 0.53 },
};

/**
 * 每类的尺寸梯度直线系数：size（帧高比例）= c0 + c1·d，d = |x − 0.5|（越靠两侧越大）。
 *
 * **♫ 的系数看着比第五轮"×1.3"的目标小 ~30%，是对的**：♫ 倾角 +26°，旋转后外接比未旋转宽 27%，
 * 而第五轮那次是按**未旋转**宽度标定的 ⇒ 按"渲染宽度 = 官方 39 crop px"重标后就是这个数
 * （★ / ♪ 同法核对过，见票 30 第六轮）。
 */
const DECOR_SIZE_FIT: Record<DecorKind, { c0: number; c1: number }> = {
  0: { c0: 0.006, c1: 0.0963 }, // ♪
  1: { c0: 0.0072, c1: 0.0815 }, // ♫
  2: { c0: 0.027, c1: 0.03 }, // ★ 顶尖位
  3: { c0: 0.027, c1: 0.03 }, // ★ 平顶位
};
const DECOR_SIZE_MIN = 0.02;

/** 配对偏移（照官方截图实测的固定值） */
const PAIR_GAP_X = 0.0084; // 星左缘 − 音符右缘（帧宽）
const PAIR_DROP_Y = 0.0377; // 星顶缘 − 音符顶缘（帧高）

/**
 * 装饰链：一串**音符**（♫ / ♪ 交替），每枚自带它的配对星。
 * `x` = 音符左缘（帧宽比例）、`y` = 音符顶缘（帧高比例，**相对白条上缘**，负 = 在白条上方）。
 * 用缘而不是锚点，是为了能直接和官方截图的量测数字对照。
 * 两簇 + 中间两对整对沉在白条后面（照官方实测）。
 */
type DecorNote = {
  x: number;
  y: number;
  kind: 0 | 1;
  gray: number;
  starKind: 2 | 3;
  starGray: number;
};

const DECOR_PAIRS: readonly DecorNote[] = [
  { x: 0.0093, y: -0.056, kind: 1, gray: 184, starKind: 2, starGray: 175 },
  { x: 0.1083, y: -0.0428, kind: 0, gray: 157, starKind: 2, starGray: 140 },
  { x: 0.1852, y: -0.0296, kind: 1, gray: 128, starKind: 3, starGray: 110 },
  { x: 0.2806, y: -0.0066, kind: 0, gray: 108, starKind: 2, starGray: 99 },
  { x: 0.4, y: 0.0233, kind: 1, gray: 102, starKind: 3, starGray: 102 },
  { x: 0.5, y: 0.0436, kind: 0, gray: 110, starKind: 2, starGray: 131 },
  { x: 0.714, y: 0.0858, kind: 1, gray: 155, starKind: 3, starGray: 157 },
  { x: 0.8, y: 0.102, kind: 0, gray: 153, starKind: 2, starGray: 182 },
  { x: 0.857, y: 0.1102, kind: 1, gray: 128, starKind: 3, starGray: 183 },
  { x: 0.934, y: 0.12, kind: 0, gray: 183, starKind: 2, starGray: 198 },
];

/** 音符头：接近圆的饱满椭圆（长轴 ≈ 1.37 × 短轴）。`r` = 该字形自己的头径倍率 */
function drawNoteHead(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, r = 1): void {
  ctx.beginPath();
  ctx.ellipse(cx * size, cy * size, 0.185 * r * size, 0.135 * r * size, -0.38, 0, Math.PI * 2);
  ctx.fill();
}

function drawDecorShape(ctx: CanvasRenderingContext2D, kind: DecorKind, size: number): void {
  if (kind === 2 || kind === 3) {
    // 五角星（游戏里只有这一种星；两种朝向由 DECOR_ROT_DEG 区分，不是两种字形）
    const R = size * 0.5;
    const r = R * 0.55; // 官方星很胖（内径比 ≈0.5）
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? R : r;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const x = Math.cos(a) * rad;
      const y = Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    // 官方星的尖端是**圆角**的：同色描边 + round join 把角磨圆
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(0.8, size * 0.07);
    ctx.strokeStyle = ctx.fillStyle;
    ctx.stroke();
    ctx.fill();
    return;
  }
  if (kind === 0) {
    drawNoteHead(ctx, -0.13, 0.3, size);
    ctx.beginPath(); // 茎
    ctx.rect(-0.005 * size, -0.5 * size, 0.08 * size, 0.84 * size);
    ctx.fill();
    ctx.beginPath(); // 旗：一整块厚叶形（官方不是细月牙）
    ctx.moveTo(0.06 * size, -0.5 * size);
    ctx.bezierCurveTo(0.44 * size, -0.6 * size, 0.6 * size, -0.34 * size, 0.48 * size, -0.08 * size);
    ctx.bezierCurveTo(0.4 * size, -0.26 * size, 0.26 * size, -0.3 * size, 0.06 * size, -0.22 * size);
    ctx.closePath();
    ctx.fill();
    return;
  }
  // ♫：横梁**厚**（0.27 size）且只轻微上斜（0.09 size），右端基本齐平右茎
  drawNoteHead(ctx, -0.26, 0.36, size, 1.25);
  drawNoteHead(ctx, 0.26, 0.3, size, 1.25);
  ctx.beginPath(); // 左茎
  ctx.rect(-0.1 * size, -0.23 * size, 0.09 * size, 0.59 * size);
  ctx.fill();
  ctx.beginPath(); // 右茎
  ctx.rect(0.4 * size, -0.32 * size, 0.09 * size, 0.62 * size);
  ctx.fill();
  ctx.beginPath(); // 横梁
  ctx.moveTo(-0.1 * size, -0.5 * size);
  ctx.lineTo(0.5 * size, -0.59 * size);
  ctx.lineTo(0.5 * size, -0.32 * size);
  ctx.lineTo(-0.1 * size, -0.23 * size);
  ctx.closePath();
  ctx.fill();
}

function decorSize(kind: DecorKind, x: number, h: number): number {
  const fit = DECOR_SIZE_FIT[kind];
  return Math.max(DECOR_SIZE_MIN, fit.c0 + fit.c1 * Math.abs(x - 0.5)) * h;
}

function grayOf(v: number): string {
  const c = Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${c},${c},${c})`;
}

/**
 * 画整条装饰链：每条记录画**一枚音符 + 它的配对星**。
 *
 * `bandY` = 白条上缘（帧 px）：装饰 y 是相对它的比例 ⇒ 改版式时整链跟着白条走。
 *
 * **不碰 `globalAlpha`**：整屏那个 alpha 由 `drawOpeningFrameAt` 唯一设一次（第七轮教训 ——
 * 子层在函数级改了不还，会把后面封面 / 白条 / 文字的淡入淡出吃掉，表现为"只有装饰在淡"）。
 */
export function drawOpeningDecor(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  bandY: number,
  avoid: { x: number; y: number; w: number; h: number },
): void {
  for (const p of DECOR_PAIRS) {
    const sN = decorSize(p.kind, p.x, h);
    const e = GLYPH_EXTENT[p.kind];
    const noteLeft = p.x * w;
    const noteTop = bandY + p.y * h;
    const noteRight = noteLeft + (e.r - e.l) * sN;
    const starLeft = noteRight + PAIR_GAP_X * w;
    const starTop = noteTop + PAIR_DROP_Y * h;
    const sS = decorSize(p.starKind, starLeft / w, h);
    const eS = GLYPH_EXTENT[p.starKind];
    const items: { kind: DecorKind; size: number; ax: number; ay: number; gray: number }[] = [
      { kind: p.kind, size: sN, ax: noteLeft - e.l * sN, ay: noteTop - e.t * sN, gray: p.gray },
      {
        kind: p.starKind,
        size: sS,
        ax: starLeft - eS.l * sS,
        ay: starTop - eS.t * sS,
        gray: p.starGray,
      },
    ];
    for (const it of items) {
      if (it.ax > avoid.x && it.ax < avoid.x + avoid.w && it.ay > avoid.y && it.ay < avoid.y + avoid.h) {
        continue;
      }
      ctx.save();
      ctx.translate(it.ax, it.ay);
      ctx.rotate((DECOR_ROT_DEG[it.kind] * Math.PI) / 180);
      ctx.fillStyle = grayOf(it.gray);
      drawDecorShape(ctx, it.kind, it.size);
      ctx.restore();
    }
  }
}
