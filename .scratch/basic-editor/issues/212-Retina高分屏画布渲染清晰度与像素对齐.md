# 212 · Retina高分屏画布渲染清晰度与像素对齐

Type: bug
Status: open

## 来源

用户在 macOS 环境反馈：
谱面画布在 Mac 上非常的糊，小节线、轨道线和音符边缘明显发虚，与 Windows 相比视觉清晰度差距显著。

## 症状与根因

1. **Canvas CSS 边框盒挤压引发全局 0.998x 双线性模糊插值（主因）**：
   - **症状**：整张画布从最左侧轨道到最右侧轨道、从底至顶全量发虚，小节线与文本边缘有雾状抗锯齿边缘。
   - **根因**：
     - 在 [FinalVirtualCanvas.tsx](file:///d:/Company/WorkSpace/MocaCoffee/bangdream-editor/src/chart/components/canvas/FinalVirtualCanvas.tsx#L552-L566) 中，`<canvas>` 设置了 `boxSizing: 'border-box'` 与 `border: '1px solid #333'`。
     - CSS `width: surf.w` 包含 2px 边框，导致实际 CSS 内容盒变成了 `(surf.w - 2)px`。
     - 而底层 HTML 属性 `width={Math.round(surf.w * dpr)}` 为真实物理分辨率。
     - 浏览器被迫将物理位图挤压映射到 `surf.w - 2` 的显示空间，全屏产生 $\approx 0.998\times$ 的非整数双线性缩放（Bilinear Resampling），原本精确对齐的 1px 细线全被打散。
2. **离屏瓦片 DPR 上限截断（`TILE_DPR_CAP = 1.5`）导致 Retina 2.0x 二次非整数拉伸（次因）**：
   - **症状**：音符贴图、文字标注比纯背景更模糊。
   - **根因**：
     - 在 [noteLayerCache.ts](file:///d:/Company/WorkSpace/MocaCoffee/bangdream-editor/src/rendering/pipeline/noteLayerCache.ts#L42-L46) 中，硬编码了 `TILE_DPR_CAP = 1.5`。
     - 在 Retina 2.0x 屏幕上，离屏瓦片以 1.5x 分辨率光栅化，而在主画布呈现时，通过 `drawImage` 放大 1.333x 绘制到 2.0x 主画板。
     - 经过 1.333x 放大后，再被根因 1 的 0.998x 边框重采样二次模糊，导致高分屏下严重失真。

## 修法

1. **消除 Canvas 内容盒 0.998x 缩放**：
   - 将 `border: '1px solid #333'` 移至外层包裹容器，或者对 `<canvas>` 改用 CSS `outline: 1px solid #333`（`outline` 不挤占盒模型内容空间）；
   - 保证 `<canvas>` 的 CSS 内容盒尺寸与 `surf.w`、`surf.h` 严格 1:1 相等，彻底恢复整像素直通。
2. **自适应整数阶梯倍率（对齐 Retina 2.0x）**：
   - 调整 `getEffectiveDpr` 算法，对标准 2.0x Retina 屏幕开放 2.0x 整数倍光栅化，消除 1.333x 放大失真；
   - 配合 LRU 瓦片数量上限与安全显存预算，防范超大视口爆显存。

## 锁测与不变量保护

1. **既有功能不变量**：
   - 严守 Issue 50 不变量：Canvas 元素不得超出父级产生 1px 偶发滚动条或 ResizeObserver 死循环；
   - Windows 平台 100%、125%、150%、175%、200% 各 DPI 缩放下几何对齐依然正确。
2. **锁测**：
   - `tests/unit/FinalVirtualCanvas.test.ts`：验证 canvas 几何盒模型与 backing store 比例严格一致；
   - `tests/unit/noteLayerCache.dpr.test.ts`：验证 DPR=2.0 下瓦片生成与屏幕绘制比例为 1:1，无小数缩放拉伸。
