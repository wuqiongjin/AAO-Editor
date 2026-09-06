Type: task
Status: resolved（2026-09-06 实现：琥珀主题色收敛单出口绘制、仅数值、外侧装饰文字系统 gutterLabels.ts + 单测）
Blocked by:

## Question

BPM 线现状（`src/visual/render.ts`）：

1. 线被画了**两遍**——`renderNotes` 的 BPM 分支在音符瓦片里画正红虚线（`strokeStyle='red'`，dash [5,5]），`renderBpmNumbers` 每帧再画 `#ff6666` 实线 + 文字；正红刺眼，影响谱面观感（用户反馈）。
2. 文字带 `BPM ` 前缀（`fillText(\`BPM ${bpm}\`)`），用户要求只显示数值。
3. 文字锚定 `textX = trackStartX - 80`、字号 `12 * scale`、纵向偏移 `15 * scale`——缩放过程中字号与位置动态变化，用户要求"永远贴在轨道外侧边缘、距离恒定，像轨道外面的一个装饰"。

grill 定案（2026-09-06，Q1/Q2）：

- **配色 = 低饱和主题色（三线三色方案）**：BPM 线 → 琥珀（基准 `#e0a458`），文字用同色系更亮一档（如 `#f2c078`）；具体色值实现时可按实机观感微调，方向为"低饱和、不抢音符"。
- **文字 = 仅数值**（如 `120`），不带 "BPM" 前缀。
- **外侧装饰文字系统**（本 issue 建立基础实现，供 START/END 与实时显示线复用）：
  - 贴**轨道左外缘**恒定 CSS 像素间距（6px，右缘对齐该点）；
  - 恒定 CSS 像素字号（12px，**不随 scale 缩放**）；
  - BPM 数值垂直居中于线；
  - beat 0 的 BPM 音符与起始线同 Y 时：START/END 文字优先，BPM 数值自动向谱面外侧错开（见 issue 52）。

## 期望

- [ ] 两套 BPM 线绘制收敛为一套（瓦片内红虚线移除或同色化，避免旧样式从瓦片透出；线+数值统一走动态层）。
- [ ] 任意缩放（Ctrl+滚轮 / 工具栏 ± / 双击复位）过程中：数值文字与轨道左外缘距离恒定、字号恒定。
- [ ] 文字只显示数值；正红不再出现（grep `#ff6666`/`'red'` 于 BPM 绘制路径清零）。
- [ ] 外侧装饰文字锚定逻辑收敛为可复用纯函数（输入 scale/trackGeometry/线 Y，输出画布坐标），供 issue 52/54 复用并有单测。
- [ ] 谱面画布缩放锚定回归不受影响（issue 50 修复的锚定不变量测试保持绿）。

## Comments

- 2026-09-06 实现+验收闭环：gutterLabels.ts 锚定系统 + renderBpmNumbers 琥珀单出口 + 让位/堆叠钳制（起始贴底边时数值堆叠到 START 上方，"都在谱面范围内"优先）；GutterLabels.test.ts 11 例。实机验收（Playwright）：左沟槽检出琥珀数值像素、放大后锚定恒定。

## 第二轮修订（2026-09-06 grill，用户反馈驱动）

用户实测反馈 5 点，grill 定案（Q1=A/Q2=A/Q5=B + 新 BUG）：

1. **文字太小** → 基准字号 12→14px，新增设置 `display.labelScale`（50%–300% 滑杆，默认 100%），
   作用于 BPM 数值/START/END/实时信息全部沟槽文字。
2. **START/END 抢占 BPM 数值位置** → 双带制：BPM 数值内带（gap 8px），START/END 外带
   （gap = 8 + ceil(14×labelScale×2.2) + 8，随文字大小系数动态放大，100% 时 47px）——水平分带
   互不抢占；**让位/堆叠规则删除**（bpmLabelPlacement 移除），BPM 数值恒定居中于线，
   仅保留画布内钳制；沟槽过窄放不下文字时整体隐藏（优雅降级）。
3. **BPM 线颜色仍偏红橙** → Q5=B：跟随轨道颜色主题主色（`gridThemeBpmColor` = 主题 beat 层色）。
4. **BPM 线覆盖音符（BUG）** → renderChart 编排拆层：`renderBpmLines`（音符层之下，与轨道线同层
   语义）/ `renderBpmLabels`（沟槽层）。
5. **文字与轨道距离随缩放变化（BUG，先于本 issue 的几何不一致）** → 根因：renderGrid 边条绘制
   宽度 ×es，但 `trackGeometry`/`effectiveScale` 按 9px 不缩放预留——高倍下边条越过 trackStartX
   侵入左沟槽、轨道整体偏心 (9es−9)/2 px。修复：外框 chrome 预留与绘制一致化（均 ×es），
   `effectiveScale` fitWidth 分母改为 W/(210+18)。文字锚点（trackStartX − gap）随之恢复真恒定。

验收增补：labelScale 滑杆生效并持久化；双带间距恒定（跨缩放像素级不变）；BPM 线在音符之下；
窄沟槽优雅降级。

## 第三轮补修订（2026-09-06，用户反馈）

- **字号基准再上调**：labelScale 100% 即原 150% 观感 → 常显标线基准 14→**21px**、实时信息 11→**16.5px**
  （"实时信息小一档"比例保持）。外带间距公式随基准联动（100% 时 63px）。
- **实时信息右侧读数右移**：右锚点从"轨道内容右缘 + 8px"改为"轨道**右外缘**（含外框 chrome）+ 8px"——
  原锚点会陷进右侧边条内（与第五点 chrome 几何修复同源）。

## 第四轮补修订（2026-09-06，用户反馈）

- **START/END 文字贴线**：above/below 的纵向间隙 4→**0**（文字盒边缘贴线）——与 BPM 数值
  骑线（居中、距离 0）的观感一致。水平双带分带保证互不冲突。
