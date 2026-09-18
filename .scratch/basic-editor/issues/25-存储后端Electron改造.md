Type: task
Status: resolved（2026-08-27 实现+验证闭环：tsc 0 错误 / vitest 277 全过（新增 10 例）/ vite build 绿；Electron 手工验收清单见文末）
Blocked by:

## Question

未来跟踪项（来自 ADR-0005 §6 Q8）：本期谱面工程持久化用 **IndexedDB** 落地，接口抽象化。未来需支持把谱面工程（代码 + 谱面时长 + 音频 Blob）持久化到 Electron `userData` 原生文件后端，替代/补充浏览器 IndexedDB。**待后续 grill / 实现，本期只登记跟踪。**

## 期望

- 存储层接口抽象（统一读写），IndexedDB 与 Electron `userData` 后端可切换；
- 沿用 [issue 04 文件 IPC](../../../.scratch/basic-editor/issues/04-Electron文件持久化与导出.md) 的架构方向（preload invoke → main ipcMain.handle + dialog + fs）。

## Answer（结论）

### grill 定案（2026-08-27，与用户两轮确认）

1. **后端选择策略 = 按环境自动切换**：应用启动时探测 `window.electronAPI.projectStore` 是否存在——Electron 环境自动用 `userData` 文件后端，浏览器环境照旧 IndexedDB。**不新增设置项**（用户明确拒绝可选项方案）。
2. **旧数据迁移 = 静默一次性迁入**：Electron 下首次读取时，若文件后端无该工程数据且 IndexedDB 有旧工程，自动把 {音符 + 时长 + 音频 Blob} 迁入文件后端；**IndexedDB 原数据永久保留作备份、不删除**。

### 实现记录（2026-08-27，验证见下）

文件面（与素材页另一会话工作零交集）：

- **`src/utils/ChartProject.ts`（重构）**：保持公开 API 兼容——`ChartProjectStore` 门面签名不变（`new ChartProjectStore()` 无参构造即自动选后端），`Editor.tsx` 零改动。
  - 抽出 `ChartProjectBackend` 接口；`IndexedDbProjectBackend` = 原 issue 23 实现整体平移，行为不变；
  - 新增 `ElectronFileProjectBackend`：
    - 音频重写规避：按「Blob 对象同一实例」判定音频未变（音频只在导入/清除时产生新对象），未变则向主进程声明 `keep`、不传字节——防抖保存（~800ms/次）不再反复重写 ~40MB 音频；get 重建出的音频同样登记身份，重启恢复后的自动保存亦命中 keep；
    - put 失败回滚缓存，下次保存自愈重发；
    - 首启迁移幂等：先查文件侧再决定是否迁入，绝不覆盖已有文件数据；旧存储异常静默跳过。
- **`electron/preload.js`**：新增 `electronAPI.projectStore.{ get(id), put(payload) }` 两个 invoke 封装；音频以 `Uint8Array` 显式过桥（不走 Blob 结构化克隆的不可控路径）。
- **`electron/main.cjs`**：注册 `project:get` / `project:put`；落盘布局 `<userData>/projects/<id>/project.json` + `audio.bin`；project.json 与 audio.bin 分离；写入一律「临时文件 + rename」原子替换；工程目录名白名单校验（字母开头、仅 `[A-Za-z0-9._-]`、≤64 位）杜绝路径穿越；audio.bin 缺失/JSON 解析失败均降级为空数据并告警，下次保存自然修复。
- **`tests/unit/ChartProject.electron.test.ts`（新增 10 例）**：保存意图三态（set/keep/cleared）、JSON 规范化剔除 undefined 键、put 失败回滚重发、读取重建+身份缓存、首启迁移幂等且不覆盖已有数据、迁移来源异常静默跳过、id 双保险校验、门面委托与无参构造 node 安全。
- **音频字节传输格式**：主进程返回 `Buffer`（渲染侧收到 `Uint8Array`）统一包 `Blob`；payload 携带 `doc.audioIntent ∈ {set, keep, cleared}`，由渲染侧判定。

**浏览器行为零变化**：无 `window.electronAPI` 时走平移后的 IndexedDB 后端，语义与 issue 23 完全一致。

### 验证状态

- ✅ `tsc -b` 0 错误；`vitest run` 22 文件 277 例全过（既有 267 无回归 + 新增 `ChartProject.electron.test.ts` 10 例）；`vite build` 全绿（2026-08-27，feat/issue25-electron-project-storage worktree）。
- ⏳ Electron 手工验收（用户，可后置）：
  1. 桌面包里放音符 → 完全退出 → 重开应恢复；
  2. 导入音频后改音符，观察 `audio.bin` mtime 不变（防抖保存命中 keep）；
  3. 清除音频后 `audio.bin` 消失；
  4. 本改动前旧版产生的 IndexedDB 数据，在首次打开新版时静默出现在 `userData/projects/default/`（原 IDB 数据保留不动）。

## Comments

- 2026-09-18：[117](./117-Electron数据根目录.md) **部分推翻**本票「不新增设置项」——用户可改 **数据根**（其下仍是 `projects/<id>/` 布局）；按环境自动选文件/IDB 后端这一条仍成立。本票不改写、不合入。
