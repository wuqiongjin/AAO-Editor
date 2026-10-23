# 173 · RendererPerf 缩放手势用例偶发假红：绝对墙钟阈值把「进程 CPU 份额」当成「渲染耗时」

Type: bug
Status: resolved（2026-10-23 实现 + 锁测；全量 319 文件 / 3576 用例绿，待用户复核）

## 来源

用户 2026-10-23：本地与 CNB 门禁**小概率**同时出现同一条红（全量 318 文件 / 3573 用例里仅此 1 条）：

```
FAIL tests/perf/RendererPerf.test.ts > 端到端缩放性能（stub canvas，5000 音符） > 缩放手势帧渐进重建…
AssertionError: expected 19.125966555555603 to be less than 16
 ❯ tests/perf/RendererPerf.test.ts:373   expect(avg).toBeLessThan(16); // 60fps 帧预算
```

同一次运行 `max < 100` 与循环内的 `drawImage ≤ 8`、`spriteRenders` 断言全部通过 —— 说明**不是单帧尖峰**，而是多数帧被整体拉长。

## 实测（本机 8 vCPU（cgroup cpu.max=8），单跑该文件；帧循环与用例同构）

| 场景 | 初帧 build | 9 帧 avg | max | 每帧重建瓦片 `lo-hi:rebuilt` | settle 帧重建 sprite |
| --- | --- | --- | --- | --- | --- |
| 空载 | 10.2ms | **1.61ms** | 2.47ms | 319-325:7 / … / 320-323:4（**每帧把可见 stale 瓦片全建完**） | 0 |
| 8× CPU 抢占（64 个自旋进程） | 32.4ms | 6.10ms | 12.99ms | 同上（预算仍够） | 0 |
| 16× 抢占（128 个自旋进程） | 35.1ms | 10.72ms | 42.69ms | 某帧 319-324:**4**（4ms 预算被抢占吃掉，2 块退回缩放 blit） | 0 |
| 真实用例 @8× 抢占（3 次跑 1 次红） | — | 通过 | — | — | **25 ≠ 0** → 该用例 383 行 `expect(spriteRenders).toBe(0)` 报红 |

空载成本 1.61ms 对 16ms 预算 = **10 倍余量**；1.61 → 19.13 是 12 倍膨胀。

## 根因 A（假红的直接原因）：断言测的是墙钟，且没有做并发隔离/校准

- `frameTimes` 用 `performance.now()` 差值，包住的是「同步 JS + 进程被剥夺 + GC 停顿」的总和；渲染器真实成本只有 1.6ms/帧。
- 全量跑时 vitest 默认 file 并行（`maxWorkers = availableParallelism()-1`，本机 7 个 fork），318 个文件、transform+import 130s；runner 的 CPU 份额随邻居/配额波动，一个 1.6ms 的同步块被反复抢占就能变成 20–90ms。
- 本机把抢占比压到 8× / 16× 即复现 6.1 / 10.7ms avg 与 42.7ms 单帧（自旋进程不产生 GC，仅调度抢占已足够解释）；CI 报的 19.1ms 对应同量级（约 1/20~1/30 CPU 份额，或再叠加堆大时的 major GC）。
- 这条断言**无法区分**「渲染器退化 10 倍」与「机器慢了 10 倍」：任何真退化都要到 10× 才红，而调度噪音 3× 就能红 → 假红/假绿同时存在。
- 同文件其他阈值已因同一原因放宽过一次（`17610b05 test(perf): 放宽并发测试下的性能时间护栏阈值`，说明写的是「并发下墙钟膨胀 2~2.5 倍」）。继续上调 16 → 24/32 只是在等下一次更饿的 runner（19 距 16 仅 +20%），属复发模式，不是解法。

## 根因 B（被 A 掩盖的真 bug）：手势重建预算用墙钟，且重建顺序恒从 `lo` 开始

`src/rendering/pipeline/noteLayerCache.ts:472` `rebuildBudgetUntil = performance.now() + 4`；`draw` 的 `for (id = lo..hi)` 里 `t.dirty || (stale && !rc.playing && performance.now() < rebuildBudgetUntil)` **先判后建**：

