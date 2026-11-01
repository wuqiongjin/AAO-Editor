# 202 · Slide 同拍中间结点无法拖动移动

Type: grilling
Status: resolved
Blocked by: —

## 来源

用户反馈带有同拍结点（Same-beat group）的绿条中间结点当前无法移动：

```json
{
  "type": "Slide",
  "connections": [
    { "beat": 0.5, "lane": 5 },
    { "beat": 0.75, "lane": 2 },
    { "beat": 0.75, "lane": 5 },
    { "beat": 1, "lane": 1 },
    { "beat": 1, "lane": 4 },
    { "beat": 1.25, "lane": 3 }
  ]
}
```

## 症状

1. 该绿条的 4 个中间结点（索引 1、2、3、4）在画布上可以被正常点选、悬停高亮；
2. 当鼠标拖拽任意一个中间结点时（无论横向变轨还是纵向变拍）：
   - 画布上不出现拖拽幽灵预览（`dragGhost` 为空）；
   - 松开鼠标后不提交任何变更，结点弹回原位置；
3. 首尾端点（索引 0、5）以及整条绿条的整体平移功能正常，仅中间结点死锁。

## 根因

位于 `src/chart/editing/NoteDragging.ts` 的 `planDragMove`（L278-289）：

```typescript
if (plan.kind !== 'whole') {
  for (const ci of plan.conns) {
    const c = conns[ci];
    const prev = nearestVisible(conns, ci, -1);
    const next = nearestVisible(conns, ci, +1);
    // 结点必须严格保持在前后可见邻居之间（防交叉/退化段；端点只有单侧约束）
    if (prev && sumBeat(c.beat, c.subBeat || 0, beatDisplay) <= sumBeat(prev.beat, prev.subBeat || 0, beatDisplay) + EPS) return fail('out-of-bounds');
    if (next && sumBeat(c.beat, c.subBeat || 0, beatDisplay) >= sumBeat(next.beat, next.subBeat || 0, beatDisplay) - EPS) return fail('out-of-bounds');
  }
}
```

校验逻辑假设所有可见结点 beat 必须**严格单调递增**（`prev.beat < c.beat < next.beat`）：
- 结点 1（beat 0.75）的后邻居为结点 2（beat 0.75），`c.beat >= next.beat - EPS` 恒成立；
- 结点 2（beat 0.75）的前邻居为结点 1（beat 0.75），`c.beat <= prev.beat + EPS` 恒成立；
- 结点 3、4 同理因 beat 1.0 互为邻居而双向死锁；
- 因此任何横向变轨（`dBeat = 0`）直接被判 `out-of-bounds` 拒绝；纵向在 1/4 拍网格吸附下因无严格开区间可用拍位也全部拒绝。

---

## 定案（用户 2026-11-01 拍板）

1. **Q1（同拍变轨与重叠冲突）**：**采用策略 A（保守回弹）**。同拍内允许任意变轨（`lane` 自由），但禁止落到同拍其他结点已占用的同一轨道（同拍同轨视为 `collision` 回弹，防止误触破坏结构或造成画布无法点选的重合废点）。不引入去重吞并（策略 B），保持移动口径无副作用。
2. **Q2（单结点改拍位）**：**采用弱序单调约束**（`prev.beat <= c.beat <= next.beat`）。保持 `connections` 数组时间序单调不减，向开阔方向移动合法，不得逆向跨越同拍伙伴，保序防倒流。
3. **Q3（构造同拍）**：**允许**普通中间结点拖动吸附至与相邻结点同拍（形成阶梯瞬跳），只要不落入同轨即可。
4. **Q4（多选组拖）**：**组内互免**。同时选中的兄弟结点相互之间豁免时序碰撞，整体统一受该组之外的前后未选中最近邻居约束。

---

## 实现落点

1. `src/chart/editing/NoteDragging.ts`：
   - 提取 helper：寻找最近**未被当前拖拽计划移动**的外部可见邻居（当单拖时即为普通邻居；当组拖时跳过 `plan.conns` 内的同伴）；
   - 放宽时序不等式：从严格小于/大于改为弱序：
     - 若 `sumBeat(c.beat) < sumBeat(prev.beat) - EPS` 则 `fail('out-of-bounds')`；
     - 若 `sumBeat(c.beat) > sumBeat(next.beat) + EPS` 则 `fail('out-of-bounds')`；
   - 邻居同拍同轨碰撞检查：若 `sumBeat(c.beat) === sumBeat(neighbor.beat)` 且 `c.lane === neighbor.lane`，判定为 `fail('collision')`（或由既有 `claimed` / `occ` 表天然兜住）。
2. `tests/unit/chart/editing/NoteDragging.test.ts`：
   - 针对用户提供的 6 点绿条及一般同拍绿条增加完整回归用例。

---

## 锁测计划

1. `tests/unit/chart/editing/NoteDragging.test.ts` 新增「同拍中间结点拖动与弱序时序」用例集：
   - **用例 1（本绿条横向变轨）**：节点 1 从 lane 2 移到 lane 3，返回 ok=true，connections 更新为 lane 3；
   - **用例 2（本绿条同轨碰撞回弹）**：节点 1 从 lane 2 移到 lane 5（与节点 2 同轨），返回 ok=false, reason='collision'；
   - **用例 3（本绿条纵向弱序边界）**：节点 1 移至 beat 0.625（合法开阔区）ok=true；移至 beat 0.5（撞节点 0 且同轨 lane 5）collision 回弹；移至 beat 0.4（越过节点 0）out-of-bounds 回弹；移至 beat 0.875（越过节点 2）out-of-bounds 回弹；
   - **用例 4（多选组拖联动）**：同时多选节点 1 与节点 2 一起平移（dLane=1 或 dBeat=0.125），组内不自阻，整体移动成功；
   - **用例 5（普通滑条吸附成同拍）**：普通滑条 `[(1,1), (2,2), (3,3)]` 将节点 1 拖至 beat 1 (lane 4)，成功变为同拍阶梯，不报越界。

---

## Answer

**resolved**。已按照用户定案修复同拍绿条中间结点无法拖动移动的问题：
1. **时序判定放宽为弱序单调**：在 `NoteDragging.ts` 中允许 `prev.beat <= c.beat <= next.beat`（允许同拍）；
2. **同拍同轨碰撞拦截（策略 A）**：由 step ③ 占位表自然判定为 `fail('collision')` 回弹防误触；
3. **多选组拖联动**：`nearestVisible` 扩充 `skipIndices` 跳过同批被拖结点（组内互免），受外部最近可见邻居边界约束；
4. **锁测验证**：`NoteDragging.test.ts` 5 组针对性用例与 77 项用例全绿，全量图表单测 1173 项通过，`npx tsc -b` 零错误。

