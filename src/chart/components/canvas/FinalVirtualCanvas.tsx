import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from "react";
import type { BpmNote } from "../../types";
import CanvasSpriteIcon from '../../../ui/CanvasSpriteIcon';
import {
  clickOps, execSlideOps, execBpmOps, execCurveOps,
  type MatrixOp, type MatrixTool, type SlidePoint, type SnapPos,
  type CurveDraft,
} from '../../editing/ToolActionMatrix';
import {
  GestureSession, type GestureOp, type GestureResult, type GestureSessionHost,
} from '../../editing/GestureSession';
import {
  LANES, LANE_WIDTH,
  TRACK_CHROME_TOTAL, type ChartGeometry, type SurfaceSize,
} from '../../geometry/ChartGeometry';
import { useEditing, useUI, usePlayback, useConfig } from '../../../app/ProviderTree';
import { useChartCodeEditor } from '../code-editor/ChartCodeEditorProvider';
import { renderChart, findItemAt, type RenderCtx, type ViewportState } from '../../../visual';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '../../../visual/noteSkin';
import { normalizeBackgroundOpacity } from '../../../visual/staticLayerCache';
import { BPM_LABEL_GAP_PX, GUTTER_LABEL_FONT_PX, measureGutterLabelWidth } from '../../../visual/gutterLabels';
import { useBackgroundSkin } from '../../rendering/useBackgroundSkin';
import { countNotesUpToBeat } from '../../editing/NoteEditing';
import { t } from '../../../i18n';
import {
  hitStartMarkerAt, hitBpmLabelAt,
  isInsideSurface,
  canPlaceAtCursor, resolveExecNoteCodeHit,
} from '../../editing/CanvasGesture';
import { formatTimePrecise } from '../../geometry/TimeFormat';

interface FinalVirtualCanvasProps {
  // 仅留 onScrollChange（虚拟高度需经 Editor 同步给滚动条容器）；其余状态经 hooks 直读（ADR-0003 §7）
  onScrollChange?: (scrollY: number, virtualHeight: number) => void;
  /**
   * issue 110：**滚动宿主**（Editor 的 `overflow:auto` 容器）。Shift+滚轮被浏览器映射为横向滚动，
   * 而容器 `overflowX:hidden` 会把它吃掉 → 画布在这里把它转回纵向。画布自己滚不动（它不是滚动容器）。
   */
  scrollHostRef?: React.RefObject<HTMLDivElement | null>;
  /** issue 134：与 useScrollModel 同一份布局轴几何（Editor 经 useChartSpace 注入） */
  geometry: ChartGeometry;
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
  /** issue 101：播放 RAF 启动/停止时同步打标，避免首帧仍走无预算的静止重建。 */
  setPlaybackActive?: (active: boolean) => void;
  /** 起点标记（ADR-0004 §4）：Editor 经此做 Ctrl+空格 回跳 / Delete 删除。 */
  getMarkerBeat?: () => number | null;
  getMarkerSelected?: () => boolean;
  setMarkerSelected?: (sel: boolean) => void;
  clearMarker?: () => void;
  /** Esc 优先级链（ADR-0008 §7 第②档，issue 109）：若有**进行中手势**（画笔/拖拽/框选/右键删除预览）
   *  则取消它并返回 true——Editor 据此决定是否继续落档。取消后保持工具态与选区 */
  cancelActiveGesture?: () => boolean;
  /** Esc 优先级链（ADR-0008 §7 第③档）：若有待连接滑条锚点/曲线草稿则取消并返回 true——Editor 据此决定是否继续落档 */
  cancelPendingSlide?: () => boolean;
  /** Ctrl+`（§3）：光标处放置 BPM 线（默认值沿用上次的值）→ 打开 §5 就地编辑；光标不在画布 = 无事发生 */
  execBpm?: () => void;
  /** Ctrl+E（§3）：有选区 → §4 组合成滑条；无选区 → 光标处放临时端点（与鼠标两击共用 slideBuffer） */
  execSlide?: () => void;
  /** Shift+W（验收反馈 #9）：执行-曲线——选区≥2 = 组合+全部段应用；否则与曲线工具单击同源
   *  （hover 在段上=重应用当前配置 / 空白=挂锚点续段，与单击共用 curveDraft） */
  execCurve?: () => void;
  /** issue 59 §2：Ctrl+B —— 打开**光标处**音符的代码（不切工具的快捷版）；光标不在音符上 = 无事发生 */
  execNoteCode?: () => void;
  /**
   * Ctrl+F/G/A/S/D（§3）：光标处放置该键型 —— **与单击放置共用 clickOps**，
   * 故 §2 原则 6（清选区）与 snapPos 的"越谱面末端 = 非法落点"判定自动一致
   *（原先走 Editor 的 place() 绕过矩阵：不清选区、且能在末端外放置）。
   */
  execPlace?: (tool: MatrixTool) => void;
  /** issue 73：Ctrl+V —— 光标处粘贴（与粘贴工具单击同源，含整组越末端的拒绝判定） */
  execPaste?: () => void;
}

