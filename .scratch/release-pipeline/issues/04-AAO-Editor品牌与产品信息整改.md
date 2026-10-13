# 04-AAO-Editor品牌与产品信息整改

Type: grilling
Status: resolved
Blocked by: —

**来源**：用户 2026-10-12 确定正式产品定名「AAO Editor」（全称「Advanced Arrangement Organizer」），提供全套多尺寸与多格式设计图标，要求对全仓涉及产品品牌名称、图标资产、外壳标题及存储标识进行全面整改。

## 症状与背景

此前项目内部处于原型与基础期，产品名称分散在多个历史占位词中（如 `bangdream-editor`、`BangDream Editor`、`BD`），应用图标使用 Vite 默认的 `vite.svg`，Electron 打包 ID 残留测试前缀 `com.mocacoffee.bangdream-editor`，且底层存储与数据库名称统一使用 `bangdream.*` 前缀。随着产品正式品牌命名确立与全套图标设计交付，需要进行统一的品牌资产与元数据收敛。

## 根因与定案动因

产品尚未对外公开发布，不存在需要向下兼容的线上存量用户；因此无需设计复杂的数据迁移垫片层，直接一步到位将对外呈现与内部持久化标识清洗为 `AAO Editor` 与 `aao.*`。

## ADR 变更说明

- **Contradicts ADR-0003（工作台UI与配置系统）、ADR-0004、ADR-0005、ADR-0018**：
  此前 ADR 中关于 *“key 命名沿用 `bangdream.*` 前缀”*、`bangdream.chartproject`、`bangdream.assets` 的决定在此被正式推翻修订。修订结论：产品定名 AAO Editor，全仓持久化键统一收敛为 `aao.*`。

## 用户拍板定案（2026-10-12）

- **Q1 跟踪位置**：放在 `release-pipeline` 下统一跟踪。
- **Q2 产品名称与定位**：主名称 `AAO Editor`，全称 `Advanced Arrangement Organizer`，页面标题展示为 `AAO Editor · Advanced Arrangement Organizer`。
- **Q3 应用导航 Logo**：左侧 AppNav 顶部采用 `AAO-Editor-Icon-rounded-128.png` 渲染为 34×34px 图标，悬停 Tooltip 呈现 `AAO Editor · Advanced Arrangement Organizer`，无障碍 aria-label 为 `AAO Editor`（使用 `app.markAria` 词条）。
- **Q4 图标资产落位**：
  - `public/favicon.ico` + `public/icon.png` 替换原有 `vite.svg`；
  - `src/assets/brand/app-logo.png` 供前端导航使用；
  - electron-builder 构建各平台图标直接复用 `public/` 资产（`public/favicon.ico` 与 `public/icon.png`），避免根目录创建冗余 `build/` 文件夹；
  - `electron/main.cjs` 窗口图标适配开发态与生产打包态路径，并按平台区分 `.ico` 与 `.png`。
- **Q5 打包标识与存储命名空间**：
  - 产品从未正式发布，不保留历史迁移负担，彻底重命名；
  - `package.json` 的 `appId` 移除旧前缀，定为 `com.aao.editor`，`productName` 为 `AAO Editor`，`name` 为 `aao-editor`；
  - `localStorage` 键统一为 `aao.settings.v1`、`aao.currentProject.v1`、`aao.shortcuts.v1`；
  - `IndexedDB` 库名统一为 `aao.chartproject`、`aao.assets`；
  - 导出设置备份文件名改为 `aao-settings.json`。

## 实现落点

1. **静态图标资产落位**：
   - `public/favicon.ico`、`public/icon.png`；
   - `src/assets/brand/app-logo.png`；
   - `package.json` 的 electron-builder 配置直接复用 `public/` 图标，根目录不新建冗余 `build/` 目录；
   - 彻底删除 `public/vite.svg`。
2. **应用外壳与打包元数据**：
   - `package.json`：`name: aao-editor`, `appId: com.aao.editor`, `productName: AAO Editor`；
   - `index.html`：Favicon 指向 `/favicon.ico` 与 `/icon.png`，`<title>` 更新为 `AAO Editor · Advanced Arrangement Organizer`；
   - `electron/main.cjs`：BrowserWindow 显式配置 `title: 'AAO Editor'`，`resolveAppIcon()` 兼顾开发与生产打包态路径。
3. **UI 导航与多语言**：
   - `src/i18n/messages/zh-CN.json` 与 `en.json`：`app.name: AAO Editor`，`app.markAria: AAO Editor`，新增 `app.fullName: AAO Editor · Advanced Arrangement Organizer`；
   - `src/layouts/AppNav.tsx`：引入 `app-logo.png`，替换文字 `BD` 为图形图标，`aria-label={t('app.markAria')}`，添加 `title={t('app.fullName')}`；
   - `src/layouts/AppShell.css`：`.app-mark` 去掉硬编码深色底，新增 `.app-mark-img` 34×34px 样式；
   - `src/prototypes/PageShellPrototype.tsx`：同步更新占位标题。
