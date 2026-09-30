// 页面作用域（票 22 / ADR-0015 §6）：某个页面此刻**作用于哪一个工程**的临时指向。
//
// 与「当前工程」（工作台唯一打开的那份，ADR-0015 §3）是两个独立概念——术语上不许混用。
// 存在的理由：音频页与预览页要能从工程管理页直接进去处理某一首歌的
// 东西，而不必先把它切成当前工程、把工作台正在编辑的上下文丢掉。
//
// 生命周期由「进入动作」决定，不持久化、不写 URL：
//   - 应用壳左栏的页面入口（含切页快捷键）= 先清 scope 再激活（语义：去当前工程的这一页）；
//   - 带 scope 的跳转 = 先写 scope 再激活。
// 页面是保活挂载的（全量挂载只切可见性），按"入口决定"比"进入时判断是不是跳转来的"可靠；
// "回到当前工程"因此 = 再点一次那个左栏入口，不需要一个专门的按钮。
export interface PageScope {
  /** 一级：工程。 */
  projectId: string;
  /**
   * 二级：谱面。**ADR-0016 §4 起转正**（此前"只留形状、不做"，票 22 定案 10）——
   * 预览页是那个"第二个真实消费者"：带 `chartId` 的跳转精确到哪一张谱面。
   * 缺席 / 失效时的回落见 `pickScopedChartId`。
   */
  chartId?: string;
}

/** 页面此刻的作用对象 = 作用域 ?? 当前工程；两者都没有则 null（走该页的空态）。 */
export function resolveScopedProjectId(
  scope: PageScope | null,
  currentProjectId: string | null,
): string | null {
  return scope?.projectId ?? currentProjectId;
}

/**
 * 二级（谱面）解析（ADR-0016 §4）：预览类页面据此定位"作用对象工程里的哪一张谱面"。
 *
 * 三级回落（前者失效即退到后者）：
 *   1. 作用域二级 —— 只在该谱面仍属于这个工程时算数；
 *   2. 该工程就是当前工程时，取当前谱面（`CurrentProjectSession` 的 `chartId`）；
 *   3. 首张。
 *
 * `chartIds` = 作用对象工程的谱面 id（记录顺序即展示顺序）；工程一张谱面都没有时给 null
 * ——记录不变式是至少一张（`pickCurrentChart` 也据此直接抛错），真到了这里说明记录坏了：
 * 页面不猜（不给谱面切换器、舞台照旧），不额外分支。
 */
export function pickScopedChartId(
  scope: PageScope | null,
  scopedProjectId: string,
  currentProjectId: string | null,
  currentChartId: string | null,
  chartIds: readonly string[],
): string | null {
  const member = (id: string | null | undefined): string | null =>
    id != null && chartIds.includes(id) ? id : null;
  return member(scope?.chartId)
    ?? (scopedProjectId === currentProjectId ? member(currentChartId) : null)
    ?? chartIds[0]
    ?? null;
}
