import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import type { ChartNote, SlideNote, SelectionItem } from "../notes/Charts";
import CanvasSpriteIcon, { CanvasNoteIcons, CanvasSlideLineIcons, BaseSpriteIcons } from './CanvasSpriteIcon';
import { handleNoteReplacement, handleSlideToSlideCombination } from '../utils/NoteReplacementRules';
import { deleteSelection } from '../utils/SelectionEditing';
import { shiftGroupToAnchor, mirrorNote } from '../utils/NoteEditing';

export type EditingToolAction = 'copy' | 'cut' | 'delete' | 'mirror';

interface FinalVirtualCanvasProps {
    notes: ChartNote[];
    setNotes: (notes: ChartNote[]) => void;
    selectedTool: string;
    selectedItems: SelectionItem[];
    setSelectedItems: (items: SelectionItem[]) => void;
    beatDisplay: number;
    onMousePositionChange: (position: { lane: number; beat: number } | null) => void;
    scale: number;
    onScrollChange?: (scrollY: number, virtualHeight: number) => void;
    externalScrollY?: number; // 外部控制的滚动位置
    clipboard?: ChartNote[]; // 剪贴板内容（供粘贴预览）
    onEditToolAction?: (action: EditingToolAction, item: SelectionItem) => void; // 编辑工具态：点击命中音符即执行
    onEditToolPaste?: (pos: { beat: number; lane: number }) => void; // 粘贴工具态：点击位置即粘贴
}

const LANES = 7;
const BEATS = 360;
const BEAT_HEIGHT = 220; // 基准节拍高度
const LANE_WIDTH = 30;
const CANVAS_WIDTH = 750;  // 最终确定的谱面宽度
const CANVAS_HEIGHT = 900; // 最终确定的谱面高度

// 音符大小配置
const NOTE_ICON_SIZE = 36;
const DIRECTIONAL_ICON_SIZE = 45;
const SLIDE_ICON_SIZE = 36;

// 音符高度压缩配置
const NOTE_HEIGHT_SCALE = 0.6;
const DIRECTIONAL_HEIGHT_SCALE = 0.33;
const SLIDE_HEIGHT_SCALE = 0.6;

// 虚拟画布配置
const MAX_SCALE = 3.0;
const MIN_SCALE = 0.1;
const VIEWPORT_PADDING = 200;

// 虚拟高度配置 - 可以手动修改这个值来调整虚拟高度
const VIRTUAL_HEIGHT_MULTIPLIER = 1.0; // 虚拟高度倍数，可以调整这个值
// 完整谱面虚拟高度（下落式：起始拍 beat 0 在画布最底部）
const TOTAL_VIRTUAL_HEIGHT = BEAT_HEIGHT * BEATS * VIRTUAL_HEIGHT_MULTIPLIER;

// 虚拟画布边界配置（暂未使用，缩放边界由 getScaledVirtualBounds 计算）

// 缩放时的虚拟边界调整
const getScaledVirtualBounds = (_scale: number) => {
    // 使用固定的虚拟高度计算，避免依赖组件内部函数
    const totalVirtualHeight = BEAT_HEIGHT * BEATS * VIRTUAL_HEIGHT_MULTIPLIER;
    const totalVirtualWidth = LANES * LANE_WIDTH + (1 + 4 + 1 + 1 + 1 + 1) * 2;

    return {
        minY: 0,
        maxY: totalVirtualHeight, // 使用实际虚拟高度
        minX: 0,
        maxX: totalVirtualWidth // 使用实际虚拟宽度
    };
};

// 视口状态接口
interface ViewportState {
    scrollX: number;
    scrollY: number;
    scale: number;
    virtualWidth: number;
    virtualHeight: number;
}

