# CONTEXT（领域上下文）

> ⚠️ **文档权威性标注**：`docs/plans/` 目录内容多为基础期产物、可能过时，且**不纳入版本控制、未来不会上仓库**。权威依据仅以下两处：
> - **决策/规则** → `docs/adr/`（ADR，纳入版本控制）。
> - **术语** → 本文件（CONTEXT.md）词汇表。
> 实现与评审以 `docs/adr/` 与本文为准；`docs/plans/` 仅供历史参考，冲突时以 ADR 为准。

本文件的词汇为**通用语言**（Ubiquitous Language）。涉及"音符覆盖/滑条"的术语与规则以 [ADR-0001 音符覆盖与滑条规则](./docs/adr/0001-音符覆盖与滑条规则.md) 为准；编写代码、issue、测试、方案时使用下文术语，勿漂移到同义词。

## 领域

BanG Dream / Bestdori 自制谱编辑器。谱面代码 = Bestdori 风格 JSON 数组（见 `docs/plans/谱面代码规则文档.md`）。

## 核心实体

| 术语 | 英文 | 说明 |
| --- | --- | --- |
| 谱面 | Chart | 整份可编辑的音符集合（`ChartNote[]`） |
| 音符 | Note | 谱面中的基本元素，见下方各类型 |
| 谱面代码 | Chart code | Bestdori 风格 JSON 数组，编辑器内部数据 ↔ 代码的双向映射产物 |
| beat / subBeat | beat / subBeat | 时间坐标；subBeat 为细分，未设置时视为 `0` |
| lane | lane | 轨道编号 `0..6`（共 7 道） |

## 音符类型

| 术语 | 英文 / 类型 | 说明 |
| --- | --- | --- |
| 单键 | Single | 普通单点音符 |
| 滑键 | Flick | 带 `flick` 标记的单键 |
| 技能键 | Skill | 带 `skill` 标记的单键 |
| 方向键 | Directional | `LDirectional` / `RDirectional`，带 `length`（1..3） |
| 滑条 | Slide | 由多个**结点**（connections）组成的连线 |
| 长条 | Long | 由多个 connections 组成（与滑条同构） |
| BPM 线 / System | BPM / System | 非击打类元素 |

## 滑条相关（重点）

| 术语 | 英文 | 说明 |
| --- | --- | --- |
| 滑条结点 | Node / connection | 滑条的一个连接点，含 beat/lane/subBeat 及可选 `flick`/`skill` 标记 |
| 端点 | Endpoint | 滑条的**头部**（`e0`）与**尾部**（`eN`）结点 |
| 中间节点 | Middle node / pathway | 滑条两端点之间的途经结点（`m1..m_{N-1}`），亦称"途径结点" |
| 覆盖 | Overwrite | 把音符放置到已有音符/结点所在位置的处理 |
| 拆条 | Split | 从滑条中拆出部分，得到独立音符与/或更短的滑条 |
| 组合 | Combine | 滑条与滑条的端点合并（合并为一条更长的滑条） |

## 交互状态

| 术语 | 说明 |
| --- | --- |
| 组合状态 | 工具栏的组合模式开关；语义 = "将选中的普通音符连接成滑条"（进阶功能） |

> 规则细节：见 [ADR-0001 音符覆盖与滑条规则](./docs/adr/0001-音符覆盖与滑条规则.md)。
