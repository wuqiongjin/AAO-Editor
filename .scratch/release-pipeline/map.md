# Map: 发布流水线与素材分发

> Effort: `release-pipeline` · 2026-10-07 · 开于 chart-preview 04 后票 + 用户"GitHub Actions 自动发版"诉求（原名 `release-packaging`，同日改宽）

## Destination

本 effort 是**构建 / 发布 / CI 的家**（素材分发是首个消费者；用户 2026-10-07 确认）：GitHub Actions 自动发版，**发布物携带 Bestdori 素材、仓库不含二进制**；发版链路**不依赖 Bestdori 在线**（走 release 镜像）；素材分发边界与 ADR-0011 §4 / issue 05 结论一致。

**边界**（建议，用户可调）：CI / workflow / 缓存 / 构建矩阵 / 签名与公证 / 自动更新（electron-updater）/ release 渠道与版本策略归这里；素材**抓取链**（`fetch-*.mjs` 的演进）仍归 bestdori-integration / basic-editor；应用功能不归。

## Notes

- 现状口径**分裂**：skins（43 文件 / 1.9MB）+ 键音（12 mp3 / 244KB）**已入库并随包**（basic-editor/29「产物入库、离线零配置」+ bestdori-integration/02，2026-09-12 拍板维持捆绑）；fieldskin / bgskin **两处都不进**（chart-preview/04，dev 中间件直读）。本 effort 收敛这个分裂。
- 关键区分：**仓库里有没有 ≠ 发布物里有没有**。本 effort 只改前者，**不降版权风险档**（降档 = 用户自备 / 运行时拉取，见 bestdori-integration/05 风险梯度；退役捆绑另行拍板）。
- 仓库目前**没有任何 CI 配置**（无 `.github/`、无 `.cnb.yml`）——发版管线是从 0 建。
- 仿真场只需要 `skin00` 一包（场地 ≈56KB + 背景 ≈636KB），"发布物携带"的增量可以很小；全量归档不必进包。

## Decisions so far

- [2026-10-07 用户拍板] 形态 = **CI 构建期注入**（安装包内嵌素材、仓库不含二进制）；**否决**"release 附素材包 + 用户自己导入"（原话："用户要自己导入，有门槛"）。
- [2026-10-07 用户拍板] 素材源 = **release 镜像为主**，不每回拉 Bestdori（原话："bestdori 万一维护了就完了"）——发版链路与 Bestdori 在线状态解耦；碰 Bestdori 只发生在"更新镜像"那一步。
- [2026-10-07 用户三答] ① 发布范围 = **内部**（仓库 + release）；② 已入库的 skins / 键音 **迁出 git**（`git rm --cached`，历史不清）；③ 镜像 = **构建选集**（几 MB，不做全量归档备份）。

## Frontier

- [01 素材分发与发布策略（CI 构建期注入 + release 镜像）](./issues/01-素材分发与发布策略.md) — open（待拍板：发布范围 / skins+键音是否迁出 git / 镜像粒度）