// 视口缩放配置
const MAX_SCALE = 3.0;
const MIN_SCALE = 0.1;

// 拖拽判定阈值（ADR-0008 §2 原则 1）：按下移动 ≥4px = 拖拽；<4px 快速起按 = 单击
/** FinalVirtualCanvas（ADR-0003 候选 B 收口 + ADR-0008 交互重构）：
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
    scrollHostRef,
    geometry,
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
    const { armedTool, beatDisplay, scale, setScale, curveConfig } = useUI();
    const { setMarker: setMarkerContext, currentSeconds, isPlaying } = usePlayback();
    // issue 59 §2/§3：「音符代码」工具点击 → 打开该音符的代码弹窗（与「谱面代码」按钮共用同一弹窗）
    const { openNoteCode } = useChartCodeEditor();
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

    // 候选 3-b：**原有一条 `useEffect([scale])` 已删除** —— 它把未钳制的 `ui.scale` 原样写进
    // viewport.scale，而下面那条 effect 紧接着用 effectiveScale 覆盖它，结果从没机会生效（死通道）。
    // 缩放双入口联动由下方 `[scale, geometry]` 的 effect 一处承担（工具栏 ±0.1 / 设置面板改值）。

    const [slideBuffer, setSlideBuffer] = useState<{ beat: number; lane: number; subBeat?: number } | null>(null);
    // 皮肤图片就绪信号：懒加载图片异步到达后 +1，触发一次重绘（否则连接带等未预热的素材会一直空白）
    const [skinVersion, setSkinVersion] = useState(0);
    // 缩放手势状态（issue 10）：手势期间离屏瓦片只按比例 blit；结束后 settle 触发一次高清重渲
    const [renderTick, setRenderTick] = useState(0);
    const zoomGestureUntilRef = useRef(0);
    const zoomSettleTimerRef = useRef<number | undefined>(undefined);
    const playbackActiveRef = useRef(false);
    // ADR-0008 §5：BPM 就地编辑（无模态打断）。默认值 = 上一次放置所设的值（初始 120）
    const lastBpmRef = useRef(120);
    const [bpmEdit, setBpmEdit] = useState<{ beat: number; value: string } | null>(null);
    // issue 09 S2（ADR-0009 §3）：曲线工具链式草稿（与 slideBuffer 同属组件侧 UI 态，不入历史）
    const [curveDraft, setCurveDraft] = useState<CurveDraft | null>(null);

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

    const [hoverPos, setHoverPos] = useState<{ cx: number; cy: number } | null>(null);
    // Q5：最后一个合法**画布 px**；frozenCursor 用时按当前 viewport 现算（不再缓存 beat/lane）
    const lastLegalPxRef = useRef<{ x: number; y: number } | null>(null);
    // 临时起点标记（ADR-0004 §4）：不入谱面数据、随会话丢弃；markerSelected 与音符选择互斥
    const [markerBeat, setMarkerBeat] = useState<number | null>(null);
    const [markerSelected, setMarkerSelected] = useState(false);

    // 起点标记状态同步到 PlaybackContext（供 PlayBar 提示 / Delete 删除判定走同一路径）
    useEffect(() => {
        setMarkerContext(markerBeat);
    }, [markerBeat, setMarkerContext]);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const spriteIcon = useRef<CanvasSpriteIcon>(new CanvasSpriteIcon());
    const sessionHostRef = useRef<GestureSessionHost>({
        setCursor: (style: string) => { if (canvasRef.current) canvasRef.current.style.cursor = style; },
        attachWindow: () => { /* 由下方 attachWindowGesture 回填 */ },
        detachWindow: () => { /* 由下方 detachWindowGesture 回填 */ },
        setTimeout: (fn: () => void, ms: number) => window.setTimeout(fn, ms),
        clearTimeout: (id: number) => window.clearTimeout(id),
    });
    const sessionRef = useRef<GestureSession | null>(null);
    if (!sessionRef.current) sessionRef.current = new GestureSession(sessionHostRef.current);
    const session = sessionRef.current;
    const [gestureSnap, setGestureSnap] = useState(() => session.getSnapshot());
    useEffect(() => session.subscribe(setGestureSnap), [session]);

    // issue 134：geometry 由 Editor useChartSpace 注入（与 PlaybackScrollModel 同引用）
    const chartEndBeat = geometry.chartEndBeat;
    const chartEndVirtualY = geometry.chartEndVirtualY;

    /**
     * 命中测试依赖（几何 / 视口 / 谱面 / noteSize）。
     * 七处调用（hover、点选、工具点击、拖拽候选、右键删除、BPM 整线、Ctrl+B）必须**同口径**，
     * 否则 noteSize≠1 时命中盒与视觉不符 —— 收敛成一处，避免逐个手写时漂移。
     */
    const hitDeps = () => ({ geometry, viewport, beatDisplay, notes, noteSize: display.noteSize });

    // issue 56 c)：hover 命中项 —— 只在 hoverPos 变化时重算（findItemAt 不进每帧渲染路径，C6）。
    // noteSize 与点选/工具点击同口径，否则命中盒与视觉不符；hidden 结点由 findItemAt 侧跳过（A6）。
    const hoverItem = useMemo(() => {
        if (!hoverPos) return null;
        return findItemAt(hoverPos.cx, hoverPos.cy, hitDeps());
    }, [hoverPos, geometry, viewport, beatDisplay, notes, display.noteSize]);

    // 坐标变换（薄封装，保持既有调用签名不变；内部均为 O(log BPM) 缓存查询）
    const getScaledVirtualBounds = (scale: number) => geometry.scaledVirtualBounds(scale);
    const beatToVirtualY = (beat: number) => geometry.beatToVirtualY(beat, viewport.scale);
    const virtualYToBeat = (virtualY: number) => geometry.virtualYToBeat(virtualY, viewport.scale);
    const virtualToCanvas = (virtualX: number, virtualY: number) => geometry.virtualToCanvas(virtualX, virtualY, viewport);
    const canvasToVirtual = (canvasX: number, canvasY: number) => geometry.canvasToVirtual(canvasX, canvasY, viewport);
    const getLaneBeatFromCanvas = (cx: number, cy: number, allowOutsideLane = false) =>
        geometry.laneBeatFromCanvas(cx, cy, viewport, beatDisplay, allowOutsideLane);

    /**
     * 候选 3（issue 70）：**谱面光标（beat/lane）是派生值，必须用时现算，不能缓存进 state。**
     * 旧实现在 handlePointerMove 里把 px 换算成 beat/lane 存进 `UIProvider.mousePosition`，
     * 而它是 `Ctrl+B/E/F..S` 执行键与 `Ctrl+V` 粘贴的落点；滚动/缩放改了 viewport 之后
     * 鼠标不动就不会重算 —— 同一个像素此刻已指向别的拍，执行键却仍按旧值落点（用户已复现）。
     * 与切片 4 的框选滚动漂移同族（都源于「把派生值缓存成 state」）。
     *
     * 真相源 = `hoverPos`（画布 px，原始输入，缓存无害）；此处即用即算，永远跟随当前 viewport。
     */
    const cursorChartPos = (): SnapPos | null => {
        if (!hoverPos) return null;
        const p = getLaneBeatFromCanvas(hoverPos.cx, hoverPos.cy);
        return p ? { beat: p.preciseBeat, lane: p.lane } : null;
    };

    // slideBuffer 归一化为矩阵输入（Canvas 态 subBeat 可选，矩阵 SlidePoint 必填）
    const bufferPoint: SlidePoint | null = slideBuffer
        ? { beat: slideBuffer.beat, lane: slideBuffer.lane, subBeat: slideBuffer.subBeat || 0 }
        : null;

    const applyOps = (ops: ReadonlyArray<MatrixOp | GestureOp>) => {
        for (const op of ops) {
            if (op.t === 'setNotes') handleNotesChange(op.notes);
            else if (op.t === 'setSelection') setSelectedItems(op.items);
            else if (op.t === 'setClipboard') setClipboard(op.notes);
            else if (op.t === 'setSlideBuffer') setSlideBuffer(op.point);
            else if (op.t === 'setCurveBuffer') setCurveDraft(op.draft);
            else if (op.t === 'openBpmEditor') setBpmEdit({ beat: op.beat, value: op.value });
            else if (op.t === 'openNoteCode') openNoteCode(op.target);
            else if (op.t === 'setMarkerSelected') setMarkerSelected(op.selected);
            else if (op.t === 'closeBpmEditor') setBpmEdit(null);
        }
    };

    const applyGesture = (r: GestureResult) => {
        if (r.ops.length > 0) applyOps(r.ops);
    };
    const hitBpmLabel = (cx: number, cy: number): number | null => hitBpmLabelAt({
        deps: { geometry, viewport, notes },
        labelScale: display.labelScale ?? 1,
        surfaceH: surf.h,
        // 与绘制端共用同一套宽度判定（传画布 ctx 精确测量），避免"已隐藏但仍可点中"的隐形热区
        measureWidth: (text, fontPx) =>
            measureGutterLabelWidth(text, fontPx, canvasRef.current?.getContext('2d') ?? null),
    }, cx, cy);

    // 左沟槽命中起点标记线（ADR-0004 §4；与音符命中路径无关）
    const hitStartMarker = (cx: number, cy: number): boolean =>
        hitStartMarkerAt({ geometry, viewport }, markerBeat, cx, cy);

    /**
     * §5：提交就地编辑（Enter / 失焦）。无效数值 = 取消编辑（保留放置时已应用的值）。
     * ADR-0010 结论 8（issue 103）：**接受负整数**——编辑器内可创建倒流区。
     * `parseInt` 口径不变：只取十进制整数部分、截断小数（"12.7" → 12、"-12.7" → -12、
     * "-225" → -225）；`0` / `-0` / 非数字（NaN，如空串、"abc"）一律视为无效、取消编辑。
     */
    const commitBpmEdit = () => {
        if (!bpmEdit) return;
        const v = parseInt(bpmEdit.value, 10);
        const beat = bpmEdit.beat;
        setBpmEdit(null);
        if (Number.isNaN(v) || v === 0) return;
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

    session.bindWorld({
        notes, selectedItems, armedTool, beatDisplay, chartEndBeat,
        geometry, viewport, surface: surf, clipboard,
        slideBuffer: bufferPoint, curveDraft, curveConfig,
        lastBpm: lastBpmRef.current, noteSize: display.noteSize,
        hitStartMarker, hitBpmLabel,
    });

    // ---------------- issue 63：手势期间的隐式指针捕获 ----------------
    const gestureHandlersRef = useRef<{
        move: (e: { clientX: number; clientY: number }) => void;
        up: (e: { clientX: number; clientY: number; button?: number; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean } | null) => void;
    }>({ move: () => { /* 首个手势开始前不会被调用 */ }, up: () => { } });
    const onWindowMove = useCallback((e: MouseEvent) => gestureHandlersRef.current.move(e), []);
    const onWindowUp = useCallback((e: MouseEvent) => gestureHandlersRef.current.up(e), []);
    const onWindowBlur = useCallback(() => gestureHandlersRef.current.up(null), []);
    const attachWindowGesture = useCallback(() => {
        window.addEventListener('mousemove', onWindowMove);
        window.addEventListener('mouseup', onWindowUp);
        window.addEventListener('blur', onWindowBlur);
    }, [onWindowMove, onWindowUp, onWindowBlur]);
    const detachWindowGesture = useCallback(() => {
        window.removeEventListener('mousemove', onWindowMove);
        window.removeEventListener('mouseup', onWindowUp);
        window.removeEventListener('blur', onWindowBlur);
    }, [onWindowMove, onWindowUp, onWindowBlur]);
    sessionHostRef.current.attachWindow = attachWindowGesture;
    sessionHostRef.current.detachWindow = detachWindowGesture;
    useEffect(() => detachWindowGesture, [detachWindowGesture]);
    useEffect(() => () => session.destroy(), [session]);

    // 框选/拖拽进行中滚动或缩放 → 内核按虚拟起点 + 最后输入 px 重算（issue 113 Q7 / bug 32 / issue 110）。
    // notes 等由每次渲染的 bindWorld 保持最新；本 effect 只在视口几何变化时转发。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 故意只跟视口/几何/渲染面
    useEffect(() => {
        session.onViewportChange(viewport, geometry, surf);
    }, [viewport, geometry, surf]);

    const syncHover = (mouseX: number, mouseY: number) => {
        const inside = isInsideSurface(surf, mouseX, mouseY);
        setHoverPos(inside ? { cx: mouseX, cy: mouseY } : null);
        if (inside) {
            const lp = getLaneBeatFromCanvas(mouseX, mouseY);
            if (lp) lastLegalPxRef.current = { x: mouseX, y: mouseY };
        }
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        const pos = cssToCanvas(e);
        if (!pos) return;
        const v = canvasToVirtual(pos.x, pos.y);
        applyGesture(session.begin({
            x: pos.x, y: pos.y, vx: v.x, vy: v.y,
            button: e.button, shiftKey: e.shiftKey,
            ctrlKey: e.ctrlKey, metaKey: e.metaKey,
        }));
    };

    const handlePointerMove = (e: { clientX: number; clientY: number }) => {
        const canvasPos = cssToCanvas(e);
        if (!canvasPos) return;
        syncHover(canvasPos.x, canvasPos.y);
        applyGesture(session.move({ x: canvasPos.x, y: canvasPos.y }));
    };

    const handlePointerUp = (e: { clientX: number; clientY: number; button?: number; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean } | null) => {
        if (!e) { applyGesture(session.end(null)); return; }
        const pos = cssToCanvas(e);
        applyGesture(session.end(pos ? {
            x: pos.x, y: pos.y, button: e.button,
            shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey,
        } : null));
    };

    gestureHandlersRef.current = { move: handlePointerMove, up: handlePointerUp };


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

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault(); // 只屏蔽原生菜单；删除在 mouseup 执行（见 rightButtonHeld effect）
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
            selectionBox: gestureSnap.selectionBox,
            slideBuffer,
            hoverPos,
            frozenCursor: lastLegalPxRef.current
                ? (() => {
                    const p = lastLegalPxRef.current!;
                    const lp = geometry.laneBeatFromCanvas(p.x, p.y, viewport, beatDisplay);
                    return lp ? { lane: lp.lane, preciseBeat: lp.preciseBeat } : null;
                })()
                : null,
            hoverItem,
            clipboard,
            markerBeat,
            markerSelected,
            armedTool,
            rightButtonHeld: gestureSnap.rightButtonHeld,
            dragGhost: gestureSnap.dragGhost,
            curveDraft, curveConfig, // issue 09 S2：曲线工具预览
            penPreview: gestureSnap.penPreview,
            penActive: gestureSnap.penActive,
            spriteIcon: spriteIcon.current,
            noteIcons,
            zoomGesture: performance.now() < zoomGestureUntilRef.current, // 手势期间瓦片只 blit（issue 10）
            playing: isPlaying || playbackActiveRef.current, // issue 101：播放滚动帧套瓦片重建预算（ref 覆盖 React 首帧竞态）
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
    }, [notes, selectedItems, viewport, gestureSnap, slideBuffer, beatDisplay, armedTool, hoverPos, hoverItem, clipboard, markerBeat, markerSelected, skinVersion, geometry, chartEndBeat, renderTick, display.noteSize, display.slideOpacity, display.simultaneousClickLines, display.colorAssist, display.imageQuality, display.gridStyle, display.lineShapeTiers, display.gridOpacity, display.labelScale, noteIcons, background, curveDraft, curveConfig, isPlaying]);


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

    // issue 74：右键按住期间 —— 松手时执行删除（跨平台一致），失焦只清标志不动谱面。
    useEffect(() => {
        if (!gestureSnap.rightButtonHeld) return;
        const onUp = (e: MouseEvent) => {
            if (e.button !== 2) return;
            const pos = cssToCanvas(e);
            applyGesture(session.rightUp(pos ? {
                x: pos.x, y: pos.y, button: 2,
                shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey,
            } : null));
        };
        const onBlur = () => applyGesture(session.rightUp(null));
        window.addEventListener('mouseup', onUp);
        window.addEventListener('blur', onBlur);
        return () => {
            window.removeEventListener('mouseup', onUp);
            window.removeEventListener('blur', onBlur);
        };
    }, [gestureSnap.rightButtonHeld, cssToCanvas]);

    const handleWheel = useCallback((e: WheelEvent) => {
        // issue 110：**Shift+滚轮 = 纵向滚动**（浏览器把它映射成横向 → 被容器的 overflowX:hidden 吃掉）。
        // 放在画布这里处理，是因为本监听器是 passive:false —— 能 preventDefault 掉原生横向滚动，
        // 于是"转回纵向"不会与原生滚动叠加成双倍；滚动量取 |deltaX| / |deltaY| 的较大者（跨平台：
        // 有些平台做横向映射、有些保留 deltaY），统一归一到纵向。
        if (e.shiftKey) {
            const host = scrollHostRef?.current;
            if (!host) return;
            const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
            if (delta === 0) return;
            e.preventDefault();
            host.scrollTop += delta;
            return;
        }
        // Ctrl+滚轮 = 缩放；普通滚动交给父容器（原生）
        if (e.ctrlKey) {
            e.preventDefault();
            const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
            const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, viewport.scale * zoomFactor));
            const effNewScale = geometry.effectiveScale(newScale);
            // 缩放锚定判定线（issue 90）：scrollY 保持不变——底边（判定线）处的谱面位置缩放时原地不动，
            // 与工具栏 ±/百分比缩放（只 setScale）完全同口径。不再以光标为锚：光标锚曾使 scrollY 随缩放
            // 大幅变化（∝ 光标到判定线的距离），放大了「滚动条回写在缩放提交窗口内用陈旧值覆写」的回弹竞态
            // （越靠上部越明显、判定线处恒为 0）。
            setViewport(prev => ({
                ...prev,
                scale: effNewScale // 视图 scale 恒等于 effectiveScale（ADR-0006 Q4=A）
            }));
            // 回写工具栏缩放数字（issue 10 回归修复）：ui.scale 与 viewport.scale 保持同一生效值
            setScale(effNewScale);
            // 缩放手势窗口（issue 10）：手势中瓦片只按比例 blit；停止 250ms 后 settle 一次高清重渲
            zoomGestureUntilRef.current = performance.now() + 240;
            if (zoomSettleTimerRef.current !== undefined) clearTimeout(zoomSettleTimerRef.current);
            zoomSettleTimerRef.current = window.setTimeout(() => setRenderTick(t => t + 1), 250);
        }
        // 普通滚轮滚动由父容器处理，不在这里处理
    }, [geometry, viewport, setScale]);

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
        setPlaybackActive: (active: boolean) => { playbackActiveRef.current = active; },
        // 起点标记访问（ADR-0004 §4）：Editor 经此做 Ctrl+空格 回跳 / Delete 删除
        getMarkerBeat: () => markerBeat,
        getMarkerSelected: () => markerSelected,
        setMarkerSelected: (sel: boolean) => setMarkerSelected(sel),
        clearMarker: () => { setMarkerBeat(null); setMarkerSelected(false); },
        // Esc 五档链第②档（ADR-0008 §7 / issue 109）：问内核是否有进行中手势。
        cancelActiveGesture: () => session.cancel().consumed === true,
        // Esc 五档链第③档（ADR-0008 §7）：有待连接滑条锚点/曲线草稿才消费本次 Esc（返回值供 Editor 决定是否落档）
        cancelPendingSlide: () => {
            if (slideBuffer === null && curveDraft === null) return false;
            setSlideBuffer(null);
            setCurveDraft(null);
            return true;
        },
        // ADR-0008 §3 执行键（Ctrl+` / Ctrl+E）：经 ref 进画布，与鼠标路径共用 ToolActionMatrix 调度
        execBpm: () => {
            applyOps(execBpmOps({
                notes, selectedItems, cursor: cursorChartPos(),
                slideBuffer: bufferPoint, lastBpm: lastBpmRef.current, chartEndBeat,
            }));
        },
        execSlide: () => {
            applyOps(execSlideOps({
                notes, selectedItems, cursor: cursorChartPos(),
                slideBuffer: bufferPoint, lastBpm: lastBpmRef.current, chartEndBeat,
            }));
        },
        // 验收反馈 #9（Shift+W）：执行-曲线，语义分发在 execCurveOps（矩阵层，可单测）。
        // hit 用 hoverItem 现取（与「执行-音符代码」同口径）——光标悬停在段上 = 重应用而非锚点。
        execCurve: () => {
            applyOps(execCurveOps({
                notes, selectedItems, cursor: cursorChartPos(), chartEndBeat, beatDisplay,
                slideBuffer: bufferPoint, lastBpm: lastBpmRef.current, clipboard,
                curveDraft, curveConfig,
                hit: hoverItem,
            }));
        },
        // issue 59 §2：Ctrl+B = 打开光标处音符的代码。与「音符代码」工具单击共用 clickOps，
        // 故粒度（findItemAt 数组序首个）、hidden 不可达、slideRegion 回退整条、BPM 例外全部一致。
        execNoteCode: () => {
            // 与工具单击同口径：hoverItem（音符/滑条）优先，未命中再按整条 BPM 线判（issue 59）
            const hit = resolveExecNoteCodeHit({ hoverItem, hoverPos, deps: hitDeps() });
            applyOps(clickOps({
                tool: 'noteCode', notes, hit,
                pos: null, slideBuffer: null, lastBpm: lastBpmRef.current, clipboard,
                chartEndBeat, beatDisplay, selectedItems,
            }));
        },
        // §3 键型执行键：光标不在画布 / 越过谱面末端 → 无事发生（不落子、也不清选区）
        // 末端判据与放置路径同源（CanvasGesture.canPlaceAtCursor / isPastChartEnd）
        execPlace: (tool: MatrixTool) => {
            // 用时现算（候选 3）：用缓存的 mousePosition 会落在滚动/缩放前的旧拍
            const cursor = cursorChartPos();
            if (!canPlaceAtCursor(cursor, chartEndBeat)) return;
            applyOps(clickOps({
                tool, notes, hit: null,
                pos: { beat: cursor.beat, lane: cursor.lane },
                slideBuffer: null, lastBpm: lastBpmRef.current, clipboard,
                chartEndBeat, beatDisplay, selectedItems,
            }));
        },
        // issue 73：Ctrl+V 执行键 —— 与「粘贴」工具单击共用 clickOps 的 paste 行，
        // 故"整组越出谱面末端 = 拒绝整组"的判定与鼠标路径同源（原先走 Editor 的 paste() 绕过了矩阵）
        execPaste: () => {
            const cursor = cursorChartPos();
            if (!canPlaceAtCursor(cursor, chartEndBeat)) return;
            applyOps(clickOps({
                tool: 'paste', notes, hit: null,
                pos: { beat: cursor.beat, lane: cursor.lane },
                slideBuffer: null, lastBpm: lastBpmRef.current, clipboard,
                chartEndBeat, beatDisplay, selectedItems,
            }));
        },
    }));

    // 切换离开滑条工具时清空待连接锚点（防止残留红点）；离开曲线工具同理清草稿（issue 09 S2）
    useEffect(() => {
        if (armedTool !== "slide") {
            setSlideBuffer(null);
        }
        if (armedTool !== "curve") {
            setCurveDraft(null);
            session.onToolChange(armedTool);
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
        const effective = geometry.effectiveScale(Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale)));
        setViewport(prev => (Math.abs(prev.scale - effective) > 1e-9 ? { ...prev, scale: effective } : prev));
        // 候选 3-b（2026-09-10）：`ui.scale` 是"用户请求值"，被钳制时它就与生效值分家 ——
        // 工具栏数字虚高（显示 300%、画面停在 263%），且点「-」要先把虚高的那截消耗掉画面才动
        // （死行程，用户已复现）。此处把生效值回写，使两者恒等 —— `:743` 的 ctrl+滚轮路径
        // 早就这么做，工具栏按钮路径此前漏了。
        // 幂等守卫：仅在不等时写，否则会与上面的 setViewport 形成回环。
        if (Math.abs(effective - scale) > 1e-9) setScale(effective);
    }, [scale, geometry, setScale]);

    // 通知滚动变化
    useEffect(() => {
        if (onScrollChange) {
            onScrollChange(viewport.scrollY, viewport.virtualHeight);
        }
    }, [viewport.scrollY, viewport.virtualHeight, onScrollChange]);

    // 画布实时信息叠加（issue 22）：判定线处精确时间（左下）+ 已过判定线音符数（右下）。
    // 判定线 = 画布底边，故叠加层贴 bottom 置于其上；pointerEvents:none 不干扰画布交互。
    const playheadBeat = useMemo(
        () => geometry.beatOfSeconds(currentSeconds),
        [geometry, currentSeconds],
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
                        // issue 63：手势期间由 window 接管 move（画布自身监听让位，避免同一事件双份处理）；
                        // 空闲时仍走画布监听做 hover 反馈
                        onMouseMove={(e) => { if (!session.isPressed()) handlePointerMove(e); }}
                        onContextMenu={handleContextMenu}
                        onDoubleClick={handleDoubleClick}
                        onMouseLeave={() => {
                            // issue 54：hoverPos 一并清空，实时显示线不残留。
                            // issue 63：**不再清按下态**——手势已由 window 接管，越出画布继续。
                            setHoverPos(null);
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
                    <span title={t('canvas.passedNotes')}>♪ {passedNoteCount}</span>
                </div>
            </div>
        </div>
    );
});

export default FinalVirtualCanvas;
