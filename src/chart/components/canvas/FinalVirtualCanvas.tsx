import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from "react";
import type { ChartNote, SelectionItem } from "../../types";
import CanvasSpriteIcon from '../../../ui/CanvasSpriteIcon';
import { handleNoteReplacement, handleSlideToSlideCombination } from '../../editing/NoteReplacementRules';
import { deleteSelection } from '../../editing/SelectionEditing';
import { getBpmEvents, secondsToBeat, chartLengthToEndBeat, type BpmEvent } from '../../../audio/AudioTiming';
import {
  ChartGeometry, LANES, LANE_WIDTH,
  TRACK_CHROME_TOTAL, type SurfaceSize,
} from '../../geometry/ChartGeometry';
import { useEditing, useUI, usePlayback, useConfig } from '../../../app/ProviderTree';
import { renderChart, findItemAt, computeItemsInBox, type RenderCtx, type ViewportState } from '../../../visual';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '../../../visual/noteSkin';
import { normalizeBackgroundOpacity } from '../../../visual/staticLayerCache';
import { useBackgroundSkin } from '../../rendering/useBackgroundSkin';
import { countNotesUpToBeat } from '../../editing/NoteEditing';
import { formatTimePrecise } from '../../geometry/TimeFormat';

interface FinalVirtualCanvasProps {
  // 仅留 onScrollChange（虚拟高度需经 Editor 同步给滚动条容器）；其余状态经 hooks 直读（ADR-0003 §7）
  onScrollChange?: (scrollY: number, virtualHeight: number) => void;
  /** 谱面长度（秒，ADR-0005 §1）：显式、与音符无关；有音频=音频时长，无音频=持久化值(默认30s) */
  chartEndSeconds: number;
  /**
   * 渲染面尺寸（CSS 像素，ADR-0006 §1）：由 Editor 经 ResizeObserver 提供；缓冲 = surface × dpr
   * issue 50（Q8 a / Q24 a）：null = RO 尚未回调（mount 后 0~16ms），
   * 组件不渲染（不画判定线、不响应指针——保护所有依赖 surface 的几何/绘制）
   */
  surface: SurfaceSize | null;
  /** 工作台激活态（issue 28 表面契约透传）：false→true（回到工作台）时强制补一帧——
   *  保活隐藏期间背景皮肤的换图/开关/透明度变化不经过任何画布交互路径（issue 29 用户反馈2），激活即重绘保证所见为最新 */
  active?: boolean;
}

/**
 * 画布 imperative 句柄（架构深化评审候选 1 收窄）：只暴露 Editor 需要让画布【跟随】的动作与
 * 起点标记状态；秒↔scrollY↔滚动条 的数学全部收敛到 PlaybackScrollModel，不再经此 ref 协议跨组件调用。
 */
export interface FinalVirtualCanvasHandle {
  /** 应用目标 scrollY（画布跟随）：值由 PlaybackScrollModel 计算，画布内部钳制到可滚范围。 */
  setScrollY: (scrollY: number) => void;
  /** 起点标记（ADR-0004 §4）：Editor 经此做 Ctrl+空格 回跳 / Delete 删除。 */
  getMarkerBeat?: () => number | null;
  setMarkerBeat?: (beat: number | null) => void;
  getMarkerSelected?: () => boolean;
  setMarkerSelected?: (sel: boolean) => void;
  clearMarker?: () => void;
}

// 视口缩放配置
const MAX_SCALE = 3.0;
const MIN_SCALE = 0.1;

/** BPM 事件表内容相等（issue 35 F2：内容未变时 geometry 复用旧实例，事件数通常 ≤ 个位数） */
const bpmEventsContentEqual = (a: readonly BpmEvent[], b: readonly BpmEvent[]) =>
    a === b || (a.length === b.length && a.every((e, i) => e.beat === b[i].beat && e.bpm === b[i].bpm));

/**
 * FinalVirtualCanvas（ADR-0003 候选 B 收口）：已拆成薄层。
 * 渲染/命中/坐标全部收敛到 src/renderer 纯模块，本组件只保留：
 * 挂载/canvas 生命周期/皮肤加载、事件绑定、视图状态(viewport)、坐标薄封装、imperative 方法。
 */
