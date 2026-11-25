# ガルパ实机：Opening / 判定 / AP Combo / 结算（对照动态预览）

> 调研日期 2026-10-26 · 服务 `chart-preview` 票 50–52。
> 只记可复核的事实与本仓对照，不做决策。决策走票内 grilling。

## 0. 结论速览

| 段 | 游戏实机 | 本仓动态预览现状 | 根因类型 |
| --- | --- | --- | --- |
| Opening（曲目信息片头） | 进 live 前的夹克画面 + 淡入场地 + 轨道浮现；期间有现场人潮环境音 | **仅导出物**演 6.75s 四段交叉淡；实时预览从谱面 0 秒起；开场段无声 | 票 30 定案 11「只在导出里演」+ 票 31 环境音未拍板；不是绘制漏了 |
| 判定文字 | PERFECT / GREAT / GOOD / BAD / MISS，命中时出 | **没有** | ADR-0016 §1.2 首期明示不含；§6 写「不需要 judgeskin」 |
| Combo AP 态 | v6.2.0「コンボ状態表示」：从开场起全 PERFECT 时 **combo 变色** | Bestdori `digits`/`combo` 精灵 + 命中弹跳；**无 AP 变色** | 票 21 对齐 Bestdori 模拟器（它没有 AP 态） |
| 谱面结束 | 中央章（AP / FC / 无）→ 过渡 → 结算画面 | 播到谱面长度 **停在末帧**；导出视频在此切断 | 时间线没有「后置段」；`stopAtEnd()` 就是终点 |

口径冲突的已有定案：**Bestdori 参照与游戏打架时优先游戏**（票 24 / 48）。Opening / HUD / 结算这三块，现状仍是「Bestdori 模拟器为首期对标」（ADR-0016 票 01 定案 2），所以看起来像 Bestdori / 不像实机——这是**范围取舍**，不是实现漂了。

## 1. 游戏 Opening（曲目信息画面 → 入场）

实机进 live 的视觉顺序（夹克画面是玩家最认的「Opening」）：

1. **夹克画面**（加载期常驻）：黑底 + 音符/星装饰 + 方形封面 + 难度色 L 形垫层 + 难度徽章 + 全宽标题条 + 乐队 + **作詞 / 作曲 / 編曲**。
2. 淡到 **live 场地**（3D / Live2D 角色在台上；本编辑器没有角色层）。
3. **轨道**（场地图 + 判定线）浮现。
4. BGM 起、音符开始接近。期间人潮环境音掐掉。

对照本仓票 30（已落地 `src/preview/video/opening/`）：

| 项 | 游戏 | 本仓 |
| --- | --- | --- |
| 四段结构（淡入 → 停留 → 入场 → 轨道） | 有，时长跟加载，不钉死 | 定稿 1 / 2.2 / 1.75 / 1.8 = **6.75s**（2026-10-27 回填） |
| 装饰 | 游戏 UI 素材，可带微闪 | 程序化路径自绘；布点按截图拟合；用户第五轮评「装饰基本 OK」 |
| 封面比例 | 票 30 注释：游戏约 **0.383 H** | `OPENING_COVER_RATIO = 0.45`（2026-11-15 定版，从 0.48 调小；链坐标仍相对白条） |
| credits | 夹克上常驻 作詞/作曲/編曲 | 绘制层有 `OpeningCredits`（票 39），**工程没有对应字段**；`PreviewPage` 用 `(project as { credits })` 取值，实际恒空 |
| 谁演 | 每次进 live 都演 | **只在导出物里演**（ADR-0016 §5.1 / 票 30 定案 11） |
| 声 | 人潮环境音，BGM 起掐掉 | 开场段无声；票 31 待拍板 |
| 角色 / 舞台 3D | 有 | 无，也不该在本编辑器做 |

「优化 Opening 更接近游戏」因此不是「票 30 没画出来」，而是：**实时预览缺整段、credits 无数据、环境音未做、以及用户仍觉得不对的观感差**（需用户点名；装饰/四段时长已拍板钉死）。

## 2. 判定文字

游戏判定五档：PERFECT / GREAT / GOOD / BAD / MISS。

- Combo 在 GREAT 及以上不断（官方 FAQ：「コンボ数 = GREAT 以上连续成功次数」）。
- GOOD 及以下断 combo；BAD / MISS 扣生命。
- PERFECT 窗口社区常用值约 **±40 ms**（非官方表，仅作量级）。
- FAST/SLOW 是选项，只在 GREAT/GOOD/BAD 时出，PERFECT 不出。
- 判定字落点（2026-10-26 录屏逐帧）：**场中央一条、判定线上方 ~0.09 H**，宽 ~0.15 W；不跟轨道左右移动（双轨同时命中仍只有一条）。见 `gbp-live-recording-BV1BDapzbEdX.md` §3。

本仓：

