import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from "react";
import type { BpmNote, ChartNote, SelectionItem } from "../../types";
import CanvasSpriteIcon from '../../../ui/CanvasSpriteIcon';
import { deleteSelection } from '../../editing/SelectionEditing';
import { planDragMove, draggableFromItems } from '../../editing/NoteDragging';
import {
  clickOps, boxSelectOps, execSlideOps, execBpmOps, pointerClickSelection,
  sameSelectionItem, type MatrixOp, type SlidePoint,
} from '../../editing/ToolActionMatrix';
import { getBpmEvents, secondsToBeat, chartLengthToEndBeat, type BpmEvent } from '../../../audio/AudioTiming';
import {
  ChartGeometry, LANES, LANE_WIDTH,
  TRACK_CHROME_TOTAL, type SurfaceSize,
} from '../../geometry/ChartGeometry';
import { useEditing, useUI, usePlayback, useConfig } from '../../../app/ProviderTree';
import { renderChart, findItemAt, computeItemsInBox, type RenderCtx, type ViewportState } from '../../../visual';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '../../../visual/noteSkin';
import { normalizeBackgroundOpacity } from '../../../visual/staticLayerCache';
import { BPM_LABEL_GAP_PX, GUTTER_LABEL_FONT_PX } from '../../../visual/gutterLabels';
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
 * 画布 imperative 句柄（架构深化评审候选 1 收窄 + ADR-0008 §3 执行键入口）：
 * 只暴露 Editor 需要让画布【跟随/代执行】的动作与起点标记状态；
 * 秒↔scrollY↔滚动条 的数学全部收敛到 PlaybackScrollModel，不再经此 ref 协议跨组件调用。
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
  /** Esc 优先级链（ADR-0008 §7 第②档）：若有待连接滑条锚点则取消并返回 true——Editor 据此决定是否继续落档 */
  cancelPendingSlide?: () => boolean;
  /** Ctrl+`（§3）：光标处放置 BPM 线（默认值沿用上次的值）→ 打开 §5 就地编辑；光标不在画布 = 无事发生 */
  execBpm?: () => void;
  /** Ctrl+E（§3）：有选区 → §4 组合成滑条；无选区 → 光标处放临时端点（与鼠标两击共用 slideBuffer） */
  execSlide?: () => void;
}

// 视口缩放配置
const MAX_SCALE = 3.0;
const MIN_SCALE = 0.1;

// 拖拽判定阈值（ADR-0008 §2 原则 1）：按下移动 ≥4px = 拖拽；<4px 快速起按 = 单击
const DRAG_THRESHOLD_PX = 4;

/** BPM 事件表内容相等（issue 35 F2：内容未变时 geometry 复用旧实例，事件数通常 ≤ 个位数） */
const bpmEventsContentEqual = (a: readonly BpmEvent[], b: readonly BpmEvent[]) =>
    a === b || (a.length === b.length && a.every((e, i) => e.beat === b[i].beat && e.bpm === b[i].bpm));

/**
 * FinalVirtualCanvas（ADR-0003 候选 B 收口 + ADR-0008 交互重构）：
 * 渲染/命中/坐标全部收敛到 src/visual 纯模块；批量编辑语义收敛到 src/chart/editing 纯模块
 * （NoteReplacementRules/SelectionEditing/SlideCombination/NoteDragging，均有行锁单测）。
 * 本组件只保留：挂载/canvas 生命周期/皮肤加载、按下-拖拽-抬起输入状态机、视图状态(viewport)、
 * BPM 就地编辑输入框（§5）、imperative 方法。
 *
 * 输入模型（§2）：mousedown 记录按下点（画布坐标 + 虚拟坐标双锚，bug 32）；
 * mousemove 位移 ≥4px 进入拖拽（指针态按下音符 = 移动幽灵，其余 = 框选）；
 * 全部点击/框选动作在 mouseup 分发——原 handleClick 删除，避免与全态框选双触发。
 */
