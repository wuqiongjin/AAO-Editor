import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from "react";
import type { BpmNote, ChartNote, SelectionItem, SlideNote } from "../../types";
import CanvasSpriteIcon from '../../../ui/CanvasSpriteIcon';
import { planDragMove, dragDeltaBeat, type DragDelta } from '../../editing/NoteDragging';
import {
  clickOps, boxSelectOps, execSlideOps, execBpmOps, execCurveOps, pointerClickSelection, actionOnTargetsOps, resolveActionTargets,
  placeSpanWithCombination,
  type MatrixOp, type MatrixTool, type SlidePoint, type SnapPos,
  type CurveDraft,
} from '../../editing/ToolActionMatrix';
import { buildPenSlide } from '../../editing/SpanCurve';
import { getBpmEvents, secondsToBeat, chartLengthToEndBeat, type BpmEvent } from '../../../audio/AudioTiming';
import {
  ChartGeometry, LANES, LANE_WIDTH,
  TRACK_CHROME_TOTAL, type SurfaceSize,
} from '../../geometry/ChartGeometry';
import { useEditing, useUI, usePlayback, useConfig } from '../../../app/ProviderTree';
import { useChartCodeEditor } from '../code-editor/ChartCodeEditorProvider';
import { renderChart, findItemAt, findBpmLineAt, computeItemsInBox, computeBpmLinesInBox, type RenderCtx, type ViewportState } from '../../../visual';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '../../../visual/noteSkin';
import { normalizeBackgroundOpacity } from '../../../visual/staticLayerCache';
import { BPM_LABEL_GAP_PX, GUTTER_LABEL_FONT_PX, measureGutterLabelWidth } from '../../../visual/gutterLabels';
import { useBackgroundSkin } from '../../rendering/useBackgroundSkin';
import { countNotesUpToBeat } from '../../editing/NoteEditing';
import {
  snapChartPos, hitStartMarkerAt, hitBpmLabelAt,
  resolvePressIntent, resolveReleaseIntent, resolveClickPlan,
  isInsideSurface, hasMovedBeyondThreshold, marqueeRect,
  canStartMarquee, resolveBoxPlan,
  canPlaceAtCursor, resolveExecNoteCodeHit,
  penCursorAt, penAppendSamples, penExitCrossing,
  penMaxBeatsForCanvasDy, resolvePenStroke,
  type DragAnchor,
} from '../../editing/CanvasGesture';
import { formatTimePrecise } from '../../geometry/TimeFormat';
import { smoothPenLanes } from '../../editing/SpanCurve';

/** 画笔光标（验收反馈 #6）：内联 data-uri SVG（铅笔、笔尖为热点），免新增资源文件与加载时序 */
const PEN_CURSOR = `url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='24'%20height='24'%3E%3Cpath%20d='M3%2021%20L5.5%2014.5%20L17%203%20L21%207%20L9.5%2018.5%20Z'%20fill='%23ffe082'%20stroke='%23333'%20stroke-width='1.5'%20stroke-linejoin='round'/%3E%3Cpath%20d='M3%2021%20L5.5%2014.5%20L9.5%2018.5%20Z'%20fill='%23333'/%3E%3C/svg%3E") 3 21, crosshair`;

/** 画笔视觉激活的按住时长（验收反馈 #6：单击不该闪画笔态，长按才算"作画中"） */
const PEN_HOLD_MS = 200;

