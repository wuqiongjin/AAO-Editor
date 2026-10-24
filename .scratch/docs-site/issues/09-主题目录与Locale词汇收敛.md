# 09 · 主题目录收敛与 Locale 词汇统一

Type: chore
Status: open（2026-10-24 开票；未开工，排期在票 06 英文正文补写之后）

## 来源

同一批评审（2026-10-24）：多语言被拆成四套并行词汇，`theme/` 根目录 9 项发散，
`landingCopy.ts` 事实是一套私有 i18n 微框架。与票 06 的英文正文补写错开做。

## 症状 / 根因

- **Locale 标识三套并行**：URL 世界 `localeIndex` 用 `'root'|'en'`，TS 类型
  `Locale = 'zh-CN'|'en'`，landingCopy 用对象键；`useSiteLocale.ts` 两处手工映射。
  加第三语言要同步改四处，漏一处即静默错。
- **`landingCopy.ts` 是私有 i18n 微框架**：230 行扁平字典 + `cap01b1` 位置键名 +
  `bulletsOf()` 运行时扫键到第一个 `undefined` 为止；且 `docDesc` 与 `config.ts`
  两个 locale 的 `description` 抄了两遍。
- **`theme/` 根目录发散**：`components/`(3) + `composables/`(4) + 6 个平级文件，
  landing* 与 chrome* 两类关注点混在同一层。

## 范围

1. Locale 单一词汇表：`Locale` 直接采用 localeIndex 键（`'root'|'en'`），删
   `useSiteLocale.ts` 的手工映射，`COPY` 改键；`NavLangSwitch` 的 `'zh-CN'|'en'`
   判断随之收敛。
2. 目录收敛：`theme/landing/`（landingCopy / landingMedia / landingTypes /
   landing.css / Landing.vue）、`theme/chrome/`（NavLangSwitch / NavThemeToggle /
   site-chrome.css / useSiteChrome）；`composables/` 只留 useCarousel / useRotor /
   useSiteLocale。
3. landingCopy 结构化：能力块文案改数组 + 语义键，删 `bulletsOf` 扫键与 `cap01b1`
   位置键；`docDesc` 收敛为 config.ts description 的单一来源（或反向）。
4. 顺带清理：`socialLinks` 已删而 `site-chrome.css` 仍 `!important` 藏
   `.VPNavBarSocialLinks`——重叠机制，二选一。

## 锁测

行为等价重构：`npx vitepress build` 通过；Playwright 中 / 英 × 1440 / 375
落地页与文档页无横向溢出、无控制台报错（照票 01 实测口径）。

## Comments

- 2026-10-24 评审开出。
