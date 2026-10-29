# 02 · perf 用例把「单样本墙钟」当预算判据：全量并行跑下偶发假红（82.96ms / 5s 超时）

Type: bug
Status: resolved（2026-10-29 实现 + 锁测；待门禁连续绿）
Blocked by: —

## 来源与症状

2026-10-29 CNB 门禁（`ci-gate.sh:26` → `npm test`，337 文件 / 3760 用例）偶发两条红，同轮其余 3758 条全绿、本地全绿：

- `tests/perf/ChartCodeScale.test.ts:68` —— `expected 82.9606 to be less than 60`（5000 音符 `convertNotesToChartCode`）
- `tests/perf/HighZoomBackflowSpCost.test.ts:79` —— `Test timed out in 5000ms`

两处同时红、概率复现、无对应代码改动 → 与 173 同类：**不是回归，是测量口径**。

## 实测（本机 8 vCPU / node 24 / vitest 4.1.11，单跑该文件）

| 场景 | `convertNotesToChartCode` 单样本 | HighZoom 首个 it |
| --- | --- | --- |
| 空载（照抄 `timeIt` 口径 40 个样本） | min 0.39 / p50 0.50 / p90 1.17 / max 1.95 ms | 1289 ms（对 5000ms 超时仅 3.9× 余量） |
| 4× 抢占（32 自旋进程） | 文件级 40~61 → 279 ms | 3486 ms（2.7×） |
| 8× 抢占（64 自旋进程） | p50 0.70 / p90 37.5 / **max 78.7**，≥60ms 1/40 | **>5000ms → 同一条 timeout 复现** |

CI 报的 82.96ms 正落在 8× 抢占的分布里；该函数真实成本中位数 **0.5ms** —— 断言测到的是「进程被剥夺的墙钟」，膨胀约 160×。

## 根因

1. **单样本墙钟**：`timeIt` = 预热 1 次 + 采样 1 次（`ChartCodeScale.test.ts:35-40`），`performance.now()` 差值把抢占 / GC / CFS 配额停顿都记在被测函数头上。空载 0.5ms 对 60ms 预算看似有 120× 余量，但只要采样窗口落进一次 60~100ms 停顿就必红（实测 1/40）。同文件另三条绝对预算（60 / 60 / 120ms）结构相同，只是余量不同，同样会偶发。
2. **把「liveness 超时」当「性能预算」**：`HighZoom` 首个 it 是纯 CPU 活（es=3 折返带 raster 单趟 ≈100ms，用例 3 组 × 9 趟 ≈1.2s），却拿 vitest 默认 `testTimeout: 5000` 当上限（`vitest` resolved 默认值；`vitest.config.ts` 未覆盖）—— 3.9× 余量，4× 抢占吃到 3.5s，8× 直接超时。
3. **没有隔离**：`tests/perf` 与其余 335 个文件同批跑。vitest 4 默认 `pool: 'forks'`、`maxWorkers = availableParallelism()-1`（本机 7 个 fork 抢 8 vCPU；CI 容器配额更紧时更糟）。perf 断言与 6 个邻居争 CPU，测的是「份额」不是「成本」。
4. **复发模式**：`17610b05`（2026-09-26）已因同一原因放宽过 `RendererPerf` 阈值（提交信息写明「并发下墙钟膨胀 2~2.5 倍」）；173 才定位根因并把 `avg` 改成 `process.cpuUsage()`、墙钟只留 `max<100` 兜底。本次两条是同一模式的**第三处** —— 继续调阈值只是等下一次更饿的 runner。

## 复现（不依赖 CI）

```bash
for i in $(seq 1 64); do node -e 'while(true){}' & done   # 自旋不产生 GC，纯调度抢占即可
npx vitest run tests/perf/HighZoomBackflowSpCost.test.ts   # → Test timed out in 5000ms
```

## 修法候选（未实施，待拍板）

