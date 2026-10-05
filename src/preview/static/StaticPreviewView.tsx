// 静态预览画面（chart-preview 03；ADR-0016 §1.1 / §2）：**面板折行全景**。
//
// 排布：面板按序号横向排开 + 容器横向滚动；只画**可见且尚未画过**的面板（懒绘制 + 记账），
// 滚出视口不销毁（已出图的 canvas 留着）；但**画家换代时视口外的老位图整块作废**（见出图段注释）。
// 面板里画的是编辑器那套渲染（`panelPainter` → `renderChart`），
// 显示档只是叠了一层 `FrameView.display` 覆盖（`displayProfile.ts`）——**没有第二份绘制**。
//
// 本文件只做四件事：量容器 / 认可见区间 / 记账出图 / hover 交互；排布数学全在 `panelLayout.ts`（纯函数）。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatTimePrecise } from '../../chart/geometry/TimeFormat';
import { t } from '../../i18n';
import { displayOptionsFromSettings } from '../../rendering';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '../../rendering/skin/noteSkin';
import CanvasSpriteIcon from '../../ui/CanvasSpriteIcon';
import type { PreviewSettings } from '../../chart/config/AppSettings';
import { DEFAULT_PREVIEW_MARKERS, resolvePreviewDisplay } from './displayProfile';
import {
  MIN_PANEL_H,
  esForZoom,
  makePanelLayout,
  normalizePreviewZoom,
  visiblePanelRange,
} from './panelLayout';
import {
  createPanelPainter,
  resolvePanelDpr,
  type PanelPainter,
  type PanelPainterFactory,
  type PanelSceneInput,
} from './panelPainter';
import './StaticPreviewView.css';

export interface StaticPreviewViewProps {
  /** 要画的谱面（含细分档与作者画布设置）：与导出共用同一份字段定义 */
  scene: PanelSceneInput;
  /**
   * 缩放（1 = 标准档）：**唯一旋钮** —— 轨道宽 / 音符大小 / 每面板秒数 / 面板宽全由它推出
   * （见 panelLayout：「一个旋钮」）。面板高跟容器高（Bestdori 语义）。
   */
  zoom: number;
  /** 预览标注（默认 = 精简档，见 displayProfile.ts）：来自 `settings.preview` */
  markers?: PreviewSettings;
  /** 预览区内 Ctrl/⌘+滚轮调缩放时回传新值（不传 = 该手势不接管，交给浏览器） */
  onZoom?: (zoom: number) => void;
  painterFactory?: PanelPainterFactory;
}

const panelIndexes = (count: number): number[] => Array.from({ length: count }, (_, k) => k);

