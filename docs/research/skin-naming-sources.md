# 皮肤命名来源盘点（音符 / 轨道 / 背景）

> 调研日期 2026-10-22 · 目的：确定「皮肤的有意义命名」从哪来——为命名方案决策提供事实依据。
> 结论只服务决策；票内引用本文，不复制数据。**不是决策**；决策走 ADR（预计修订 ADR-0018 §1 的命名口径）。
> 关联：[ADR-0018 表演背景与场地皮肤包的选择模型](../adr/0018-表演背景与场地皮肤包的选择模型.md)、
> `docs/research/sim-asset-variants.md`（仿真场素材种类盘点）、`.scratch/chart-preview/issues/41`（定案记录）。

## 1. 现状：名字从哪来、用户在哪看到

| 类别（CONTEXT 术语） | 注册表（素材快照仓生成，应用仓只消费） | 当前显示名 | 用户可见位置 |
| --- | --- | --- | --- |
| 音符皮肤（noteskin，7 普通 + 5 方向键） | `src/rendering/skin/gen/noteSkinRegistry.gen.ts` | `label: "Skin 00"`… | 素材页整包预设卡 `AssetsPage.tsx:118`；六条目选择 pill `NoteSkinPreview.tsx:139-142` |
| 场地皮肤包（fieldskin，33 包） | `src/preview/video/sim/gen/simAssetPacks.gen.ts` | **无名字段，UI 直接渲染包 ID** | 预览页设置面板缩略网格 `PreviewDisplayPanel.tsx:321`（`skin00` / `skin_maid` / `collabo23_summer_g`…） |
| 表演背景（bgskin，快照内 4 包 / 完整策展 24–25 包） | 同上 `background` 段 | 同上，包 ID | 同上 |
| 键音（对照先例，非本次范围） | `src/audio/gen/keySoundRegistry.gen.ts` | i18n `keysound.pack.skin00` = “官方键音 00” | 音频页 `AudioPage.tsx:356` |

两个关键事实：

1. **"Skin 00" 是手写的**——来自已删除的 `scripts/fetch-target-note-skins.mjs` 的 `label` 字段
   （git `7d482708` 可证），不是任何权威来源；取件侧迁出后（release-pipeline 02）label 随快照再生，来源依旧是人写。
2. **ADR-0018 §1 定「显示名 = 包 ID」**，其 Considered Options 记录「人工给每个包起中文显示名」被否：
   33 个轨道包里 15 个是 `skin01`–`skin14` 编号包“起不出名”，且要多维护一份清单。
   **该定案是在不知道本文 §2.2 的官方命名 API 存在的情况下做的。**

## 2. 来源查证（逐个实测）

### 2.1 素材仓自身：无名称 ❌

- 包清单 JSON（`https://bestdori.com/api/explorer/jp/assets/ingameskin/<cat>/<pack>.json`）= **纯文件名数组**（2026-10-22 实测 `noteskin/skin00`、`fieldskin/skin_maid`）；
- `.sprites` = 精灵矩形定义；`.bundle` 按取件策略跳过。
- **素材本身不带任何人类可读名称**，命名只能外求。

### 2.2 Bestdori 官方皮肤命名 API ✅（核心发现）

四个端点，**仅 v3 存在**（`.all.1.json` / `.all.2.json` 均 404）：

```
https://bestdori.com/api/skin/notes.all.3.json             音符皮肤
https://bestdori.com/api/skin/directionalFlicks.all.3.json  方向键皮肤
https://bestdori.com/api/skin/lanes.all.3.json             轨道皮肤（= fieldskin）
https://bestdori.com/api/skin/backgrounds.all.3.json       表演背景（= bgskin）
```

- 结构：`{ "<序号>": { assetBundleName: "<包名>", skinName: [jp, en, tw, cn, kr] } }`。
  服务器顺序 `jp → en → tw → cn → kr`（与 Bestdori 生态 `servers` 常量一致；本地化键 `ja/en/zht/zhs/ko`）。
- **directionalflicks 的 `assetBundleName` 不带 `directionalflick` 前缀**（API 返回 `skin00`，
  消费方拼 `directionalflick` + `skin00` = `directionalflickskin00`，与本应用包 ID 一致）。
- 编号错位坑：音符 **skin05 = TYPE7、skin06 = TYPE6**（官方序号 6/7 与包号交叉）。
- 本地化回落：编号轨道包（skin00–04/12/13）的 en 服未填、回落日文（`レーンスキン00`）；
  背景包的 tw/cn 未填、回落日文（`デフォルト背景`）。乐队名 / 活动名条目五服齐全。
- 该 API 即 Bestdori Sonolus 官方皮肤站（`sonolus.bestdori.com/official/skins`）的命名来源。

### 2.3 Bestdori Sonolus 皮肤站的 fallback 约定 ✅（补无官方名的包）

生成器 `NonSpicyBurrito/sonolus-bandori-skin-generator`（MIT，v1.3.3）命名逻辑 =
**有官方名用官方名；没有就清洗包 ID**：