const FinalVirtualCanvas = forwardRef<any, FinalVirtualCanvasProps>(({
    notes,
    setNotes: _setNotes,
    selectedTool,
    selectedItems,
    setSelectedItems,
    beatDisplay,
    onMousePositionChange,
    scale,
    onScrollChange,
    externalScrollY,
    clipboard,
    onEditToolAction,
    onEditToolPaste
}, ref) => {
    // 视口状态
    const [viewport, setViewport] = useState<ViewportState>({
        scrollX: 0,
        scrollY: 0,
        scale: scale,
        virtualWidth: LANES * LANE_WIDTH + (1 + 4 + 1 + 1 + 1 + 1) * 2,
        virtualHeight: BEAT_HEIGHT * BEATS * VIRTUAL_HEIGHT_MULTIPLIER
    });

    const [dragging, setDragging] = useState(false);
    const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
    const [slideBuffer, setSlideBuffer] = useState<{ beat: number; lane: number; subBeat?: number } | null>(null);
    const [selectionBox, setSelectionBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
    const selectionStartRef = useRef<{ x: number; y: number } | null>(null); // 圈选起点（画布坐标）
    const selectionMovedRef = useRef(false); // 是否已发生拖拽（区分点击与圈选）
    // 光标悬停位置（画布坐标），供工具态预览（放置/粘贴/镜像悬停）
    const [hoverPos, setHoverPos] = useState<{ cx: number; cy: number } | null>(null);

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
        }
    }));

    // ---------------------------
    // BPM 事件处理
    // ---------------------------
    const getSortedBpmEvents = () => {
        const bpmEvents: { beat: number; bpm: number }[] = [];
        for (const note of notes) {
            if (note.type === "BPM") {
                bpmEvents.push({ beat: note.beat, bpm: (note as any).bpm });
            }
        }
        bpmEvents.sort((a, b) => a.beat - b.beat);

        if (bpmEvents.length === 0 || bpmEvents[0].beat > 0) {
            bpmEvents.unshift({ beat: 0, bpm: 120 });
        }

        return bpmEvents;
    };

    // ---------------------------
    // 虚拟坐标转换函数
    // ---------------------------
    const beatToVirtualYRaw = (beat: number) => {
        const bpmEvents = getSortedBpmEvents();
        let offset = 0;
        for (let i = 0; i < bpmEvents.length; i++) {
            const cur = bpmEvents[i];
            const next = bpmEvents[i + 1];
            const segmentStart = cur.beat;
            const segmentEnd = next ? next.beat : Infinity;

            if (beat <= segmentStart) break;

            const segFrom = segmentStart;
            const segTo = Math.min(segmentEnd, beat);
            if (segTo > segFrom) {
                const lengthInBeats = segTo - segFrom;
                const perBeatHeight = (BEAT_HEIGHT * 120) / cur.bpm;
                offset += lengthInBeats * perBeatHeight;
            }

            if (segmentEnd >= beat) break;
        }
        return offset;
    };

    // 自下而上（下落式音游）：起始拍 beat 0 位于画布最底部，越往后越靠上
    const beatToVirtualY = (beat: number) => TOTAL_VIRTUAL_HEIGHT - beatToVirtualYRaw(beat);

    const virtualYToBeatRaw = (virtualY: number) => {
        const bpmEvents = getSortedBpmEvents();
        let remaining = virtualY;
        for (let i = 0; i < bpmEvents.length; i++) {
            const cur = bpmEvents[i];
            const next = bpmEvents[i + 1];
            const segStart = cur.beat;
            const segEnd = next ? next.beat : Infinity;
            const segLenBeats = segEnd - segStart;
            const perBeatHeight = (BEAT_HEIGHT * 120) / cur.bpm;

            if (!isFinite(segEnd)) {
                const beatOffset = remaining / perBeatHeight;
                return segStart + beatOffset;
            }

            const segHeight = segLenBeats * perBeatHeight;
            if (remaining <= segHeight) {
                const beatOffset = remaining / perBeatHeight;
                return segStart + beatOffset;
            } else {
                remaining -= segHeight;
            }
        }
        return BEATS;
    };

    // 与 beatToVirtualY 对应的反变换
    const virtualYToBeat = (virtualY: number) => virtualYToBeatRaw(TOTAL_VIRTUAL_HEIGHT - virtualY);

    // ---------------------------
    // 坐标转换：虚拟坐标 <-> 画布坐标
    // ---------------------------
    const virtualToCanvas = (virtualX: number, virtualY: number) => {
        // 虚拟X原点位于轨道内容左缘（trackBgX = trackStartX + borderTotalWidth），
        // 轨道已水平居中，故画布X加上该偏移；trackBgX 与 scale 统一缩放，保证任意缩放下对齐。
        const borderTotalWidth = (1 + 4 + 1 + 1 + 1 + 1);
        const totalTrackWidth = LANES * LANE_WIDTH * viewport.scale + borderTotalWidth * 2;
        const trackStartX = (CANVAS_WIDTH - totalTrackWidth) / 2;
        const trackBgX = trackStartX + borderTotalWidth;
        const canvasX = trackBgX + (virtualX - viewport.scrollX) * viewport.scale;
        const canvasY = (virtualY - viewport.scrollY) * viewport.scale;
        return { x: canvasX, y: canvasY };
    };

    const canvasToVirtual = (canvasX: number, canvasY: number) => {
        const borderTotalWidth = (1 + 4 + 1 + 1 + 1 + 1);
        const totalTrackWidth = LANES * LANE_WIDTH * viewport.scale + borderTotalWidth * 2;
        const trackStartX = (CANVAS_WIDTH - totalTrackWidth) / 2;
        const trackBgX = trackStartX + borderTotalWidth;
        const virtualX = (canvasX - trackBgX) / viewport.scale + viewport.scrollX;
        const virtualY = canvasY / viewport.scale + viewport.scrollY;
        return { x: virtualX, y: virtualY };
    };

    // ---------------------------
    // 视口范围计算
    // ---------------------------
    const getViewportBounds = () => {
        const padding = VIEWPORT_PADDING / viewport.scale;
        const scaledBounds = getScaledVirtualBounds(viewport.scale);

        // 修复边界计算逻辑
        const bounds = {
            minX: Math.max(scaledBounds.minX, viewport.scrollX - padding),
            maxX: Math.min(scaledBounds.maxX, viewport.scrollX + CANVAS_WIDTH / viewport.scale + padding),
            minY: Math.max(scaledBounds.minY, viewport.scrollY - padding),
            maxY: Math.min(scaledBounds.maxY, viewport.scrollY + CANVAS_HEIGHT / viewport.scale + padding)
        };

        return bounds;
    };

    // ---------------------------
    // 音符位置计算
    // ---------------------------
    const getNoteVirtualY = (beat: number, subBeat: number = 0) => {
        const preciseBeat = beat + (subBeat > 0 ? subBeat / beatDisplay : 0);
        const virtualY = beatToVirtualY(preciseBeat);
        // 直接返回虚拟Y坐标，不进行翻转
        return virtualY;
    };

    const getNoteVirtualX = (lane: number) => {
        // 虚拟X原点位于轨道内容左缘（trackBgX），lane中心即相对该原点的偏移
        return lane * LANE_WIDTH + LANE_WIDTH / 2;
    };

    // 画布坐标 -> lane/beat（用于命中与圈选）
    const getLaneBeatFromCanvas = (cx: number, cy: number) => {
        const borderTotalWidth = (1 + 4 + 1 + 1 + 1 + 1);
        const totalTrackWidth = LANES * LANE_WIDTH * viewport.scale + borderTotalWidth * 2;
        const trackStartX = (CANVAS_WIDTH - totalTrackWidth) / 2;
        const trackBgX = trackStartX + borderTotalWidth;
        const relativeX = cx - trackBgX;
        const lane = Math.floor(relativeX / (LANE_WIDTH * viewport.scale));
        const virtualY = viewport.scrollY + cy / viewport.scale;
        const beat = virtualYToBeat(virtualY);
        if (lane >= 0 && lane < LANES && beat >= 0) {
            const subBeatPosition = beat * beatDisplay;
            const nearestSubBeat = Math.round(subBeatPosition);
            const preciseBeat = nearestSubBeat / beatDisplay;
            return { lane, preciseBeat };
        }
        return null;
    };

    // 音符的虚拟坐标集合（用于命中测试）
    const getNoteVirtualPoints = (note: ChartNote): { x: number; y: number }[] => {
        if (note.type === "Single" || note.type === "LDirectional" || note.type === "RDirectional") {
            return [{ x: getNoteVirtualX(note.lane), y: getNoteVirtualY(note.beat, note.subBeat || 0) }];
        } else if (note.type === "Slide" || note.type === "Long") {
            return note.connections.map(c => ({ x: getNoteVirtualX(c.lane), y: getNoteVirtualY(c.beat, c.subBeat || 0) }));
        } else if (note.type === "BPM") {
            return [{ x: getNoteVirtualX(0), y: getNoteVirtualY(note.beat) }];
        }
        return [];
    };

    // 判断 SelectionItem 是否已在选中集中（同 kind/noteIndex/connIndex 视为同一条目）
    const sameItem = (a: SelectionItem, b: SelectionItem) =>
        a.kind === b.kind && a.noteIndex === b.noteIndex &&
        (a.kind === 'note' ? true : a.connIndex === (b as any).connIndex);

    // 点选：普通左键选子部分 / Ctrl+左键选整条滑条 / Shift 加选
    const selectItemAtPoint = (cx: number, cy: number, additive: boolean, ctrl: boolean) => {
        const hit = findItemAt(cx, cy);
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

    // 圈选：按命中子部分选中框内音符（框到结点→结点；框到区域→区域）
    const computeItemsInBox = useCallback((box: { x1: number; y1: number; x2: number; y2: number }): SelectionItem[] => {
        const minX = Math.min(box.x1, box.x2);
        const maxX = Math.max(box.x1, box.x2);
        const minY = Math.min(box.y1, box.y2);
        const maxY = Math.max(box.y1, box.y2);
        const tl = canvasToVirtual(minX, minY);
        const br = canvasToVirtual(maxX, maxY);
        const vminX = Math.min(tl.x, br.x);
        const vmaxX = Math.max(tl.x, br.x);
        const vminY = Math.min(tl.y, br.y);
        const vmaxY = Math.max(tl.y, br.y);
        const result: SelectionItem[] = [];
        notes.forEach((note, index) => {
            if (note.type === "Slide" || note.type === "Long") {
                const conns = note.connections;
                // 结点：虚拟坐标落在框内 → 选中该结点
                conns.forEach((conn, ci) => {
                    const x = getNoteVirtualX(conn.lane);
                    const y = getNoteVirtualY(conn.beat, conn.subBeat || 0);
                    if (x >= vminX && x <= vmaxX && y >= vminY && y <= vmaxY) {
                        result.push({ kind: 'slideNode', noteIndex: index, connIndex: ci });
                    }
                });
                // 区域：两端点都在框内 → 选中该区域
                for (let ci = 0; ci < conns.length - 1; ci++) {
                    const c1 = conns[ci];
                    const c2 = conns[ci + 1];
                    const p1 = { x: getNoteVirtualX(c1.lane), y: getNoteVirtualY(c1.beat, c1.subBeat || 0) };
                    const p2 = { x: getNoteVirtualX(c2.lane), y: getNoteVirtualY(c2.beat, c2.subBeat || 0) };
                    if (p1.x >= vminX && p1.x <= vmaxX && p1.y >= vminY && p1.y <= vmaxY &&
                        p2.x >= vminX && p2.x <= vmaxX && p2.y >= vminY && p2.y <= vmaxY) {
                        result.push({ kind: 'slideRegion', noteIndex: index, connIndex: ci });
                    }
                }
            } else {
                const pts = getNoteVirtualPoints(note);
                if (pts.some(p => p.x >= vminX && p.x <= vmaxX && p.y >= vminY && p.y <= vmaxY)) {
                    result.push({ kind: 'note', noteIndex: index });
                }
            }
        });
        return result;
    }, [notes, canvasToVirtual, getNoteVirtualX, getNoteVirtualY]);

    const selectItemsInBox = (box: { x1: number; y1: number; x2: number; y2: number }) => {
        setSelectedItems(computeItemsInBox(box));
    };

    // ---------------------------
    // 视口剔除：只渲染可见区域的音符
    // ---------------------------
    const getVisibleNotes = () => {
        const bounds = getViewportBounds();
        const visibleNotes: { note: ChartNote; index: number }[] = [];

        notes.forEach((note, index) => {
            let isVisible = false;

            if (note.type === "Single" || note.type === "LDirectional" || note.type === "RDirectional") {
                const virtualY = getNoteVirtualY(note.beat, note.subBeat || 0);
                const virtualX = getNoteVirtualX(note.lane);
                isVisible = virtualY >= bounds.minY && virtualY <= bounds.maxY &&
                    virtualX >= bounds.minX && virtualX <= bounds.maxX;
            } else if (note.type === "Slide" || note.type === "Long") {
                // 检查滑条是否有任何连接点在视口内
                isVisible = note.connections.some(conn => {
                    const virtualY = getNoteVirtualY(conn.beat, conn.subBeat || 0);
                    const virtualX = getNoteVirtualX(conn.lane);
                    return virtualY >= bounds.minY && virtualY <= bounds.maxY &&
                        virtualX >= bounds.minX && virtualX <= bounds.maxX;
                });
            } else if (note.type === "BPM") {
                const virtualY = getNoteVirtualY(note.beat);
                isVisible = virtualY >= bounds.minY && virtualY <= bounds.maxY;
            }

            if (isVisible) {
                visibleNotes.push({ note, index });
            }
        });

        return visibleNotes;
    };

    // ---------------------------
    // 渲染函数
    // ---------------------------
    const renderCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        // 设置固定画布尺寸
        canvas.width = CANVAS_WIDTH;
        canvas.height = CANVAS_HEIGHT;

        // 清空画布
        ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // 绘制背景
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // 测试绘制已移除，恢复正常的轨道渲染

        // 计算虚拟总尺寸
        const totalVirtualHeight = TOTAL_VIRTUAL_HEIGHT;
        const borderTotalWidth = (1 + 4 + 1 + 1 + 1 + 1);
        const totalVirtualWidth = LANES * LANE_WIDTH + borderTotalWidth * 2;

        // 只在虚拟高度发生变化时更新视口状态，避免渲染循环
        if (Math.abs(viewport.virtualHeight - totalVirtualHeight) > 1) {
            setViewport(prev => ({
                ...prev,
                virtualWidth: totalVirtualWidth,
                virtualHeight: totalVirtualHeight
            }));
        }

        // 计算轨道在Canvas中的居中位置
        const totalTrackWidth = LANES * LANE_WIDTH * viewport.scale + borderTotalWidth * 2;
        const trackStartX = (CANVAS_WIDTH - totalTrackWidth) / 2;

        // 绘制轨道内背景
        const trackBgX = trackStartX + borderTotalWidth;
        const trackBgY = 0;
        const trackBgWidth = LANES * LANE_WIDTH * viewport.scale;
        const trackBgHeight = CANVAS_HEIGHT;

        ctx.fillStyle = '#00000A';
        ctx.fillRect(trackBgX, trackBgY, trackBgWidth, trackBgHeight);

        // 绘制网格
        renderGrid(ctx, trackStartX, trackBgX, trackBgWidth);

        // 获取可见音符并渲染
        const visibleNotes = getVisibleNotes();
        renderNotes(ctx, visibleNotes);

        // 渲染BPM数字（在画布内部）
        renderBpmNumbers(ctx);

        // 绘制选择框
        if (selectionBox) {
            renderSelectionBox(ctx);
        }

        // 绘制滑条缓冲区
        renderSlideBuffer(ctx);

        // 绘制工具态预览（放置/粘贴/镜像幽灵，ADR-0002 §4）
        renderToolPreview(ctx);

    }, [notes, selectedItems, viewport, selectionBox, slideBuffer, beatDisplay, selectedTool, hoverPos, clipboard]);

    // 绘制网格
    const renderGrid = useCallback((ctx: CanvasRenderingContext2D, trackStartX: number, trackBgX: number, trackBgWidth: number) => {
        const borderTotalWidth = (1 + 4 + 1 + 1 + 1 + 1);

        // 绘制垂直线（轨道线）
        for (let lane = 0; lane <= LANES; lane++) {
            const x = trackStartX + borderTotalWidth + lane * LANE_WIDTH * viewport.scale;

            if (lane === 0 || lane === LANES) {
                // 外侧轨道边框
                const borderColors = ['#004C4C', '#004D4D', '#009898', '#00A6A6', '#008186', '#003D44'];
                const borderWidths = [1, 4, 1, 1, 1, 1];
                let currentOffset = 0;
                const isRightBorder = lane === LANES;

                borderColors.forEach((color, index) => {
                    const width = borderWidths[index] * viewport.scale;
                    const rectX = isRightBorder ? (x + currentOffset) : (x - currentOffset - width);

                    ctx.fillStyle = color;
                    ctx.fillRect(rectX, 0, width, CANVAS_HEIGHT);
                    currentOffset += width;
                });
            } else {
                // 内部轨道线
                ctx.strokeStyle = '#333333';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, CANVAS_HEIGHT);
                ctx.stroke();
            }
        }

        // 绘制水平线（节拍线）
        const bounds = getViewportBounds();

        let drawnLines = 0;
        for (let beat = 0; beat < BEATS; beat++) {
            const virtualY = beatToVirtualY(beat);
            if (virtualY < bounds.minY || virtualY > bounds.maxY) {
                continue;
            }

            const canvasPos = virtualToCanvas(0, virtualY);
            if (canvasPos.y >= 0 && canvasPos.y <= CANVAS_HEIGHT) {
                drawnLines++;
                // 整数beat用实线
                ctx.strokeStyle = '#555555';
                ctx.lineWidth = Math.max(2, 2 * viewport.scale);
                ctx.setLineDash([]); // 实线
                ctx.beginPath();
                ctx.moveTo(trackBgX, canvasPos.y);
                ctx.lineTo(trackBgX + trackBgWidth, canvasPos.y);
                ctx.stroke();
            }

            // 绘制子节拍线（非整数beat用虚线）
            for (let subBeat = 1; subBeat < beatDisplay; subBeat++) {
                const preciseBeat = beat + subBeat / beatDisplay;
                const subVirtualY = beatToVirtualY(preciseBeat);
                if (subVirtualY < bounds.minY || subVirtualY > bounds.maxY) continue;

                const subCanvasPos = virtualToCanvas(0, subVirtualY);
                if (subCanvasPos.y >= 0 && subCanvasPos.y <= CANVAS_HEIGHT) {
                    ctx.strokeStyle = '#666666';
                    ctx.lineWidth = Math.max(0.5, 1 * viewport.scale);
                    ctx.setLineDash([4 * viewport.scale, 6 * viewport.scale]); // 虚线
                    ctx.globalAlpha = 0.8;
                    ctx.beginPath();
                    ctx.moveTo(trackBgX, subCanvasPos.y);
                    ctx.lineTo(trackBgX + trackBgWidth, subCanvasPos.y);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.globalAlpha = 1.0;
                }
            }
        }

        }, [viewport, beatDisplay]);

    // 选中状态判定辅助（ADR-0001 §6：整条/结点/区域）
    const isNoteSelected = (index: number) => selectedItems.some(it => it.kind === 'note' && it.noteIndex === index);
    const isSlideNodeSelected = (index: number, connIndex: number) =>
        selectedItems.some(it => it.kind === 'slideNode' && it.noteIndex === index && it.connIndex === connIndex);
    const isSlideRegionSelected = (index: number, connIndex: number) =>
        selectedItems.some(it => it.kind === 'slideRegion' && it.noteIndex === index && it.connIndex === connIndex);

    // 绘制音符
    const renderNotes = useCallback((ctx: CanvasRenderingContext2D, visibleNotes: { note: ChartNote; index: number }[]) => {
        // 第一层：普通音符和方向键主体
        visibleNotes.forEach(({ note, index }) => {
            const isSelected = isNoteSelected(index);

            if (note.type === "Single") {
                const subBeat = note.subBeat || 0;
                const virtualY = getNoteVirtualY(note.beat, subBeat);
                const virtualX = getNoteVirtualX(note.lane);
                const canvasPos = virtualToCanvas(virtualX, virtualY);
                const iconSize = NOTE_ICON_SIZE * viewport.scale;

                // 根据音符类型选择图标
                let iconConfig = BaseSpriteIcons.tap;
                if (note.flick) {
                    iconConfig = BaseSpriteIcons.flick;
                } else if (note.skill) {
                    iconConfig = BaseSpriteIcons.skill;
                }

                // 渲染主图标（canvasSize 传未缩放基准尺寸，scale 统一缩放，避免二次缩放）
                spriteIcon.current.render(ctx, {
                    ...iconConfig,
                    canvasX: canvasPos.x,
                    canvasY: canvasPos.y,
                    canvasSize: NOTE_ICON_SIZE,
                    canvasWidth: NOTE_ICON_SIZE,
                    canvasHeight: NOTE_ICON_SIZE * NOTE_HEIGHT_SCALE,
                    scale: viewport.scale,
                    renderLayer: 'main'
                });

                // 选中状态
                if (isSelected) {
                    ctx.strokeStyle = 'yellow';
                    ctx.lineWidth = 3 * viewport.scale;
                    ctx.globalAlpha = 0.8;
                    ctx.beginPath();
                    ctx.arc(canvasPos.x, canvasPos.y, iconSize / 2 + 4, 0, 2 * Math.PI);
                    ctx.stroke();
                    ctx.globalAlpha = 1.0;
                }
            } else if (note.type === "LDirectional") {
                const subBeat = note.subBeat || 0;
                const virtualY = getNoteVirtualY(note.beat, subBeat);
                const virtualX = getNoteVirtualX(note.lane);
                const canvasPos = virtualToCanvas(virtualX, virtualY);
                const iconSize = DIRECTIONAL_ICON_SIZE * viewport.scale;

                // 根据length属性选择对应的组合图标配置
                let iconConfig;
                switch (note.length) {
                    case 1:
                        iconConfig = CanvasNoteIcons.leftFlickL1;
                        break;
                    case 2:
                        iconConfig = CanvasNoteIcons.leftFlickL2;
                        break;
                    case 3:
                        iconConfig = CanvasNoteIcons.leftFlickL3;
                        break;
                    default:
                        iconConfig = CanvasNoteIcons.leftFlickL1;
                }

                // 渲染主图标
                spriteIcon.current.render(ctx, {
                    ...iconConfig,
                    canvasX: canvasPos.x,
                    canvasY: canvasPos.y,
                    canvasSize: DIRECTIONAL_ICON_SIZE,
                    canvasWidth: DIRECTIONAL_ICON_SIZE,
                    canvasHeight: DIRECTIONAL_ICON_SIZE * DIRECTIONAL_HEIGHT_SCALE,
                    scale: viewport.scale,
                    renderLayer: 'main'
                });

                // 选中状态
                if (isSelected) {
                    ctx.strokeStyle = 'yellow';
                    ctx.lineWidth = 3 * viewport.scale;
                    ctx.globalAlpha = 0.8;
                    ctx.beginPath();
                    ctx.arc(canvasPos.x, canvasPos.y, iconSize / 2 + 4, 0, 2 * Math.PI);
                    ctx.stroke();
                    ctx.globalAlpha = 1.0;
                }
            } else if (note.type === "RDirectional") {
                const subBeat = note.subBeat || 0;
                const virtualY = getNoteVirtualY(note.beat, subBeat);
                const virtualX = getNoteVirtualX(note.lane);
                const canvasPos = virtualToCanvas(virtualX, virtualY);
                const iconSize = DIRECTIONAL_ICON_SIZE * viewport.scale;

                // 根据length属性选择对应的组合图标配置
                let iconConfig;
                switch (note.length) {
                    case 1:
                        iconConfig = CanvasNoteIcons.rightFlickR1;
                        break;
                    case 2:
                        iconConfig = CanvasNoteIcons.rightFlickR2;
                        break;
                    case 3:
                        iconConfig = CanvasNoteIcons.rightFlickR3;
                        break;
                    default:
                        iconConfig = CanvasNoteIcons.rightFlickR1;
                }

                // 渲染主图标
                spriteIcon.current.render(ctx, {
                    ...iconConfig,
                    canvasX: canvasPos.x,
                    canvasY: canvasPos.y,
                    canvasSize: DIRECTIONAL_ICON_SIZE,
                    canvasWidth: DIRECTIONAL_ICON_SIZE,
                    canvasHeight: DIRECTIONAL_ICON_SIZE * DIRECTIONAL_HEIGHT_SCALE,
                    scale: viewport.scale,
                    renderLayer: 'main'
                });

                // 选中状态
                if (isSelected) {
                    ctx.strokeStyle = 'yellow';
                    ctx.lineWidth = 3 * viewport.scale;
                    ctx.globalAlpha = 0.8;
                    ctx.beginPath();
                    ctx.arc(canvasPos.x, canvasPos.y, iconSize / 2 + 4, 0, 2 * Math.PI);
                    ctx.stroke();
                    ctx.globalAlpha = 1.0;
                }
            } else if (note.type === "BPM") {
                const virtualY = getNoteVirtualY(note.beat);
                const borderTotalWidth = (1 + 4 + 1 + 1 + 1 + 1);
                // 计算轨道在Canvas中的居中位置
                const totalTrackWidth = LANES * LANE_WIDTH * viewport.scale + borderTotalWidth * 2;
                const trackStartX = (CANVAS_WIDTH - totalTrackWidth) / 2;
                const trackBgX = trackStartX + borderTotalWidth;
                const trackBgWidth = LANES * LANE_WIDTH * viewport.scale;

                // 直接使用画布坐标，不进行虚拟坐标转换
                const canvasStart = { x: trackBgX, y: virtualToCanvas(0, virtualY).y };
                const canvasEnd = { x: trackBgX + trackBgWidth, y: virtualToCanvas(0, virtualY).y };

                ctx.strokeStyle = 'red';
                ctx.lineWidth = 3 * viewport.scale; // 随缩放调整线宽
                ctx.setLineDash([5 * viewport.scale, 5 * viewport.scale]); // 随缩放调整虚线
                ctx.beginPath();
                ctx.moveTo(canvasStart.x, canvasStart.y);
                ctx.lineTo(canvasEnd.x, canvasStart.y);
                ctx.stroke();
                ctx.setLineDash([]);
            } else if (note.type === "Slide" || note.type === "Long") {
                const connections = note.connections;
                if (connections.length < 2) return;

                // 渲染连接线
                for (let i = 0; i < connections.length - 1; i++) {
                    const conn1 = connections[i];
                    const conn2 = connections[i + 1];
                    const subBeat1 = conn1.subBeat || 0;
                    const subBeat2 = conn2.subBeat || 0;
                    const virtualY1 = getNoteVirtualY(conn1.beat, subBeat1);
                    const virtualY2 = getNoteVirtualY(conn2.beat, subBeat2);
                    const virtualX1 = getNoteVirtualX(conn1.lane);
                    const virtualX2 = getNoteVirtualX(conn2.lane);

                    const canvasPos1 = virtualToCanvas(virtualX1, virtualY1);
                    const canvasPos2 = virtualToCanvas(virtualX2, virtualY2);

                    // 计算四边形的四个顶点：上下两边水平、与横向轨道对齐的平行四边形
                    const halfLaneWidth = (LANE_WIDTH * viewport.scale) / 2;
                    const left1 = canvasPos1.x - halfLaneWidth;
                    const right1 = canvasPos1.x + halfLaneWidth;
                    const left2 = canvasPos2.x - halfLaneWidth;
                    const right2 = canvasPos2.x + halfLaneWidth;

                    const quadPoints = [
                        [left1, canvasPos1.y],   // 左上
                        [right1, canvasPos1.y],  // 右上
                        [right2, canvasPos2.y],  // 右下
                        [left2, canvasPos2.y]    // 左下
                    ];

                    const minX = Math.min(left1, right1, left2, right2);
                    const maxX = Math.max(left1, right1, left2, right2);
                    const minY = Math.min(canvasPos1.y, canvasPos2.y);
                    const maxY = Math.max(canvasPos1.y, canvasPos2.y);
                    const centerX = (minX + maxX) / 2;
                    const centerY = (minY + maxY) / 2;
                    const width = maxX - minX;
                    const height = maxY - minY;

                    const diagonalLength = Math.sqrt(width * width + height * height);
                    const slideIconSize = Math.max(diagonalLength, Math.max(width, height)) * 1.0;

                    // 使用clipPath来裁剪slideLine图标到四边形区域
                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(quadPoints[0][0], quadPoints[0][1]);
                    for (let j = 1; j < quadPoints.length; j++) {
                        ctx.lineTo(quadPoints[j][0], quadPoints[j][1]);
                    }
                    ctx.closePath();
                    ctx.clip();

                    spriteIcon.current.render(ctx, {
                        ...CanvasSlideLineIcons.slideLine,
                        canvasX: centerX,
                        canvasY: centerY,
                        canvasSize: slideIconSize,
                        canvasWidth: slideIconSize,
                        canvasHeight: height,
                        scale: 1 // 尺寸已是画布像素，禁止再次缩放
                    });

                    ctx.restore();
                }

                // 渲染连接点
                connections.forEach((conn, i) => {
                    const subBeat = conn.subBeat || 0;
                    const virtualY = getNoteVirtualY(conn.beat, subBeat);
                    const virtualX = getNoteVirtualX(conn.lane);
                    const canvasPos = virtualToCanvas(virtualX, virtualY);
                    const isHidden = conn.hidden;

                    if (isHidden) return;

                    // 根据连接点位置和属性选择sprite图标
                    let iconConfig;
                    const isFirst = i === 0;
                    const isLast = i === connections.length - 1;

                    if (isFirst || isLast) {
                        // 起点和终点使用endpoint图标
                        iconConfig = {
                            ...CanvasSlideLineIcons.endpoint,
                            ...(conn.flick ? CanvasNoteIcons.flick : {}),
                            ...(conn.skill ? CanvasNoteIcons.skill : {})
                        };
                    } else {
                        // 中间途径结点使用pathway图标
                        iconConfig = {
                            ...CanvasSlideLineIcons.pathway,
                            ...(conn.flick ? CanvasNoteIcons.flick : {}),
                            ...(conn.skill ? CanvasNoteIcons.skill : {})
                        };
                    }

                    spriteIcon.current.render(ctx, {
                        ...iconConfig,
                        canvasX: canvasPos.x,
                        canvasY: canvasPos.y,
                        canvasSize: SLIDE_ICON_SIZE,
                        canvasWidth: SLIDE_ICON_SIZE,
                        canvasHeight: SLIDE_ICON_SIZE * SLIDE_HEIGHT_SCALE,
                        scale: viewport.scale
                    });
                });

                // 选中状态（ADR §6：整条高亮虚线框；结点/区域各自独立高亮圈）
                if (isSelected) {
                    const minX = Math.min(...connections.map(c => getNoteVirtualX(c.lane))) - 10;
                    const minY = Math.min(...connections.map(c => getNoteVirtualY(c.beat, c.subBeat || 0))) - 10;
                    const maxX = Math.max(...connections.map(c => getNoteVirtualX(c.lane))) + 10;
                    const maxY = Math.max(...connections.map(c => getNoteVirtualY(c.beat, c.subBeat || 0))) + 10;

                    const canvasMin = virtualToCanvas(minX, minY);
                    const canvasMax = virtualToCanvas(maxX, maxY);

                    ctx.strokeStyle = 'yellow';
                    ctx.lineWidth = 2 * viewport.scale;
                    ctx.setLineDash([5, 5]);
                    ctx.globalAlpha = 0.7;
                    ctx.strokeRect(canvasMin.x, canvasMin.y, canvasMax.x - canvasMin.x, canvasMax.y - canvasMin.y);
                    ctx.setLineDash([]);
                    ctx.globalAlpha = 1.0;
                }

                // 被选中的滑条结点高亮圈（解耦：集中于此，便于后续调整样式）
                connections.forEach((conn, ci) => {
                    if (!isSlideNodeSelected(index, ci)) return;
                    const pos = virtualToCanvas(
                        getNoteVirtualX(conn.lane),
                        getNoteVirtualY(conn.beat, conn.subBeat || 0)
                    );
                    ctx.strokeStyle = '#00e5ff';
                    ctx.lineWidth = 3 * viewport.scale;
                    ctx.globalAlpha = 0.9;
                    ctx.beginPath();
                    ctx.arc(pos.x, pos.y, (SLIDE_ICON_SIZE / 2) * viewport.scale + 6, 0, 2 * Math.PI);
                    ctx.stroke();
                    ctx.globalAlpha = 1.0;
                });

                // 被选中的滑条区域高亮描边（解耦：集中于此）
                for (let ci = 0; ci < connections.length - 1; ci++) {
                    if (!isSlideRegionSelected(index, ci)) continue;
                    const c1 = connections[ci];
                    const c2 = connections[ci + 1];
                    const p1 = virtualToCanvas(
                        getNoteVirtualX(c1.lane),
                        getNoteVirtualY(c1.beat, c1.subBeat || 0)
                    );
                    const p2 = virtualToCanvas(
                        getNoteVirtualX(c2.lane),
                        getNoteVirtualY(c2.beat, c2.subBeat || 0)
                    );
                    const halfLaneWidth = (LANE_WIDTH * viewport.scale) / 2;
                    ctx.strokeStyle = '#00e5ff';
                    ctx.lineWidth = 2 * viewport.scale;
                    ctx.globalAlpha = 0.9;
                    ctx.beginPath();
                    ctx.moveTo(p1.x - halfLaneWidth, p1.y);
                    ctx.lineTo(p1.x + halfLaneWidth, p1.y);
                    ctx.lineTo(p2.x + halfLaneWidth, p2.y);
                    ctx.lineTo(p2.x - halfLaneWidth, p2.y);
                    ctx.closePath();
                    ctx.stroke();
                    ctx.globalAlpha = 1.0;
                }
            }
        });

        // 第二层：装饰器层 - 确保装饰器在所有音符之上
        visibleNotes.forEach(({ note }) => {
            if (note.type === "LDirectional" || note.type === "RDirectional") {
                const subBeat = note.subBeat || 0;
                const virtualY = getNoteVirtualY(note.beat, subBeat);
                const virtualX = getNoteVirtualX(note.lane);
                const canvasPos = virtualToCanvas(virtualX, virtualY);

                // 根据length属性选择对应的组合图标配置
                let iconConfig;
                if (note.type === "LDirectional") {
                    switch (note.length) {
                        case 1: iconConfig = CanvasNoteIcons.leftFlickL1; break;
                        case 2: iconConfig = CanvasNoteIcons.leftFlickL2; break;
                        case 3: iconConfig = CanvasNoteIcons.leftFlickL3; break;
                        default: iconConfig = CanvasNoteIcons.leftFlickL1;
                    }
                } else {
                    switch (note.length) {
                        case 1: iconConfig = CanvasNoteIcons.rightFlickR1; break;
                        case 2: iconConfig = CanvasNoteIcons.rightFlickR2; break;
                        case 3: iconConfig = CanvasNoteIcons.rightFlickR3; break;
                        default: iconConfig = CanvasNoteIcons.rightFlickR1;
                    }
                }

                spriteIcon.current.render(ctx, {
                    ...iconConfig,
                    canvasX: canvasPos.x,
                    canvasY: canvasPos.y,
                    canvasSize: DIRECTIONAL_ICON_SIZE,
                    canvasWidth: DIRECTIONAL_ICON_SIZE,
                    canvasHeight: DIRECTIONAL_ICON_SIZE * DIRECTIONAL_HEIGHT_SCALE,
                    scale: viewport.scale,
                    renderLayer: 'decorators'
                });
            } else if (note.type === "Single" && note.flick) {
                // 滑键音符的装饰器层渲染
                const subBeat = note.subBeat || 0;
                const virtualY = getNoteVirtualY(note.beat, subBeat);
                const virtualX = getNoteVirtualX(note.lane);
                const canvasPos = virtualToCanvas(virtualX, virtualY);

                spriteIcon.current.render(ctx, {
                    ...CanvasNoteIcons.flick,
                    canvasX: canvasPos.x,
                    canvasY: canvasPos.y,
                    canvasSize: NOTE_ICON_SIZE,
                    canvasWidth: NOTE_ICON_SIZE,
                    canvasHeight: NOTE_ICON_SIZE * NOTE_HEIGHT_SCALE,
                    scale: viewport.scale,
                    renderLayer: 'decorators'
                });
            }
        });
    }, [selectedItems, viewport]);

    // 绘制选择框
    const renderSelectionBox = useCallback((ctx: CanvasRenderingContext2D) => {
        if (!selectionBox) return;

        const minX = Math.min(selectionBox.x1, selectionBox.x2);
        const maxX = Math.max(selectionBox.x1, selectionBox.x2);
        const minY = Math.min(selectionBox.y1, selectionBox.y2);
        const maxY = Math.max(selectionBox.y1, selectionBox.y2);

        ctx.fillStyle = 'rgba(0, 123, 255, 0.2)';
        ctx.fillRect(minX, minY, maxX - minX, maxY - minY);

        ctx.strokeStyle = 'rgba(0, 123, 255, 0.8)';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
        ctx.setLineDash([]);
    }, [selectionBox]);

    // 绘制滑条缓冲区（待连接的滑条起点/终点）
    const renderSlideBuffer = useCallback((ctx: CanvasRenderingContext2D) => {
        if (!slideBuffer) return;
        const subBeat = slideBuffer.subBeat || 0;
        const virtualY = getNoteVirtualY(slideBuffer.beat, subBeat);
        const virtualX = getNoteVirtualX(slideBuffer.lane);
        const { x, y } = virtualToCanvas(virtualX, virtualY);
        const s = viewport.scale;

        // 外层柔光光晕
        ctx.beginPath();
        ctx.arc(x, y, 15 * s, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(0, 229, 255, 0.12)';
        ctx.fill();

        // 描边环（半透明）
        ctx.beginPath();
        ctx.arc(x, y, 10 * s, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.55)';
        ctx.lineWidth = 2 * s;
        ctx.stroke();

        // 实心中心点
        ctx.beginPath();
        ctx.arc(x, y, 5 * s, 0, 2 * Math.PI);
        ctx.fillStyle = '#00e5ff';
        ctx.fill();

        // 中心白色高光，增添立体感
        ctx.beginPath();
        ctx.arc(x - 1.2 * s, y - 1.2 * s, 1.6 * s, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fill();
    }, [slideBuffer, viewport]);

    // 在虚拟坐标绘制低透明度音符幽灵（简化为圆形，ADR-0002 §4）
    // 渲染单个精灵图标（幽灵/预览用；透明度由调用方通过 ctx.globalAlpha 控制）
    const renderSpriteGhost = (ctx: CanvasRenderingContext2D, icon: any, cx: number, cy: number, size: number, heightScale: number) => {
        spriteIcon.current.render(ctx, {
            ...icon,
            canvasX: cx, canvasY: cy,
            canvasSize: size, canvasWidth: size, canvasHeight: size * heightScale,
            scale: viewport.scale,
        });
    };

    // 渲染一条滑条的完整外观幽灵（连接带 + 各结点图标）
    const renderSlideGhost = (ctx: CanvasRenderingContext2D, note: { connections: SlideNote["connections"] }) => {
        const conns = note.connections;
        if (conns.length < 2) return;
        for (let i = 0; i < conns.length - 1; i++) {
            const c1 = conns[i]; const c2 = conns[i + 1];
            const p1 = virtualToCanvas(getNoteVirtualX(c1.lane), getNoteVirtualY(c1.beat, c1.subBeat || 0));
            const p2 = virtualToCanvas(getNoteVirtualX(c2.lane), getNoteVirtualY(c2.beat, c2.subBeat || 0));
            const half = (LANE_WIDTH * viewport.scale) / 2;
            const quad = [[p1.x - half, p1.y], [p1.x + half, p1.y], [p2.x + half, p2.y], [p2.x - half, p2.y]];
            const minX = Math.min(p1.x - half, p2.x - half);
            const maxX = Math.max(p1.x + half, p2.x + half);
            const minY = Math.min(p1.y, p2.y);
            const maxY = Math.max(p1.y, p2.y);
            const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
            const w = maxX - minX, h = maxY - minY;
            const sz = Math.max(Math.sqrt(w * w + h * h), Math.max(w, h)) * 1.0;
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(quad[0][0], quad[0][1]);
            for (let j = 1; j < quad.length; j++) ctx.lineTo(quad[j][0], quad[j][1]);
            ctx.closePath();
            ctx.clip();
            spriteIcon.current.render(ctx, {
                ...CanvasSlideLineIcons.slideLine,
                canvasX: cx, canvasY: cy, canvasSize: sz, canvasWidth: sz, canvasHeight: h, scale: 1,
            });
            ctx.restore();
        }
        conns.forEach(conn => {
            const c = virtualToCanvas(getNoteVirtualX(conn.lane), getNoteVirtualY(conn.beat, conn.subBeat || 0));
            const icon = { ...CanvasSlideLineIcons.endpoint, ...(conn.flick ? CanvasNoteIcons.flick : {}), ...(conn.skill ? CanvasNoteIcons.skill : {}) };
            renderSpriteGhost(ctx, icon, c.x, c.y, SLIDE_ICON_SIZE, SLIDE_HEIGHT_SCALE);
        });
    };

    // 渲染一个音符的完整外观幽灵（Q2/Q5：用真实图标而非圆圈；方向键保留其 length 变体）
    const renderNoteGhost = (ctx: CanvasRenderingContext2D, note: ChartNote) => {
        if (note.type === "Single") {
            const c = virtualToCanvas(getNoteVirtualX(note.lane), getNoteVirtualY(note.beat, note.subBeat || 0));
            let icon = BaseSpriteIcons.tap;
            if (note.flick) icon = BaseSpriteIcons.flick;
            else if (note.skill) icon = BaseSpriteIcons.skill;
            renderSpriteGhost(ctx, icon, c.x, c.y, NOTE_ICON_SIZE, NOTE_HEIGHT_SCALE);
        } else if (note.type === "LDirectional" || note.type === "RDirectional") {
            const c = virtualToCanvas(getNoteVirtualX(note.lane), getNoteVirtualY(note.beat, note.subBeat || 0));
            const len = note.length || 1;
            const icon = note.type === "LDirectional"
                ? (len === 1 ? CanvasNoteIcons.leftFlickL1 : len === 2 ? CanvasNoteIcons.leftFlickL2 : CanvasNoteIcons.leftFlickL3)
                : (len === 1 ? CanvasNoteIcons.rightFlickR1 : len === 2 ? CanvasNoteIcons.rightFlickR2 : CanvasNoteIcons.rightFlickR3);
            renderSpriteGhost(ctx, icon, c.x, c.y, DIRECTIONAL_ICON_SIZE, DIRECTIONAL_HEIGHT_SCALE);
        } else if (note.type === "Slide" || note.type === "Long") {
            renderSlideGhost(ctx, note);
        }
    };

    // 放置工具态幽灵：按工具构造一个代表音符（方向键默认 length=1，Q5）
    const ghostNoteForTool = (tool: string, lane: number, beat: number): ChartNote | null => {
        switch (tool) {
            case 'single': return { type: "Single", lane, beat, subBeat: 0 };
            case 'flick': return { type: "Single", lane, beat, subBeat: 0, flick: true };
            case 'skill': return { type: "Single", lane, beat, subBeat: 0, skill: true };
            case 'ldirectional': return { type: "LDirectional", lane, beat, subBeat: 0, length: 1 };
            case 'rdirectional': return { type: "RDirectional", lane, beat, subBeat: 0, length: 1 };
            default: return null;
        }
    };

    // 绘制一组选择条目的镜像结果幽灵（Q4/Q5：用真实图标；滑条区域保留连接带）
    const drawMirrorGhosts = (ctx: CanvasRenderingContext2D, items: SelectionItem[]) => {
        for (const it of items) {
            const note = notes[it.noteIndex];
            if (!note) continue;
            if (note.type === "Slide" || note.type === "Long") {
                if (it.kind === 'slideNode') {
                    const conn = note.connections[it.connIndex];
                    renderNoteGhost(ctx, { type: "Single", lane: 6 - conn.lane, beat: conn.beat, subBeat: conn.subBeat || 0 });
                } else if (it.kind === 'slideRegion') {
                    const c1 = note.connections[it.connIndex];
                    const c2 = note.connections[it.connIndex + 1];
                    renderSlideGhost(ctx, {
                        type: note.type, connections: [
                            { ...c1, lane: 6 - c1.lane },
                            { ...c2, lane: 6 - c2.lane },
                        ],
                    } as SlideNote);
                } else {
                    renderNoteGhost(ctx, mirrorNote(note));
                }
            } else {
                renderNoteGhost(ctx, mirrorNote(note));
            }
        }
    };

    // 镜像工具态悬停预览（Q14）：仅预览单个键；滑条结点/连接带当作一个普通单键预览
    const drawMirrorHoverGhost = (ctx: CanvasRenderingContext2D, hit: SelectionItem) => {
        const note = notes[hit.noteIndex];
        if (!note) return;
        if (note.type === "Slide" || note.type === "Long") {
            if (hit.kind !== 'slideNode' && hit.kind !== 'slideRegion') return;
            const conn = note.connections[hit.connIndex];
            renderNoteGhost(ctx, { type: "Single", lane: 6 - conn.lane, beat: conn.beat, subBeat: conn.subBeat || 0 });
        } else {
            renderNoteGhost(ctx, mirrorNote(note));
        }
    };

    // 工具态预览：光标/框选处绘制低透明度结果幽灵（ADR-0002 §4）
    const renderToolPreview = (ctx: CanvasRenderingContext2D) => {
        if (!hoverPos) return;
        const pos = getLaneBeatFromCanvas(hoverPos.cx, hoverPos.cy);
        if (!pos) return;

        ctx.save();
        ctx.globalAlpha = 0.35;

        // 音符放置工具态：光标处放置幽灵（真实图标，Q2）
        if (selectedTool === 'single' || selectedTool === 'flick' || selectedTool === 'skill'
            || selectedTool === 'ldirectional' || selectedTool === 'rdirectional') {
            const ghost = ghostNoteForTool(selectedTool, pos.lane, pos.preciseBeat);
            if (ghost) renderNoteGhost(ctx, ghost);
            ctx.restore();
            return;
        }

        // 粘贴工具态：剪贴板组幽灵（Q4/Q5：保留源音符原本外观）
        if (selectedTool === 'paste' && clipboard && clipboard.length > 0) {
            const shifted = shiftGroupToAnchor(clipboard, pos.preciseBeat, pos.lane);
            for (const n of shifted) renderNoteGhost(ctx, n);
            ctx.restore();
            return;
        }

        // 镜像工具态（Q14）：悬停仅预览单个键；框选按下态预览含连接区域（与实际镜像一致）
        if (selectedTool === 'mirror') {
            if (selectionBox) {
                drawMirrorGhosts(ctx, computeItemsInBox(selectionBox));
            } else {
                const hit = findItemAt(hoverPos.cx, hoverPos.cy);
                if (hit) drawMirrorHoverGhost(ctx, hit);
            }
        }

        ctx.restore();
    };


    // 渲染BPM数字
    const renderBpmNumbers = useCallback((ctx: CanvasRenderingContext2D) => {
        const bpmMarks = notes.filter(note => note.type === "BPM");

        bpmMarks.forEach((note) => {
            const virtualY = getNoteVirtualY(note.beat);
            const canvasPos = virtualToCanvas(0, virtualY);

            // 检查是否在可见区域内 - 放宽检查范围，确保BPM在最下面时也能显示
            if (canvasPos.y >= -50 && canvasPos.y <= CANVAS_HEIGHT + 50) {
                // 计算轨道在Canvas中的居中位置
                const borderTotalWidth = (1 + 4 + 1 + 1 + 1 + 1);
                const totalTrackWidth = LANES * LANE_WIDTH * viewport.scale + borderTotalWidth * 2;
                const trackStartX = (CANVAS_WIDTH - totalTrackWidth) / 2;
                const trackBgX = trackStartX + borderTotalWidth;
                const trackBgWidth = LANES * LANE_WIDTH * viewport.scale;

                // 绘制BPM线（红色横线）
                ctx.strokeStyle = '#ff6666';
                ctx.lineWidth = 3 * viewport.scale;
                ctx.setLineDash([]); // 实线
                ctx.beginPath();
                ctx.moveTo(trackBgX, canvasPos.y);
                ctx.lineTo(trackBgX + trackBgWidth, canvasPos.y);
                ctx.stroke();

                // 将BPM数字放在轨道外面（左侧），在BPM线上面
                const textY = canvasPos.y - 15 * viewport.scale; // 在BPM线上面15像素
                const textX = trackStartX - 80; // 在轨道左侧80像素处

                // 确保BPM数字在画布范围内显示
                if (textY >= -20 && textY <= CANVAS_HEIGHT + 20) {
                    ctx.fillStyle = '#ff6666';
                    ctx.font = `bold ${12 * viewport.scale}px Arial`;
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(`BPM ${(note as any).bpm}`, textX, textY);
                }
            }
        });
    }, [notes, viewport]);

    // ---------------------------
    // 事件处理
    // ---------------------------
    const handleWheel = useCallback((e: WheelEvent) => {
        // 只处理Ctrl+滚轮缩放，禁用普通滚动
        if (e.ctrlKey) {
            e.preventDefault();

            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect) return;

            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            // 获取鼠标在虚拟坐标系中的位置
            const virtualMouse = canvasToVirtual(mouseX, mouseY);

            // 计算缩放
            const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
            const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, viewport.scale * zoomFactor));

            // 计算新的垂直滚动位置，保持鼠标所在 beat 纵向不变
            // 水平方向无滚动（轨道始终水平居中），scrollX 保持 0，
            // 音符随 trackBgX 一起缩放就不会漂移。
            const newScrollY = virtualMouse.y - mouseY / newScale;

            setViewport(prev => ({
                ...prev,
                scale: newScale,
                scrollX: 0,
                scrollY: newScrollY
            }));
        }
        // 普通滚轮滚动由父容器处理，不在这里处理
    }, [viewport]);

    // 切换离开滑条工具时清空待连接锚点（防止残留红点）
    useEffect(() => {
        if (selectedTool !== "slide") {
            setSlideBuffer(null);
        }
    }, [selectedTool]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        // 鼠标 / 镜像工具态：记录圈选起点，支持点击单选与拖拽圈选（镜像框选用于预览+批量执行）
        if (selectedTool === "mouse" || selectedTool === "mirror") {
            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect) return;
            selectionStartRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            selectionMovedRef.current = false;
            setSelectionBox(null);
        }
    }, [selectedTool]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // 记录悬停位置（供工具态预览：放置/粘贴/镜像）
        setHoverPos({ cx: mouseX, cy: mouseY });

        // 更新状态栏鼠标位置与粘贴锚点
        const pos = getLaneBeatFromCanvas(mouseX, mouseY);
        if (pos) {
            onMousePositionChange({ lane: pos.lane, beat: pos.preciseBeat });
        } else {
            onMousePositionChange(null);
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

        // 禁用拖拽滚动，滚动由父容器处理
        if (dragging && dragStart) {
            // 拖拽滚动由父容器处理，虚拟画布不处理拖拽滚动
            setDragStart({ x: e.clientX, y: e.clientY });
        }
    }, [dragging, dragStart, viewport, onMousePositionChange, beatDisplay, selectedTool]);

    // ---------------------------
    // 命中测试（供编辑工具态点击执行 / 右键删除 / 镜像悬停预览）
    // ---------------------------
    // 命中测试：返回点击位置命中的选择条目（任意音符类型）
    // - 普通音符/方向键/BPM → {kind:'note'}
    // - 滑条结点 → {kind:'slideNode', connIndex}
    // - 滑条连接带区域 → {kind:'slideRegion', connIndex}
    const findItemAt = useCallback((cx: number, cy: number): SelectionItem | null => {
        const slideNodeRadius = (SLIDE_ICON_SIZE / 2) * viewport.scale + 4 * viewport.scale;
        const noteRadius = (NOTE_ICON_SIZE / 2) * viewport.scale + 4 * viewport.scale;
        const halfLaneWidth = (LANE_WIDTH * viewport.scale) / 2;

        for (let i = 0; i < notes.length; i++) {
            const note = notes[i];

            if (note.type === "Slide" || note.type === "Long") {
                const connections = (note as SlideNote).connections;

                // 先检测是否命中结点（端点或中间结点）
                for (let ci = 0; ci < connections.length; ci++) {
                    const conn = connections[ci];
                    const vx = getNoteVirtualX(conn.lane);
                    const vy = getNoteVirtualY(conn.beat, conn.subBeat || 0);
                    const pos = virtualToCanvas(vx, vy);
                    const dx = pos.x - cx;
                    const dy = pos.y - cy;
                    if (dx * dx + dy * dy <= slideNodeRadius * slideNodeRadius) {
                        return { kind: 'slideNode', noteIndex: i, connIndex: ci };
                    }
                }

                // 再检测是否命中连接带区域（平行四边形）
                for (let ci = 0; ci < connections.length - 1; ci++) {
                    const conn1 = connections[ci];
                    const conn2 = connections[ci + 1];
                    const p1 = virtualToCanvas(
                        getNoteVirtualX(conn1.lane),
                        getNoteVirtualY(conn1.beat, conn1.subBeat || 0)
                    );
                    const p2 = virtualToCanvas(
                        getNoteVirtualX(conn2.lane),
                        getNoteVirtualY(conn2.beat, conn2.subBeat || 0)
                    );
                    // 上下两边水平、与横向轨道对齐的平行四边形
                    const quad = [
                        [p1.x - halfLaneWidth, p1.y],
                        [p1.x + halfLaneWidth, p1.y],
                        [p2.x + halfLaneWidth, p2.y],
                        [p2.x - halfLaneWidth, p2.y]
                    ];
                    if (pointInQuad(cx, cy, quad)) {
                        return { kind: 'slideRegion', noteIndex: i, connIndex: ci };
                    }
                }
            } else if (note.type === "Single" || note.type === "LDirectional" || note.type === "RDirectional") {
                const vx = getNoteVirtualX(note.lane);
                const vy = getNoteVirtualY(note.beat, note.subBeat || 0);
                const pos = virtualToCanvas(vx, vy);
                const dx = pos.x - cx;
                const dy = pos.y - cy;
                if (dx * dx + dy * dy <= noteRadius * noteRadius) {
                    return { kind: 'note', noteIndex: i };
                }
            } else if (note.type === "BPM") {
                const vy = getNoteVirtualY(note.beat);
                const pos = virtualToCanvas(getNoteVirtualX(0), vy);
                const dx = pos.x - cx;
                const dy = pos.y - cy;
                if (dx * dx + dy * dy <= noteRadius * noteRadius) {
                    return { kind: 'note', noteIndex: i };
                }
            }
        }
        return null;
    }, [notes, viewport]);

    // 点在四边形内判定
    const pointInQuad = useCallback((px: number, py: number, quad: number[][]): boolean => {
        let inside = false;
        for (let i = 0, j = quad.length - 1; i < quad.length; j = i++) {
            const xi = quad[i][0], yi = quad[i][1];
            const xj = quad[j][0], yj = quad[j][1];
            const intersect = ((yi > py) !== (yj > py)) &&
                (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }, []);

    // 处理鼠标点击事件
    const handleClick = useCallback((e: React.MouseEvent) => {
        // 鼠标状态下的选择（点击/圈选）已在 mouseup 中处理，这里直接跳过
        if (selectedTool === "mouse") {
            return;
        }

        // 其他工具的处理逻辑
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // 计算轨道在Canvas中的居中位置
        const borderTotalWidth = (1 + 4 + 1 + 1 + 1 + 1);
        const totalTrackWidth = LANES * LANE_WIDTH * viewport.scale + borderTotalWidth * 2;
        const trackStartX = (CANVAS_WIDTH - totalTrackWidth) / 2;
        const trackBgX = trackStartX + borderTotalWidth;

        // 计算相对于轨道背景的鼠标位置
        const relativeX = mouseX - trackBgX;
        const lane = Math.floor(relativeX / (LANE_WIDTH * viewport.scale));

        // 计算beat位置 - 使用正确的虚拟坐标转换
        const virtualY = viewport.scrollY + mouseY / viewport.scale;
        const beat = virtualYToBeat(virtualY);

        if (lane >= 0 && lane < LANES && beat >= 0) {
            // 对齐到节拍显示值
            const subBeatPosition = beat * beatDisplay;
            const nearestSubBeat = Math.round(subBeatPosition);
            const preciseBeat = nearestSubBeat / beatDisplay;

            // 音符放置逻辑：应用覆盖替换规则（替换/方向键组合）
            if (selectedTool === "single" || selectedTool === "flick" || selectedTool === "skill"
                || selectedTool === "ldirectional" || selectedTool === "rdirectional") {
                const result = handleNoteReplacement(notes, preciseBeat, lane, 0, selectedTool);
                if (result.shouldReplace) {
                    _setNotes(result.newNotes);
                }
            } else if (selectedTool === "slide") {
                // 自动连接滑条：两点击创建滑条，并应用滑条与滑条组合规则
                const point = { beat: preciseBeat, lane, subBeat: 0 };
                if (!slideBuffer) {
                    setSlideBuffer(point);
                } else {
                    // 规则2：禁止横向放置——同 beat（含 subBeat）的两点不可连成滑条
                    const sameBeat =
                        slideBuffer.beat === point.beat &&
                        (slideBuffer.subBeat || 0) === (point.subBeat || 0);
                    if (sameBeat) {
                        setSlideBuffer(null);
                    } else {
                        const comb = handleSlideToSlideCombination(notes, [slideBuffer, point]);
                        if (comb.shouldCombine) {
                            _setNotes(comb.newNotes);
                        } else {
                            const newNotes = [...comb.newNotes];
                            const [start, end] = [slideBuffer, point].sort(
                                (a, b) => (a.beat - b.beat) || ((a.subBeat || 0) - (b.subBeat || 0))
                            );
                            newNotes.push({ type: "Slide", connections: [start, end] });
                            _setNotes(newNotes);
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
                    _setNotes([...notes, newNote]);
                }
            }
        }
    }, [selectedTool, selectedItems, setSelectedItems, notes, viewport, beatDisplay, slideBuffer]);

    const handleMouseUp = useCallback((e: React.MouseEvent) => {
        setDragging(false);
        setDragStart(null);

        const rect = canvasRef.current?.getBoundingClientRect();
        const mx = rect ? e.clientX - rect.left : 0;
        const my = rect ? e.clientY - rect.top : 0;

        // 镜像工具态：单点点击命中即镜像；拖拽圈选 → 预览（渲染时）+ 松手批量镜像
        if (selectedTool === "mirror") {
            if (selectionStartRef.current && selectionMovedRef.current && selectionBox) {
                const items = computeItemsInBox(selectionBox);
                setSelectedItems(items);
                if (items.length > 0 && onEditToolAction) {
                    items.forEach(it => onEditToolAction('mirror', it));
                }
            } else if (onEditToolAction) {
                const hit = findItemAt(mx, my);
                if (hit) onEditToolAction('mirror', hit);
            }
            selectionStartRef.current = null;
            setSelectionBox(null);
            return;
        }

        // 复制/剪切/删除工具态：点击命中音符即执行
        if ((selectedTool === "copy" || selectedTool === "cut" || selectedTool === "delete") && onEditToolAction) {
            const hit = findItemAt(mx, my);
            if (hit) onEditToolAction(selectedTool, hit);
            selectionStartRef.current = null;
            setSelectionBox(null);
            return;
        }

        // 粘贴工具态：点击位置即粘贴
        if (selectedTool === "paste" && onEditToolPaste) {
            const pos = getLaneBeatFromCanvas(mx, my);
            if (pos) onEditToolPaste({ beat: pos.preciseBeat, lane: pos.lane });
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
            // 拖拽圈选：选中框内音符（按子部分）
            selectItemsInBox(selectionBox);
        } else {
            // 点击单选 / Shift 加选 / Ctrl 选整条滑条
            const start = selectionStartRef.current;
            selectItemAtPoint(start.x, start.y, e.shiftKey, e.ctrlKey || e.metaKey);
        }

        selectionStartRef.current = null;
        setSelectionBox(null);
    }, [selectedTool, selectionBox, notes, selectedItems, computeItemsInBox, onEditToolAction, onEditToolPaste, findItemAt, getLaneBeatFromCanvas]);

    // ---------------------------
    // 右键删除滑条子段：区域（连接带）/ 端点 / 中间结点
    // ---------------------------
    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // 右键 = 选中命中目标 + 删除（对任意音符生效）
        const hit = findItemAt(mouseX, mouseY);
        if (!hit) return;

        setSelectedItems([hit]);
        _setNotes(deleteSelection(notes, [hit]));
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
        const totalVirtualHeight = TOTAL_VIRTUAL_HEIGHT;
        const scaledBounds = getScaledVirtualBounds(viewport.scale);
        // 确保初始滚动位置在最下面（起始拍），但在虚拟边界内
        const initialScrollY = Math.max(scaledBounds.minY, Math.min(scaledBounds.maxY - CANVAS_HEIGHT / viewport.scale, totalVirtualHeight - CANVAS_HEIGHT / viewport.scale));

        setViewport(prev => ({
            ...prev,
            scrollY: initialScrollY,
            virtualHeight: totalVirtualHeight,
            virtualWidth: LANES * LANE_WIDTH + (1 + 4 + 1 + 1 + 1 + 1) * 2
        }));

        // 通知父组件虚拟高度变化
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

    // 同步外部滚动位置
    useEffect(() => {
        if (externalScrollY !== undefined) {
            setViewport(prev => {
                const scaledBounds = getScaledVirtualBounds(prev.scale);
                const newScrollY = Math.max(scaledBounds.minY, Math.min(scaledBounds.maxY - CANVAS_HEIGHT / prev.scale, externalScrollY));
                return {
                    ...prev,
                    scrollY: newScrollY
                };
            });
        }
    }, [externalScrollY]);


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
                    onMouseLeave={() => onMousePositionChange(null)}
                    onClick={handleClick}
                    style={{
                        backgroundColor: '#000000',
                        display: 'block',
                        userSelect: 'none',
                        border: '1px solid #333',
                        width: `${CANVAS_WIDTH}px`, // 使用固定像素值
                        height: `${CANVAS_HEIGHT}px`, // 使用固定像素值
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