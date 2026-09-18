Type: research
Status: resolved
Blocked by:

## Question

当前 Electron main（`electron/main.cjs`）与 preload（`electron/preload.js`）暴露了哪些能力？调研并给出**文件持久化（打开/保存谱面）、导出、可能的音频文件读取**的推荐实现：
- Electron 主/渲染进程 IPC（contextBridge/handle/invoke）现状。
- 用 dialog + fs 打开/保存谱面 JSON 的推荐做法。
- 导出产物形态（谱面 JSON？附带音频？）。
- 是否需要在主进程做任何 Node 侧处理。

产出：推荐架构 + 现状差距，供后续"文件保存/导出"实现决策。

## Answer（结论）

research 子代理确认现状 + 推荐：

- **现状**：`main.cjs` contextIsolation=true、nodeIntegration=false（安全）；preload 仅暴露 `platform/versions`；菜单"打开/新建"项未绑定行为；**无任何文件 IPC**。
- **目标模式**：渲染进程 → preload `contextBridge.invoke` → main `ipcMain.handle('openFile'/'saveFile')` → `dialog.showOpenDialog/showSaveDialog` + `fs.readFile/writeFile`。保持 contextIsolation on、renderer 无 nodeIntegration。
- **导出产物**：MVP 只导出 `chartCodeToJSON(chartCode)` 的 JSON 字符串（音频另行选择）；后续可扩展 ZIP（JSON + audio）。

**含义**：文件 I/O 是干净的"加 IPC 通道"工作，复用 `ChartConverter` 的序列化即可，无架构阻碍。

## Comments

- 2026-09-18：谱面代码「每次另存为、不记路径」的实现票 = [118](./118-谱面代码导出另存为.md)。本票正文不改写、不合入。Electron 工程自动库改根 = [117](./117-Electron数据根目录.md)，与本票 dialog 导出不是同一条产品线。