# 30 · 编辑工程信息曲目归属改只读与LLSIF下线

Type: grilling
Status: resolved (2026-10-13)

## 来源

用户 2026-10-13 提出：
1. 「编辑工程信息」弹窗中应删除 LLSIF 曲目（无法获取资源且无官方谱面）；
2. 针对 BanG Dream 官方曲目，下方的「曲库 id」不应允许随意输入，初拟改为弹窗重新导入（换源），并提供是否覆盖现有信息的选项；
3. 经 `/grill-with-docs` 深入推演与讨论后，确认在已有工程上搞“换源覆盖”是伪需求且有极大逻辑冲突（音、画、BPM、谱面会脱节），决定剥离该伪需求，使弹窗回归纯粹。

## 症状 / 根因

- **历史包袱**：原 `EditInfoDialog`（`ProjectDialogs.tsx`）采用了一个 `<select>`（custom/bandori/llsif）与原生数字输入框 `<input value={sourceId}>`，属于早期未打磨的临时实现。
- **概念混淆**：`曲目来源`（Song source）在领域模型中仅代表“向 Bestdori 社区发布时的曲目归属指针”，不是本地导入的入口。暴露可编辑的 ID 框误导用户认为这里应该支持“重新选歌/换源”。
- **LLSIF 已成死节点**：Bestdori API 的 LLSIF 资源走未白名单域名（`card.niconi.co.ni`），无 7 键官方谱，且社区帖早已过滤掉 LLSIF，界面上留着 LLSIF 毫无意义。

## 定案（用户 2026-10-13）

1. **彻底取消“修改曲目归属 / 换源”能力**：
   - 曲目归属是工程创建时确立的固有属性（从官方曲导入即 official，空白创建/导入本地音频即 custom）。
   - 彻底移除弹窗中的 `<select>` 与 `sourceId` 输入框。
   - 保留的合法操作正交清晰：
     - 改封面、改工程名、改歌手：在「编辑工程信息」弹窗内自由修改；
     - 换音频：在「音频页」进行，换后由底层（`projectAudio.ts`）自动将归属改写为 `custom`；
     - 导入/追加谱面：归入工程详情页「谱面列表区」（后续迭代落地）；
     - 想要一首新歌：在工程启动台「新建工程」。
2. **曲目归属改为只读徽标展示（透明化）**：
   - 在编辑弹窗内展示一行只读状态（无任何输入框）：
     - 若 `source.type === 'bandori'`：展示为只读徽标 `BanG Dream 官方曲 (#<id>)`；
     - 若 `source.type === 'custom'`：展示为只读徽标 `自定义曲目`。
   - 保存时不再由用户输入推导 `source`，保持 `project.source` 不变。
3. **彻底下线 LLSIF**：
   - 从界面与 i18n 字典中彻底移除 LLSIF 选项；
   - 存储反序列化层对旧版可能残留的 `llsif` 做平滑降级（归一为 `custom`）。
4. **锁定红线守护**：
   - 若工程包含已上传谱面，依既有 ADR 保持音频与发布归属锁定。

## 修法

1. **`src/pages/projects/components/ProjectDialogs.tsx`**：
   - 重构 `EditInfoDialog`：移除 `sourceType`、`sourceId` 内部状态；
   - 移除 `<select>` 与曲库 ID `<input>`，改为轻量只读徽标；
   - 保存时不重写 `source`（或直接透传 `project.source`）。
2. **`src/pages/projects/projectFormat.ts`**：
   - 清理 `parseSource` 中的 `llsif` 分支或收敛。
3. **`src/project/ChartProjectRecord.ts`**：
   - 反序列化读取器中对 `llsif` 兼容回退为 `custom`。
4. **`src/i18n/`**：
   - 清理已废弃的 LLSIF 键（`projects.sourceLlsif`），增补只读徽标相关文案。
5. **`CONTEXT.md`**：
   - 更新「曲目来源」词条，记录 LLSIF 正式废弃与工程信息改只读徽标定案。

## 锁测

1. `tests/static/ProjectDetailHeadLayout.test.ts`：
   - 调整票 37 中关于 `projects.sourceLlsif` 等键的旧断言，对齐最新键集。
2. `tests/static/EditInfoDialogNoRawInput.test.ts`：
   - 断言 `EditInfoDialog` 不再包含任何 `<select>` 标签与 `sourceId` 输入框；
   - 断言只读胶囊徽标与说明问号按钮存在。
3. `npm run test:unit` 与 `npx tsc -b` 全绿。

## Comments

### 2026-10-13 验收回修（第二轮）
1. **外部点击无法关闭 Popover 根因定位与修复**：
   - 原 `document.addEventListener('mousedown', ...)` 走的是冒泡阶段。但 `Dialog.tsx` 在 `.dialog` 顶层节点挂了 `onMouseDown={(e) => e.stopPropagation()}`（用于阻止弹窗内点击冒泡到背景 scrim 触发误关弹窗），React 的合成事件 `stopPropagation` 会直接调用底层的 `nativeEvent.stopPropagation()`，导致弹窗内其他任何元素的 `mousedown` 都无法冒泡到 `document`。
   - 此外原先 `ref={helpRef}` 挂在了外层的 `.dialog-field` 上，点击同字段下方的徽标被判定为内部点击。
   - **修复**：改在 `window` 捕获阶段（`capture: true`）监听 `pointerdown` 事件（涵盖鼠标、触屏与笔触），在任何元素触发 `stopPropagation` 之前即执行检查；并将 `ref={helpRef}` 精确收拢至 `<div className="dialog-field__label-left">`。点击弹窗内其他任何区域均能瞬间自动收起气泡。