1. 单块可任意超支（实测一帧 42.7ms，预算 4ms）；
2. 预算被抢占吃完时本帧只重建前 k 块，而循环**每帧都从 `lo` 起**、`lo` 在缩放手势里只从 319 挪到 320 → 视口上方（id 更大）的瓦片永远排在后面、一直轮不到；
3. 手势结束的 settle 帧一次性同步重建这些残块 —— 正是 issue 10 / 146 定案要消灭的「糊 → 清晰整批替换跳变」（实测 settle `spriteRenders = 25`）。

空载不复现，慢机 / 高负载下用户可见：缩放全程只有最下面一块变清晰，松手瞬间其余整批刷新。

## 修法（2026-10-23 已实施）

1. **断言改测 CPU 时间**（`tests/perf/RendererPerf.test.ts`）：`process.cpuUsage()` 差值（µs → ms）做
   `avg < 16` 主断言；墙钟只留 `max < 100` 兜底（防"整个进程被冻住"）。被调度出去的份额不再算进渲染成本。
2. **手势重建加游标**（`noteLayerCache.ts`）：预算中断的位置记进 `rebuildCursor`，下一帧从断点续建（环形轮转），
   不再每帧从 `lo` 重扫 → 高 id 瓦片不会被饿死。首块恒建（每帧保证有进展）。
3. **单块成本上限** `GESTURE_TILE_COST_CAP_MS = 8`：一块实测建造成本超上限就本帧收手，最坏帧成本
   从「不可控」压到「预算 + 一块」。**只对手势帧生效** —— settle/静止帧预算是 Infinity，收手会让瓦片停在旧 es。
4. **stats 增 `backlog`**（本帧后仍 stale 的可见瓦片数）：让"settle 是否该集中重建"变成可断言的量。
5. 顺带把 `anchorY` 提到 blit 循环外（每帧只算一次，纯收益）。

## 锁测

- `tests/perf/RendererPerf.test.ts`（改）：
  - `avg` 用 CPU 时间（并发抢占不再假红）；
  - 手势期**公平性**：最终可见的每块瓦片都必须重建过一次（旧实现恒从 lo 重扫 → 必红）；
  - settle：`settleRebuilt ≤ backlog`，且 `backlog === 0` 时必须零重建（机器无关的表述）。
- `tests/unit/rendering/cache/GestureRebuildFairness.test.ts`（新增 3 条，假时钟 = `performance.now` 每次调用
  推进固定毫秒，把"预算何时耗尽"钉死）：
  1. 每次 +1.5ms（预算每帧只够一块）→ 每帧 1~2 块、手势期覆盖全部最终可见瓦片；
  2. 每次 +5ms（单块 10ms > 8ms 上限）→ 每帧恰好 1 块，仍轮转覆盖；
  3. 真时钟 → 首个手势帧仍一次建完所有可见 stale 瓦片、settle 零重建（证明没为了轮转把快机拖慢）。
  - **旧实现对照**：`git checkout -- noteLayerCache.ts` 后跑，第 1、2 条红（`瓦片 322 在整个手势期一次都没重建`），
    第 3 条绿（它是"不许变慢"的护栏）。

## Comments

- 2026-10-23 定位：空载 1.61ms/帧（对 16ms 预算 10 倍余量），8×/16× CPU 抢占下 6.10/10.72ms、
  单帧最高 42.7ms；CI 报的 19.13ms 只可能来自份额被抢（1.6→19 = 12 倍），不是渲染成本。
- 2026-10-23 复现命令（不依赖 CI）：`for i in $(seq 1 128); do node -e "while(true){}" & done` 后
  `npx vitest run tests/perf/RendererPerf.test.ts -t '缩放手势帧渐进重建'`。修复前 3 次跑 1~2 次红
  （`expected 25/51 to be +0`，settle 集中重建）；修复后 64 个自旋进程下 **6/6 绿**。
- 2026-10-23 教训：`evictOverBudget`/`basis` 之外的顺序性 bug（"每帧从同一端重扫"）只在预算被外部因素
  掐断时暴露 —— 这类缺陷要用假时钟锁，不能靠压 CPU 概率性复现。