```
clean(id)：剥 skin / skin_ / directionalflickskin 前缀
         → 按 "_" 分词 → 每词首字母大写 → 空格连接
```

例：`skin_maid` → “Maid”；`skin_persona` → “Persona”；`collabo23_summer_g` → “Collabo23 Summer G”；
`skin_april_2024` → “April 2024”；`habahiro` → “Habahiro”。该站展示的组合名
（“April 2024 / Persona / Maid”“Hello, Happy World! Lane”）即由此生成，可信度与一致性有保证。

## 3. 覆盖率（对照本应用实际取件的包，2026-10-22）

| 类别 | 有官方名 | 无官方名（主题包） |
| --- | --- | --- |
| 音符皮肤 | **7/7**（skin00–06） | — |
| 方向键皮肤 | **5/5**（skin00–04，与音符同号同名 TYPE1–5） | — |
| 场地皮肤包 | **15/33**（skin00–14） | 18：`collabo23_summer_g` `habahiro` `skin_april2019` `skin_april2021` `skin_april_2024` `skin_bike` `skin_cafe` `skin_coin` `skin_collabo24_autumn_i` `skin_collabo25_autumn_s` `skin_delta` `skin_gbp2020` `skin_maid` `skin_miku` `skin_persona` `skin_satan` `skin_stage` `skin_witch` |
| 表演背景 | **4/25**（skin00–04 + skin_teamlivefestival 中的 4；完整策展集下 6/25） | 21（轨道主题包同名 + `skin_5th` `skin_collabo23_winter_d` `skinpractice`） |

## 4. 与 ADR-0018 的关系

> _Contradicts ADR-0018 §1 Considered Options_：人工起名被否的理由（“编号包起不出名”）
> 对**轨道皮肤已不成立**——官方 API 恰好给 15 个编号包起了名，其中 8 个是乐队名
> （Poppin'Party / Afterglow / Pastel＊Palettes / Roselia / Hello, Happy World! / Morfonica /
> RAISE A SUILEN / MyGO!!!!! Lane），信息量远高于编号。
> 但**音符皮肤的官方名仍是 TYPE1–7**（五服一致、与游戏内一致），对“看不懂编号”的用户
> 提升有限——音符类的辨识主力仍是缩略图（ADR-0018 §1 已定网格形态）。

## 5. 待拍板（命名方案决策的输入）

> 2026-10-22 当日已由用户四问拍板完毕，决策落点：[ADR-0018 §6](../adr/0018-表演背景与场地皮肤包的选择模型.md)
> （官方 > 社区 fallback > 包 ID；中文取 cn 服优先；TYPE 错位照官方；键音不在范围）、
> 实现票 `.scratch/chart-preview/issues/49-皮肤显示名接入官方命名映射.md`。以下问题清单留档。

1. 命名源优先级：官方 API > 社区 fallback > 包 ID（推荐此序）？
2. 无官方名的主题包（轨道 18 + 背景 21）：fallback 生成英文显示名（“Maid”/“Collabo23 Summer G”，
   与 Sonolus 站一致、零维护）vs 人工起中文名（最易懂但要维护映射、易起争议）vs 保留包 ID？
3. 中文显示名：官方 cn 服条目优先（“Poppin'Party的按键条皮肤”）vs 统一自译（“Poppin'Party 轨道皮肤”）vs 官方 jp 原文？
4. 音符 TYPE 错位（skin05=TYPE7 / skin06=TYPE6）：照官方显示（与游戏内一致）vs 按包号重排？
5. 落地形态建议（非决策）：命名映射由**取件侧**拉四个 `*.all.3.json`、随 gen 注册表一起生成进快照
   （照 `noteSkinRegistry.gen.ts` 先例，与二进制同版本）；应用侧只查表不联网（合 ADR-0011 §2）；
   设置仍存包 ID，显示名走 i18n 消息表（照 `keysound.pack.*` 先例）→ 老设置零迁移。

## 附 A：官方名完整映射（本应用实际取件的包）

### A.1 音符皮肤（notes.all.3.json，7/7，五服同名）

| 包 ID | 官方名 |
| --- | --- |
| skin00 | TYPE1 |
| skin01 | TYPE2 |
| skin02 | TYPE3 |
| skin03 | TYPE4 |
| skin04 | TYPE5 |
| skin06 | TYPE6 |
| skin05 | **TYPE7**（错位） |

### A.2 方向键皮肤（directionalFlicks.all.3.json，5/5）

`directionalflickskin00–04` ↔ API `skin00–04` = TYPE1–TYPE5（与同号音符包同名）。

### A.3 场地皮肤包（lanes.all.3.json，15/33 有官方名）

