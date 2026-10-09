# 07 · 从官方谱 / 社区谱新建工程

Type: grilling
Status: open
Blocked by: 02, 04；[bestdori-integration/issues/07 网络 IPC 面](../../bestdori-integration/issues/07-网络IPC面与主进程网关.md)（2026-09-30 已开，不再是「尚未开」）

> 本票的四条「待 grill」已于 2026-09-30 拍板，结论落在 [bestdori-integration/issues/06](../../bestdori-integration/issues/06-社区能力层地基.md) 的 Answer 表，实现拆成 08（官方曲）/ 09（社区帖）。其中 ②③ 见 08 票、① 见 Q10、④ 见 Q9。
>
> **2026-10-09 归位**：本票标题里的「从 Bestdori」是**实现视角**的写法，已在 [bestdori-integration/issues/12](../../bestdori-integration/issues/12-导入入口四项归类.md) 按用户口径改成**用户视角**四项来源（空白创建 / 从本地谱面导入 / 从官方谱面导入 / 从社区谱面导入）。本票 = 后两支（官方谱、社区谱）；「用户不关心 Bestdori，只关心官方 / 社区」是 12 票的拍板理由。下面「已定」里按新名词重排了一遍，**旧结论一字未改**。
>
> （顺带修掉 HEAD 那笔留下的链接：`issues/` 里的相对路径要 `../../` 上一层到 `.scratch/`，原写的 `../bestdori-integration/` 落在 `.scratch/chart-projects/` 里，是断链。）

## 来源

[01](./01-谱面工程管理与启动流程定案.md) 定案 13。用户 2026-09-26：从 Bestdori 创建很实用，除官网发帖页的 BanG Dream / LLSIF / Custom 外还要支持 Community。

## 已定

- 入口在工程管理页「新建」；静态演示版隐藏（ADR-0011 §1）。判定口径 = `window.electronAPI` 缺失（全仓惯例）。
- 来源按用户口径归两大类（Custom 与空白创建相同，不单列；「从本地谱面导入」= 既有「复制工程」归位，不属本票）：
  - **从官方谱面导入**（原 BanG Dream / LLSIF 两支合并为一支，游戏之分只在 `曲目来源` 字段里留存）：
    - BanG Dream 曲：选官方曲 → 工程名称、歌手、曲目来源（官方曲 id）预填，下载音频与封面；可选导入官方各难度谱面代码作为谱面。
    - LLSIF 曲：选曲 → 预填信息、下载音频；无该格式谱面代码，给一张空谱面。
  - **从社区谱面导入**（原 Community）：选社区帖 → 导入谱面代码、难度、等级；曲目按帖子的 `song.type` 处理（官方曲记 id 并下载音频；自定义曲按帖内 URL 下载音频与封面）。
- 导入的谱面代码走 Apply 闸门（ADR-0014）；网络只走 Electron 主进程（ADR-0011 §2）。

## 待 grill

- 选曲 / 选帖界面长什么样（搜索、分页、预览）。
- 官方谱默认导入哪些难度。
- 下载的音频 / 封面缓存位置与数据根的关系；素材边界按 ADR-0011 §4 / bestdori-integration issue 05。
- Community 导入的谱面名称是否预填帖子标题（那是别人的谱）。