4. **存储与数据库命名空间**：
   - `src/chart/config/AppSettings.ts`：`STORAGE_KEY = 'aao.settings.v1'`；
   - `src/chart/config/ShortcutConfig.ts`：`STORAGE_KEY = 'aao.shortcuts.v1'`；
   - `src/project/ChartProject.ts`：`DB_NAME = 'aao.chartproject'`；
   - `src/project/currentProjectPointer.ts`：`CURRENT_PROJECT_POINTER_KEY = 'aao.currentProject.v1'`；
   - `src/rendering/skin/backgroundSkin.ts`：`DB_NAME = 'aao.assets'`；
   - `src/pages/settings/SettingsPage.tsx`：下载备份文件名改为 `aao-settings.json`；
   - `tests/support/storage.ts`：测试替身 `SETTINGS_KEY = 'aao.settings.v1'`。
5. **领域文档与规范**：
   - `CONTEXT.md`：领域与实体定义更新为 AAO Editor。

## 锁测

- `tests/static/ProductIdentityWiring.test.ts`（新增）：
  1. 断言 `package.json` 元数据（name: `aao-editor`, appId: `com.aao.editor`, productName: `AAO Editor`）；
  2. 断言 `index.html` 标题与 favicon 指向（非 vite.svg）；
  3. 断言 `i18n` 字典包含正确的 `app.name` 与 `app.fullName`；
  4. 断言核心存储键不出现 `bangdream.`，全量收敛为 `aao.`；
  5. 断言 `AppNav.tsx` 引用品牌 logo 且无硬编码 `BD` 文字；
  6. 断言 `electron/main.cjs` 正确配置窗口标题与图标解析；
  7. 断言关键规格图标静态文件实际存在，根目录无冗余 build 夹，且 package.json 显式配置 electron-builder 图标。

## Comments

### 2026-10-12 拍板定案与实现记录
- **Round 1 Grilling 拍板**：
  - Q1: 选项 B，放入 release-pipeline 统一跟踪发布与外壳资产；
  - Q2: 选项 A，全称 Advanced Arrangement Organizer，页面标题与 ARIA 规范统一；
  - Q3: 选项 A，AppNav 采用 128px 圆角图标缩放至 34×34px 渲染；
  - Q4: 选项 A，全平台图标规格落地（.ico / .png）；
  - Q5: 选项 C，产品未发布，拒绝 mocacoffee 前缀，底层命名空间彻底重命名。
- **Round 2 Grilling 拍板**：
  - Q1: 选项 A，`appId` 确认为 `com.aao.editor`；
  - Q2: 选项 A，存储全量切换为 `aao.*`；
  - Q3: 选项 B，Logo Tooltip 显示全称 `AAO Editor · Advanced Arrangement Organizer`。
- **2026-10-12 Code Review 修复项**：
  - 修订 `electron/main.cjs` 中的图标路径解析，兼容打包生产态（`dist/`）与开发态（`public/`）；
  - `AppNav.tsx` 恢复绑定 `aria-label={t('app.markAria')}`，消除字典死代码；
  - `map.md` 剔除构建/测试状态冗余，恢复纯决策索引；
  - 票内补全症状/根因/ADR 修订声明/问答归档。
- **2026-10-12 根目录整洁化重构（方案 1）**：
  - 经审阅，删除根目录冗余的 `build/` 文件夹及其中重复图标文件；
  - `package.json` 中的 `build.win.icon` 显式指向 `public/favicon.ico`，`build.mac.icon` / `build.linux.icon` 显式指向 `public/icon.png`；
  - 消除与构建输出产物的认知混淆，保持根目录清爽。
- **2026-10-12 Windows 打包产物图标与属性异常归因修复**：
  - 症状：执行 `npm run electron:dist` 后 `release/win-unpacked/AAO Editor.exe` 仍为 Electron 原始原子图标，文件说明为 Electron，版权为 GitHub, Inc.。
  - 根因：`electron-builder` 打包时调用 7-Zip 解压依赖工具 `winCodeSign-2.6.0.7z`，其内部包含 macOS 平台的 `.dylib` 软链接；Windows 非管理员环境下无权限创建软链接导致 7-Zip 报错退出（exit code 2）。`electron-builder` 在未执行 `rcedit` 图标/属性注入及 NSIS 编译阶段即中断退出，留下了最初复制的未经修改的 Electron 模板二进制文件。此外，`package.json` 缺少 `author`、`description` 和 `copyright` 导致公司名称等元数据无法覆盖。
  - 修复：缓存目录安全解压 `winCodeSign-2.6.0`；在 `package.json` 补齐 `author: "AAO Editor"`、`description: "Advanced Arrangement Organizer"` 与 `build.copyright: "Copyright © 2026 AAO Editor"`。重新打包全流程成功通过（code 0），生成完整安装包与包含完整品牌图标和属性的 `AAO Editor.exe`。


