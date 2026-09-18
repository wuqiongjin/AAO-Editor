# 117 · Electron 数据根目录

Type: grilling
Status: open（2026-09-18 `/grill-with-docs` 已拍板，待实现）
Blocked by: —

## 来源

用户要求「支持更改数据文件保存路径」。经 grill 收窄：只改 **Electron 自动落盘的根目录**，不是设置对象、不是导出对话框。

## 定案（用户 2026-09-18）

1. **一个数据根**（用户选文件夹）。其下约定子目录：谱面工程 `projects/`、背景皮肤图文件（固定文件名，**不是**第二套路径设置）。
2. **仅 Electron** 出现「更改保存位置」；浏览器保持 IndexedDB / localStorage，无路径 UI。
3. 改根 = **搬家**（工程 + 背景图一起）；成功才切根，失败保持旧根并报错。
4. 默认根 = 现有 `app.getPath('userData')`（与 issue 25 布局兼容：`…/projects/<id>/{project.json,audio.bin}`）。
5. **不在范围**：设置对象改路径（仍 localStorage）；「导出配置」范围不动。

与 issue 25 冲突：25 拍过「不新增设置项」。本票 **推翻那一条中「工程根不可配」**；自动选后端（Electron 文件 / 浏览器 IDB）仍成立。25 文末 Comments 交叉引用，不合入 25。

## 实现落点

- 主进程：数据根读写 + 目录选择对话框 + 搬家（拷/移失败回滚）+ 现有 `project:*` 改走当前根。
- 背景图从 IndexedDB `bangdream.assets` 文件化到数据根下（Electron）；浏览器仍 IDB。
- 设置页（Electron）增加只读路径 + 更改按钮；**不进**「导出配置」JSON。

## 锁测

- 纯逻辑：根路径规范化、id 白名单仍防穿越、搬家失败不切根。
- IPC / 真磁盘：Electron 手工验收（改根 → 退出重开工程与背景仍在；失败时旧根数据完好）。
- 浏览器路径：静态断言无「更改保存位置」入口。

## Comments

- 2026-09-18 grill：Q3=P1+P3（P4 拆到 118）；Q8=A 单根；Q10=A 仅 Electron；Q11=A 搬家。
