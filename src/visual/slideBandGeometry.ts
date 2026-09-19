/**
 * 滑条连接带的**横截面口径 = 唯一定义处**（issue 09 验收反馈六轮）。
 *
 * 口径：**车道横向** —— 中心线各点整体横移 ±half（half = `LANE_WIDTH × viewport.scale × noteSize / 2`），
 * 首尾用**过结点中心的水平线段**封口。带子因此是"沿拍位扫过的一格车道"，与 Bestdori / Sonolus 的
 * 连接带画法同构。
 *
 * 为什么必须集中一处：本模块的三个消费者——
 *   1. 带体实绘（`render.ts` 的 `drawBandQuad` / `renderSpBandStrip`，含幽灵与 live 预览），
 *   2. 选中 / hover 描边（`render.ts` 的 `collectSelectionOutlines` 的 `quad`），
 *   3. 命中判定（`hitTest.ts` 的 `slideRegion` 平行四边形），
 * —— 只要口径不同就会分别漂移：四轮/五轮把 ① 改成**垂直法线**（保持法向等宽），② ③ 仍是横向，
 * 于是"点得中、亮对圈，但带子本身错位"；更直接的是端点衔接——斜封口纵向伸出 `half·cosθ`，
 * 平缓带超过端点图标墨迹半高（10.8·s）→ 绿色一头戳出图标、另一头留楔形背景缺口（用户图1）。
 * 与 `noteMetrics.ts` 同一教训：**渲染与命中/描边共用的尺寸口径必须下沉到叶子模块**。
 *
 * 不变量（`tests/unit/visual/render/SlideBandGeometry.test.ts` 锁测）：
 * - 封口过结点中心且水平，宽 = 2·half < 端点图标墨迹宽（`SLIDE_ICON_SIZE`）→ 封口被图标盖住；
 * - 相邻逻辑段在共享结点上产生**同一条**封口线段 → 跨段天然连续，无需角平分线法线；
 * - 纯横向段（同拍，Δy = 0）面积退化为 0 → 实绘不画、命中不中（所见 = 所点）；
 * - 带体形状 = 采样折线**原样**（实绘不做渲染期平滑 → 与 ② ③ 逐顶点重合，验收反馈 #2）。
 *
 * 另有 `splitBandAtFolds`：中心线**拍位回折**（画笔中途折返 / 导入谱合法点序）时把折线切成
 * dy 单调的 run，供条带逐 run 填充——单条自叠路径在"外环+反向内孔"下环绕数相消会出黑线洞
 * （验收反馈 #1）。
 */

/** 画布坐标点（px） */
export interface BandPoint {
  x: number;
  y: number;
}

/**
 * 中心线两侧的轨道（左轨 = x − half，右轨 = x + half，逐点同 y）。
 * 入参是段的中心线采样点（**含两端可见结点**，段内为 hidden 采样点或其渲染期细分点）。
 */
export function bandRails(pts: readonly BandPoint[], half: number): { left: BandPoint[]; right: BandPoint[] } {
  return {
    left: pts.map((p) => ({ x: p.x - half, y: p.y })),
    right: pts.map((p) => ({ x: p.x + half, y: p.y })),
  };
}

/** 闭合多边形（左轨正序 → 右轨逆序）。带体填充、描边、命中都从它派生，顶点序由各侧自行决定。 */
export function bandPolygon(pts: readonly BandPoint[], half: number): BandPoint[] {
  const { left, right } = bandRails(pts, half);
  return [...left, ...right.reverse()];
}

/**
 * 描边 / 命中用的**顶点序**：`[左₀, 右₀, 右₁, 左₁, …]`——两端封口边各由 0/1 与末两点相邻给出，
 * 保持 issue 56/77 定案以来的顶点顺序（既有锁测按"上下边水平"断言，勿随意轮换）。
 */
export function bandPolygonAt(pts: readonly BandPoint[], half: number): [number, number][] {
  if (pts.length === 2) {
    const { left, right } = bandRails(pts, half);
    return [[left[0]!.x, left[0]!.y], [right[0]!.x, right[0]!.y], [right[1]!.x, right[1]!.y], [left[1]!.x, left[1]!.y]];
  }
  return bandPolygon(pts, half).map((p) => [p.x, p.y]);
}