| 包 ID | jp | en | cn（简中） |
| --- | --- | --- | --- |
| skin00 | レーンスキン00 | レーンスキン00（回落） | 按键条皮肤00 |
| skin01 | レーンスキン01 | レーンスキン01（回落） | 按键条皮肤01 |
| skin02 | レーンスキン02 | 〃 | 按键条皮肤02 |
| skin03 | レーンスキン03 | 〃 | 按键条皮肤03 |
| skin04 | レーンスキン04 | 〃 | 按键条皮肤04 |
| skin05 | Poppin'Partyのレーン | Poppin'Party Lane | Poppin'Party的按键条皮肤 |
| skin06 | Afterglowのレーン | Afterglow Lane | Afterglow的按键条皮肤 |
| skin07 | Pastel＊Palettesのレーン | Pastel＊Palettes Lane | Pastel＊Palettes的按键条皮肤 |
| skin08 | Roseliaのレーン | Roselia Lane | Roselia的按键条皮肤 |
| skin09 | ハロー、ハッピーワールド！のレーン | Hello, Happy World! Lane | Hello, Happy World!的按键条皮肤 |
| skin10 | Morfonicaのレーン | Morfonica Lane | Morfonica的按键条皮肤 |
| skin11 | RAISE A SUILENのレーン | RAISE A SUILEN Lane | RAISE A SUILEN的按键条皮肤 |
| skin12 | レーンスキン05 | 〃 | 按键条皮肤05 |
| skin13 | レーンスキン06 | 〃 | 按键条皮肤06 |
| skin14 | MyGO!!!!!のレーン | MyGO!!!!! Lane | MyGO!!!!!的按键条皮肤 |

其余 18 个主题包无官方名 → fallback 显示名：`skin_maid`→Maid、`skin_persona`→Persona、
`skin_miku`→Miku、`skin_cafe`→Cafe、`skin_coin`→Coin、`skin_bike`→Bike、`skin_stage`→Stage、
`skin_witch`→Witch、`skin_satan`→Satan、`skin_delta`→Delta、`skin_gbp2020`→Gbp2020、
`skin_april2019`→April2019、`skin_april2021`→April2021、`skin_april_2024`→April 2024、
`collabo23_summer_g`→Collabo23 Summer G、`skin_collabo24_autumn_i`→Collabo24 Autumn I、
`skin_collabo25_autumn_s`→Collabo25 Autumn S、`habahiro`→Habahiro。

### A.4 表演背景（backgrounds.all.3.json）

| 包 ID | jp | en | cn |
| --- | --- | --- | --- |
| skin00 | デフォルト背景 | デフォルト背景（回落） | デフォルト背景（回落） |
| skin01 | ストーリーイベント背景 | 〃 | 〃 |
| skin02 | チャレンジイベント背景 | 〃 | 〃 |
| skin03 | 対バンイベント背景 | 〃 | 〃 |
| skin04 | ライブトライイベント背景 | 〃 | 〃 |
| skin_teamlivefestival | フェスイベント・ライブ背景 | 〃 | 〃 |

语义：默认背景 / 故事活动 / 挑战活动 / 对邦活动（対バン，对抗活动）/ Live Try 活动 / 演唱会·Live 背景。
当前快照内的 `skin_miku`、`skinpractice` 及完整策展集其余主题包无官方名 → 同 A.3 fallback。

## 附 B：API 复核补记（2026-10-22 当晚，issue 49 实现轮实测）

实现 `pickSkinName` 前对四个端点做了逐条字符级复核，补三条白天没抓到的数据事实（应用侧选服逻辑按此实现，锁测实例见 `tests/unit/rendering/skin/SkinDisplayName.test.ts`）：

1. **NBSP 变体（轨道 skin09 的 cn 条目）**：`lanes.all.3.json` 序号 10（`skin09`）的 cn 条目实为
   `Hello,\u00A0Happy\u00A0World!的按键条皮肤`——词间是 NBSP（U+00A0）而非普通空格，肉眼与普通
   空格无异。四个端点全表扫描仅此一处含 NBSP。照官方数据显示会把不可见空格带进 UI（影响检索 /
   排版）→ 应用侧选服规则定为**含 NBSP 的条目当不可用、跳过该服取下一服**（zh-CN 下 skin09 因此
   显示 en 条目「Hello, Happy World! Lane」）。
2. **`null` 条目（轨道 skin14 的 kr 条目）**：序号 15（`skin14`）的 kr 条目为 JSON `null`（非空串）。
   选服实现按「非字符串即不可用」处理，en 界面不取 kr 故无感；取件侧生成 `skinName` 时按五服原样
   保留即可，无需把 null 洗成空串。
3. **白天记为"未填回落"的服当晚已填（同值）**：编号轨道包（skin00–04/12/13）的 en 服已填（与 jp
   同值 `レーンスキン00`）、背景包 tw/cn 已填（与 jp 同值 `デフォルト背景`）——即 §2.2 的回落描述
   对这两类已过期，但回落链末端同值，**显示结果不变**（cn 有值就直接取 cn）。选服的"空串跳下一服"
   规则作为通用兜底保留（防将来再出现未填）。