/** 画笔平滑开关打开时：对 [起笔, …采样, 落笔] 整体平滑 lane，端点（起笔/落笔）保持原值 */
const smoothedPenSamples = (
  start: { beat: number; lane: number },
  samples: { beat: number; lane: number }[],
  end: { beat: number; lane: number },
  smooth: boolean,
): { beat: number; lane: number }[] => {
  if (!smooth || samples.length < 2) return samples;
  return smoothPenLanes([start, ...samples, end]).slice(1, -1);
};

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
  /** 谱面光标（beat/lane）：**派生值，用时按当前 viewport 现算**（候选 3）。
   *  不在画布内或在左右沟槽内 → null。Editor 的 Ctrl+V 粘贴锚点走此入口。 */
  getCursorChartPos?: () => SnapPos | null;
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
    const { armedTool, beatDisplay, scale, setScale, curveConfig } = useUI();
    const { setMarker: setMarkerContext, currentSeconds } = usePlayback();
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
    // ADR-0008 §5：BPM 就地编辑（无模态打断）。默认值 = 上一次放置所设的值（初始 120）
    const lastBpmRef = useRef(120);
    const [bpmEdit, setBpmEdit] = useState<{ beat: number; value: string } | null>(null);
    // 拖拽移动（§6）：指针态按下音符 → 拖 = 移动；ghost = 移动后受影响音符（渲染器半透明绘制）
    // issue 61：拍位移的量化基准 = **被拖对象的落点**，不是"光标吸附拍位差"。
    //   anchorBeat   = 被按住那件对象的真实拍位（组拖也以它为准，其余成员共用同一 delta）
    //   rawPressBeat = 按下时光标的**未量化**拍位（与 anchorBeat 的差即"抓取偏移"，保住按住哪儿拖哪儿的手感）
    const dragRef = useRef<DragAnchor | null>(null);
    const [dragGhost, setDragGhost] = useState<ChartNote[] | null>(null);
    // issue 09 验收反馈九轮 #2：拖拽期间最后一个**合法落点**的裁决结果（notes/items）。光标越界或
    // 落到非法点时冻结到此，松手若此刻非法 → 提交这份冻结结果（所见即所得，与画笔 lastValid 同口径）。
    const dragFrozenRef = useRef<{ notes: ChartNote[]; items: SelectionItem[] } | null>(null);
    // issue 09 S2（ADR-0009 §3）：曲线工具链式草稿（与 slideBuffer 同属组件侧 UI 态，不入历史；
    // 草稿引用的滑条被 undo 掉时由 curveChainClickOps 的完整性检查自愈）
    const [curveDraft, setCurveDraft] = useState<CurveDraft | null>(null);
    // 画笔进行中：采样进 ref（高频），预览幽灵进 state（驱动渲染）。
    // dir = 采样方向锁（0=未定；1=正向/-1=倒向，验收反馈 #4：首拍移动方向锁定，中途回头不采样）
    // lastValid = 界内最后一个**画布光标位**（八轮 #2：越界松手 = 以它为端点落子，所见即所得）
    const penRef = useRef<{ start: SlidePoint; samples: { beat: number; lane: number }[]; last: { beat: number; lane: number }; dir: 0 | 1 | -1; lastValid: { x: number; y: number }; exitFrozen: boolean } | null>(null);
    const [penPreview, setPenPreview] = useState<SlideNote | null>(null);
    // 验收反馈 #6：画笔视觉进行中（按住超时或移动过阈值后）——渲染层借此让位端点幽灵 + 画笔光标
    const [penActive, setPenActive] = useState(false);
    const penHoldTimerRef = useRef<number | null>(null);
    /** 画笔视觉激活（光标 + 端点幽灵让位）；只在按下持续或开始拖动画时发生，单击永不触发 */
    const activatePenVisual = () => {
        if (penHoldTimerRef.current !== null) { window.clearTimeout(penHoldTimerRef.current); penHoldTimerRef.current = null; }
        setPenActive(true);
        if (canvasRef.current) canvasRef.current.style.cursor = PEN_CURSOR;
    };
    const cancelPenVisual = () => {
        if (penHoldTimerRef.current !== null) { window.clearTimeout(penHoldTimerRef.current); penHoldTimerRef.current = null; }
        setPenActive(false);
    };

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
    /** 框选进行中光标的**画布坐标**（鼠标没动时它不变）。
     *  矩形起点按虚拟坐标锚定（bug 32），但 `selectionBox` 存的是画布坐标 —— 滚动会让它失效，
     *  必须用它重算（见下方 `viewport` 依赖的重算 effect）。 */
    const marqueeCursorRef = useRef<{ x: number; y: number } | null>(null);
    // 光标悬停位置（画布坐标），供工具态预览（放置/粘贴/镜像悬停）
    const [hoverPos, setHoverPos] = useState<{ cx: number; cy: number } | null>(null);
    // issue 09 验收反馈九轮 #2：最后一个**合法落点**（lane + 吸附拍位）。有进行中锚点（滑条首击 /
    // 曲线链草稿已挂点）且当前光标越界时，放置/链式 live 预览冻结到它——与画笔草稿同一口径
    // （共用 `freezeGestureCursor`）。纯 hover 无锚点不使用它（越界照旧隐藏幽灵）。
    const frozenCursorRef = useRef<{ lane: number; preciseBeat: number } | null>(null);
    // issue 74：右键**按住未松手**（右键 = 删除光标下的对象）→ hover 描边转删除红
    const [rightButtonHeld, setRightButtonHeld] = useState(false);
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

    /** 放置/执行的合法落点（ADR-0005 §5）：判定表已抽到 CanvasGesture.snapChartPos（issue 70，可单测）。
     *  `rawBeat` = 未量化拍位，只有拖拽用（issue 61），放置一律吃量化后的 `beat`。 */
    const snapPos = (cx: number, cy: number, allowOutsideLane = false) =>
        snapChartPos({ geometry, viewport, beatDisplay }, chartEndBeat, cx, cy, allowOutsideLane);

    // slideBuffer 归一化为矩阵输入（Canvas 态 subBeat 可选，矩阵 SlidePoint 必填）
    const bufferPoint: SlidePoint | null = slideBuffer
        ? { beat: slideBuffer.beat, lane: slideBuffer.lane, subBeat: slideBuffer.subBeat || 0 }
        : null;

    // 点选（ADR-0008 §2 指针行）：加选/去选/Ctrl 整条滑条的合并语义已纯函数化（pointerClickSelection，
    // 行锁单测）；此处只做命中换算与"标记选中互斥"清标记
    const selectItemAtPoint = (cx: number, cy: number, additive: boolean, ctrl: boolean) => {
        setMarkerSelected(false); // 起点标记与音符选择互斥（ADR-0004 §4）
        const hit = findItemAt(cx, cy, hitDeps());
        setSelectedItems(pointerClickSelection(selectedItems, hit, additive, ctrl));
    };

    // ---------------------------
    // ADR-0008 §2 语义矩阵的画布侧编排（输入状态机）
    // 交互处理器全部用普通函数（每次渲染重建、闭包恒新）——事件只经 React props 挂接，
    // 不进任何 effect/缓存依赖，memo 化只会制造陈旧闭包风险。
    // ---------------------------

    /**
     * 左沟槽 BPM 数字命中（§5 手势仲裁：单击数字 = 就地编辑；返回该 BPM 的 beat）。
     * 判定表已抽到 CanvasGesture.hitBpmLabelAt（issue 70，可单测）；此处只注入画布侧的文字测量。
     */
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

    /** 矩阵 op 应用器：逐条执行 ToolActionMatrix（§2/§3 纯调度层）输出的副作用指令。
     *  一次手势内 setNotes 至多一条 = 一个可回退快照（§8） */
    const applyOps = (ops: MatrixOp[]) => {
        for (const op of ops) {
            if (op.t === 'setNotes') handleNotesChange(op.notes);
            else if (op.t === 'setSelection') setSelectedItems(op.items);
            else if (op.t === 'setClipboard') setClipboard(op.notes);
            else if (op.t === 'setSlideBuffer') setSlideBuffer(op.point);
            else if (op.t === 'setCurveBuffer') setCurveDraft(op.draft);
            else if (op.t === 'openBpmEditor') setBpmEdit({ beat: op.beat, value: op.value });
            else if (op.t === 'openNoteCode') openNoteCode(op.target);
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
        const boxDeps = { geometry, viewport, beatDisplay, notes };
        const items = computeItemsInBox(box, boxDeps);
        if (resolveBoxPlan(armedTool) === 'select') {
            setSelectedItems(items); // issue 71：BPM 不在其中（不进选区）
            setMarkerSelected(false); // 起点标记与音符选择互斥（ADR-0004 §4）
        } else {
            // issue 71 例外：删除工具的框选是批量执行 → 单独按"整条覆盖"判据收集 BPM 线（不进选区）
            const bpmInBox = armedTool === 'delete' ? computeBpmLinesInBox(box, boxDeps) : [];
            // 验收反馈 #7：曲线工具框选 = 组合 + 全部段应用当前曲线配置（配置经 boxSelectOps 进矩阵）
            applyOps(boxSelectOps(armedTool as MatrixTool, notes, items, bpmInBox, curveConfig, beatDisplay));
        }
    };

    /** §2 单击矩阵（未达拖拽阈值的快速起按）；坐标为虚拟锚定的按下点（bug 32）。
     *  "去问谁"的判定表已抽到 CanvasGesture.resolveClickPlan（issue 70，可单测）。 */
    const handleToolClick = (cx: number, cy: number, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
        const plan = resolveClickPlan({
            cx, cy, armedTool,
            shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey,
            deps: hitDeps(),
            notes,
            snap: snapPos(cx, cy),
            bpmLabelBeat: hitBpmLabel(cx, cy),
            onMarker: hitStartMarker(cx, cy),
        });
        if (plan.kind === 'editBpm') {
            // §5：任何工具态下单击沟槽 BPM 数字 = 就地编辑（用"既有值"打开，与 BPM 工具
            // 点击的"lastBpm 覆盖后编辑"是两条路径）
            setBpmEdit({ beat: plan.beat, value: plan.value });
            return;
        }
        if (plan.kind === 'selectMarker') {
            setSelectedItems([]);
            setMarkerSelected(true);
            return;
        }
        if (plan.kind === 'selectItem') {
            // 指针：标记线 / 音符选中（Shift 加选、Ctrl 整条滑条）/ 空白清空选区
            selectItemAtPoint(cx, cy, plan.additive, plan.ctrl);
            return;
        }
        applyOps(clickOps({
            tool: armedTool as MatrixTool, notes, hit: plan.hit,
            pos: plan.pos,
            slideBuffer: bufferPoint,
            lastBpm: lastBpmRef.current,
            clipboard,
            chartEndBeat, beatDisplay, // issue 73：粘贴按整组校验谱面末端
            selectedItems,              // issue 88：命中项 ∈ 选区 → 该工具动作作用于整片选区
            curveDraft, curveConfig,    // issue 09 S2：曲线工具链式草稿与配置
        }));
    };

    /** §6：按下意图仲裁（拖拽 vs 框选）——判定表已抽到 CanvasGesture.resolvePressIntent（issue 70）。
     *  指针态音符上拖拽 = 移动；**任意持工具态 Shift+按住音符 = 移动**；其余持工具态拖拽 = 框选（防误拖）。
     *  标记线上按下不拖音符。任一步不合法 → 框选，不产生半截拖拽态。 */
    const beginDragCandidate = (cx: number, cy: number, shiftKey: boolean) => {
        const intent = resolvePressIntent({
            cx, cy, armedTool, shiftKey,
            onMarker: hitStartMarker(cx, cy),
            deps: hitDeps(),
            selectedItems,
            chartEndBeat,
        });
        if (intent.kind === 'drag') { dragRef.current = intent.anchor; dragFrozenRef.current = null; }
        // issue 09 S2：画笔起手（曲线工具态空白按下）。验收反馈 #2 修复：**不再清链式草稿**——
        // 起手即清会把第二次单击挂好的锚点在按下瞬间抹掉（松手 click 读到空草稿 → 永远只挂锚点、
        // 接不成段）；锚点与画笔共存，草稿在画笔**真正落子（commitPen）成功后**才清。
        // 验收反馈 #6 二轮修复：按下瞬间**不激活**画笔视觉（光标/幽灵）——快速单击不该闪画笔态；
        // 激活时机 = 按住超过笔势时长、或移动越过拖拽阈值（见 handlePointerMove pen 分支）。
        if (intent.kind === 'pen') {
            // 验收反馈 #3：绘制起手 = 开始做新内容 → 旧选区即刻清空（与单击放置路径的
            // clearSel 同口径；链式草稿是独立状态，不受影响）。
            if (selectedItems.length > 0) setSelectedItems([]);
            penRef.current = {
                start: { beat: intent.start.beat, lane: intent.start.lane, subBeat: 0 },
                samples: [],
                last: { beat: intent.start.beat, lane: intent.start.lane },
                dir: 0,
                lastValid: { x: cx, y: cy }, // 起手点必然界内（resolvePressIntent 已判合法落点）
                exitFrozen: false, // 十轮 Q1：越界交点只在"界内→界外"那一帧求一次，界外期间不再前移
            };
            setPenPreview(null);
            penHoldTimerRef.current = window.setTimeout(() => activatePenVisual(), PEN_HOLD_MS);
        }
    };

    // ---------------- issue 63：手势期间的隐式指针捕获 ----------------
    // 按下后把 move/up 挂到 window：越出画布不再取消手势（旧实现 onMouseLeave 一律清按下态，
    // 框选拉出画布即作废 → "框一条跨屏长滑条"做不到）。window 上只挂一次稳定壳，
    // 经 gestureHandlersRef 转发到**最新一帧**的处理器（本组件处理器惯例：每次渲染重建）。
    const gestureHandlersRef = useRef<{
        move: (e: { clientX: number; clientY: number }) => void;
        up: (e: { clientX: number; clientY: number; button?: number; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean } | null) => void;
    }>({ move: () => { /* 首个手势开始前不会被调用 */ }, up: () => { } });
    const onWindowMove = useCallback((e: MouseEvent) => gestureHandlersRef.current.move(e), []);
    const onWindowUp = useCallback((e: MouseEvent) => gestureHandlersRef.current.up(e), []);
    // 失焦（切窗口 / 弹窗抢焦点）时 mouseup 可能永远不来 → e=null 只收手势态，不触发任何动作
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
    // 卸载兜底：手势中途被卸载（切页/关闭）不留悬挂监听；画笔按住计时器同理
    useEffect(() => detachWindowGesture, [detachWindowGesture]);
    useEffect(() => () => {
        if (penHoldTimerRef.current !== null) window.clearTimeout(penHoldTimerRef.current);
    }, []);

    // 框选进行中滚动/缩放 → **必须重算矩形**（issue 70 修复，既有缺陷）。
    // `selectionBox` 存的是**画布坐标**（渲染/命中都要用它），而起点按**虚拟坐标**锚定（bug 32）。
    // 滚动不产生 mousemove，于是旧画布坐标失效：矩形钉在画布的同一像素位置，视觉上起点漂到别的拍，
    // 直到鼠标再动才"啪"地跳回。这里用"起点虚拟坐标 + 光标画布坐标"在 viewport 变化时重算，
    // 使矩形在滚动全程都锁在最初那个拍与轨道上。
    useEffect(() => {
        const start = selectionStartRef.current;
        const cursor = marqueeCursorRef.current;
        // 仅框选进行中（已过阈值、且不是拖拽）才重算
        if (!start || !cursor || !selectionMovedRef.current || dragRef.current) return;
        setSelectionBox(marqueeRect({
            start: { vx: start.vx, vy: start.vy },
            curCanvas: cursor,
            deps: { geometry, viewport },
            surface: surf,
        }));
    }, [viewport, geometry, surf]);

    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) {
            // issue 74：右键按下（未松手）→ 光标下对象的 hover 切删除红，作"松手即删"的预览。
            // 删除动作本身仍在 `contextmenu` 里执行，此处只置反馈标志。
            if (e.button === 2) setRightButtonHeld(true);
            return; // 只响应左键（右键走 contextmenu）
        }
        const pos = cssToCanvas(e);
        if (!pos) return;
        // bug 32：起点同时存画布坐标（拖拽阈值/渲染基线）与虚拟坐标（滚动时锚定谱面时刻）
        const v = canvasToVirtual(pos.x, pos.y);
        selectionStartRef.current = { x: pos.x, y: pos.y, vx: v.x, vy: v.y };
        selectionMovedRef.current = false;
        marqueeCursorRef.current = null;
        setSelectionBox(null);
        setDragGhost(null);
        dragRef.current = null;
        // Shift+未移动松开 = 回落到该态原本单击语义（handlePointerUp 单击路径）
        beginDragCandidate(pos.x, pos.y, e.shiftKey);
        // issue 63：手势一旦开始就由 window 接管 move/up —— 越出画布不再取消手势
        attachWindowGesture();
    };

    /** 当前按下点相对拖拽锚的栅格位移（吸附 = beat 栅格 × lane 整格，与放置同规则）。
     *  drag 可显式传入：mouseUp 提交时 dragRef 已清，必须用按下时的锚点快照（三轮修复：
     *  旧代码先置空 dragRef 再调 dragDelta → 恒 null → 松手永远回弹）。
     *  issue 61：拍位分量改由 `dragDeltaBeat` 算——量化**对象的落点**，不是"光标吸附拍位差"。 */
    const dragDelta = (mx: number, my: number, drag = dragRef.current): DragDelta | null => {
        if (!drag) return null;
        // issue 66 §4a：拖拽中光标移到轨道外也能继续算位移（落点是否合法由 planDragMove 按根轨裁决）
        const cur = snapPos(mx, my, true);
        if (!cur) return null;
        return {
            dBeat: dragDeltaBeat({
                anchorBeat: drag.anchorBeat,
                rawPressBeat: drag.rawPressBeat,
                rawCurBeat: cur.rawBeat,
                beatDisplay,
            }),
            dLane: cur.lane - drag.pressLane,
        };
    };

    const handlePointerMove = (e: { clientX: number; clientY: number }) => {
        const canvasPos = cssToCanvas(e);
        if (!canvasPos) return;
        const mouseX = canvasPos.x;
        const mouseY = canvasPos.y;
        // issue 63：手势由 window 接管后光标可能在画布外 —— hover 系反馈（实时显示线 / 放置幽灵 /
        // hover 描边 / 状态栏读数）出界一律关闭；手势本身继续。
        const inside = isInsideSurface(surf, mouseX, mouseY);
        setHoverPos(inside ? { cx: mouseX, cy: mouseY } : null);
        // issue 09 验收反馈九轮 #2：记录最后一个**合法落点**（与放置预览同一换算口径
        // `getLaneBeatFromCanvas`）→ 有锚点时光标越界可冻结预览到它。纯记录，不驱动渲染分支。
        if (inside) {
            const lp = getLaneBeatFromCanvas(mouseX, mouseY);
            if (lp) frozenCursorRef.current = { lane: lp.lane, preciseBeat: lp.preciseBeat };
        }
        // 谱面光标（beat/lane）**不再**在此处预算并缓存 —— 它是 px 的派生值，
        // 滚动/缩放后鼠标不动就算不出新值（候选 3）。改由 cursorChartPos() 用时现算，
        // 服务于粘贴锚点与三个执行键（Ctrl+B / Ctrl+E / Ctrl+F..S）。
        if (!selectionStartRef.current) return;
        const start = selectionStartRef.current;
        // §2 原则 1：未过阈值 = 仍是单击（判定表在 CanvasGesture.hasMovedBeyondThreshold）
        if (!hasMovedBeyondThreshold(start, { x: mouseX, y: mouseY }, DRAG_THRESHOLD_PX)) return;
        selectionMovedRef.current = true;
        if (dragRef.current) {
            // §6 移动中：幽灵预览 = 合法落点下的移动结果。
            // 光标反馈（三轮修订，用户验收反馈 #4）：拖拽进行中 = grabbing
            if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
            // issue 09 验收反馈九轮 #2（freeze_all，与画笔/放置同一口径）：拖拽 = 有进行中锚点的
            // 手势，**幽灵在手势期间永不消失**——光标越界（轨道外 / 越过谱末端 / 移出画布）或落到
            // 非法落点（碰撞 / 越界）时冻结在最后合法落点，而不是回弹隐藏（用户反馈的"东西突然没了"）。
            // 真正能否落子由松手提交（commitDrag）按 planDragMove 裁决（越界/碰撞 = 回弹，口径不变）。
            const d = dragDelta(mouseX, mouseY);
            if (d && (d.dBeat !== 0 || d.dLane !== 0)) {
                const r = planDragMove(notes, dragRef.current.items, d, { chartEndBeat, beatDisplay });
                if (r.ok) {
                    setDragGhost(r.ghost ?? notes); // 非法落点 → 保持上一帧合法幽灵（冻结）
                    dragFrozenRef.current = { notes: r.notes, items: r.items }; // 越界松手的回退落子
                }
            }
            return;
        }
        // issue 09 S2：画笔进行中 → 轨迹采样（按下仲裁已排除框选）。
        // 验收反馈 #6：越过拖拽阈值开始拖画才激活画笔视觉（快速单击永不闪画笔态）。
        // 验收反馈 #5：平滑开关打开时 live 预览与落子同一平滑管线（所见即所得）。
        // 验收反馈 #4：方向在首采样锁定；倒向笔画预览按"将成条"的升序形态画。
        if (penRef.current) {
            if (!penActive) activatePenVisual();
            const pen = penRef.current;
            const step = 1 / curveConfig.precision;
            const oracle = (cx: number, cy: number) => penCursorAt({ geometry, viewport, beatDisplay }, chartEndBeat, cx, cy);
            // issue 106 修法 6：本帧 Δ 画布 y 在光标所在层最多能跨多少拍——跨折返带边界时拍号会跳，
            // 判为跨层则只接当前光标、跳过补点（快速甩笔的 Δy 同样大、上限也大，不会被误判）。
            const prevCanvasY = pen.lastValid.y;
            // 十轮 Q1：目标点 = 界内光标；若本帧越界且上一帧还在界内，则把"上一界内画布位 → 当前
            // 界外光标"这条画布直线与轨道内部求交，笔画补到交点后冻结（exitFrozen 挡住后续界外帧，
            // 不再沿边界前移）。这样**终点**由几何交点决定、脱离对 mousemove 密度的依赖。
            const cur = oracle(mouseX, mouseY);
            let target = cur;
            if (target) {
                pen.exitFrozen = false;
                pen.lastValid = { x: mouseX, y: mouseY }; // 八轮 #2：越界松手时的回退落子位置
            } else if (!pen.exitFrozen) {
                const hit = penExitCrossing(oracle, pen.lastValid, { x: mouseX, y: mouseY });
                if (hit) {
                    pen.exitFrozen = true;
                    target = hit.point;
                    pen.lastValid = { x: hit.x, y: hit.y }; // 交点即合法位：越界松手据此落子（所见即所得）
                }
            }
            if (target) {
                const maxBeats = penMaxBeatsForCanvasDy(
                    { geometry, viewport }, target.beat, Math.abs(mouseY - prevCanvasY));
                const { samples: appended, dir } = penAppendSamples(pen.last, target, step, pen.dir, maxBeats);
                pen.dir = dir;
                for (const s of appended) {
                    pen.samples.push(s);
                    pen.last = s;
                }
                // issue 106 定案（预览 = 落子）：统一为「起点 → 锁定方向上最靠前者」，回头期间冻结在
                // 最远点、任何情况下都不画出折返（旧 bwd 分支拿实时光标当端点，回头期间会预览出折返）。
                const far = pen.samples.at(-1);
                const stroke = far
                    ? resolvePenStroke(pen.start, pen.samples, pen.dir, { beat: far.beat, lane: far.lane })
                    : null;
                setPenPreview(stroke
                    ? buildPenSlide(stroke.from,
                        smoothedPenSamples(stroke.from, stroke.middles, stroke.to, curveConfig.smooth === true), stroke.to)
                    : null);
            }
            return;
        }
        // issue 65②：框选一起手就放弃两击直放的临时锚点（本把手势改走 §4 组合，锚点留着是误导）
        if (slideBuffer !== null) setSlideBuffer(null);
        // issue 59 §3：「音符代码」态不启动框选（判定表在 CanvasGesture.canStartMarquee）。
        // Shift+按住音符 = 移动（§6 全局逃生口）不受此限（上面 dragRef 分支已先行返回）。
        if (!canStartMarquee(armedTool)) return;
        // §2 原则2：任何持工具态都可框选（原 mouse||mirror 门控废除）
        // 矩形几何（bug 32 虚拟坐标锚定 + issue 63 钳进渲染面）在 CanvasGesture.marqueeRect
        marqueeCursorRef.current = { x: mouseX, y: mouseY };
        setSelectionBox(marqueeRect({
            start, curCanvas: { x: mouseX, y: mouseY },
            deps: { geometry, viewport }, surface: surf,
        }));
    };

    /** 抬手结算（issue 63）。`e = null` = window 失焦这类异常收尾：只清手势态，不触发任何动作。
     *  优先级表已抽到 CanvasGesture.resolveReleaseIntent（issue 70，可单测）。 */
    const handlePointerUp = (e: { clientX: number; clientY: number; button?: number; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean } | null) => {
        const start = selectionStartRef.current;
        const moved = selectionMovedRef.current;
        const box = selectionBox;
        const drag = dragRef.current;
        const pen = penRef.current;
        const intent = resolveReleaseIntent({ e, start, moved, drag, box, pen: pen !== null });
        if (intent === 'continue') return; // 非左键抬起：手势继续，不动任何状态

        selectionStartRef.current = null;
        dragRef.current = null;
        penRef.current = null;
        marqueeCursorRef.current = null;
        setSelectionBox(null);
        setDragGhost(null);
        setPenPreview(null);
        cancelPenVisual();
        detachWindowGesture();
        if (canvasRef.current) canvasRef.current.style.cursor = '';
        if (intent === 'abort' || !start || !e) return;

        if (intent === 'commitPen' && pen) {
            // issue 09 S2（ADR-0009 §3）+ issue 106 定案：画笔落子 = **起点 → 锁定方向上最靠前者**
            // （`resolvePenStroke` 单一裁决）。旧实现的两分支（按"松手点 vs 起点"分 fwd/bwd + 按松手
            // 拍位截断采样）已删：上→下松手越过起点会漏出非单调点序，而"回退缩短"与预览也不一致。
            // 验收反馈 #5：平滑开关打开 → lane 序列移动平均（端点/beat 栅格保持）；
            // 验收反馈 #2：画笔**真正落子成功**才清链式草稿（画完一笔 = 上一锚点作废）；
            // 验收反馈 #4：**倒画**（从高拍向低拍）由 resolvePenStroke 端点互换承载，形态不变。
            // 验收反馈 #4 补：落子走 `placeSpanWithCombination`（与两击直放共用）——
            // 端点与既有滑条头/尾相接 = 自动组合（长按绘制同样自动接段）。
            const pos = cssToCanvas(e);
            let release = pos ? snapPos(pos.x, pos.y) : null;
            // 验收反馈八轮 #2：松手时光标越界（轨道外 / 越过谱末端 / 移出画布）→ 回退到**界内
            // 最后一个光标位**吸附落子。幽灵冻结可见 + 松手照常结算 = 所见即所得，与框选
            // "画布外松手也照常结算"（issue 63）同口径；若连一个界内位都没有（起手即非法）才不落子。
            if (!release) release = snapPos(pen.lastValid.x, pen.lastValid.y);
            if (release) {
                const stroke = resolvePenStroke(pen.start, pen.samples, pen.dir,
                    { beat: release.beat, lane: release.lane });
                if (stroke) {
                    const samples = smoothedPenSamples(stroke.from, stroke.middles, stroke.to, curveConfig.smooth === true)
                        .map((s) => ({ beat: s.beat, lane: s.lane, hidden: true as const }));
                    handleNotesChange(placeSpanWithCombination(notes, stroke.from, stroke.to, samples, null, beatDisplay));
                    if (curveDraft) setCurveDraft(null);
                }
            }
            return;
        }

        if (intent === 'commitDrag' && drag) {
            // §6 松手提交：合法 → 单次 handleNotesChange（一个快照）+ 拖拽集合保留为选区；非法 → 回弹。
            // drag 必须传给 dragDelta：dragRef 已清（三轮修复：提交位移恒 null 的根因）
            const pos = cssToCanvas(e);
            const d = pos ? dragDelta(pos.x, pos.y, drag) : null;
            if (!d && dragFrozenRef.current) {
                // issue 09 验收反馈九轮 #2：松手时光标越出轨道（越界/移出画布 → dragDelta 无值）→
                // 提交拖拽期间冻结的最后合法落点（所见即所得，与画笔越界松手提交 lastValid 同口径）。
                handleNotesChange(dragFrozenRef.current.notes);
                setSelectedItems(dragFrozenRef.current.items);
            } else if (d && (d.dBeat !== 0 || d.dLane !== 0)) {
                const r = planDragMove(notes, drag.items, d, { chartEndBeat, beatDisplay });
                if (r.ok) {
                    handleNotesChange(r.notes);
                    setSelectedItems(r.items);
                }
                // r.ok===false（碰撞等界内非法落点）→ 回弹（口径不变，非轨道越界）
            }
            dragFrozenRef.current = null;
            return;
        }
        if (intent === 'commitBox' && box) {
            // issue 63：画布外松手也照常结算（框选矩形已被钳在画布内）
            applyBoxAction(box);
            return;
        }
        if (intent === 'click') {
            // 单击（<阈值）：bug 32 以虚拟起点反解画布坐标，滚动后仍命中原谱面位置
            const p = virtualToCanvas(start.vx, start.vy);
            handleToolClick(p.x, p.y, e);
        }
    };

    // window 监听只挂一次，事件经此转发到最新一帧的闭包（本组件处理器惯例：每次渲染重建）
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

    // 右键删除滑条子段：区域（连接带）/ 端点 / 中间结点
    // issue 74（跨平台）：删除动作**不在 contextmenu 里执行** —— 该事件的触发时机因平台而异
    // （Windows = mouseup，macOS / Linux GTK = mousedown），在 mousedown 触发时"按住期间预览"的
    // 窗口为零。故统一挪到 **mouseup**（对 Windows 而言与原来等价：contextmenu 本就在松手时触发），
    // contextmenu 只负责屏蔽原生菜单。
    const rightClickDelete = useCallback((mouseX: number, mouseY: number) => {
        // noteSize 必须与另三处命中（点选/工具点击/拖拽候选）一致，否则 noteSize≠1 时命中盒与视觉不符
        // issue 59：右键删除是 56 定的 BPM 三条通路之一，同样按"整条线"判（findItemAt 只认 lane 0 一点）
        const hit = findItemAt(mouseX, mouseY, hitDeps())
            ?? findBpmLineAt(mouseX, mouseY, hitDeps());
        if (!hit) return;
        // issue 70：删除语义走矩阵（与「删除工具点音符」同一实现），不再直连 deleteSelection。
        // 矩阵已负责"删除后清空选区"（原下标在 splice 后已指向别的音符，§2 原则 6 同族）；
        // 此处只补清指向已消失对象的悬垂 UI 态：待连接锚点（可能正指向被删滑条的端点）与 BPM 就地编辑框。
        // issue 88：命中项 ∈ 选区 → **整片删除**（用户 2026-09-11："框选情况下右键删除是作用于整体的"）；
        // 点选区外 → 只删那一个（维持现状）。
        applyOps(actionOnTargetsOps('delete', notes, resolveActionTargets(hit, selectedItems)));
        setSlideBuffer(null);
        setBpmEdit(null);
    }, [notes, hitDeps, applyOps, selectedItems]);

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault(); // 只屏蔽原生菜单；删除在 mouseup 执行（见 rightClickDelete）
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
            frozenCursor: frozenCursorRef.current,
            hoverItem,
            clipboard,
            markerBeat,
            markerSelected,
            armedTool,
            rightButtonHeld, // issue 74：右键按住期间 hover 转 danger
            dragGhost,
            curveDraft, curveConfig, // issue 09 S2：曲线工具预览
            penPreview,
            penActive, // 验收反馈 #6：画笔手势中 → 端点幽灵让位画笔光标
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
    }, [notes, selectedItems, viewport, selectionBox, slideBuffer, beatDisplay, armedTool, hoverPos, hoverItem, dragGhost, clipboard, markerBeat, markerSelected, skinVersion, geometry, chartEndBeat, renderTick, display.noteSize, display.slideOpacity, display.simultaneousClickLines, display.colorAssist, display.imageQuality, display.gridStyle, display.lineShapeTiers, display.gridOpacity, display.labelScale, noteIcons, background, rightButtonHeld, curveDraft, curveConfig, penPreview, penActive]);


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
        if (!rightButtonHeld) return;
        const onUp = (e: MouseEvent) => {
            if (e.button !== 2) return;
            setRightButtonHeld(false);
            const pos = cssToCanvas(e);
            // 只在渲染面内松手才删（画布外松手 = 取消），与 §1"该位置非法则无事发生"同族
            if (pos && isInsideSurface(surf, pos.x, pos.y)) rightClickDelete(pos.x, pos.y);
        };
        const onBlur = () => setRightButtonHeld(false);
        window.addEventListener('mouseup', onUp);
        window.addEventListener('blur', onBlur);
        return () => {
            window.removeEventListener('mouseup', onUp);
            window.removeEventListener('blur', onBlur);
        };
    }, [rightButtonHeld, rightClickDelete, cssToCanvas, surf]);

    const handleWheel = useCallback((e: WheelEvent) => {
        // 只处理Ctrl+滚轮缩放，禁用普通滚动
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
        // 起点标记访问（ADR-0004 §4）：Editor 经此做 Ctrl+空格 回跳 / Delete 删除
        getCursorChartPos: () => cursorChartPos(),
        getMarkerBeat: () => markerBeat,
        setMarkerBeat: (beat: number | null) => { setMarkerBeat(beat); },
        getMarkerSelected: () => markerSelected,
        setMarkerSelected: (sel: boolean) => setMarkerSelected(sel),
        clearMarker: () => { setMarkerBeat(null); setMarkerSelected(false); },
        // Esc 四档链第②档（ADR-0008 §7）：有待连接滑条锚点/曲线草稿才消费本次 Esc（返回值供 Editor 决定是否落档）
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
            penRef.current = null;
            setPenPreview(null);
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
                        // issue 63：手势期间由 window 接管 move（画布自身监听让位，避免同一事件双份处理）；
                        // 空闲时仍走画布监听做 hover 反馈
                        onMouseMove={(e) => { if (!selectionStartRef.current) handlePointerMove(e); }}
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
                    <span title="已过判定线的音符数">♪ {passedNoteCount}</span>
                </div>
            </div>
        </div>
    );
});

export default FinalVirtualCanvas;
