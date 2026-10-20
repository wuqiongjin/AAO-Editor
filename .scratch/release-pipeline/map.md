# Map: 发布流水线与素材分发

> Effort: `release-pipeline` · 2026-10-07 · 开于 chart-preview 04 后票 + 用户"GitHub Actions 自动发版"诉求（原名 `release-packaging`，同日改宽）

## Destination

本 effort 是**构建 / 发布 / CI 的家**（素材分发是首个消费者；用户 2026-10-07 确认）：GitHub Actions 自动发版，**发布物携带 Bestdori 素材、仓库不含二进制**；发版链路**不依赖 Bestdori 在线**（走 release 镜像）；素材分发边界与 ADR-0011 §4 / issue 05 结论一致。

**边界**（建议，用户可调）：CI / workflow / 缓存 / 构建矩阵 / 签名与公证 / 自动更新（electron-updater）/ release 渠道与版本策略归这里；素材**抓取链**（`fetch-*.mjs` 的演进）仍归 bestdori-integration / basic-editor；应用功能不归。

## Notes

- 现状口径**分裂**：skins（43 文件 / 1.9MB）+ 键音（12 mp3 / 244KB）**已入库并随包**（basic-editor/29「产物入库、离线零配置」+ bestdori-integration/02，2026-09-12 拍板维持捆绑）；fieldskin / bgskin 原**两处都不进**（chart-preview/04，dev 中间件直读）。本 effort 收敛这个分裂——运行时二进制一律迁出 git、收进 `public/`、经**外部快照仓库**分发（02 落地）。
- 关键区分：**仓库里有没有 ≠ 发布物里有没有**。本 effort 只改前者，**不降版权风险档**（降档 = 用户自备 / 运行时拉取，见 bestdori-integration/05 风险梯度；退役捆绑另行拍板）。
- 仓库目前**没有任何 CI 配置**（无 `.github/`、无 `.cnb.yml`）——发版管线是从 0 建。
- 仿真场只需要 `skin00` 一包（场地 ≈56KB + 背景 ≈636KB），"发布物携带"的增量可以很小；全量归档不必进包。

## Decisions so far

- [2026-10-07 用户拍板] 形态 = **CI 构建期注入**（安装包内嵌素材、仓库不含二进制）；**否决**"release 附素材包 + 用户自己导入"（原话："用户要自己导入，有门槛"）。
- [2026-10-07 用户拍板] 素材源 = **release 镜像为主**，不每回拉 Bestdori（原话："bestdori 万一维护了就完了"）——发版链路与 Bestdori 在线状态解耦；碰 Bestdori 只发生在"更新镜像"那一步。
- [2026-10-07 用户三答] ① 发布范围 = **内部**（仓库 + release）；② 已入库的 skins / 键音 **迁出 git**（`git rm --cached`，历史不清）；③ 镜像 = **构建选集**（几 MB，不做全量归档备份）。
- [2026-10-11 票 03 · 实现口径，用户已验收] 运行时素材 URL **一律跟构建 base**（`import.meta.env.BASE_URL`），不许写死站点根 —— Electron 生产包是 `file://`，绝对路径会解析到磁盘根。
- [2026-10-11 用户拍板] 用户可见文案**只陈述事实、不摆开发者命令**：`npm run …` 是对开发者的话术（打包应用的使用者跑不了）；同理**不猜失败成因**（"没取件"与"路径解析不到"在这一层无法区分）→ 空态改为中性一句「加载失败 + 缺什么 + 可能原因」。取件入口只在 `package.json` / `scripts/README.md`。
- [2026-10-14 票 05 · 用户拍板] README = **中英双文件**（`README.md` 中文默认 + `README.en.md` 全量对等，静态锁测防双语腐烂）；**LICENSE = MIT**（© 2026 AAO Editor，仅覆盖代码、不覆盖 Bestdori 素材，声明区块说清）；README 兼作宣传视频脚本素材，功能叙事以**谱面工程管理**为锚点、只述已发布功能；截图/GIF 落 `docs/media/readme/`，Electron 专属画面列本地补拍清单，随「公开分发」复审一并放行。
- [2026-10-19 票 06 · 用户拍板] **应用更新**（ADR-0021）：已安装包检查 GitHub 正式 Release、下完请重启；关于页；自动检查进设置对象；不做第二源。验收改口：手动结果 toast；就绪改立即重启；稍后下次仍查发行；导语不承诺下载。
- [2026-10-19 票 07 · 用户拍板] **CI 拓扑（ADR-0022 Accepted）** = CNB 工作台（门禁 + 向 GitHub 单向**非 force** 镜像 main/tags + cron 国内 release 副本）/ GitHub 公开面孔（代码镜像 + 三平台发版矩阵 + 正式 Release 直发）；GitHub PR 走人节奏回流；素材 = GitHub Actions 直连 CNB（`CNB_TOKEN` 只读 secret，不建第二个仓、不 pin ref）；门禁 = test + build + assets:check（lint/test:types 存量债另排）；签名本期不做。
- [2026-10-20 票 08 · 用户拍板] 云开发取件凭据 = **平台个人环境变量**（平台 secret 注入 `ASSETS_SOURCE`，整地址含只读令牌，`use_in_slugs` 限本仓）；`assets-sync.mjs` 凭据候选链降级兜底；漫游令牌文件 / shell rc source 行 / `.cnb.yml` vscode 挂载 hook 于验收后清理。

## Frontier

- [01 素材分发与发布策略（CI 构建期注入 + release 镜像）](./issues/01-素材分发与发布策略.md) — open（拍板已毕 2026-10-07；迁移子集由 02 落地，CI / 发版链路由 07 承接，07 实现完成时本票一并 resolved）
- [02 素材迁出与内部镜像同步（无 CI）](./issues/02-素材迁出与内部镜像同步.md) — resolved（**主仓与素材解耦**：外部快照仓库自治（素材 + 生成注册表 + 抓取/构建/`update.sh` 自更新），主仓只 `npm run assets:sync` 取件、不含素材工具与 SHA 清单；实现 857f45bd，2026-10-09 用户验收通过）
- [03 打包态（file://）仿真场素材读不到：素材前缀写死站点根](./issues/03-打包态仿真场素材读不到前缀写死站点根.md) — resolved（2026-10-11 用户验收通过）：素材前缀改跟 `import.meta.env.BASE_URL`（素材本就在包里，是 file:// 下绝对路径解析到磁盘根）
- [04 AAO-Editor品牌与产品信息整改](./issues/04-AAO-Editor品牌与产品信息整改.md) — resolved（2026-10-12 定案：产品定名 AAO Editor（Advanced Arrangement Organizer），全套图标落位，元数据/外壳/UI/存储键收敛为 aao.*）
- [05 README与LICENSE整改](./issues/05-README与LICENSE整改.md) — resolved（2026-10-14 定案并落地：双语 README + MIT LICENSE + 媒体实测 + 锁测；本地补拍清单与公开化门禁见票内）
- [06 应用更新](./issues/06-应用更新.md) — resolved（2026-10-19 客户端落地；发版 CI / 签名 / 国内第二源不在本票）
- [07 CI与发版链路](./issues/07-CI与发版链路.md) — resolved（拍板完成 = ADR-0022；实现按票内落点推进，完成时 01 一并 resolved）
- [08 云开发取件凭据自举](./issues/08-云开发取件凭据自举.md) — resolved（2026-10-20 用户验收通过：凭据改走平台个人环境变量注入 `ASSETS_SOURCE`，脚本候选链兜底；清理漫游令牌文件 / rc source 行 / `.cnb.yml` vscode 挂载 hook）
