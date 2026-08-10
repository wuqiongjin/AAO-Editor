import { useState, useRef, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from "react";
import type { ChartNote, SelectionItem } from "../notes/Charts";
import CanvasSpriteIcon from './CanvasSpriteIcon';
import { handleNoteReplacement, handleSlideToSlideCombination } from '../utils/NoteReplacementRules';
import { deleteSelection } from '../utils/SelectionEditing';
import { getBpmEvents, secondsToBeat, beatToSeconds, computeChartEndBeat, type BpmEvent } from '../utils/AudioTiming';
import {
  ChartGeometry, LANES, LANE_WIDTH,
  CANVAS_WIDTH, CANVAS_HEIGHT, JUDGE_LINE_Y, TRACK_CHROME_TOTAL,
} from '../utils/ChartGeometry';
import { useEditing, useUI, usePlayback } from '../contexts';
import { renderChart, findItemAt, computeItemsInBox, type RenderCtx, type ViewportState } from '../renderer';

export type EditingToolAction = 'copy' | 'cut' | 'delete' | 'mirror';

interface FinalVirtualCanvasProps {
  // 仅留 onScrollChange（虚拟高度需经 Editor 同步给滚动条容器）；其余状态经 hooks 直读（ADR-0003 §7）
  onScrollChange?: (scrollY: number, virtualHeight: number) => void;
}

// 空谱/兜底的最短谱面拍数（ADR-0004 §3 修订：虚拟高度随谱面末端自适应，空谱也至少保留一段可视空间）
const FLOOR_BEATS = 8;

// 视口缩放配置
const MAX_SCALE = 3.0;
const MIN_SCALE = 0.1;

/**
 * FinalVirtualCanvas（ADR-0003 候选 B 收口）：已拆成薄层。
 * 渲染/命中/坐标全部收敛到 src/renderer 纯模块，本组件只保留：
 * 挂载/canvas 生命周期/皮肤加载、事件绑定、视图状态(viewport)、坐标薄封装、imperative 方法。
 */
const FinalVirtualCanvas = forwardRef<any, FinalVirtualCanvasProps>(({
    onScrollChange,
}, ref) => {
    // 状态经 hooks 直读（ADR-0003 §7）
    const {
        notes, selectedItems, setSelectedItems, clipboard,
        handleNotesChange, editToolAction, editToolPaste,
    } = useEditing();
    const { selectedTool, beatDisplay, scale, setMousePosition } = useUI();
    const { setMarker: setMarkerContext } = usePlayback();
    // 视口状态
    const [viewport, setViewport] = useState<ViewportState>({
        scrollX: 0,
        scrollY: 0,
        scale: scale,
        virtualWidth: LANES * LANE_WIDTH + TRACK_CHROME_TOTAL * 2,
        virtualHeight: 0, // 初始 0，由 chartEndVirtualY 驱动
    });

    const [slideBuffer, setSlideBuffer] = useState<{ beat: number; lane: number; subBeat?: number } | null>(null);
    // 皮肤图片就绪信号：懒加载图片异步到达后 +1，触发一次重绘（否则连接带等未预热的素材会一直空白）
    const [skinVersion, setSkinVersion] = useState(0);

    // 画布用到的全部皮肤图（含未被工具栏预热的 longNoteLine.png），挂载即预加载，加载完触发重绘
    useEffect(() => {
        let cancelled = false;
        CanvasSpriteIcon.ensureImagesLoaded([
            './assets/skins/RhythmGameSprites.png',
            './assets/skins/DirectionalFlickSprites.png',
            './assets/skins/longNoteLine.png',
            './assets/skins/longNoteLine2.png',
        ]).then(() => {
            if (!cancelled) setSkinVersion(v => v + 1);
        });
        return () => { cancelled = true; };
    }, []);

    // 谱面末端 beat（ADR-0004 §3 修订）：虚拟高度/坐标/滚动范围都随其自适应；空谱用 FLOOR_BEATS 兜底
    const chartEndBeat = useMemo(
        () => computeChartEndBeat(notes, beatDisplay) ?? FLOOR_BEATS,
        [notes, beatDisplay],
    );
    const [selectionBox, setSelectionBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
    const selectionStartRef = useRef<{ x: number; y: number } | null>(null); // 圈选起点（画布坐标）
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
    const animationFrameRef = useRef<number | undefined>(undefined);

    // 暴露方法给父组件
    useImperativeHandle(ref, () => ({
        setScrollY: (scrollY: number) => {
            setViewport(prev => {
                const scaledBounds = getScaledVirtualBounds(prev.scale);
                const newScrollY = Math.max(scaledBounds.minY, Math.min(scaledBounds.maxY - CANVAS_HEIGHT / prev.scale, scrollY));
                return {
                    ...prev,
                    scrollY: newScrollY
                };
            });
        },
        getScrollY: () => viewport.scrollY,
        getVirtualHeight: () => viewport.virtualHeight,
        // 虚拟画布可滚动的最大范围（供父组件滚动条做线性映射）
        getMaxScrollY: () => {
            const scaledBounds = getScaledVirtualBounds(viewport.scale);
            return Math.max(0, scaledBounds.maxY - CANVAS_HEIGHT / viewport.scale);
        },
        // 播放跟随（ADR-0004 §1）：给定播放位置(秒) → 目标 scrollY（使判定线压在底部）
        getScrollYForPlaybackSeconds: (seconds: number) => {
            const beat = secondsToBeat(getSortedBpmEvents(), seconds);
            const targetScrollY = beatToVirtualY(beat) - JUDGE_LINE_Y / viewport.scale;
            const scaledBounds = getScaledVirtualBounds(viewport.scale);
            return Math.max(scaledBounds.minY, Math.min(scaledBounds.maxY - CANVAS_HEIGHT / viewport.scale, targetScrollY));
        },
        // 播放跟随反向（拖动滚动条=seek）：给定 scrollY → 判定线处对应播放位置(秒)
        getPlaybackSecondsForScrollY: (scrollY: number) => {
            const virtualY = scrollY + JUDGE_LINE_Y / viewport.scale;
            const beat = virtualYToBeat(virtualY);
            return beatToSeconds(getSortedBpmEvents(), beat);
        },
        // 谱面可用滚动范围（ADR-0004 §3 修订：滚动条随谱面长度自适应，无空白）
        getChartScrollRange: () => {
            const sb = getScaledVirtualBounds(viewport.scale);
            const clamp = (y: number) => Math.max(sb.minY, Math.min(sb.maxY - CANVAS_HEIGHT / viewport.scale, y));
            const bottom = clamp(beatToVirtualY(0) - JUDGE_LINE_Y / viewport.scale);
            const top = clamp(beatToVirtualY(chartEndBeat) - JUDGE_LINE_Y / viewport.scale);
            return { top, bottom };
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
    // ---------------------------
    const geometry = useMemo(() => new ChartGeometry(getBpmEvents(notes), chartEndBeat), [notes, chartEndBeat]);
    // 谱面末端的【真实 BPM 像素高度】（ADR-0004 §3 修订）：总高/坐标基准都用它
    const chartEndVirtualY = geometry.chartEndVirtualY;
    // 与 AudioTiming 共享同一 BPM 事件表（时间→beat 与 beat→Y 都用同一事件表，保证预览线对齐）
    const getSortedBpmEvents = () => geometry.bpmEvents as BpmEvent[];

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
        const hit = findItemAt(cx, cy, { geometry, viewport, beatDisplay, notes });
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
        };
        renderChart(ctx, canvas, rc);
    }, [notes, selectedItems, viewport, selectionBox, slideBuffer, beatDisplay, selectedTool, hoverPos, clipboard, markerBeat, markerSelected, skinVersion, geometry, chartEndBeat]);

    // 虚拟高度同步（原 renderCanvas 内副作用，现移出为纯状态同步）
    useEffect(() => {
        const totalVirtualHeight = chartEndVirtualY + JUDGE_LINE_Y / viewport.scale;
        const totalVirtualWidth = LANES * LANE_WIDTH + TRACK_CHROME_TOTAL * 2;
        if (Math.abs(viewport.virtualHeight - totalVirtualHeight) > 1) {
            setViewport(prev => ({
                ...prev,
                virtualWidth: totalVirtualWidth,
                virtualHeight: totalVirtualHeight
            }));
        }
    }, [chartEndVirtualY, viewport.scale, viewport.virtualHeight]);

    // ---------------------------
    // 事件处理
    // ---------------------------
    // 画布缓冲像素固定为 CANVAS_WIDTH / CANVAS_HEIGHT，但 CSS 显示尺寸随视口自适应缩放（issue 12 布局自适应）。
    // 事件坐标取自 getBoundingClientRect（CSS 显示像素），须按显示比例换算回缓冲像素，保证命中/放置与渲染一致。
    const cssToCanvas = useCallback((e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return null;
        return {
            x: (e.clientX - rect.left) * (CANVAS_WIDTH / rect.width),
            y: (e.clientY - rect.top) * (CANVAS_HEIGHT / rect.height),
        };
    }, []);

    const handleWheel = useCallback((e: WheelEvent) => {
        // 只处理Ctrl+滚轮缩放，禁用普通滚动
        if (e.ctrlKey) {
            e.preventDefault();
            const pos = cssToCanvas(e);
            if (!pos) return;
            const virtualMouse = canvasToVirtual(pos.x, pos.y);
            const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
            const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, viewport.scale * zoomFactor));
            const newScrollY = virtualMouse.y - pos.y / newScale;
            setViewport(prev => ({
                ...prev,
                scale: newScale,
                scrollX: 0,
                scrollY: newScrollY
            }));
        }
        // 普通滚轮滚动由父容器处理，不在这里处理
    }, [geometry, viewport, cssToCanvas]);

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
            selectionStartRef.current = { x: pos.x, y: pos.y };
            selectionMovedRef.current = false;
            setSelectionBox(null);
        }
    }, [selectedTool]);

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
            const dx = mouseX - selectionStartRef.current.x;
            const dy = mouseY - selectionStartRef.current.y;
            if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
                selectionMovedRef.current = true;
                setSelectionBox({
                    x1: selectionStartRef.current.x,
                    y1: selectionStartRef.current.y,
                    x2: mouseX,
                    y2: mouseY
                });
            }
        }
    }, [geometry, viewport, setMousePosition, beatDisplay, selectedTool, cssToCanvas]);

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
    }, [selectedTool, selectedItems, setSelectedItems, notes, viewport, beatDisplay, slideBuffer, cssToCanvas]);

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
            if (hitStartMarker(start.x, start.y)) {
                setSelectedItems([]);
                setMarkerSelected(true);
            } else {
                selectItemAtPoint(start.x, start.y, e.shiftKey, e.ctrlKey || e.metaKey);
            }
        }

        selectionStartRef.current = null;
        setSelectionBox(null);
    }, [selectedTool, selectionBox, notes, selectedItems, computeItemsInBox, editToolAction, editToolPaste, findItemAt, getLaneBeatFromCanvas, cssToCanvas, hitStartMarker]);

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

    useEffect(() => {
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
        }
        animationFrameRef.current = requestAnimationFrame(renderCanvas);
    }, [renderCanvas]);

    useEffect(() => {
        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, []);

    // 初始视口设置 - 只在组件首次挂载时执行
    useEffect(() => {
        const totalVirtualHeight = chartEndVirtualY + JUDGE_LINE_Y / viewport.scale;
        const scaledBounds = getScaledVirtualBounds(viewport.scale);
        const initialScrollY = Math.max(scaledBounds.minY, Math.min(scaledBounds.maxY - CANVAS_HEIGHT / viewport.scale, totalVirtualHeight - CANVAS_HEIGHT / viewport.scale));
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

    // 同步外部scale变化
    useEffect(() => {
        setViewport(prev => ({
            ...prev,
            scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale))
        }));
    }, [scale]);

    // 通知滚动变化
    useEffect(() => {
        if (onScrollChange) {
            onScrollChange(viewport.scrollY, viewport.virtualHeight);
        }
    }, [viewport.scrollY, viewport.virtualHeight, onScrollChange]);

    return (
        <div style={{
            backgroundColor: '#000000',
            padding: '0',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: 'auto', // 根据内容自动调整高度
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
                    width={CANVAS_WIDTH}
                    height={CANVAS_HEIGHT}
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
                        border: '1px solid #333',
                        width: `min(${CANVAS_WIDTH}px, 100%)`,
                        height: 'auto',
                        aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}`,
                        objectFit: 'contain', // 保持比例，完全填充容器
                        position: 'relative',
                        zIndex: 10 // 确保Canvas在最上层
                    }}
                />
            </div>
        </div>
    );
});

export default FinalVirtualCanvas;
