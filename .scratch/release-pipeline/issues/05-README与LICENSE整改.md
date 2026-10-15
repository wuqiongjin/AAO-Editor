# 05-README与LICENSE整改

Type: grilling
Status: resolved
Blocked by: —

**来源**：用户 2026-10-14 述求「完善本仓库的 README 和 LICENSE，以便后续制作宣传视频，并让普通用户知道大概的产品功能」。

## 背景事实（本轮查证）

- 根目录 `README.md` 为 Vite 模板原文，仓库无 `LICENSE` 文件。
- 产品定名 AAO Editor（Advanced Arrangement Organizer，票 04 定案），从未正式公开分发；`.scratch/docs-site` 已定「VitePress 文档站 + GitHub Pages、中文优先、只述已发布功能」——README 与文档站分工：README 是仓库门面 + 宣传视频素材库，使用文档归 docs-site。
- 本机素材齐全（`public/assets/skins/` skin00–06 + 方向键皮、`public/assets/sim/` fieldskin/bgskin/sprites、键音 mp3），web 视图截图可行；Electron 专属面（社区网络桥、数据根、系统标题栏、素材缓存区块）浏览器不存在或降级，须本地补拍。
- 代码查证：`src/` 无任何 AI 制谱 UI、i18n 零词条——ADR-0012/0013 先行于实现，AI 制谱未落地。

## 定案（用户 2026-10-14 三轮拍板）

1. **双语 README**：`README.md`（中文，默认）+ `README.en.md`（英文），英文版**全量对等翻译**（否决精简节译——半译必腐烂）；两文件顶部各放语言互链。
2. **LICENSE = MIT**，版权行 `Copyright (c) 2026 AAO Editor`。专利条款评估：Apache-2.0 的专利授权对不持专利的个人作者是空头支票，且带来 NOTICE/变更声明负担；切换成本为零（无下游用户），将来有公司主体或持专利贡献者再升级。LICENSE **仅覆盖本仓代码**，不覆盖 Bestdori 素材（声明区块说清）。
3. **README 内容范围 = 产品向 + 轻量开发者小节**（环境要求 / install / assets:sync / dev / build / test）；不做架构导览（深水区归 `CONTEXT.md` + `docs/adr/`，README 只放指路链接）；所有外链（仓库地址、下载页）仓库内不存在，一律醒目占位。
4. **只述已发布功能**（沿用 docs-site 纪律）：AI 制谱未实现 → 整体剔除，不做 roadmap 渲染；仿真场/视频导出是已 shipped 的基本功能 → 列入但只做事实陈述、排在功能列表后段，不写「亮点」式修辞。
5. **功能叙事顺序（工程管理锚点，宣传视频脚本骨架）**：① 谱面工程管理（一首歌一个工程、多谱面/难度/封面/状态/复制、四种新建入口）→ ② 专业谱面编辑（滑条/拆条/组合、SP 缓动与画笔、BPM 与倒流、快捷键系统）→ ③ 谱面预览与谱面图 → ④ Bestdori 互通（曲库/导入/上传发布）→ ⑤ 仿真场回放与视频导出 → ⑥ 素材与个性化 → ⑦ 本地优先。每条功能 bullet 带一句用户价值，宣传视频可直接取用。
6. **截图与 GIF**：落位 `docs/media/readme/`（两语言共用、相对路径引用、纳入「随仓库公开一并复审」门禁）。GIF 两枚：**GIF-A 新建谱面工程流程**（工程启动台四入口 → 工程详情 → 工作台；四入口完整版仅 Electron 可拍）与 **GIF-B 画布编辑深度**（滑条工具 SP 缓动段 / 画笔自由段；web 可拍）。README 中未到的图留 `<!-- TODO(本地补拍) -->` 占位注释。
7. **非官方声明区块**（履行 bestdori-integration/05 缓解义务，中英各一段，docs-site 关于页可复用）：非营利粉丝工具、与 Bushiroad / Craft Egg / BanG Dream! 无关联；素材版权归 © BanG Dream! Project；MIT 仅覆盖自身代码；「请联系我们移除」两处留占位（仓库公开后回填 issue 链接）。
8. **公开化门禁**：README 媒体素材（截图/GIF 含游戏素材衍生视觉）随「公开分发」决策一并复审，联动 bestdori-integration/05（未结票）。

## 本地补拍清单（用户本机 Electron，README 占位对应）

