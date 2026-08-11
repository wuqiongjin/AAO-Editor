Type: task
Status: open
Blocked by:

## Question

未来跟踪项（来自 ADR-0005 §6 Q8）：本期谱面工程持久化用 **IndexedDB** 落地，接口抽象化。未来需支持把谱面工程（代码 + 谱面时长 + 音频 Blob）持久化到 Electron `userData` 原生文件后端，替代/补充浏览器 IndexedDB。**待后续 grill / 实现，本期只登记跟踪。**

## 期望

- 存储层接口抽象（统一读写），IndexedDB 与 Electron `userData` 后端可切换；
- 沿用 [issue 04 文件 IPC](../../../.scratch/basic-editor/issues/04-Electron文件持久化与导出.md) 的架构方向（preload invoke → main ipcMain.handle + dialog + fs）。

## Answer（结论）

（后续 grill / 实现后填写）