const FinalVirtualCanvas = forwardRef<FinalVirtualCanvasHandle, FinalVirtualCanvasProps>(({
    onScrollChange,
    chartEndSeconds,
    surface,
    active,
}, ref) => {
    // issue 50（Q6 a 修正语义）：画布 == background（尺寸 = chartArea 实测 surf，CSS 不再写 100%），几何坐标系用 chartArea 真实尺寸。
    // 之前的 min 维度算法（canvasW=min(parentW, floor(parentH*5/6))）导致左右 letterbox——父级比画布宽时
    // 画布居中、左右留黑底，违反"画布与 background 贴合"原意。新语义：画布 DOM = 父级实测尺寸（CSS 用 surf 而非
    // 100%，见下方 canvas 样式注释；surf 即 chartArea 实测尺寸），绘制坐标系也 = 父级，
    // 轨道水平居中绘制在画布内，多余的水平空间由 canvas 绘制层 letterbox 成黑底（renderChart 内部 trackStartX
    // 居中算法已实现）。判定线 = 画布底 = chartArea 底——音符越过 chartArea 底即判（与 Q7 一致）。
    // 兜底：surface null 时用 200×240 占位（与 useScrollModel 内部 fallback 对齐）；
    // 实际渲染在 JSX return 前早 return null，不会真正画到这组值。
    // useMemo 包裹：避免每次 render 重建对象导致下游 useMemo/useEffect 依赖抖动
    const surf: SurfaceSize = useMemo(() => surface ?? { w: 200, h: 240 }, [surface]);
    // 状态经 hooks 直读（ADR-0003 §7）
    const {
        notes, selectedItems, setSelectedItems, clipboard, setClipboard,
        handleNotesChange,
    } = useEditing();
    // armedTool = 持工具态（ADR-0008 §1）：null = 指针底态；选区与工具解耦、常驻不清
    const { armedTool, beatDisplay, scale, setScale, setMousePosition, mousePosition } = useUI();
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
    // ADR-0008 §5：BPM 就地编辑（无模态打断）。默认值 = 上一次放置所设的值（初始 120）
    const lastBpmRef = useRef(120);
    const [bpmEdit, setBpmEdit] = useState<{ beat: number; value: string } | null>(null);
    // 拖拽移动（§6）：指针态按下音符 → 拖 = 移动；ghost = 移动后受影响音符（渲染器半透明绘制）
    const dragRef = useRef<{ items: SelectionItem[]; pressBeat: number; pressLane: number } | null>(null);
    const [dragGhost, setDragGhost] = useState<ChartNote[] | null>(null);

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

    /** 放置/执行的合法落点：轨道内 ∧ beat≥0 ∧ 不超谱面末端（ADR-0005 §5）；非法 → null（§1"该位置非法则无事发生"） */
    const snapPos = (cx: number, cy: number): { beat: number; lane: number } | null => {
        const pos = getLaneBeatFromCanvas(cx, cy);
        if (!pos) return null;
        if (pos.preciseBeat > chartEndBeat + 1e-6) return null;
        return { beat: pos.preciseBeat, lane: pos.lane };
    };

    // slideBuffer 归一化为矩阵输入（Canvas 态 subBeat 可选，矩阵 SlidePoint 必填）
    const bufferPoint: SlidePoint | null = slideBuffer
        ? { beat: slideBuffer.beat, lane: slideBuffer.lane, subBeat: slideBuffer.subBeat || 0 }
        : null;

    // 点选（ADR-0008 §2 指针行）：加选/去选/Ctrl 整条滑条的合并语义已纯函数化（pointerClickSelection，
    // 行锁单测）；此处只做命中换算与"标记选中互斥"清标记
    const selectItemAtPoint = (cx: number, cy: number, additive: boolean, ctrl: boolean) => {
        setMarkerSelected(false); // 起点标记与音符选择互斥（ADR-0004 §4）
        const hit = findItemAt(cx, cy, { geometry, viewport, beatDisplay, notes, noteSize: display.noteSize });
        setSelectedItems(pointerClickSelection(selectedItems, hit, additive, ctrl));
    };

    // ---------------------------
    // ADR-0008 §2 语义矩阵的画布侧编排（输入状态机）
    // 交互处理器全部用普通函数（每次渲染重建、闭包恒新）——事件只经 React props 挂接，
    // 不进任何 effect/缓存依赖，memo 化只会制造陈旧闭包风险。
    // ---------------------------

    /** 左沟槽 BPM 数字命中（§5 手势仲裁：单击数字 = 就地编辑；返回该 BPM 的 beat） */
    const hitBpmLabel = (cx: number, cy: number): number | null => {
        const { trackBgX } = geometry.trackGeometry(viewport.scale);
        if (cx >= trackBgX) return null;
        const fontPx = Math.round(GUTTER_LABEL_FONT_PX * (display.labelScale ?? 1));
        const half = fontPx / 2 + 4; // 与绘制同款垂直居中 + 少量容差
        for (const n of notes) {
            if (n.type !== 'BPM') continue;
            const y = virtualToCanvas(0, beatToVirtualY(n.beat)).y;
            if (Math.abs(cy - y) <= half) return n.beat;
        }
        return null;
    };

    // 左沟槽命中起点标记线（ADR-0004 §4；与音符命中路径无关）
    const hitStartMarker = (cx: number, cy: number): boolean => {
        if (markerBeat === null) return false;
        const { trackBgX } = geometry.trackGeometry(viewport.scale);
        if (cx >= trackBgX) return false;
        const markerVirtualY = beatToVirtualY(markerBeat);
        const markerCanvasY = virtualToCanvas(0, markerVirtualY).y;
        return Math.abs(cy - markerCanvasY) < 10 * viewport.scale;
    };

    /** 矩阵 op 应用器：逐条执行 ToolActionMatrix（§2/§3 纯调度层）输出的副作用指令。
     *  一次手势内 setNotes 至多一条 = 一个可回退快照（§8） */
    const applyOps = (ops: MatrixOp[]) => {
        for (const op of ops) {
            if (op.t === 'setNotes') handleNotesChange(op.notes);
            else if (op.t === 'setSelection') setSelectedItems(op.items);
            else if (op.t === 'setClipboard') setClipboard(op.notes);
            else if (op.t === 'setSlideBuffer') setSlideBuffer(op.point);
            else if (op.t === 'openBpmEditor') setBpmEdit({ beat: op.beat, value: op.value });
        }
    };

    /** §5：提交就地编辑（Enter / 失焦）。无效数值 = 取消编辑（保留放置时已应用的值） */
    const commitBpmEdit = () => {
        if (!bpmEdit) return;
        const v = parseInt(bpmEdit.value, 10);
        const beat = bpmEdit.beat;
        setBpmEdit(null);
        if (Number.isNaN(v) || v <= 0) return;
        const idx = notes.findIndex(n => n.type === 'BPM' && Math.abs(n.beat - beat) < 1e-9);
        if (idx < 0) return; // 标记已不在（undo 等）→ 放弃
        const cur = notes[idx] as BpmNote;
        if (cur.bpm !== v) {
            lastBpmRef.current = v;
            handleNotesChange(notes.map((n, i) => i === idx ? { ...cur, bpm: v } : n));
        }
    };

    // 就地编辑输入框挂载即聚焦全选（光标置于数字内，§5）
    const attachBpmInput = useCallback((el: HTMLInputElement | null) => {
        if (el) { el.focus(); el.select(); }
    }, []);

    /** §2 框选矩阵（行语义在 ToolActionMatrix.boxSelectOps，逐行锁单测）：
     *  指针行 = 建立选区 + 标记互斥（本地语义），其余工具族行 = 纯调度输出 op */
    const applyBoxAction = (box: { x1: number; y1: number; x2: number; y2: number }) => {
        const items = computeItemsInBox(box, { geometry, viewport, beatDisplay, notes });
        if (armedTool === null) {
            setSelectedItems(items);
            setMarkerSelected(false); // 起点标记与音符选择互斥（ADR-0004 §4）
        } else {
            applyOps(boxSelectOps(armedTool, notes, items));
        }
    };

    /** §2 单击矩阵（未达拖拽阈值的快速起按）；坐标为虚拟锚定的按下点（bug 32） */
    const handleToolClick = (cx: number, cy: number, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
        // §5 手势仲裁：任何工具态下单击沟槽 BPM 数字 = 就地编辑（无需切回 BPM 工具）。
        // 用"既有值"打开编辑器，与 BPM 工具点击的"lastBpm 覆盖后编辑"是两条路径（§5）
        const labelBeat = hitBpmLabel(cx, cy);
        if (labelBeat !== null) {
            const n = notes.find(nt => nt.type === 'BPM' && Math.abs(nt.beat - labelBeat) < 1e-9) as BpmNote | undefined;
            if (n) { setBpmEdit({ beat: labelBeat, value: String(n.bpm) }); return; }
        }
        if (armedTool === null) {
            // 指针：标记线 / 音符选中（Shift 加选、Ctrl 整条滑条）/ 空白清空选区
            if (hitStartMarker(cx, cy)) {
                setSelectedItems([]);
                setMarkerSelected(true);
            } else {
                selectItemAtPoint(cx, cy, e.shiftKey, e.ctrlKey || e.metaKey);
            }
            return;
        }
        // 动作族（C/X/T/Q）才需要音符命中（空白=无效果不清选区）；其余行只吃栅格落点
        const needHit = armedTool === 'copy' || armedTool === 'cut'
            || armedTool === 'delete' || armedTool === 'mirror';
        const hit = needHit
            ? findItemAt(cx, cy, { geometry, viewport, beatDisplay, notes, noteSize: display.noteSize })
            : null;
        applyOps(clickOps({
            tool: armedTool, notes, hit,
            pos: snapPos(cx, cy),
            slideBuffer: bufferPoint,
            lastBpm: lastBpmRef.current,
            clipboard,
        }));
    };

    /** §6：指针态按下音符 → 建立拖拽候选（命中 ∈ 选区且选区≥2 → 组拖，否则单拖命中项） */
    const beginDragCandidate = (cx: number, cy: number) => {
        const hit = findItemAt(cx, cy, { geometry, viewport, beatDisplay, notes, noteSize: display.noteSize });
        if (!hit) return;
        const inSelection = selectedItems.some(it => sameSelectionItem(it, hit));
        const source = inSelection && selectedItems.length >= 2 ? selectedItems : [hit];
        const items = draggableFromItems(notes, source);
        if (items.length === 0) return; // BPM/System/区域等非可拖对象 → 退回框选
        const p = snapPos(cx, cy);
        if (!p) return;
        dragRef.current = { items, pressBeat: p.beat, pressLane: p.lane };
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) return; // 只响应左键（右键走 contextmenu）
        const pos = cssToCanvas(e);
        if (!pos) return;
        // bug 32：起点同时存画布坐标（拖拽阈值/渲染基线）与虚拟坐标（滚动时锚定谱面时刻）
        const v = canvasToVirtual(pos.x, pos.y);
        selectionStartRef.current = { x: pos.x, y: pos.y, vx: v.x, vy: v.y };
        selectionMovedRef.current = false;
        setSelectionBox(null);
        setDragGhost(null);
        dragRef.current = null;
        // 拖拽移动只存在于指针态（§6"其他持工具态下拖拽一律 = 框选"）；标记线上按下不拖音符
        if (armedTool === null && !hitStartMarker(pos.x, pos.y)) {
            beginDragCandidate(pos.x, pos.y);
        }
    };

    /** 当前按下点相对拖拽锚的栅格位移（吸附 = beat 栅格 × lane 整格，与放置同规则） */
    const dragDelta = (mx: number, my: number) => {
        const drag = dragRef.current;
        if (!drag) return null;
        const cur = snapPos(mx, my);
        if (!cur) return null;
        return { dBeat: cur.beat - drag.pressBeat, dLane: cur.lane - drag.pressLane };
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        const canvasPos = cssToCanvas(e);
        if (!canvasPos) return;
        const mouseX = canvasPos.x;
        const mouseY = canvasPos.y;
        // 记录悬停位置（供工具态预览：放置/粘贴/镜像）
        setHoverPos({ cx: mouseX, cy: mouseY });
        // 更新状态栏鼠标位置与粘贴/执行键锚点
        const pos = getLaneBeatFromCanvas(mouseX, mouseY);
        if (pos) {
            setMousePosition({ beat: pos.preciseBeat, lane: pos.lane });
        } else {
            setMousePosition(null);
        }
        if (!selectionStartRef.current) return;
        const start = selectionStartRef.current;
        const dx = mouseX - start.x;
        const dy = mouseY - start.y;
        if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
        selectionMovedRef.current = true;
        if (dragRef.current) {
            // §6 指针态移动：幽灵预览 = 合法落点下的移动结果；非法 → 隐藏幽灵（松手回弹）
            const d = dragDelta(mouseX, mouseY);
            if (!d || (d.dBeat === 0 && d.dLane === 0)) { setDragGhost(null); return; }
            const r = planDragMove(notes, dragRef.current.items, d, { chartEndBeat });
            if (r.ok) {
                setDragGhost(r.notes.filter((n, i) => n !== notes[i]));
            } else {
                setDragGhost(null);
            }
            return;
        }
        // §2 原则2：任何持工具态都可框选（原 mouse||mirror 门控废除）
        // bug 32：以虚拟坐标求矩（起点锚定谱面时刻/轨道），再转回画布坐标供渲染/命中——
        // 即使拖拽过程中滚动，起点对应的拍点也不漂移（"长截图"式选区）
        const cur = canvasToVirtual(mouseX, mouseY);
        const p1 = virtualToCanvas(start.vx, start.vy);
        const p2 = virtualToCanvas(cur.x, cur.y);
        setSelectionBox({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
    };

    const handleMouseUp = (e: React.MouseEvent) => {
        const start = selectionStartRef.current;
        const moved = selectionMovedRef.current;
        const box = selectionBox;
        const drag = dragRef.current;
        selectionStartRef.current = null;
        dragRef.current = null;
        setSelectionBox(null);
        setDragGhost(null);
        if (!start || e.button !== 0) return;

        if (moved && drag) {
            // §6 松手提交：合法 → 单次 handleNotesChange（一个快照）+ 拖拽集合保留为选区；非法 → 回弹
            const pos = cssToCanvas(e);
            const d = pos ? dragDelta(pos.x, pos.y) : null;
            if (d && (d.dBeat !== 0 || d.dLane !== 0)) {
                const r = planDragMove(notes, drag.items, d, { chartEndBeat });
                if (r.ok) {
                    handleNotesChange(r.notes);
                    setSelectedItems(r.items);
                }
            }
            return;
        }
        if (moved) {
            if (box) applyBoxAction(box);
            return;
        }
        // 单击（<阈值）：bug 32 以虚拟起点反解画布坐标，滚动后仍命中原谱面位置
        const p = virtualToCanvas(start.vx, start.vy);
        handleToolClick(p.x, p.y, e);
    };

    // 左沟槽双击：放置/删除临时起点标记（ADR-0004）。BPM 数字位上让位给单击就地编辑（§5 手势仲裁）
    const handleDoubleClick = (e: React.MouseEvent) => {
        const pos = cssToCanvas(e);
        if (!pos) return;
        const { trackBgX } = geometry.trackGeometry(viewport.scale);
        if (pos.x >= trackBgX) return;
        if (hitBpmLabel(pos.x, pos.y) !== null) return;
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
    };

    // 右键删除滑条子段：区域（连接带）/ 端点 / 中间结点
    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const hit = findItemAt(mouseX, mouseY, { geometry, viewport, beatDisplay, notes });
        if (!hit) return;
        setSelectedItems([hit]);
        handleNotesChange(deleteSelection(notes, [hit]));
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
            armedTool,
            dragGhost,
            spriteIcon: spriteIcon.current,
            noteIcons,
            zoomGesture: performance.now() < zoomGestureUntilRef.current, // 手势期间瓦片只 blit（issue 10）
            skinVersion,
            // issue 39：画布显示参数（节奏图示大小/长压线不透明度/同时点击线）
            // issue 51/53 第二轮：轨道颜色主题 + 线形分层开关 + 文字大小系数（进静态层渲染参数）
            display: {
              noteSize: display.noteSize,
              slideOpacity: display.slideOpacity,
              simultaneousClickLines: display.simultaneousClickLines,
              colorAssist: display.colorAssist,
              gridStyle: display.gridStyle,
              lineShapeTiers: display.lineShapeTiers,
              gridOpacity: display.gridOpacity,
              labelScale: display.labelScale,
            },
            // 背景皮肤（issue 29 Q4）：进静态层绘制
            background,
        };
        renderChart(ctx, canvas, rc);
    }, [notes, selectedItems, viewport, selectionBox, slideBuffer, beatDisplay, armedTool, hoverPos, dragGhost, clipboard, markerBeat, markerSelected, skinVersion, geometry, chartEndBeat, renderTick, display.noteSize, display.slideOpacity, display.simultaneousClickLines, display.colorAssist, display.imageQuality, display.gridStyle, display.lineShapeTiers, display.gridOpacity, display.labelScale, noteIcons, background]);

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
    // 事件处理（滚轮例外：原生 listener，需 passive:false）
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

    // 暴露方法给父组件（候选 1 收窄 + ADR-0008 执行键入口；factory 每次渲染重建 → 闭包恒新）
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
        // Esc 四档链第②档（ADR-0008 §7）：有待连接滑条锚点才消费本次 Esc（返回值供 Editor 决定是否落档）
        cancelPendingSlide: () => {
            if (slideBuffer === null) return false;
            setSlideBuffer(null);
            return true;
        },
        // ADR-0008 §3 执行键（Ctrl+` / Ctrl+E）：经 ref 进画布，与鼠标路径共用 ToolActionMatrix 调度
        execBpm: () => {
            applyOps(execBpmOps({
                notes, selectedItems, cursor: mousePosition,
                slideBuffer: bufferPoint, lastBpm: lastBpmRef.current, chartEndBeat,
            }));
        },
        execSlide: () => {
            applyOps(execSlideOps({
                notes, selectedItems, cursor: mousePosition,
                slideBuffer: bufferPoint, lastBpm: lastBpmRef.current, chartEndBeat,
            }));
        },
    }));

    // 切换离开滑条工具时清空待连接锚点（防止残留红点）
    useEffect(() => {
        if (armedTool !== "slide") {
            setSlideBuffer(null);
        }
    }, [armedTool]);

    // （ADR-0008 §1 对象轴）原"切换离开鼠标工具清选区"effect 已删除：选区常驻、与持工具态解耦。

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

    // 回到工作台强制补一帧（issue 29 用户反馈2）：五页保活挂载（AppShell），离开工作台期间的背景皮肤的
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

    // ADR-0008 §5：BPM 就地编辑输入框定位——覆盖在沟槽数字上（与 layoutGutterLabel 同款锚定：
    // 右缘 = 轨道左外缘 − 8px，垂直居中于 BPM 线、钳进画布）
    let bpmInputBox: { left: number; top: number; width: number; height: number; fontPx: number } | null = null;
    if (bpmEdit) {
        const fontPx = Math.round(GUTTER_LABEL_FONT_PX * (display.labelScale ?? 1));
        const { trackStartX } = geometry.trackGeometry(viewport.scale);
        const rightEdge = trackStartX - BPM_LABEL_GAP_PX;
        const width = Math.max((bpmEdit.value.length || 3) * fontPx * 0.62 + 8, fontPx * 2);
        const lineY = virtualToCanvas(0, beatToVirtualY(bpmEdit.beat)).y;
        const centerY = Math.min(Math.max(lineY, fontPx / 2), surf.h - fontPx / 2);
        bpmInputBox = { left: Math.max(0, rightEdge - width), top: centerY - fontPx / 2 - 3, width, height: fontPx + 6, fontPx };
    }

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
                {/* 画布盒（尺寸=surf）：canvas 与 BPM 就地编辑输入框共锚于此，输入框坐标=画布坐标 */}
                <div style={{ position: 'relative', width: surf.w, height: surf.h, flexShrink: 0 }}>
                    <canvas
                        ref={canvasRef}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onContextMenu={handleContextMenu}
                        onDoubleClick={handleDoubleClick}
                        onMouseLeave={() => {
                            // issue 54：hoverPos 一并清空，实时显示线不残留；离开画布 = 取消进行中的按下手势
                            setMousePosition(null); setHoverPos(null);
                            selectionStartRef.current = null;
                            selectionMovedRef.current = false;
                            dragRef.current = null;
                            setSelectionBox(null);
                            setDragGhost(null);
                        }}
                        style={{
                            backgroundColor: '#000000',
                            display: 'block',
                            userSelect: 'none',
                            boxSizing: 'border-box', // issue 50：border 算进尺寸，避免比父级宽 2px 触发 overflow
                            border: '1px solid #333',
                            // ADR-0006 §1：canvas 缓冲 = surface × dpr（renderChart 设置）；React 不触碰缓冲属性
                            // （不在 JSX 里写 width={surf.w} 作为 HTML 属性，那会重设缓冲并触发错帧）。
                            // CSS 尺寸改为跟随 surf 本身（而非 100%）：缓冲 = surf×dpr，若 CSS 盒 = 容器实时宽（100%），
                            // 二者在面板展开/收起的 200ms width 过渡期间不同步——容器实时变宽/窄，surf 与缓冲滞后约一帧，
                            // 浏览器把缓冲拉伸到 CSS 盒 → 轨道横向被拉宽再回弹（单侧折叠几乎不可见，双侧折叠容器每帧变化翻倍、
                            // 误差翻倍即可见）。改为 CSS = surf 后缓冲与 CSS 盒恒等 → 无拉伸；即便某帧 surf 略旧，画布只是
                            // 在外层 #000 包装里居中、边缘留一条同为 #000 的黑缝（黑配黑不可见），轨道比例始终精确。
                            // 稳态（surf==容器宽）与原 100% 行为一致；getBoundingClientRect 命中坐标也与绘制空间对齐。
                            width: surf.w,
                            height: surf.h,
                            position: 'relative',
                            zIndex: 10 // 确保Canvas在最上层（输入框在其上另设 z）
                        }}
                    />
                    {/* ADR-0008 §5：BPM 数字就地编辑（Enter 应用/Esc 取消/失焦应用；无模态打断）。
                        输入框焦点属 ADR-0002 §6 快捷键作用域放行，全局分发不抢键 */}
                    {bpmEdit && bpmInputBox && (
                        <input
                            ref={attachBpmInput}
                            value={bpmEdit.value}
                            onChange={(e) => setBpmEdit(prev => prev ? { ...prev, value: e.target.value } : prev)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commitBpmEdit(); }
                                else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setBpmEdit(null); }
                            }}
                            onBlur={() => commitBpmEdit()}
                            onMouseDown={(e) => e.stopPropagation()}
                            onDoubleClick={(e) => e.stopPropagation()}
                            style={{
                                position: 'absolute',
                                left: bpmInputBox.left,
                                top: bpmInputBox.top,
                                width: bpmInputBox.width,
                                height: bpmInputBox.height,
                                font: `600 ${bpmInputBox.fontPx}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`,
                                textAlign: 'right',
                                color: '#e6ecef',
                                backgroundColor: 'rgba(18, 22, 26, 0.95)',
                                border: '1px solid #53b8c9',
                                borderRadius: 3,
                                padding: '0 4px',
                                boxSizing: 'border-box',
                                outline: 'none',
                                zIndex: 30,
                            }}
                        />
                    )}
                </div>

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
