# 07 · 从 Bestdori 新建工程

Type: grilling
Status: open
Blocked by: 02, 04；[bestdori-integration/issues/07 网络 IPC 面](../bestdori-integration/issues/07-网络IPC面与主进程网关.md)（2026-09-30 已开，不再是「尚未开」）

> 本票的四条「待 grill」已于 2026-09-30 拍板，结论落在 [bestdori-integration/issues/06](../bestdori-integration/issues/06-社区能力层地基.md) 的 Answer 表，实现拆成 08（官方曲）/ 09（社区帖）。其中 ②③ 见 08 票、① 见 Q10、④ 见 Q9。

## 来源

[01](./01-谱面工程管理与启动流程定案.md) 定案 13。用户 2026-09-26：从 Bestdori 创建很实用，除官网发帖页的 BanG Dream / LLSIF / Custom 外还要支持 Community。

## 已定

- 入口在工程管理页「新建」；静态演示版隐藏（ADR-0011 §1）。
- 来源三种（Custom 与空白新建相同，不单列）：
  - **BanG Dream**：选官方曲 → 工程名称、歌手、曲目来源（官方曲 id）预填，下载音频与封面；可选导入官方各难度谱面代码作为谱面。
  - **LLSIF**：选 LLSIF 曲 → 预填信息、下载音频；Bestdori 无该格式谱面代码，给一张空谱面。
  - **Community**：选社区帖 → 导入谱面代码、难度、等级；曲目按帖子的 `song.type` 处理（官方曲记 id 并下载音频；自定义曲按帖内 URL 下载音频与封面）。
- 导入的谱面代码走 Apply 闸门（ADR-0014）；网络只走 Electron 主进程（ADR-0011 §2）。

## 待 grill

- 选曲 / 选帖界面长什么样（搜索、分页、预览）。
- 官方谱默认导入哪些难度。
- 下载的音频 / 封面缓存位置与数据根的关系；素材边界按 ADR-0011 §4 / bestdori-integration issue 05。
- Community 导入的谱面名称是否预填帖子标题（那是别人的谱）。