2. **彻底解决底部横向滚动条**：
   - 在 `.dialog__body` 上显式设置 `overflow-x: hidden`，从根本上防止横向滚动条穿透。
   - `.dialog-source-pill` 与 `span` 增设 `min-width: 0; box-sizing: border-box;`，确保超长文件名在 flex 容器中按预期省略截断，不再撑开父级容器宽度。
3. **右侧布局进化为 4 行通栏规范流与音轨条整合（第三轮打磨）**：
   - **整合音轨条（`.dialog-audio-bar`）**：原先将「设置音频」按钮置于右上方标签行，导致按钮悬空在右侧大片空白中、与被管理的音频文件名脱节；现将音频行整合为 DAW 风格的通栏音轨控制条（高 32px，与上方输入框完全同高），左侧展示音频声波图标与文件名/时长，右侧内嵌「设置音频」按钮，操作与资产一体化。
   - **语义化图标彻底去重**：
     - 音频行：采用 `<AudioLines size={13} />`（波形线条，专属音频资产）；
     - 官方曲目：采用 `<Disc3 size={12} />`（实体唱片/单曲 CD，代表官方发售曲号 `#1`）；
     - 自定义曲目：采用 `<Tag size={12} />`（标签，代表本地/自定义归属）；
     - 彻底摒弃双音符重复图标。
   - **信息权重动线与顺序定案（曲目归属放最末）**：
     - 行 1：工程名称（最常用，可写）
     - 行 2：歌手（常用，可写）
     - 行 3：音频（核心关联资产，带管理操作）
     - 行 4：曲目归属（不可编辑的底层出生元数据，作为只读属性底注）
     - 遵循“高频编辑 -> 关联媒体 -> 只读元数据”从前到后的视觉动线，交互流不再被只读徽标打断。
4. **悬浮气泡向上展开与箭头指示（彻底消灭纵向滚动条）**：
   - 气泡原向下展开会顶破 `.dialog__body` 的底部内边距，触发纵向滚动条并裁切说明内容；
   - 现调整为向上展开（`bottom: calc(100% + 8px)`），并带有指向问号的三角描边指示箭头；向上浮动在宽裕的上方空间，零溢出风险。
5. **右侧舒展排布与舒适高度（响应再高一点的要求）**：
   - 撤销此前过度收缩的 30px / 7px 压缩排版；
   - 恢复规范的 32px 舒适控件高度（输入框与音轨控制条），字段间距定为 10px，字段内部留白 5px；
   - 右侧总高调整为 244px，纵向视线舒展自然，告别拥挤压迫感。
6. **长音频名称动态播放效果重构（彻底告别左右横晃与文字截断）**：
   - **摒弃往返摇摆（Ping-Pong）**：往返来回切向运动会在视觉上造成类似摆钟的左右横晃眩晕感，且边缘渐变 mask 会遮挡两端字符；
   - **全面采用流媒体播放器工业标准（双联单向无缝传送带）**：
     - 单向左行（向左匀速滑行），绝不反向左右横晃；
     - 开头静止停顿 2.5s（占 25% 周期），方便静心阅读开头文件名；
     - 匀速单向滑行（约 32px/s 自然阅读语速），尾部时长与扩展名完全展示后，紧随 48px 呼吸间隔无缝滑入第二份副本；
     - 副本到达原点瞬时无缝衔接，再次静止停顿 2.5s；
     - 移除两端裁切遮罩（mask-image），全流程每一个文字 100% 清晰完整可见；
     - 鼠标悬停时暂停播放（`hover: paused`）。



7. **清除官方原版音频防御与曲目来源自动降级（定案解法 2）**：
   - **背景**：此前导入官方曲目后若在音频管理页点击「清除」，本地工程将失去原版音频文件导致谱面画布静音不可逆。但此前 `clearProjectAudio` 不动 `source`，导致工程在本地无音频的状态下依然挂着官方曲目来源。
   - **解法 2 落地**：
     - **非官方曲目（自定义曲）**：点击「清除」直接清空，无任何二次确认弹窗，保持日常轻量操作流程；
     - **官方原版曲目（`source.type === 'bandori'`）**：点击「清除」弹出二次确认弹窗 `ConfirmDialog`，清晰警示「清除音频后，本地谱面画布将无法播放原版音频，且曲目来源将变更为「自定义曲目」（无法自动恢复为官方曲）。确定要清除吗？」；
     - **底层改动**：`clearProjectAudio`（`src/audio/projectAudio.ts`）在清空音频时正式将 `source` 置为 `{ type: 'custom' }`；`ProjectAudioView` 暴露 `source`；
     - **测试全绿**：更新 `tests/unit/audio/ProjectAudioScope.test.ts`，并在 `tests/dom/pages/AudioPageProjectScope.test.tsx` 补充了自定义曲无弹窗与官方曲弹窗拦截/确认/取消的完整 DOM 单测。

8. **Code Review 审查回修落地**：
   - **Esc 层级穿透修复**：在 `EditInfoDialog` 中引入 `handleDialogClose`，若 `showSourceHelpRef.current` 为 true，Esc 仅关闭帮助气泡，第二次 Esc 才关闭整个弹窗；
   - **LLSIF 彻底下线收口**：从核心领域模型 `SongSource` 联合类型中移除 `{ type: 'llsif' }`；并在 `CONTEXT.md` 官方谱词条中清理 LLSIF 历史文案；
   - **死代码清理**：彻底删除 `src/pages/projects/projectFormat.ts` 中的 `parseSource` 函数；
   - **重构去重**：提取 `buildPatch()` 辅助函数消除补丁对象重复构造。