- `drawSimFrameAt` 图层 = 场地 → 带体 → 同时点击线 → 音符 → **打击特效** → **combo**。没有判定层。
- 打击特效是 Bestdori `particles.png`（票 21），**不是**判定字。
- `judgeskin` 在 basic-editor 票 29 / ADR-0003 登记为「未来 Auto 预览判定显示」，ADR-0016 §6 写「本期不需要」。抓取脚本已迁出主仓（release-pipeline 02）。

预览不是玩家手打。要出判定字，必须先定 **Auto 的判定档**：永远 PERFECT（像一次人类 AP），还是游戏「オートライブ」那种专用 **AUTO** 判定（官方 FAQ：オートライブ判定只有 AUTO、结算不显示判定内译）。

## 3. Combo 的 ALL PERFECT 态

官方来源：

- [v6.2.0 更新（2022-06-03）](https://bang-dream.bushimo.jp/news/20220603/post-292) 加「コンボ状態表示」。
- [官方 FAQ「ライブ演出・音量設定」](https://bang-dream.bushimo.jp/faq/)：ON 时，从 live 开始全部 PERFECT（ALL PERFECT 状态）则 **「コンボ表示の色が変わります」**。游戏选项里可关。

这就是用户说的「ALL PERFECT 状态下的 Combo 数特效」：不是另做一套 combo 计数，而是 **AP 续航时 combo HUD 变色**。一旦出现非 PERFECT，变色结束（combo 数字本身还在，只是回到常色）。

本仓 combo（票 21）：Bestdori `digits.png` + `combo.png`，锚点 `0.85W × 0.4375H`，命中 0.2s 弹跳。Bestdori 模拟器没有 AP 变色，所以这边也没有。

若预览永远 PERFECT，combo **全程**处在 AP 变色态——这是预期，不是 bug。

## 4. 谱面结束后的三段

游戏在最后一音 / 曲终之后：

1. **中央章**
   - ALL PERFECT：2021-07-10 起有专用演出；彩虹「ALL PERFECT!」**替换** FULL COMBO 条（[4Gamer](https://www.4gamer.net/games/356/G035692/20210712021/) / [TV Tropes](https://tvtropes.org/pmwiki/pmwiki.php/VideoGame/BangDreamGirlsBandParty)）。
   - FULL COMBO：有 GREAT 或以上、无 GOOD 及以下。
   - 普通 Clear：中央**不盖章**，直接进结算过渡。
   - FAILED：生命归零（预览无关）。
2. **入结算前的过渡**（闪白 / 分数滚动等；含角色庆贺——本编辑器无角色）。
3. **结算画面**：分数、分数等级、判定内译、最大 combo、AP/FC 标记、编成卡、奖励。

官方「不是真人打」的两种模式（FAQ）值得对照，避免做成游戏自己都不用的结算：

| 模式 | 判定 | 结算 |
| --- | --- | --- |
| オートライブ | 专用 **AUTO** | **不显示**判定内译；分数相关不记录 |
| リハーサル・デモプレイ | 自动进行，用来看节奏 | 演示向；用了快进/快退则 combo 重置、结算分数与判定不显示 |

本仓结束行为：`simPlayback.stopAtEnd()` 在 `seconds >= duration` 时 pause + seek(duration)，画面停在场地末帧。导出时间线 = `OPENING_SECONDS + duration`，没有后置段。

分数 / 等级 / 编成 / 奖励 **无法从谱面单独算真**：它们依赖卡组、技能、fever、活动倍率。预览里做「看起来像结算」只能是 **视觉仿造**，数字要么省略，要么用 Auto-PERFECT 的内译（全 PERFECT、combo = 可击打物总数）。

## 5. 素材边界（2026-10-26 核验）

取件通道不变：外部快照 + `npm run assets:sync`。主仓不复活 `fetch-bestdori-skins.mjs`。Bestdori CDN **无 `Access-Control-Allow-Origin`**，浏览器直读不行。

| 用途 | 上游 | 这轮能不能拿到 PNG/MP3 | 缺了怎么办（票 51/52 Q12） |
| --- | --- | --- | --- |
| 判定字 | `ingameskin/judgeskin/skin00` → `judge.png` 512×256 + `.asset` 切图 | **能**。精灵：`judge_perfect` (0,177,287×79)、`great` / `good` / `bad` / `miss` / `auto` / `fast` / `slow`。本期 Auto 只用 perfect | 留空或纯字，不准造假徽章 |
| AP combo 变色 | 官方 FAQ 只说改色；Bestdori `sprites/jp/{digits,combo}.png` 已在仿真场 | 不必新图；染色是便宜路径 | 观感不够再找游戏图集 |
| 中央章 / AP·FC 标记 | 疑在 `ingameskin/stageskin/{normal,challenge,versus}` 的 `RhythmGameUI.png` / `UICommon.png` | 清单里有文件名，CDN `_rip` **返回站点 HTML**，PNG 没撕到。`stamp/` 是角色聊天章，不是 live 章 | 留空或纯字 |
| 人潮环境音 | `sound/common/SE_RHYTHM_GAYA.mp3` | **能**。~7.1 s / 128 kbps / 151 KB（「ガヤ」= 现场嘈杂） | 程序化白噪声+滤波顶上（票 31） |
| 章/结算 SE（未点名） | 同包 `SE_RHYTHM_FULLCOMBO` 16 KB、`SE_RHYTHM_CLEAR` 36 KB、`SE_UI_STUMP` 10 KB、`SE_RHYTHM_CUTIN_AUDIENCE` 49 KB | 能拉到 mp3 | 本轮没点名结尾出声，实现前另问 |

判定资源其它包：`habahiro` / `skin_april2019` / `skin_bike` / `skinapril2021`（主题换皮，默认仍 `skin00`）。

- 角色 3D / Live2D / 技能切镜 / fever：**本请求未列入**，且超出仿真场能力。

实机录屏逐帧（用户 `b23.tv/U5WR1ev` / `BV1BDapzbEdX`）见 `docs/research/gbp-live-recording-BV1BDapzbEdX.md`。判定字开着；中央章是彩虹圆体 logo 不是系统字；结算页 2 是舞台底 + 左立绘 + 右白卡片。

## 6. 本仓时间线（改这三块会碰到）

```
现状导出：  [Opening 6.75s 人潮] [谱面 duration：仿真场 + BGM/键音]
现状预览：  [谱面 duration：仿真场 + BGM/键音]  → 停在末帧

若 Opening 进实时预览：从 0 起播才演；中途 seek 不重演（否则拖进度会卡 5 秒片头）。
若加结算后置：导出总长 = Opening + 谱面 + Ending；预览播完不立刻停，接着演章 + 结算。
```

播放条量程、时间码、导出进度、`OPENING_SECONDS` 偏移都会动。Opening 进预览还会改票 30 定案 11。

## 7. 分数公式调研（2026-11-08 · 票 72 Q8）

用户提问：满分按 **1,000,000**，每个音符多少分是否取决于这张谱面的音符数；若有官方公式可优先。

**结论：官方没有公开逐音符分数公式。**

- 官方 [SYSTEM 页](https://bang-dream.bushimo.jp/system) 只介绍「节奏游戏 / 故事」玩法，全文**无**分数计算、单 NOTE 得分、满分值、判定倍率或総合力口径（2026-11-08 实读）。官方 FAQ 对 オートライブ 只说「分数相关不记录」（见 §4 表），也不给公式。
- 社区逆向拆解（**非官方**，结构互相印证、倍率数值却不一致）：
  - [巴哈姆特 2017](https://forum.gamer.com.tw/C.php?bsn=31877&snA=186) / [PTT 2017](https://www.pttweb.cc/bbs/MusicGame/M.1489861194.A.8C8)：每个 NOTE(PERFECT) 分数 = `總和力 × Lv加成 / NOTE數`，`Lv加成 = 3 + (歌曲Lv − 5) × 0.03`；判定倍率 PERFECT 100% / GREAT 90% / GOOD 80% / BAD·MISS 0%；COMBO 分段加成（0–20 +0%、21–50 +1% … 700+ +11%）。基本生命 **1000**（BAD −60 / MISS −100 / 滑条中继点 −50），与 `HUB-sample.png` 的 `1000/1000` 对得上。
  - [NGA 2024](https://bbs.nga.cn/read.php?tid=40055211)：单键得分 = `基础分 × 判定倍率 × 卡组倍率 × 技能倍率 × FEVER倍率 × COMBO倍率`；基础分由谱面决定、同一首歌各键型相等；PERFECT 110% / GREAT 80% / GOOD 50%；combo 倍率 20→1.01 … 700→1.11。
  - 两版判定倍率不一致（100/90/80 vs 110/80/50）⇒ 玩家实测拟合，不能当官方口径用。

**对本项目的可用性**：

- 公式里的総合力 / 歌曲 Lv / 卡组 / 技能 / 活动倍率在谱面工程里都不存在 —— §4 的「分数无法从谱面单独算真」仍成立，社区公式无法套用。
- 但其结构支持用户推测：**同一谱面内每个可击打物基础分相等、基础分与 NOTE 数成反比**。倍率归一后自洽的做法是 `score = floor(1_000_000 × 已命中数 / 可击打物总数)`，全 PERFECT 打满 = 1,000,000。
- **1,000,000 不是ガルパ官方满分**（实机分数随总力变化），是本仓预览用的归一上限；票面 / UI 不得宣称它是官方分数。
- 可击打物总数复用既有 combo 口径：`src/chart/editing/NoteEditing.ts` 的 `comboNodePreciseBeats` / `countChartNotes` 与 `src/preview/video/sim/simField.ts:189-194,351-362` 的 `hitTimes`（单键 / 方向键各 1、滑条逐非 hidden 结点、同拍多轨各算 1、`beat < 0` 计 combo 但不渲染）。
