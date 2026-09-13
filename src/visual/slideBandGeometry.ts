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
 * 不变量（`tests/unit/SlideBandGeometry.test.ts` 锁测）：
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
  let cur = 0;
  for (let i = 1; i + 1 < n; i++) {
    const d = sign(pts[i]!.y - pts[i - 1]!.y);
    if (d === 0) continue;
    cur = cur === 0 ? d : cur;
    const nd = sign(pts[i + 1]!.y - pts[i]!.y);
    if (nd !== 0 && nd !== cur) {
      runs.push(pts.slice(start, i + 1));
      start = i;
      cur = nd;
    }
  }
  if (runs.length === 0) return [pts.slice()];
  runs.push(pts.slice(start));
  return runs;
}