export default function StaticPreviewView({
  scene,
  zoom,
  markers = DEFAULT_PREVIEW_MARKERS,
  onZoom,
  painterFactory,
}: StaticPreviewViewProps) {
  const { notes, chartDuration, verticalRatio, settingsDisplay, noteSkin } = scene;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [hostSize, setHostSize] = useState({ w: 0, h: 0 });
  const [scrollLeft, setScrollLeft] = useState(0);
  // 皮肤图集到位后 +1：画家换代 → 已出图的面板自动重画（首帧按缺图渲染的那些）
  const [skinVersion, setSkinVersion] = useState(0);
  const slotsRef = useRef(new Map<number, HTMLDivElement>());
  const canvasesRef = useRef(new Map<number, HTMLCanvasElement>());
  /** 懒绘制账：面板 k 是**用哪个画家**出的图（同一个画家 = 同一档参数 → 出过就不再出） */
  const paintedRef = useRef(new Map<number, PanelPainter>());
  /** 当前 hover：`{ 面板, 面板内 y }`（不进 state：改的是画布像素，不需要 React 重渲） */
  const hoverRef = useRef<{ panel: number; cy: number } | null>(null);
  const spriteIconRef = useRef<CanvasSpriteIcon | null>(null);
  if (spriteIconRef.current === null) spriteIconRef.current = new CanvasSpriteIcon();

  const noteIcons = useMemo(() => buildActiveNoteIcons(normalizeNoteSkinSelection(noteSkin)), [noteSkin]);
  useEffect(() => {
    let cancelled = false;
    void CanvasSpriteIcon.ensureImagesLoaded(noteIcons.preloadSrcs())
      .catch((e) => console.warn('[StaticPreview] 音符皮肤图片预热失败（按缺图渲染）:', e))
      .then(() => { if (!cancelled) setSkinVersion((v) => v + 1); });
    return () => { cancelled = true; };
  }, [noteIcons]);

  // 面板位图密度（08 四轮 ADR-0017 不变量「位图:物理 = 整数」）：density = dpr × 超采样档（流畅1/标准1/高清2），
  // 见 panelPainter 的 resolvePanelDpr —— 浏览器恒做整数倍盒式下采样，dpr 非整（如 1.25）也不再跳采样
  const dpr = resolvePanelDpr(settingsDisplay.imageQuality);
  // 面板高 = 容器高（ADR-0016 §1.1 + Bestdori 语义：窗口矮 → 面板矮 → 每面板秒数少 → 面板数多）；
  // 未测量（0）时按下限兜底，免得 `panelH / es` 退化（此时也不出图，见下方出图 effect）
  const panelH = Math.max(MIN_PANEL_H, Math.round(hostSize.h));
  // 面板模型：几何（surface = 面板尺寸）/ 面板宽（13 车道 × es）/ 面板数 / 每面板秒数，全由（谱面 + 面板高 + 缩放）推出
  const layout = useMemo(
    () => makePanelLayout({ notes, chartDuration, verticalRatio, panelH, es: esForZoom(zoom) }),
    [notes, chartDuration, verticalRatio, panelH, zoom],
  );
  const display = useMemo(
    () => resolvePreviewDisplay(displayOptionsFromSettings(settingsDisplay), markers),
    [settingsDisplay, markers],
  );

  const makePainter = painterFactory ?? createPanelPainter;
  // 画家身份 = 「这一档参数」的身份：换缩放 / 换谱 / 换皮肤 / 容器高变化都会换代 → 已出图的面板重出
  const painter = useMemo(
    () => makePainter({ layout, scene, display, noteIcons, spriteIcon: spriteIconRef.current!, dpr, skinVersion }),
    [makePainter, layout, scene, display, noteIcons, dpr, skinVersion],
  );

  const range = visiblePanelRange(layout, scrollLeft, hostSize.w);

  // ---------------- 量容器（jsdom 无布局：ResizeObserver 缺席时靠挂载 / resize / scroll 三条同步路径） ----------------
  const syncFromHost = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    const w = host.clientWidth;
    const h = host.clientHeight;
    setHostSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    setScrollLeft((prev) => (prev === host.scrollLeft ? prev : host.scrollLeft));
  }, []);
  useLayoutEffect(() => { syncFromHost(); }, [syncFromHost]);
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => syncFromHost());
    ro.observe(host);
    return () => ro.disconnect();
  }, [syncFromHost]);
  useEffect(() => {
    window.addEventListener('resize', syncFromHost);
    return () => window.removeEventListener('resize', syncFromHost);
  }, [syncFromHost]);

  // ---------------- 滚轮（原生监听：要 preventDefault，React 的 onWheel 拦不住） ----------------
  // 这一屏是横向胶片带，所以：
  // - 光滚轮 = 横向滚动（纵向滚轮也映射成横滚，不必先够到 Shift）；
  // - Ctrl/⌘+滚轮 = 缩放这一屏（面板宽/密度一起变），并**把指针下的那一格钉住**；
  //   顺带拦掉浏览器整页缩放——用户要缩的是谱面，不是页面（2026-09-30 验收）。
  //
  // 缩放锚点的写法（issue 11 #3）：**不在换代前抢写 scrollLeft** —— 那一刻 DOM 还是旧内容宽，
  // 浏览器会按旧宽先钳一次（锚点错位、滚动条回跳）。这里只把"指针下那一格"记进 ref，
  // 真正的写盘交给下面按布局落的 layout effect（那时新面板宽已经进 DOM，钳制按新宽算）。
  const zoomRef = useRef(zoom);
  useLayoutEffect(() => { zoomRef.current = zoom; }, [zoom]);
  const pendingAnchorRef = useRef<{ panelAt: number; offsetX: number } | null>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        if (!onZoom) return;
        event.preventDefault();
        const stepPerEvent = Math.min(0.08, Math.max(0.01, Math.abs(event.deltaY) / 200));
        // 从**最新档**起步：连发事件里上一发已经改了目标档，state 还停在上一帧（闭包滞后），
        // 直接读 state 会把同一档重复算 N 次（"锚点不动、档位也不动"的那种一顿一顿）。
        const next = normalizePreviewZoom(
          zoomRef.current + (event.deltaY < 0 ? stepPerEvent : -stepPerEvent),
        );
        if (next === zoomRef.current) return;
        zoomRef.current = next;
        // 锚点：指针下的那一格（带小数）在缩放前后落在同一屏位置
        const offsetX = event.clientX - host.getBoundingClientRect().left;
        pendingAnchorRef.current = {
          panelAt: (host.scrollLeft + offsetX) / layout.panelW,
          offsetX,
        };
        onZoom(next);
        return;
      }
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (delta === 0) return;
      event.preventDefault();
      host.scrollLeft += delta;
      syncFromHost();
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, [onZoom, layout, syncFromHost]);

  // 缩放锚点落地（issue 11 #3）：必须等**新布局进 DOM 之后**再写 scrollLeft（见滚轮段注释）。
  // 没有待办锚点时是空转；`zoom` 也在依赖里，兜住"档变了但布局恰好同值"的边界。
  useLayoutEffect(() => {
    const anchor = pendingAnchorRef.current;
    if (!anchor) return;
    pendingAnchorRef.current = null;
    const host = hostRef.current;
    if (!host) return;
    host.scrollLeft = Math.max(0, anchor.panelAt * layout.panelW - anchor.offsetX);
    syncFromHost();   // 浏览器钳制后的真值立刻回填 state：本帧的出图区间就按它算
  }, [layout, zoom, syncFromHost]);

  // ---------------- 出图（懒绘制 + 记账） ----------------
  const paintPanel = useCallback((panelIndex: number) => {
    const slot = slotsRef.current.get(panelIndex);
    if (!slot) return;
    let canvas = canvasesRef.current.get(panelIndex);
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'spv-panel__canvas';
      slot.appendChild(canvas);
      canvasesRef.current.set(panelIndex, canvas);
    }
    // 缓冲尺寸是画家自己的账（buffer = 面板 CSS 尺寸 × dpr）：两者同源，不在这里重算
    if (canvas.width !== painter.bufferW) canvas.width = painter.bufferW;
    if (canvas.height !== painter.bufferH) canvas.height = painter.bufferH;
    const ctx = canvas.getContext('2d');
    // transform 按「位图实际尺寸 / CSS 尺寸」取，而不是恒 dpr（照瓦片的 issue 98 口径）：
    // round(面板宽 × dpr) 的整数量化差若留在画面上，就是"每档缩放都带一点重采样"
    if (ctx) {
      ctx.setTransform(painter.bufferW / painter.panelW, 0, 0, painter.bufferH / painter.panelH, 0, 0);
    }
    const hovering = hoverRef.current;
    painter.blitInto(
      panelIndex,
      ctx,
      0,
      0,
      hovering?.panel === panelIndex ? { cx: 0, cy: hovering.cy } : null,
    );
    paintedRef.current.set(panelIndex, painter);
  }, [painter]);

  // 画家换代（换缩放 / 换谱面 / 换皮肤 / 容器高变化）时，**视口之外**的老位图连 canvas 一起作废：
  // 只重画可见区间的写法会把旧画家的图像留在视口外的画布上，横滚进视口那一瞬先看到旧音符、
  // 下一帧才被重画（2026-10-05 验收：重置谱面后横滚看到上一版音符）。视口内的由下面同一次提交的
  // 出图 effect 重画；纯滚动（画家没换）不作废——"滚出视口不销毁"照旧。
  useLayoutEffect(() => {
    for (const [k, painted] of [...paintedRef.current]) {
      if (painted === painter) continue;
      if (k >= range.lo && k <= range.hi) continue;
      canvasesRef.current.get(k)?.remove();
      canvasesRef.current.delete(k);
      paintedRef.current.delete(k);
    }
  }, [painter, range.lo, range.hi]);

  useLayoutEffect(() => {
    // 容器还没测出来（高 0）先不出图：那几张位图既看不见、又会被真实尺寸的画家整批顶掉
    if (layout.panelCount <= 0 || hostSize.h <= 0) return;
    for (let k = range.lo; k <= range.hi; k++) {
      // 同一画家出过就不再出（"只画还没画过的面板"）；换档后画家换代，这里自然重出
      if (paintedRef.current.get(k) === painter) continue;
      paintPanel(k);
    }
    // 面板数变少（换了缩放 / 容器变矮）时清掉尾部记账；DOM 槽由 React 收起，连带它的 canvas
    for (const k of [...paintedRef.current.keys()]) {
      if (k >= layout.panelCount) paintedRef.current.delete(k);
    }
    for (const k of [...canvasesRef.current.keys()]) {
      if (k >= layout.panelCount) canvasesRef.current.delete(k);
    }
  }, [painter, paintPanel, range.lo, range.hi, layout.panelCount, hostSize.h]);

  // ---------------- hover：把指针 y 交给渲染域，横线与两侧读数由它画（同一口径） ----------------
  const handleHoverMove = useCallback((panelIndex: number, event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.height <= 0) return;
    const cy = event.clientY - rect.top;
    const prev = hoverRef.current;
    if (prev && prev.panel !== panelIndex) {
      hoverRef.current = null;
      paintPanel(prev.panel);   // 上一个面板要清掉读数
    }
    hoverRef.current = { panel: panelIndex, cy };
    paintPanel(panelIndex);
  }, [paintPanel]);

  const handleHoverLeave = useCallback((panelIndex: number) => {
    if (hoverRef.current?.panel !== panelIndex) return;
    hoverRef.current = null;
    paintPanel(panelIndex);
  }, [paintPanel]);

  const panels = panelIndexes(layout.panelCount);

  return (
    <div
      className="spv-host"
      ref={hostRef}
      onScroll={syncFromHost}
      role="group"
      aria-label={t('preview.static.aria')}
    >
      {layout.panelCount > 0 && (
        <div className="spv-track" style={{ width: layout.totalWidth, height: panelH }}>
          {panels.map((k) => (
            <div
              key={k}
              className="spv-panel"
              role="img"
              aria-label={t('preview.static.panel.aria', {
                index: k + 1,
                from: formatTimePrecise(k * layout.secondsPerPanel),
                to: formatTimePrecise((k + 1) * layout.secondsPerPanel),
              })}
              data-panel={k}
              style={{ left: k * layout.panelW, width: layout.panelW, height: panelH }}
              ref={(el) => { if (el) slotsRef.current.set(k, el); else slotsRef.current.delete(k); }}
              onMouseMove={(event) => handleHoverMove(k, event)}
              onMouseLeave={() => handleHoverLeave(k)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