/**
 * 回折切分（issue 09 验收反馈七轮-#1）：导入谱的连接点拍位可**倒退**（bestdori 合法），带体在回折处
 * **自叠**。分层环带（外环实心 + 内环反向挖孔）在自叠区会让一臂的外环与另一臂的内孔环绕数相消
 * → 非零填充判定成洞 → 一条黑线穿过带身。修法 = 按"行进方向反转点"（dy 变号）把中心线切成若干
 * **单调折线段**，每段各自跑环带（段内不自叠，抵消不可能发生）；相邻段共享反转点 → 无缝；
 * 两臂真正重叠处改由**跨段 source-over 合成** = 重叠更亮（与 bestori/物理叠加一致，用户已接受"叠亮"）。
 * 无回折（正常笔画/烘焙段）→ 原样一段返回，渲染路径与改动前逐像素一致。
 */
export function splitBandAtFolds(pts: readonly BandPoint[]): BandPoint[][] {
  const n = pts.length;
  if (n < 3) return [pts.slice()];
  const sign = (v: number) => (v > 1e-9 ? 1 : v < -1e-9 ? -1 : 0);
  const runs: BandPoint[][] = [];
  let start = 0;
  // 当前 run 的行进方向：**只记非零 dy 的符号**。横跳段（Δy = 0，如倒流区同拍换轨）对方向透明——
  // 否则"横跳之后再反向"会被判成没变方向，run 里就会塞进多条同高的平行臂，而 `bandRunAtY`
  // 每行只取第一条命中的臂 → 其余臂被静默丢弃（issue 116）。
  let dir = 0;
  for (let i = 1; i < n; i++) {
    const s = sign(pts[i]!.y - pts[i - 1]!.y);
    if (s === 0) continue;
    if (dir === 0) dir = s;
    else if (s !== dir) {
      runs.push(pts.slice(start, i)); // 折返点 pts[i-1] 由下一 run 共享 → 无缝
      start = i - 1;
      dir = s;
    }
  }
  if (runs.length === 0) return [pts.slice()];
  runs.push(pts.slice(start));
  return runs;
}

// ───────────────────────── 扫描线光栅化（issue 09 验收反馈八轮 #1） ─────────────────────────
//
// 七轮前的环带分层画法 = 16 条半透明同心环带逐层 `fill()`——相邻层共享边界的像素被两侧各覆盖
// 约一半，source-over 合成 `1−(1−½a₁)(1−½a₂)` **低于任一侧目标 alpha** → 每条环带边界必留一道
// 暗发丝线；直线带亚像素间隔整体混叠 = "发虚"，曲率处缝距拉伸到 1px 级 = 逐条可见的"黑色条纹"
// （dpr4 实测：直线带内部亮脊旁暗约 30/255，弯曲带沿长度出现成排暗谷）。加层只会加缝。
//
// 本画法把横截面当**连续函数**按设备像素行扫描直接写出：每行中心 `cx(y)`（折线线性插值，
// 与路径画法的公共顶点逐点一致），像素 α = `sampleProfileAt(|x−cx|/half)` × 1px 边缘覆盖 × 基 α；
// 每像素至多一次写入（自叠多臂在**像素内**做 screen 合成 `1−(1−a₁)(1−a₂)`，等价 source-over
// 叠亮口径、七轮定案不变）→ 数学上不存在"两笔覆盖一个像素"→ 零暗缝，任意曲率/斜率都连续。
// 产物是纯 RGBA 缓冲（无 DOM 依赖，可单测），render.ts 只负责贴到主画布/瓦片。

/** 归一化横截面 α 采样：`profile` 为等距 frac 0..1（中心→边缘）上的 α 序列，线性插值。 */
export function sampleProfileAt(profile: readonly number[], absF: number): number {
  const n = profile.length - 1;
  if (n <= 0) return profile[0] ?? 0;
  const f = Math.min(Math.abs(absF), 1);
  const x = f * n;
  const i = Math.min(Math.floor(x), n - 1);
  const t = x - i;
  return profile[i]! * (1 - t) + profile[i + 1]! * t;
}

