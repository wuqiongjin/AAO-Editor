# 117 · Electron 数据根目录

Type: grilling
Status: resolved（实现 + 锁测；Electron 改根/认领手工验收仍待）
Blocked by: —

## 来源

用户要求「支持更改数据文件保存路径」。收窄为：只改 **Electron 自动落盘的根目录**，不是设置对象、不是导出对话框。

## 定案

1. **布局**：配置的是**数据根**，不是名叫 `projects` 的文件夹。其下固定两个子目录，空也建：
   - `projects/<id>/{project.json,audio.bin}`
   - `assets/background-skin.bin`（有图才有文件；`assets/` 目录始终在）
2. **默认数据根** = `userData/data`。`userData` 只放本机应用状态与 Chromium 运行时。
3. **三层存储**：

   | 层 | 是什么 | 住哪 | 进「导出设置」 |
   | --- | --- | --- | --- |
   | 文档 | 谱、音频、背景图 | **数据根**（默认 `userData/data`，可改/可认领） | 否 |
   | 偏好 | 主题、快捷键、画布 | **localStorage** `bangdream.settings.v1` | 是 |
   | 本机应用状态 | 当前数据根路径、窗体宽高与最大化 | **`userData/app-state.json`** | 否 |

   一次一个数据根；多根 = 换 `app-state.json` 里的路径字段。以后本机状态只往这一份文件加字段，不再新丢 `foo.json`。窗体几何与数据根同文件（`window` 字段）。
4. **搬家 / 认领**（仅 Electron，仅设置页，启动不弹窗）：
   - **更改保存位置** = 整包拷到新数据根、删旧根；成功才切指针，失败清目标半套、不切根。
     - 所选文件夹**为空** → 该文件夹即新数据根（文件夹名由用户定，不强制 `data`）。
     - 所选文件夹**已有内容** → 视为父目录，新根为 `所选/当前数据根文件夹名`（例：根 `…/123`、选 `…/music` 且其中有 `data/` → `…/music/123`，`music/data` 不动）。
     - **最终目标路径**须不存在或为空；落在当前根内部或其父路径 → 拒绝。若当前根名为 `data` 且父目录下已有 `data/`（解析到同一路径）→ 占用拒绝，需换路径或「使用已有数据文件夹」。
   - **使用已有数据文件夹** = 只改指针，不拷不删。所选即数据根；缺 `projects/`、`assets/` 则补空目录（含空目录首次选用）。
5. **设置页**：子标题「配置数据」+ 一句「谱面保存位置，以及主题与快捷键的导入导出。」
   - **谱面与资源**：仅 Electron（路径 + 搬家/认领）。浏览器不显示。
   - **偏好设置**：两边都有；按钮为「导出设置」「导入设置」。导出 JSON 只有 settings 对象。
6. **不做**：不迁移开发机上旧的 `userData/projects` 或 `data-root.json`。浏览器仍 IndexedDB，无选文件夹。
7. **与 issue 25**：推翻「工程根不可配」；按环境自动选文件/IDB 仍成立。25 不合入。

## 实现落点

- `electron/appState.cjs`：`userData/app-state.json`（`dataRoot` + `window`），原子写。
- `electron/dataRoot.cjs`：默认 `userData/data`；保证 `projects/` + `assets/`；`moveDataRoot` / `claimDataRoot`。
- 设置页：配置数据子标题；Electron 才有谱面与资源行。

## 锁测

- `tests/unit/ElectronDataRoot.test.ts`、`WindowStateMemory.test.ts`（窗体读写改走 `app-state.json`）。
- 单测：`resolveMoveDestRoot`（空所选 vs 非空父目录）、`music/123` 与 `music/data` 并存、默认同名 `data` 冲突。
- Electron 手工：空文件夹搬家、非空父目录按目录名落子目录、认领空目录初始化；退出重开后 `projects/` 与 `assets/` 仍在；窗体记忆仍在。

## Comments

- Grill：单根；仅 Electron 路径 UI；搬家与认领分开；认领只在设置；默认 `userData/data`；空也建 `projects/`+`assets/`；指针在 `app-state.json` 不进 settings；不迁旧盘；页内「谱面与资源」「偏好设置」。