const FinalVirtualCanvas = forwardRef<FinalVirtualCanvasHandle, FinalVirtualCanvasProps>(({
    onScrollChange,
    chartEndSeconds,
    surface,
    active,
}, ref) => {
    // issue 50（Q6 a 修正语义）：画布 == background（CSS width/height 100%），几何坐标系用 chartArea 真实尺寸。
    // 之前的 min 维度算法（canvasW=min(parentW, floor(parentH*5/6))）导致左右 letterbox——父级比画布宽时
    // 画布居中、左右留黑底，违反"画布与 background 贴合"原意。新语义：画布 DOM = 父级，绘制坐标系也 = 父级，
    // 轨道水平居中绘制在画布内，多余的水平空间由 canvas 绘制层 letterbox 成黑底（renderChart 内部 trackStartX
    // 居中算法已实现）。判定线 = 画布底 = chartArea 底——音符越过 chartArea 底即判（与 Q7 一致）。
    // 兜底：surface null 时用 200×240 占位（与 useScrollModel 内部 fallback 对齐）；
    // 实际渲染在 JSX return 前早 return null，不会真正画到这组值。
    // useMemo 包裹：避免每次 render 重建对象导致下游 useMemo/useEffect 依赖抖动
    const surf: SurfaceSize = useMemo(() => surface ?? { w: 200, h: 240 }, [surface]);
    // 状态经 hooks 直读（ADR-0003 §7）
    const {
        notes, selectedItems, setSelectedItems, clipboard,
        handleNotesChange, editToolAction, editToolPaste,
    } = useEditing();
    const { selectedTool, beatDisplay, scale, setScale, setMousePosition } = useUI();
    const { setMarker: setMarkerContext, currentSeconds } = usePlayback();
    // issue 39 功能设置·画布显示：纵向比例进 geometry（重建），其余渲染参数经 RenderCtx 注入渲染器
    const { settings } = useConfig();
    const display = settings.display;
    // 音符皮肤（issue 29）：六条目选择 → 归一化（缺省/非法回退默认包）→ 图标集；引用稳定，仅选择变化时重建
    const noteSkin = useMemo(() => normalizeNoteSkinSelection(settings.visual?.noteSkin), [settings.visual?.noteSkin]);
    const noteIcons = useMemo(() => buildActiveNoteIcons(noteSkin), [noteSkin]);
    // 背景皮肤（issue 29 Q4 最小模型）：store 快照（IndexedDB 懒装载）× settings 开关位 → 渲染输入；
    // 开关/换图/透明度任一变化都会经此处注入，静态层据 revision+opacity 失效重建
    const bgSnapshot = useBackgroundSkin();
    const background = useMemo(() => {
      const bg = settings.visual?.backgroundSkin;
      if (!bg?.enabled || !bgSnapshot.image) return null;
      return {
        source: bgSnapshot.image.source as CanvasImageSource,
        width: bgSnapshot.image.width,
        height: bgSnapshot.image.height,
        revision: bgSnapshot.revision,
        opacity: normalizeBackgroundOpacity(bg.opacity),
        fit: bg.fit === 'contain' ? 'contain' as const : 'cover' as const,
        scope: bg.scope === 'fullCanvas' ? 'fullCanvas' as const : 'outsideTrack' as const,
      };
    }, [settings.visual?.backgroundSkin, bgSnapshot]);
    // 视口状态
    const [viewport, setViewport] = useState<ViewportState>({
        scrollX: 0,
        scrollY: 0,
        scale: scale,
        virtualWidth: LANES * LANE_WIDTH + TRACK_CHROME_TOTAL * 2,
        virtualHeight: 0, // 初始 0，由 chartEndVirtualY 驱动
    });

    // 缩放双入口联动（issue 10 回归修复）：工具栏 ±0.1 / 设置面板改 ui.scale 时同步画布视口；
    // ctrl+滚轮路径在 handleWheel 里反向回写 ui.scale（那里已比较生效值，此处不会形成循环）。
    useEffect(() => {
        setViewport(prev => Math.abs(prev.scale - scale) > 1e-6 ? { ...prev, scale } : prev);
    }, [scale]);

    const [slideBuffer, setSlideBuffer] = useState<{ beat: number; lane: number; subBeat?: number } | null>(null);
    // 皮肤图片就绪信号：懒加载图片异步到达后 +1，触发一次重绘（否则连接带等未预热的素材会一直空白）
    const [skinVersion, setSkinVersion] = useState(0);
    // 缩放手势状态（issue 10）：手势期间离屏瓦片只按比例 blit；结束后 settle 触发一次高清重渲
    const [renderTick, setRenderTick] = useState(0);
    const zoomGestureUntilRef = useRef(0);
    const zoomSettleTimerRef = useRef<number | undefined>(undefined);

    // 画布用到的全部皮肤图（issue 29：随当前音符皮肤选择动态解析），挂载/换肤即预加载，加载完触发重绘；
    // 单图失败不阻断（按缺图渲染，drawSingle 每帧重试加载），无论成败都 bump skinVersion 全量失效瓦片
    useEffect(() => {
        let cancelled = false;
        CanvasSpriteIcon.ensureImagesLoaded(noteIcons.preloadSrcs())
            .catch((e) => console.warn('[FinalVirtualCanvas] 音符皮肤图片预热失败（按缺图渲染）:', e))
            .then(() => {
                if (!cancelled) setSkinVersion(v => v + 1);
            });
        return () => { cancelled = true; };
    }, [noteIcons]);

    // 谱面末端 beat（ADR-0005 §1/§7）：由显式谱面长度(秒) 经 BPM 事件换算得出，与音符无关、无尾量。
    // 空谱/无音频也用谱面长度（默认 30s）换算，不再有 FLOOR_BEATS 兜底。
    const chartEndBeat = useMemo(
        () => chartLengthToEndBeat(getBpmEvents(notes), chartEndSeconds),
        [notes, chartEndSeconds],
    );
    const [selectionBox, setSelectionBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
    // 圈选起点（bug 32：同时记画布坐标与虚拟坐标；滚动时用虚拟坐标锚定谱面时刻/轨道不变，行为如"长截图"）
    const selectionStartRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
    const selectionMovedRef = useRef(false); // 是否已发生拖拽（区分点击与圈选）
    // 光标悬停位置（画布坐标），供工具态预览（放置/粘贴/镜像悬停）
    const [hoverPos, setHoverPos] = useState<{ cx: number; cy: number } | null>(null);
    // 临时起点标记（ADR-0004 §4）：不入谱面数据、随会话丢弃；markerSelected 与音符选择互斥
    const [markerBeat, setMarkerBeat] = useState<number | null>(null);
    const [markerSelected, setMarkerSelected] = useState(false);

    // 起点标记状态同步到 PlaybackContext（供 PlayBar 提示 / Delete 删除判定走同一路径）
    useEffect(() => {
        setMarkerContext(markerBeat);
    }, [markerBeat, setMarkerContext]);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const spriteIcon = useRef<CanvasSpriteIcon>(new CanvasSpriteIcon());

    // 暴露方法给父组件（候选 1 收窄：只留 setScrollY 跟随 + 起点标记；秒↔scrollY 数学归 PlaybackScrollModel）
    useImperativeHandle(ref, () => ({
        setScrollY: (scrollY: number) => {
            setViewport(prev => {
                const scaledBounds = getScaledVirtualBounds(prev.scale);
                const newScrollY = Math.max(scaledBounds.minY, Math.min(scaledBounds.maxY - surf.h / prev.scale, scrollY));
                return {
                    ...prev,
                    scrollY: newScrollY
                };
            });
        },
        // 起点标记访问（ADR-0004 §4）：Editor 经此做 Ctrl+空格 回跳 / Delete 删除
        getMarkerBeat: () => markerBeat,
        setMarkerBeat: (beat: number | null) => { setMarkerBeat(beat); },
        getMarkerSelected: () => markerSelected,
        setMarkerSelected: (sel: boolean) => setMarkerSelected(sel),
        clearMarker: () => { setMarkerBeat(null); setMarkerSelected(false); },
    }));

    // ---------------------------
    // 谱面几何（ADR-0003 候选 B/C）：BPM→虚拟Y 走缓存时间线，坐标/剔除/命中统一由 ChartGeometry 提供
    // issue 35 F2：BPM 事件内容/谱长/渲染面未变时复用旧实例——否则每次编辑普通音符都新建实例，
    // geometry 引用变化本身就会触发瓦片缓存全量失效（密集音符下放置/选择卡顿的根因之一）。
    // ---------------------------
    const geometryRef = useRef<ChartGeometry | null>(null);
    const verticalRatio = display.verticalRatio;
    const geometry = useMemo(() => {
        const bpmEvents = getBpmEvents(notes);
        const prev = geometryRef.current;
        if (
            prev &&
            prev.chartEndBeat === chartEndBeat &&
            prev.surface.w === surf.w && prev.surface.h === surf.h &&
            prev.verticalRatio === verticalRatio &&
            bpmEventsContentEqual(prev.bpmEvents, bpmEvents)
        ) {
            return prev;
        }
        const next = new ChartGeometry(bpmEvents, chartEndBeat, surf, verticalRatio);
        geometryRef.current = next;
        return next;
        // issue 39 #5：纵向比例变化 → 重建 geometry（改变每小节纵向高度）
    }, [notes, chartEndBeat, surf, verticalRatio]);
    // 谱面末端的【真实 BPM 像素高度】（ADR-0004 §3 修订）：总高/坐标基准都用它
    const chartEndVirtualY = geometry.chartEndVirtualY;

    // 坐标变换（薄封装，保持既有调用签名不变；内部均为 O(log BPM) 缓存查询）
    const getScaledVirtualBounds = (scale: number) => geometry.scaledVirtualBounds(scale);
    const beatToVirtualY = (beat: number) => geometry.beatToVirtualY(beat, viewport.scale);
    const virtualYToBeat = (virtualY: number) => geometry.virtualYToBeat(virtualY, viewport.scale);
    const virtualToCanvas = (virtualX: number, virtualY: number) => geometry.virtualToCanvas(virtualX, virtualY, viewport);
    const canvasToVirtual = (canvasX: number, canvasY: number) => geometry.canvasToVirtual(canvasX, canvasY, viewport);
    const getLaneBeatFromCanvas = (cx: number, cy: number) => geometry.laneBeatFromCanvas(cx, cy, viewport, beatDisplay);

    // 判断 SelectionItem 是否已在选中集中（同 kind/noteIndex/connIndex 视为同一条目）
    const sameItem = (a: SelectionItem, b: SelectionItem) =>
        a.kind === b.kind && a.noteIndex === b.noteIndex &&
        (a.kind === 'note' ? true : a.connIndex === (b as any).connIndex);

    // 点选：普通左键选子部分 / Ctrl+左键选整条滑条 / Shift 加选
    const selectItemAtPoint = (cx: number, cy: number, additive: boolean, ctrl: boolean) => {
        setMarkerSelected(false); // 起点标记与音符选择互斥（ADR-0004 §4）
        const hit = findItemAt(cx, cy, { geometry, viewport, beatDisplay, notes, noteSize: display.noteSize });
        if (!hit) {
            if (!additive) setSelectedItems([]);
            return;
        }
        // Ctrl+左键 → 选中整条滑条（{kind:'note'}）；否则选命中的子部分
        const target: SelectionItem = ctrl ? { kind: 'note', noteIndex: hit.noteIndex } : hit;
        if (additive) {
            const exists = selectedItems.some(it => sameItem(it, target));
            if (exists) {
                setSelectedItems(selectedItems.filter(it => !sameItem(it, target)));
            } else {
                // 加选整条时，清掉同一滑条的既有子部分选择（ADR §6.1 整条与子部分互斥）
                const filtered = ctrl ? selectedItems.filter(it => it.noteIndex !== target.noteIndex) : selectedItems;
                setSelectedItems([...filtered, target]);
            }
        } else {
            setSelectedItems([target]);
        }
    };

    const selectItemsInBox = (box: { x1: number; y1: number; x2: number; y2: number }) => {
        setSelectedItems(computeItemsInBox(box, { geometry, viewport, beatDisplay, notes }));
        setMarkerSelected(false); // 起点标记与音符选择互斥（ADR-0004 §4）
    };

    // ---------------------------
    // 渲染：薄层只组装 RenderCtx 并调用 renderChart（ADR-0003 候选 B）
    // ---------------------------
    const renderCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const rc: RenderCtx = {
            geometry,
            viewport,
            surface: surf,
            // issue 39 #6：图像品质 → 画布 dpr 上限（流畅 1x / 标准 2.5x / 高清 3x）
            // issue 40：标准从 2 提到 2.5（缩小采样比更小 → 音符边缘更锐利、杂色更轻，
            // 代价是增加约 56% 画布像素/显存与重绘成本；主画布按完整 dpr，瓦片另有 TILE_DPR_CAP）
            dpr: Math.min(window.devicePixelRatio || 1, display.imageQuality === 'smooth' ? 1 : display.imageQuality === 'hd' ? 3 : 2.5),
            beatDisplay,
            chartEndBeat,
            notes,
            selectedItems,
            selectionBox,
            slideBuffer,
            hoverPos,
            clipboard,
            markerBeat,
            markerSelected,
            selectedTool,
            spriteIcon: spriteIcon.current,
            noteIcons,
            zoomGesture: performance.now() < zoomGestureUntilRef.current, // 手势期间瓦片只 blit（issue 10）
            skinVersion,
            // issue 39：画布显示参数（节奏图示大小/长压线不透明度/同时点击线）
            display: { noteSize: display.noteSize, slideOpacity: display.slideOpacity, simultaneousClickLines: display.simultaneousClickLines },
            // 背景皮肤（issue 29 Q4）：进静态层绘制
            background,
        };
        renderChart(ctx, canvas, rc);
    }, [notes, selectedItems, viewport, selectionBox, slideBuffer, beatDisplay, selectedTool, hoverPos, clipboard, markerBeat, markerSelected, skinVersion, geometry, chartEndBeat, renderTick, display.noteSize, display.slideOpacity, display.simultaneousClickLines, display.imageQuality, noteIcons, background]);

    // 虚拟高度同步（原 renderCanvas 内副作用，现移出为纯状态同步）
    useEffect(() => {
        const totalVirtualHeight = chartEndVirtualY + surf.h / geometry.effectiveScale(viewport.scale);
        const totalVirtualWidth = LANES * LANE_WIDTH + TRACK_CHROME_TOTAL * 2;
        if (Math.abs(viewport.virtualHeight - totalVirtualHeight) > 1) {
            setViewport(prev => ({
                ...prev,
                virtualWidth: totalVirtualWidth,
                virtualHeight: totalVirtualHeight
            }));
        }
    }, [chartEndVirtualY, viewport.scale, viewport.virtualHeight, surf, geometry]);

    // ---------------------------
    // 事件处理
    // ---------------------------
    // 渲染面动态化（ADR-0006 §1）：几何/命中/绘制均用 CSS 像素坐标（缓冲 = surface × dpr，绘制时 setTransform）。
    // 事件坐标取自 getBoundingClientRect（CSS 显示像素），与几何坐标同基准，无需再换算。
    const cssToCanvas = useCallback((e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return null;
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
        };
    }, []);

    const handleWheel = useCallback((e: WheelEvent) => {
        // 只处理Ctrl+滚轮缩放，禁用普通滚动
        if (e.ctrlKey) {
            e.preventDefault();
            const pos = cssToCanvas(e);
            if (!pos) return;
            const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
            const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, viewport.scale * zoomFactor));
            const effNewScale = geometry.effectiveScale(newScale);
            // 缩放锚定鼠标下的谱面位置：必须锚 pos 空间（缩放不变量）而非 virtualY
            // （virtualY 原点 C(es)=chartEndVirtualY+surf.h/es 随缩放变化，保 virtualY 会让整幅内容
            // 每 tick 平移 surf.h·(k−1) px，端点处再被钳制拉回——起始线/首拍 BPM 线"漂移后回弹"根因）。
            // 返回值已钳制到 [0, chartEndVirtualY]，与 setScrollY 同一可滚范围。
            const newScrollY = geometry.zoomAnchorScrollY(pos.y, viewport.scale, viewport.scrollY, newScale);
            setViewport(prev => ({
                ...prev,
                scale: effNewScale, // 视图 scale 恒等于 effectiveScale（ADR-0006 Q4=A）
                scrollX: 0,
                scrollY: newScrollY
            }));
            // 回写工具栏缩放数字（issue 10 回归修复）：ui.scale 与 viewport.scale 保持同一生效值
            setScale(effNewScale);
            // 缩放手势窗口（issue 10）：手势中瓦片只按比例 blit；停止 250ms 后 settle 一次高清重渲
            zoomGestureUntilRef.current = performance.now() + 240;
            if (zoomSettleTimerRef.current !== undefined) clearTimeout(zoomSettleTimerRef.current);
            zoomSettleTimerRef.current = window.setTimeout(() => setRenderTick(t => t + 1), 250);
        }
        // 普通滚轮滚动由父容器处理，不在这里处理
    }, [geometry, viewport, cssToCanvas, setScale]);

    // 切换离开滑条工具时清空待连接锚点（防止残留红点）
    useEffect(() => {
        if (selectedTool !== "slide") {
            setSlideBuffer(null);
        }
    }, [selectedTool]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        // 鼠标 / 镜像工具态：记录圈选起点，支持点击单选与拖拽圈选（镜像框选用于预览+批量执行）
        if (selectedTool === "mouse" || selectedTool === "mirror") {
            const pos = cssToCanvas(e);
            if (!pos) return;
            // bug 32：起点同时存画布坐标（拖拽阈值/渲染基线）与虚拟坐标（滚动时锚定谱面时刻）
            const v = canvasToVirtual(pos.x, pos.y);
            selectionStartRef.current = { x: pos.x, y: pos.y, vx: v.x, vy: v.y };
            selectionMovedRef.current = false;
            setSelectionBox(null);
        }
    }, [selectedTool, canvasToVirtual]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        const canvasPos = cssToCanvas(e);
        if (!canvasPos) return;
        const mouseX = canvasPos.x;
        const mouseY = canvasPos.y;
        // 记录悬停位置（供工具态预览：放置/粘贴/镜像）
        setHoverPos({ cx: mouseX, cy: mouseY });
        // 更新状态栏鼠标位置与粘贴锚点
        const pos = getLaneBeatFromCanvas(mouseX, mouseY);
        if (pos) {
            setMousePosition({ beat: pos.preciseBeat, lane: pos.lane });
        } else {
            setMousePosition(null);
        }
        // 鼠标 / 镜像工具态：拖拽更新圈选矩形
        if ((selectedTool === "mouse" || selectedTool === "mirror") && selectionStartRef.current) {
            const start = selectionStartRef.current;
            const dx = mouseX - start.x;
            const dy = mouseY - start.y;
            if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
                selectionMovedRef.current = true;
                // bug 32：以虚拟坐标求矩（起点锚定谱面时刻/轨道），再转回画布坐标供渲染/命中——
                // 即使拖拽过程中滚动，起点对应的拍点也不漂移（"长截图"式选区）
                const cur = canvasToVirtual(mouseX, mouseY);
                const p1 = virtualToCanvas(start.vx, start.vy);
                const p2 = virtualToCanvas(cur.x, cur.y);
                setSelectionBox({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
            }
        }
    }, [geometry, viewport, setMousePosition, beatDisplay, selectedTool, cssToCanvas, canvasToVirtual, virtualToCanvas]);

    // 处理鼠标点击事件（放置音符 / 滑条连接 / BPM）
    const handleClick = useCallback((e: React.MouseEvent) => {
        // 鼠标状态下的选择（点击/圈选）已在 mouseup 中处理，这里直接跳过
        if (selectedTool === "mouse") return;
        const pos = cssToCanvas(e);
        if (!pos) return;
        const mouseX = pos.x;
        const mouseY = pos.y;
        const { trackBgX } = geometry.trackGeometry(viewport.scale);
        const relativeX = mouseX - trackBgX;
        const lane = Math.floor(relativeX / (LANE_WIDTH * viewport.scale));
        const virtualY = viewport.scrollY + mouseY / viewport.scale;
        const beat = virtualYToBeat(virtualY);

        if (lane >= 0 && lane < LANES && beat >= 0) {
            const subBeatPosition = beat * beatDisplay;
            const nearestSubBeat = Math.round(subBeatPosition);
            const preciseBeat = nearestSubBeat / beatDisplay;

            // ADR-0005 §5：超出谱面长度（显式末端）的放置一律禁止；需先手动加长谱面再放置
            if (preciseBeat > chartEndBeat + 1e-6) {
                return;
            }

            if (selectedTool === "single" || selectedTool === "flick" || selectedTool === "skill"
                || selectedTool === "ldirectional" || selectedTool === "rdirectional") {
                const result = handleNoteReplacement(notes, preciseBeat, lane, 0, selectedTool);
                if (result.shouldReplace) {
                    handleNotesChange(result.newNotes);
                }
            } else if (selectedTool === "slide") {
                const point = { beat: preciseBeat, lane, subBeat: 0 };
                if (!slideBuffer) {
                    setSlideBuffer(point);
                } else {
                    const sameBeat =
                        slideBuffer.beat === point.beat &&
                        (slideBuffer.subBeat || 0) === (point.subBeat || 0);
                    if (sameBeat) {
                        setSlideBuffer(null);
                    } else {
                        const comb = handleSlideToSlideCombination(notes, [slideBuffer, point]);
                        if (comb.shouldCombine) {
                            handleNotesChange(comb.newNotes);
                        } else {
                            const newNotes = [...comb.newNotes];
                            const [start, end] = [slideBuffer, point].sort(
                                (a, b) => (a.beat - b.beat) || ((a.subBeat || 0) - (b.subBeat || 0))
                            );
                            newNotes.push({ type: "Slide", connections: [start, end] });
                            handleNotesChange(newNotes);
                        }
                    }
                    setSlideBuffer(null);
                }
            } else if (selectedTool === "bpm") {
                const bpm = parseInt(prompt("请输入 BPM 数值") || "0", 10);
                if (!isNaN(bpm) && bpm > 0) {
                    const newNote: ChartNote = {
                        beat: preciseBeat,
                        type: "BPM",
                        bpm: bpm
                    };
                    handleNotesChange([...notes, newNote]);
                }
            }
        }
    }, [selectedTool, selectedItems, setSelectedItems, notes, viewport, beatDisplay, slideBuffer, chartEndBeat, cssToCanvas]);

    // 左沟槽命中起点标记线（ADR-0004 §4；与音符命中路径无关）
    const hitStartMarker = useCallback((cx: number, cy: number): boolean => {
        if (markerBeat === null) return false;
        const { trackBgX } = geometry.trackGeometry(viewport.scale);
        if (cx >= trackBgX) return false;
        const markerVirtualY = beatToVirtualY(markerBeat);
        const markerCanvasY = virtualToCanvas(0, markerVirtualY).y;
        return Math.abs(cy - markerCanvasY) < 10 * viewport.scale;
    }, [geometry, markerBeat, viewport]);

    // 左沟槽双击：放置/删除临时起点标记
    const handleDoubleClick = useCallback((e: React.MouseEvent) => {
        const pos = cssToCanvas(e);
        if (!pos) return;
        const { trackBgX } = geometry.trackGeometry(viewport.scale);
        if (pos.x >= trackBgX) return;
        const virtualY = viewport.scrollY + pos.y / viewport.scale;
        const beat = virtualYToBeat(virtualY);
        if (hitStartMarker(pos.x, pos.y)) {
            setMarkerBeat(null);
            setMarkerSelected(false);
            return;
        }
        const snapped = Math.round(beat * beatDisplay) / beatDisplay;
        setMarkerSelected(true);
        setSelectedItems([]);
        setMarkerBeat(snapped);
    }, [geometry, viewport, beatDisplay, cssToCanvas, hitStartMarker]);

    const handleMouseUp = useCallback((e: React.MouseEvent) => {
        const pos = cssToCanvas(e);
        const mx = pos ? pos.x : 0;
        const my = pos ? pos.y : 0;

        // 镜像工具态：单点点击命中即镜像；拖拽圈选 → 预览（渲染时）+ 松手批量镜像
        if (selectedTool === "mirror") {
            if (selectionStartRef.current && selectionMovedRef.current && selectionBox) {
                const items = computeItemsInBox(selectionBox, { geometry, viewport, beatDisplay, notes });
                setSelectedItems(items);
                if (items.length > 0) {
                    items.forEach(it => editToolAction('mirror', it));
                }
            } else {
                const hit = findItemAt(mx, my, { geometry, viewport, beatDisplay, notes });
                if (hit) editToolAction('mirror', hit);
            }
            selectionStartRef.current = null;
            setSelectionBox(null);
            return;
        }

        // 复制/剪切/删除工具态：点击命中音符即执行
        if (selectedTool === "copy" || selectedTool === "cut" || selectedTool === "delete") {
            const hit = findItemAt(mx, my, { geometry, viewport, beatDisplay, notes });
            if (hit) editToolAction(selectedTool, hit);
            selectionStartRef.current = null;
            setSelectionBox(null);
            return;
        }

        // 粘贴工具态：点击位置即粘贴
        if (selectedTool === "paste" && editToolPaste) {
            const pos2 = getLaneBeatFromCanvas(mx, my);
            if (pos2) editToolPaste({ beat: pos2.preciseBeat, lane: pos2.lane });
            selectionStartRef.current = null;
            setSelectionBox(null);
            return;
        }

        // 鼠标状态下完成点选或圈选
        if (selectedTool !== "mouse" || !selectionStartRef.current) {
            selectionStartRef.current = null;
            setSelectionBox(null);
            return;
        }

        if (selectionMovedRef.current && selectionBox) {
            selectItemsInBox(selectionBox);
        } else {
            const start = selectionStartRef.current;
            if (start) {
                // bug 32：单击也以虚拟起点反解画布坐标，滚动后仍命中原拍点（起点锚定谱面坐标）
                const p = virtualToCanvas(start.vx, start.vy);
                if (hitStartMarker(p.x, p.y)) {
                    setSelectedItems([]);
                    setMarkerSelected(true);
                } else {
                    selectItemAtPoint(p.x, p.y, e.shiftKey, e.ctrlKey || e.metaKey);
                }
            }
        }

        selectionStartRef.current = null;
        setSelectionBox(null);
    }, [selectedTool, selectionBox, notes, selectedItems, computeItemsInBox, editToolAction, editToolPaste, findItemAt, getLaneBeatFromCanvas, cssToCanvas, hitStartMarker, virtualToCanvas]);

    // 右键删除滑条子段：区域（连接带）/ 端点 / 中间结点
    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const hit = findItemAt(mouseX, mouseY, { geometry, viewport, beatDisplay, notes });
        if (!hit) return;
        setSelectedItems([hit]);
        handleNotesChange(deleteSelection(notes, [hit]));
    }, [notes, findItemAt]);

    // ---------------------------
    // 生命周期和效果
    // ---------------------------
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.addEventListener('wheel', handleWheel, { passive: false });
        return () => canvas.removeEventListener('wheel', handleWheel);
    }, [handleWheel]);

    // 渲染：在 React 提交后、浏览器 paint 前【同步】调用 renderChart（useLayoutEffect）。
    // issue 38（根因 b）：轨道可见宽 = LANES·LANE_WIDTH·effectiveScale，而
    // effectiveScale = min(用户scale, fitWidth(surface.w))。容器宽（surface.w）变化 - 折叠/展开侧栏、
    // 切回工作台 - 会改变 fitWidth；在 fitWidth<用户scale（钳制区）时轨道宽应跟随容器宽。
    // 但原先 viewport.scale 只在 paint 后的单独 useEffect 里按新 geometry 重新钳制，而此处渲染在
    // paint 前已用【新 geometry × 旧 viewport.scale】算 effectiveScale → 钳制区轨道宽错一帧（"先偏宽/
    // 偏窄、随后修正"）。
    // 修复：渲染前先核对 viewport.scale == effectiveScale(新 geometry)；若不等，先同步 setViewport
    // （useLayoutEffect 内的 setState 会在 paint 前引发同步重渲染），本次不绘制；重渲染后 renderCanvas
    // 闭包已带正确 scale，再按正确轨道宽原子绘制。保证 surface 变化帧轨道宽即正确、无陈旧帧。
    useLayoutEffect(() => {
        const es = geometry.effectiveScale(Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale)));
        if (Math.abs(viewport.scale - es) > 1e-9) {
            setViewport((prev) =>
                Math.abs(prev.scale - es) > 1e-9 ? { ...prev, scale: es } : prev
            );
            return; // 待重渲染后再绘制
        }
        renderCanvas();
    }, [renderCanvas, viewport.scale, geometry, scale]);

    // 回到工作台强制补一帧（issue 29 用户反馈2）：五页保活挂载（AppShell），离开工作台期间背景皮肤的
    // 换图/开关/透明度变化不经过任何画布交互路径，可能停在旧帧直到用户滚动。经 ref 取最新 renderCanvas，
    // 仅在 active 翻转为 true 时补绘一次，不增加交互帧成本。
    const paintOnActivateRef = useRef<() => void>(() => {});
    paintOnActivateRef.current = renderCanvas;
    const wasActiveRef = useRef<boolean>(active ?? true);
    useEffect(() => {
        const now = active ?? true;
        if (now && !wasActiveRef.current) {
            paintOnActivateRef.current();
        }
        wasActiveRef.current = now;
    }, [active]);

    useEffect(() => {
        return () => {
            if (zoomSettleTimerRef.current !== undefined) {
                clearTimeout(zoomSettleTimerRef.current);
            }
        };
    }, []);

    // 初始视口设置 - 只在组件首次挂载时执行
    useEffect(() => {
        const es = geometry.effectiveScale(viewport.scale);
        const totalVirtualHeight = chartEndVirtualY + surf.h / es;
        const scaledBounds = getScaledVirtualBounds(viewport.scale);
        const initialScrollY = Math.max(scaledBounds.minY, Math.min(scaledBounds.maxY - surf.h / es, totalVirtualHeight - surf.h / es));
        setViewport(prev => ({
            ...prev,
            scrollY: initialScrollY,
            virtualHeight: totalVirtualHeight,
            virtualWidth: LANES * LANE_WIDTH + TRACK_CHROME_TOTAL * 2
        }));
        if (onScrollChange) {
            onScrollChange(initialScrollY, totalVirtualHeight);
        }
    }, []); // 只在组件首次挂载时执行，不监听任何依赖

    // 同步外部scale变化（ADR-0006 Q4=A：视图 scale 恒等于 effectiveScale，保证渲染/命中一致）
    // issue 36 F3b：surface/chartEnd/BPM 变化都会换 geometry 实例，若此处无条件新建 viewport
    // 对象，即使 effectiveScale 值未变也会多出一次渲染 + rAF 重排（resize 结算链双渲染的来源之一）。
    // 值未变时返回 prev，与上方 [scale] effect 的守卫同款。
    useEffect(() => {
        setViewport(prev => {
            const next = geometry.effectiveScale(Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale)));
            return Math.abs(prev.scale - next) > 1e-9 ? { ...prev, scale: next } : prev;
        });
    }, [scale, geometry]);

    // 通知滚动变化
    useEffect(() => {
        if (onScrollChange) {
            onScrollChange(viewport.scrollY, viewport.virtualHeight);
        }
    }, [viewport.scrollY, viewport.virtualHeight, onScrollChange]);

    // 画布实时信息叠加（issue 22）：判定线处精确时间（左下）+ 已过判定线音符数（右下）。
    // 判定线 = 画布底边，故叠加层贴 bottom 置于其上；pointerEvents:none 不干扰画布交互。
    const playheadBeat = useMemo(
        () => secondsToBeat(getBpmEvents(notes), currentSeconds),
        [notes, currentSeconds],
    );
    const passedNoteCount = useMemo(
        () => countNotesUpToBeat(notes, playheadBeat),
        [notes, playheadBeat],
    );

    // issue 50（Q24 a）：surface 为 null 时不渲染（chartArea 还未就绪；保护所有依赖 surface 的几何/绘制）
    if (!surface) return null;

    return (
        <div style={{
            backgroundColor: '#000000',
            padding: '0',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%', // 铺满外层 sticky 容器的可视高度（父级已给确定高度）
            overflow: 'hidden' // 完全禁用滚动条
        }}>

            {/* 画布区域 - 完全填充容器 */}
            <div style={{
                position: 'relative',
                backgroundColor: '#000000',
                width: '100%',
                height: '100%',
                minHeight: '100%', // 确保最小高度
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                overflow: 'hidden' // 禁用滚动条
            }}>
                <canvas
                    ref={canvasRef}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onContextMenu={handleContextMenu}
                    onDoubleClick={handleDoubleClick}
                    onMouseLeave={() => setMousePosition(null)}
                    onClick={handleClick}
                    style={{
                        backgroundColor: '#000000',
                        display: 'block',
                        userSelect: 'none',
                        boxSizing: 'border-box', // issue 50：border 算进 100% 尺寸，避免比父级宽 2px 触发 overflow
                        border: '1px solid #333',
                        // ADR-0006 §1：canvas 缓冲 = surface × dpr（renderChart 设置）；React 不触碰缓冲属性
                        // （不在 JSX 里写 width={surf.w} 作为 HTML 属性，那会重设缓冲并触发错帧）。
                        // issue 50（Q6 a 修正语义）：canvas CSS width/height = 100%，与 background div 同尺寸；
                        // 绘制坐标系用 surf（= chartArea 真实尺寸），轨道在画布内水平居中（letterbox 在 canvas 绘制层）。
                        // 之前的"width:100% 会闪一帧"担心在 issue 50 hotfix 后已不成立（StrictMode RO 同步回调，
                        // 不会出现 canvas 已变宽但 surface 还在旧值的中间态）。
                        width: '100%',
                        height: '100%',
                        position: 'relative',
                        zIndex: 10 // 确保Canvas在最上层
                    }}
                />

                {/* 画布实时信息叠加层（issue 22）：常显，不拦截指针 */}
                <div style={{
                    position: 'absolute', left: 0, right: 0, bottom: 8,
                    display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
                    pointerEvents: 'none', zIndex: 20, padding: '0 12px',
                    fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
                    fontSize: 'var(--text-sm)', color: 'rgba(230,236,239,0.75)',
                    textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                }}>
                    <span>{formatTimePrecise(currentSeconds)}</span>
                    <span title="已过判定线的音符数">♪ {passedNoteCount}</span>
                </div>
            </div>
        </div>
    );
});

export default FinalVirtualCanvas;