1. **改测 CPU 时间 + 多取最小值**（与 173 一致，推荐）：新增 `tests/support/perfTiming.ts` 的 `measureCpuMs()`（预热 + N≥5 次 `process.cpuUsage()` 差值取 min），`ChartCodeScale` 四条绝对预算改用 min；相对断言 `bigMs < max(20, smallMs*25)` 本就硬件无关，保留。前提 `pool: 'forks'`（当前默认）——换 threads 后 `process.cpuUsage()` 含全部 worker 线程，口径失效。
2. **重活用例显式 `testTimeout`**：`it(..., 30_000)`；顺带删掉 `measure(g1, 1, 5)` 里断言用不到、纯为计时的 8 趟 raster（省 ~280ms）。
3. **可选：perf 单独串行跑**（`vitest run tests/perf --maxWorkers=1`，CI 加一步），让绝对预算重新有意义；代价 +3~5s，与 1 不冲突。
4. **不采用**：继续上调阈值（`17610b05` 已证明是复发模式，且假绿/假红同时存在）、加 `retry`（真回归也会被重试掉）。

## 实施（2026-10-29，取修法 1 + 2）

- 新增 `tests/support/perfTiming.ts`：`sampleCpuMs()`（预热 2 次 + N 次 `process.cpuUsage()` 差值）/ `minCpuMs()`（取最小值）；注释写明「`pool: 'forks'` 前提 + 为什么取 min」。
- `ChartCodeScale`：四条绝对预算改 `minCpuMs`，预算 60/60/120 → **20/20/50ms**（实测 CPU 最小值 ≈0.4 / 1.4 / 5.0ms）。注释如实标注灵敏度：这几条抓灾难性退化（约 50× / 14× / 10×），O(n²) 由「规模 10 倍」用例看守。
- `HighZoom`：raster 成本改 `minCpuMs(..., 3)`；删掉 es=1 那 8 趟「只为计时、断言用不到」的重复 raster；用例加 `30_000` 显式超时。用例耗时 1289 → 712ms。
- 新增 `tests/unit/testing/PerfTiming.test.ts`（4 条）：假时钟锁「取最小值」语义、时钟倒退夹 0、静态锁「生产时钟必须是 `process.cpuUsage`，不得出现 `performance.now`」。

## 锁测

- 改完在 8× 抢占下连跑 6 次全绿（173 的验收口径）。
- 留「真退化会红」的对照：给 `convertNotesToChartCode` 人为加一次全谱重扫（O(n²)），新口径仍须红。
- 结构不变量（行数、px 大小关系、rebuilt / blit 上限）不动。

## Comments

- 2026-10-29 探针（临时文件，已删）：空载单样本 min/p50/p90/max = 0.39/0.50/1.17/1.95ms；8× 抢占 = 0.62/0.70/37.49/78.70ms，≥60ms 1/40、≥30ms 5/40。
- 2026-10-29 HighZoom 空载 1289ms，其中 raster es=3@5s ≈100ms/趟 ×9 = 0.9s、es=1@5s ≈35ms/趟 ×9 = 0.3s；4× 抢占 3486ms；8× 抢占 >5000ms（第 3 趟 `measure` 前就超时）。
- 2026-10-29 同轮 3758/3760 绿 + 两处同时红 + 本地全绿 → 排除单点代码回归；`ChartCodeScale` 其余 3 条绝对预算同样脆弱，只是余量更大。
- 2026-10-29 验收：8× 抢占（64 自旋）下两条用例连跑 **6/6 全绿**（修复前 8× 下次次超时）；全量 `npm test` 338 文件 / 3764 用例全绿；改动文件 eslint 干净；`tsc -p tsconfig.test.json` 无新增错（存量错仍在 tests/dom，见 ci-gate.sh 注释）。
- 2026-10-29 「真退化会红」对照：临时给 `convertNotesToChartCode` 注入约 350ms/次的重复扫描 → `expected 354.8 to be less than 20`，验证完已 `git checkout` 还原（未进提交）。
- 2026-10-29 取舍：预算没再往紧里收。CPU 时间随硬件慢而变大，预算同时承担「硬件差异余量」与「退化灵敏度」两个职责；convert 收到 8ms 能抓 ~20× 退化，但在 3× 慢的 runner 上只剩 7× 余量 —— 得不偿失，结构性退化交给规模比用例。