/**
 * y 单调 run 在画布行 `yCss` 上的中心线 x；行不在 run 的 [首末 y 区间) 内 → null。
 * 行归属口径 = `[lo, hi)`（半开）：相邻 run 共享的回折点行只归后一个 run 一次，
 * 带体两端终点行不计（该半行本就落在端点图标墨迹下）。
 */
export function bandRunAtY(run: readonly BandPoint[], yCss: number): number | null {
  for (let i = 0; i + 1 < run.length; i++) {
    const a = run[i]!, b = run[i + 1]!;
    if (a.y === b.y) continue; // 同拍点对行无贡献（面积 0，与 drawBandQuad 同判据）
    const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y);
    if (yCss >= lo && yCss < hi) {
      const t = (yCss - a.y) / (b.y - a.y);
      return a.x + (b.x - a.x) * t;
    }
  }
  return null;
}

export interface BandRasterInput {
  /** `splitBandAtFolds` 的产物（每条 y 单调） */
  runs: readonly (readonly BandPoint[])[];
  /** 带半宽（CSS px，车道横向口径） */
  half: number;
  /** 中心→边缘等距 α 剖面（`bandStripStyle` 的 profile） */
  profile: readonly number[];
  /** 体色 RGB（0..255，非预乘） */
  rgb: readonly [number, number, number];
  /** 设备像素 / CSS 像素（来自主上下文的变换，保证 1:1 无重采样） */
  sx: number;
  sy: number;
  /** 基 α（slideOpacity）；幽灵亮度口径由调用方处理 */
  baseAlpha: number;
}

export interface BandRaster {
  /** 位图左上角（设备像素，主画布当前变换空间） */
  bxDev: number;
  byDev: number;
  bw: number;
  bh: number;
  /** RGBA（非预乘）缓冲，bw·bh·4 */
  data: Uint8ClampedArray;
}

/**
 * 扫描线光栅化整个带体（多 run 自叠区在像素内 screen 合成 = 叠亮）。
 * 空输入 / 非法缩放 → null（调用方不画）。
 */
export function rasterBandRuns(input: BandRasterInput): BandRaster | null {
  const { runs, half, profile, rgb, sx, sy, baseAlpha } = input;
  if (runs.length === 0 || sx <= 0 || sy <= 0 || half <= 0) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const run of runs) {
    for (const p of run) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX) || maxX - minX < 1e-9 && maxY - minY < 1e-9) return null;
  const padCss = 2; // 边缘 1px AA 余量
  const bxDev = Math.floor((minX - half - padCss) * sx);
  const byDev = Math.floor((minY - padCss) * sy);
  const bw = Math.max(1, Math.ceil((maxX + half + padCss) * sx) - bxDev);
  const bh = Math.max(1, Math.ceil((maxY + padCss) * sy) - byDev);
  if (bw * bh === 0) return null;
  const data = new Uint8ClampedArray(bw * bh * 4);
  const [rC, gC, bC] = rgb;
  for (const run of runs) {
    for (let j = 0; j < bh; j++) {
      const yCss = (byDev + j + 0.5) / sy;
      const cx = bandRunAtY(run, yCss);
      if (cx === null) continue;
      const leftDev = (cx - half) * sx - bxDev;   // 位图局部设备坐标
      const rightDev = (cx + half) * sx - bxDev;
      const i0 = Math.max(0, Math.floor(leftDev));
      const i1 = Math.min(bw - 1, Math.ceil(rightDev));
      for (let i = i0; i <= i1; i++) {
        const ic = i + 0.5;
        const cov = Math.min(Math.max(Math.min(ic - leftDev, rightDev - ic), 0), 1);
        if (cov <= 0) continue;
        const xCss = (bxDev + ic) / sx;
        const a = Math.min(Math.max(sampleProfileAt(profile, (xCss - cx) / half) * cov * baseAlpha, 0), 1);
        if (a <= 0) continue;
        const p = (j * bw + i) * 4;
        data[p] = rC; data[p + 1] = gC; data[p + 2] = bC;
        // 像素内 screen 合成（同色不预乘）：重叠臂 = 叠亮，等价两次 source-over
        data[p + 3] = Math.round(255 * (1 - (1 - data[p + 3]! / 255) * (1 - a)));
      }
    }
  }
  return { bxDev, byDev, bw, bh, data };
}