- [ ] 应用窗口整体（系统标题栏 + AppNav 34px 图标）
- [ ] 工程启动台**四入口完整版**（官方谱 / 社区谱导入两支在浏览器被隐藏）
- [ ] 选曲面板（曲库浏览 / 搜索 / 试听条）
- [ ] Bestdori 账号授权与上传发布流程
- [ ] 设置页「数据目录」区块（打开 / 更改 / 占用）
- [ ] 设置页「社区素材缓存」区块（占用查询 / 清除）
- [ ] GIF-A：新建谱面工程四入口完整流程

## 实现落点

- `LICENSE`（MIT）；`README.md` / `README.en.md`（双语对等 + 声明区块 + 截图占位 + 轻量开发小节）。
- `docs/media/readme/`：本轮 web 实拍截图与 GIF-B；GIF-A 与 Electron 面占位。
- 静态锁测：断言 `README.en.md` 存在、两文件语言互链存在、章节标题集合一致（防双语腐烂）。

## 锁测

- `tests/static/` 新增双语 README 布线断言（文件存在 / 互链 / 章节一致）。
- 截图与 GIF 的可用性由本轮 dev server + Playwright 实测；Electron 面进上方手工验收清单（浏览器跑不了，无法单测）。

## Comments

### 2026-10-14 拍板存档
- Round 1：Q1=A 中文为主+英文节→**用户修正为分文件双语**（README.md 中文默认 + README.en.md，后确认为全量对等）；Q2 用户对专利授权存疑 → 解释后定 MIT；Q3=A 版权行 `AAO Editor`；Q4 用户指正本机素材齐全（修正助手基于 10-08 旧记录的误判），并提出素材借用的版权顾虑 → 定「现在实拍 + 声明区块 + 公开化门禁」；Q5=B；Q6=A（只述已发布）；Q7=A（README 兼作宣传视频脚本素材）；Q8=本 effort 建票。
- Round 2：Q1=A 全量对等 + 锁测；Q2=MIT；Q3=A 实拍+声明+门禁（用户提醒：部分画面仅 Electron 可拍，须本机补拍）。
- Round 3：Q1=OK（`docs/media/readme/` + 补拍清单 + 占位注释）；Q2 **用户否掉 GIF ①仿真场（"bestdori 都有，不算新颖"）与 ③**，指出独特点是谱面工程管理与新建方式 → GIF 改选新建工程流程 + 画布编辑深度；Q3 **用户纠正重点**：视频导出缺漏大、只实现基本功能，AI 制谱未实现 → 叙事重排为工程管理锚点，视频导出降为事实陈述项；Q4=OK 声明区块文案。
- Round 4（终轮）：Q1=OK；Q2=OK 新叙事顺序；Q3=A 视频导出正常列入、只述事实。设计树清空，开工。

### 2026-10-14 实现记录（用户已答完三轮，本会话落地）

- **`LICENSE`**：MIT，`Copyright (c) 2026 AAO Editor`（1067 B）。
- **双语 README**：`README.md`（中文默认）+ `README.en.md`（英文全量对等，13 个章节同构），顶部语言互链；功能叙事按定案顺序（工程管理锚点），每条 bullet 带用户价值句，宣传视频可直接取用；视频导出只作事实陈述、列后段；AI 制谱按「只述已发布」整体剔除。
- **媒体**（`docs/media/readme/`，dev server + Playwright chromium headless、locale zh-CN、视口 1440×900 实测）：
  - 截图：`project-hub` / `project-detail` / `workspace` / `workspace-curve` / `chart-code` / `static-preview` / `simulation` / `shortcuts` / `assets`（.png）；
  - `gif-canvas-editing.gif`（620×648，71 KB）：曲线工具链式点击 4 点、SP 缓动段逐步烘焙；
  - `sheet-export.png`（1400×4434，580 KB）：预览页「导出 → 开始导出」实测产物（原件 2312×7324，已缩放入 README）。
  - 示范谱为手工编制（Sine InOut / Expo InOut 两条 SP 曲线、BPM 120→150、方向键、Long、技能键、flick），经「完整谱面代码」对话框应用；演示数据只存在于 Playwright 临时 profile，不影响用户本机浏览器。
- **锁测**：`tests/static/ReadmeBilingualWiring.test.ts`（8 条：双文件存在 / 互链 / 章节同构 / 图片集一致且存在 / 声明三要素 / 非 Vite 模板 / LICENSE MIT / 补拍占位 / dev.sh 指引）。全量 `npm test` 257 文件 3035 用例通过。
- **已知事项**：`LICENSE` 首次写入后一度消失（原因未明），已重写；锁测含存在性断言看守。README 外链（仓库地址 / 下载页 / Issues / docs-site）均为占位，待仓库公开与首发 release 回填。
- **门禁提醒**：`docs/media/readme/` 含 Bestdori 素材衍生视觉，随「公开分发」决策一并复审（联动 bestdori-integration/05 未结票）。
