# 16-下载源：CNB 与 GitHub

Type: grilling
Status: resolved
Blocked by: —

**来源**：用户 2026-10-25「当前产品支持 CNB 镜像源的版本更新，且默认 CNB，也可以手动切换到 GitHub」；`/grill-me` 拍板后**默认改为 GitHub**（可信优先），界面词定为「下载源」。语义写入 [ADR-0021](../../../docs/adr/0021-应用更新.md) §2–§3、[ADR-0022](../../../docs/adr/0022-发布链路拓扑.md) §7、`CONTEXT.md`「下载源」。本票跟踪落地。实现另开 session。

## 症状

国内已装用户检查 GitHub 经常失败或极慢。CNB 已有同一批安装包副本（票 15），但 updater 只认 GitHub，关于里不能换源。首次从 CNB 下手装之后，应用内更新仍打 GitHub。

## 根因

ADR-0021（2026-10-19）明确不做第二源：当时没有可达副本，双源会是空壳。票 07/15 把副本做成了「手点下载」，feed 契约未做。CNB 没有 GitHub 那种 `/releases/latest/download/latest.yml` 目录；yml 里还是 GitHub 相对文件名。

## 为什么在 release-pipeline

updater、release 渠道、CNB 镜像脚本都在本 effort。关于是同一能力的产品面，不另开 effort。

## 定案（用户 2026-10-25）

全文以 ADR-0021 §3 / ADR-0022 §7 为准。摘：

- 界面叫 **下载源**，不叫更新源。关于一行：GitHub（标默认）/ CNB；短名；单色站点标。说明：「检查更新时从这里获取安装包。CNB 是国内副本，可能稍晚。」未打包 / 浏览器不出现。
- 全体包默认 **GitHub**。不按地区、不按从哪下的包。不静默 fallback。
- CNB = GitHub 已 Publish 的同一 tag、同一字节副本。不允许 CNB 独发。sha512 跟 GitHub 构建产物。
- 本机 `app-state.json` 的 `updateSource: 'github' | 'cnb'`（缺省/非法 = github）。不进设置 JSON。
- 改源不立刻检查。下载中禁改源。已下完待重启可改源（这次包与立即重启不动）。
- 停在 CNB 且副本未跟上 → 「已是最新」，不每次解释时差。
- 连不上 GitHub 的人第一次拿到本选择器：CNB 发行页手下一遍。README / 发行说明写一句。
- 网络 / HTTP 失败（启动自动检查、手动检查、下载中断）每次 toast：「检查失败，可能是网络问题，可以尝试将下载源替换为 {另一个源}。」校验 / 磁盘 / 权限不提换源。
- **选择器与 CNB 匿名 generic feed 同一张票**；做不到 feed 就不合 CNB 选项。

## 实现落点（待下一 session）

- 镜像：`scripts/ci/ci-mirror-installers.mjs` 在转载附件之外，产出可匿名 GET 的 generic feed（改写/另发 yml，文件 URL 指向 CNB 上能直接下的安装包与 blockmap）。先查清 CNB 公开附件 URL，再接线；令牌不得打进客户端。
- 客户端：打包仍 `publish.provider: github`；运行时按 `updateSource` `setFeedURL`。扩 `electron/appState.cjs` 的 `patchAppStateSync`（现只写 `dataRoot`/`window`）。
- 关于：下载源一行 + i18n（zh-CN / en）。GitHub 标 lucide `Github`；CNB 标官方公开品牌的单色 SVG。
- 失败分类：网络/HTTP vs 校验/磁盘/权限；前者每次带换源句。
- README 双语：国内检查失败可从 CNB 手装一次，之后在关于里把下载源改为 CNB。
- 改 ADR 头注里的「非更新源」脚本注释，与 §7 对齐。

## 锁测

1. `tests/platform/electron/AppUpdate.test.ts`：GitHub publish 配置仍在；运行时 CNB 走 generic `setFeedURL`；未打包不调 updater；下载中改源被拒；ready 时可改源且仍能 install。
2. `tests/platform/electron/ElectronDataRoot.test.ts` 或新 `AppStateUpdateSource`：`updateSource` 落 `app-state.json`；缺省/非法 = github；与 dataRoot/window 共存。
3. `tests/unit/chart/config/AppSettingsAutoCheck.test.ts`（或设置导入导出用例）：导入 JSON **不含**、也不能改 `updateSource`。
4. `tests/dom/pages/SettingsPageAbout.test.tsx`：未打包无下载源；已打包有 GitHub/CNB；下载中控件禁用。
5. 失败文案：网络失败 toast 含「下载源」与另一个源名；校验类失败不含换源句。启动自动检查的网络失败也 toast（推翻 06「启动失败安静」）。
6. `tests/static/`：镜像脚本产出 generic feed（yml 不是原样 GitHub 相对路径当 CNB 根）；渲染进程不直连 electron-updater。
7. 真机（单测覆盖不到）：Publish 后 GitHub 源能更新；镜像齐后 CNB 源能更新；CNB 未跟上显示已是最新；国内断 GitHub 时失败句出现。

## Answer

已装包关于里可选下载源 GitHub（默认）/ CNB；偏好写 `app-state.json` 的 `updateSource`，不进设置 JSON。打包仍 `publish.provider: github`，运行时两边都 generic：GitHub `https://github.com/wuqiongjin/AAO-Editor/releases/latest/download`（不打 api.github.com）；CNB 先匿名 GET `https://cnb.cool/AsterPicker/AAO-Editor/-/releases?format=json` 取真实 tag，再 `.../-/releases/download/{tag}`（没有名为 latest 的 tag，也没有 GitHub 的 `/releases/latest/download`）。`latest.yml` 的 `url:` 本来就是文件名，拼在该 tag 目录下即可，CNB 现网如此、不必改成绝对 URL。网络/HTTP 失败（含启动自动检查、下载中断）toast 提换源；校验/磁盘/权限不提。真机验收见锁测第 7 条。失败态改源只记账、清 error，不立刻检查、不再 toast。

## Comments

### 2026-10-25 grilling 存档

- Q1=1：国内已装用户检查 GitHub 经常失败。
- Q2=A：改 ADR，双源 + 选择器。
- Q3=全体包同一默认。Q5=默认 GitHub（用户先要默认 CNB，拍板改为可信优先）。
- Q4=A：关于里持久切换，不静默 fallback。Q6=A：CNB 落后就「已是最新」。
- Q7=A：带选择器的第一版，打不开 GitHub 的人去 CNB 手装一次。
- Q8 被 Q19=B 收口：网络失败每次都提换源（含启动自动检查）。
- Q9=A：feed 与 UI 同一张票。Q10=B：不进设置 JSON。Q11=A：下载中禁改。Q12=A：`app-state.json`。
- Q13=A + 站点图标。Q14=A：改源不立刻检查。Q15=A：同一 tag 字节。Q16=A：ready 可改源、已下的包保留。
- Q17=A：单色标。Q18=A：短名 GitHub / CNB。Q20=A：中性「可能是网络问题」。Q21=B：只网络/HTTP 带换源句。
- Q22 先 A「更新源」，用户改口 B「下载源」（「更新源听着怪」）。
