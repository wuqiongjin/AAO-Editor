import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import type { ChartNote } from "../notes/Charts";
import CanvasSpriteIcon, { CanvasNoteIcons, CanvasSlideLineIcons, BaseSpriteIcons } from './CanvasSpriteIcon';
// import { handleNoteReplacement, handleSlideToSlideCombination } from '../utils/NoteReplacementRules';
// import { slideEndpointManager } from '../utils/SlideEndpointManager';

interface FinalVirtualCanvasProps {
    notes: ChartNote[];
    setNotes: (notes: ChartNote[]) => void;
    selectedTool: string;
    selectedNotes: number[];
    setSelectedNotes: (notes: number[]) => void;
    beatDisplay: number;
    onMousePositionChange: (position: { lane: number; beat: number } | null) => void;
    scale: number;
    isCombinationMode: boolean;
    onScrollChange?: (scrollY: number, virtualHeight: number) => void;
    externalScrollY?: number; // 外部控制的滚动位置
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

// 虚拟画布边界配置
const VIRTUAL_BOUNDS = {
    minY: 0, // 虚拟画布下限
    maxY: BEAT_HEIGHT * BEATS * VIRTUAL_HEIGHT_MULTIPLIER, // 虚拟画布上限
    minX: 0,
    maxX: LANES * LANE_WIDTH + (1 + 4 + 1 + 1 + 1 + 1) * 2
};

// 缩放时的虚拟边界调整
const getScaledVirtualBounds = (scale: number) => {
    // 使用固定的虚拟高度计算，避免依赖组件内部函数
    const totalVirtualHeight = BEAT_HEIGHT * BEATS * VIRTUAL_HEIGHT_MULTIPLIER;
    const totalVirtualWidth = LANES * LANE_WIDTH + (1 + 4 + 1 + 1 + 1 + 1) * 2;

    console.log('🔧 缩放边界计算:', {
        scale,
        totalVirtualHeight,
        totalVirtualWidth,
        BEATS,
        VIRTUAL_HEIGHT_MULTIPLIER
    });

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
    selectedNotes,
    setSelectedNotes,
    beatDisplay,
    onMousePositionChange,
    scale,
    isCombinationMode,
    onScrollChange,
    externalScrollY
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
    const [slideBuffer] = useState<{ beat: number; lane: number; subBeat?: number }[]>([]);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [isSelecting] = useState(false); // 保留用于未来功能
    const [selectionBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

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
        getVirtualHeight: () => viewport.virtualHeight
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
    const beatToVirtualY = (beat: number) => {
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

    const virtualYToBeat = (virtualY: number) => {
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

    // ---------------------------
    // 坐标转换：虚拟坐标 <-> 画布坐标
    // ---------------------------
    const virtualToCanvas = (virtualX: number, virtualY: number) => {
        const canvasX = (virtualX - viewport.scrollX) * viewport.scale;
        const canvasY = (virtualY - viewport.scrollY) * viewport.scale;
        return { x: canvasX, y: canvasY };
    };

    const canvasToVirtual = (canvasX: number, canvasY: number) => {
        const virtualX = canvasX / viewport.scale + viewport.scrollX;
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

        console.log('🔍 视口边界计算:', {
            viewport: viewport.scrollY,
            scale: viewport.scale,
            padding,
            scaledBounds,
            bounds,
            CANVAS_HEIGHT: CANVAS_HEIGHT / viewport.scale,
            'viewport + CANVAS_HEIGHT': viewport.scrollY + CANVAS_HEIGHT / viewport.scale
        });

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
        const borderTotalWidth = (1 + 4 + 1 + 1 + 1 + 1);
        return borderTotalWidth + lane * LANE_WIDTH + LANE_WIDTH / 2;
    };

    // ---------------------------
    // 视口剔除：只渲染可见区域的音符
    // ---------------------------
    const getVisibleNotes = () => {
        const bounds = getViewportBounds();
        const visibleNotes: { note: ChartNote; index: number }[] = [];

        console.log('🔍 视口边界检查:', {
            bounds,
            viewport: viewport.scrollY,
            scale: viewport.scale
        });

        notes.forEach((note, index) => {
            let isVisible = false;

            if (note.type === "Single" || note.type === "LDirectional" || note.type === "RDirectional") {
                const virtualY = getNoteVirtualY(note.beat, note.subBeat || 0);
                const virtualX = getNoteVirtualX(note.lane);
                isVisible = virtualY >= bounds.minY && virtualY <= bounds.maxY &&
                    virtualX >= bounds.minX && virtualX <= bounds.maxX;

                console.log('🎵 音符可见性检查:', {
                    note: { beat: note.beat, lane: note.lane, type: note.type },
                    virtualY,
                    virtualX,
                    bounds,
                    isVisible
                });
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
            console.log('❌ Canvas ref is null');
            return;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            console.log('❌ Canvas context is null');
            return;
        }

        console.log('🎨 开始渲染虚拟画布:', {
            viewport: viewport.scrollY,
            scale: viewport.scale,
            notesCount: notes.length
        });

        // 设置固定画布尺寸
        canvas.width = CANVAS_WIDTH;
        canvas.height = CANVAS_HEIGHT;

        console.log('🎨 Canvas尺寸设置:', {
            canvasWidth: canvas.width,
            canvasHeight: canvas.height,
            CANVAS_WIDTH,
            CANVAS_HEIGHT,
            canvasStyle: {
                width: canvas.style.width,
                height: canvas.style.height,
                display: canvas.style.display
            }
        });

        // 清空画布
        ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // 绘制背景
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // 测试绘制已移除，恢复正常的轨道渲染

        console.log('🎨 测试绘制完成:', {
            canvasWidth: canvas.width,
            canvasHeight: canvas.height,
            testRectangles: '4个彩色方块已绘制'
        });

        // 计算虚拟总尺寸
        const totalVirtualHeight = beatToVirtualY(BEATS) * VIRTUAL_HEIGHT_MULTIPLIER;
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

        console.log('🎨 绘制轨道背景:', {
            trackBgX,
            trackBgY,
            trackBgWidth,
            trackBgHeight,
            viewport: viewport.scrollY,
            scale: viewport.scale
        });

        ctx.fillStyle = '#00000A';
        ctx.fillRect(trackBgX, trackBgY, trackBgWidth, trackBgHeight);

        // 绘制网格
        renderGrid(ctx, trackStartX, trackBgX, trackBgWidth);

        // 获取可见音符并渲染
        const visibleNotes = getVisibleNotes();
        console.log('🎵 可见音符数量:', visibleNotes.length);
        renderNotes(ctx, visibleNotes);

        // 渲染BPM数字（在画布内部）
        renderBpmNumbers(ctx);

        // 绘制选择框
        if (selectionBox) {
            renderSelectionBox(ctx);
        }

        // 绘制滑条缓冲区
        renderSlideBuffer(ctx);

        console.log('✅ 虚拟画布渲染完成');

    }, [notes, selectedNotes, viewport, selectionBox, slideBuffer, beatDisplay]);

    // 绘制网格
    const renderGrid = useCallback((ctx: CanvasRenderingContext2D, trackStartX: number, trackBgX: number, trackBgWidth: number) => {
        const borderTotalWidth = (1 + 4 + 1 + 1 + 1 + 1);
        const totalVirtualHeight = beatToVirtualY(BEATS);

        console.log('🎨 开始绘制网格:', {
            trackStartX,
            trackBgX,
            trackBgWidth,
            totalVirtualHeight,
            viewport: viewport.scrollY,
            scale: viewport.scale
        });

        // 绘制垂直线（轨道线）
        console.log('📏 绘制垂直轨道线:', { LANES, trackStartX, borderTotalWidth, scale: viewport.scale });
        for (let lane = 0; lane <= LANES; lane++) {
            const x = trackStartX + borderTotalWidth + lane * LANE_WIDTH * viewport.scale;
            console.log(`🎯 轨道线 ${lane}:`, { x, lane, LANE_WIDTH: LANE_WIDTH * viewport.scale });

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
        console.log('🔍 绘制水平线:', { bounds, viewport: viewport.scrollY, scale: viewport.scale });

        let drawnLines = 0;
        for (let beat = 0; beat < BEATS; beat++) {
            const virtualY = beatToVirtualY(beat);
            if (virtualY < bounds.minY || virtualY > bounds.maxY) {
                if (beat < 5) console.log(`⏭️ 跳过beat ${beat}:`, { virtualY, bounds });
                continue;
            }

            const canvasPos = virtualToCanvas(0, virtualY);
            if (canvasPos.y >= 0 && canvasPos.y <= CANVAS_HEIGHT) {
                drawnLines++;
                if (drawnLines <= 5) console.log(`✅ 绘制beat ${beat}:`, { virtualY, canvasPos, bounds });
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

        console.log('📊 网格绘制完成:', { drawnLines, totalBeats: BEATS });
    }, [viewport, beatDisplay]);

    // 绘制音符
    const renderNotes = useCallback((ctx: CanvasRenderingContext2D, visibleNotes: { note: ChartNote; index: number }[]) => {
        const borderTotalWidth = (1 + 4 + 1 + 1 + 1 + 1);

        // 第一层：普通音符和方向键主体
        visibleNotes.forEach(({ note, index }) => {
            const isSelected = selectedNotes.includes(index);

            if (note.type === "Single") {
                const subBeat = note.subBeat || 0;
                const virtualY = getNoteVirtualY(note.beat, subBeat);
                const virtualX = getNoteVirtualX(note.lane);
                const canvasPos = virtualToCanvas(virtualX, virtualY);
                const iconSize = NOTE_ICON_SIZE * viewport.scale;
                const iconHeight = iconSize * NOTE_HEIGHT_SCALE;

                // 根据音符类型选择图标
                let iconConfig = BaseSpriteIcons.tap;
                if (note.flick) {
                    iconConfig = BaseSpriteIcons.flick;
                } else if (note.skill) {
                    iconConfig = BaseSpriteIcons.skill;
                }

                // 渲染主图标
                spriteIcon.current.render(ctx, {
                    ...iconConfig,
                    canvasX: canvasPos.x,
                    canvasY: canvasPos.y,
                    canvasSize: iconSize,
                    canvasWidth: iconSize,
                    canvasHeight: iconHeight,
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
                const iconHeight = iconSize * DIRECTIONAL_HEIGHT_SCALE;

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
                    canvasSize: iconSize,
                    canvasWidth: iconSize,
                    canvasHeight: iconHeight,
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
                const iconHeight = iconSize * DIRECTIONAL_HEIGHT_SCALE;

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
                    canvasSize: iconSize,
                    canvasWidth: iconSize,
                    canvasHeight: iconHeight,
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

                const iconSize = SLIDE_ICON_SIZE * viewport.scale;
                const iconHeight = iconSize * SLIDE_HEIGHT_SCALE;

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

                    // 计算四边形的四个顶点
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
                        scale: viewport.scale
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
                        canvasSize: iconSize,
                        canvasWidth: iconSize,
                        canvasHeight: iconHeight,
                        scale: viewport.scale
                    });
                });

                // 选中状态
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
            }
        });

        // 第二层：装饰器层 - 确保装饰器在所有音符之上
        visibleNotes.forEach(({ note }) => {
            if (note.type === "LDirectional" || note.type === "RDirectional") {
                const subBeat = note.subBeat || 0;
                const virtualY = getNoteVirtualY(note.beat, subBeat);
                const virtualX = getNoteVirtualX(note.lane);
                const canvasPos = virtualToCanvas(virtualX, virtualY);
                const iconSize = DIRECTIONAL_ICON_SIZE * viewport.scale;
                const iconHeight = iconSize * DIRECTIONAL_HEIGHT_SCALE;

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
                    canvasSize: iconSize,
                    canvasWidth: iconSize,
                    canvasHeight: iconHeight,
                    scale: viewport.scale,
                    renderLayer: 'decorators'
                });
            } else if (note.type === "Single" && note.flick) {
                // 滑键音符的装饰器层渲染
                const subBeat = note.subBeat || 0;
                const virtualY = getNoteVirtualY(note.beat, subBeat);
                const virtualX = getNoteVirtualX(note.lane);
                const canvasPos = virtualToCanvas(virtualX, virtualY);
                const iconSize = NOTE_ICON_SIZE * viewport.scale;
                const iconHeight = iconSize * NOTE_HEIGHT_SCALE;

                spriteIcon.current.render(ctx, {
                    ...CanvasNoteIcons.flick,
                    canvasX: canvasPos.x,
                    canvasY: canvasPos.y,
                    canvasSize: iconSize,
                    canvasWidth: iconSize,
                    canvasHeight: iconHeight,
                    scale: viewport.scale,
                    renderLayer: 'decorators'
                });
            }
        });
    }, [selectedNotes, viewport]);

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

    // 绘制滑条缓冲区
    const renderSlideBuffer = useCallback((ctx: CanvasRenderingContext2D) => {
        slideBuffer.forEach((point) => {
            const subBeat = point.subBeat || 0;
            const virtualY = getNoteVirtualY(point.beat, subBeat);
            const virtualX = getNoteVirtualX(point.lane);
            const canvasPos = virtualToCanvas(virtualX, virtualY);

            ctx.fillStyle = 'orange';
            ctx.globalAlpha = 0.7;
            ctx.beginPath();
            ctx.arc(canvasPos.x, canvasPos.y, 8 * viewport.scale, 0, 2 * Math.PI);
            ctx.fill();
            ctx.globalAlpha = 1.0;
        });
    }, [slideBuffer, viewport]);

    // 渲染BPM数字
    const renderBpmNumbers = useCallback((ctx: CanvasRenderingContext2D) => {
        const bpmMarks = notes.filter(note => note.type === "BPM");

        console.log('🎵 渲染BPM数字:', {
            bpmMarksCount: bpmMarks.length,
            bpmMarks: bpmMarks.map(note => ({ beat: note.beat, bpm: (note as any).bpm }))
        });

        bpmMarks.forEach((note) => {
            const virtualY = getNoteVirtualY(note.beat);
            const canvasPos = virtualToCanvas(0, virtualY);

            console.log('🎵 BPM渲染检查:', {
                beat: note.beat,
                bpm: (note as any).bpm,
                virtualY,
                canvasPos,
                inViewport: canvasPos.y >= 0 && canvasPos.y <= CANVAS_HEIGHT
            });

            // 检查是否在可见区域内
            if (canvasPos.y >= 0 && canvasPos.y <= CANVAS_HEIGHT) {
                // 计算轨道在Canvas中的居中位置
                const borderTotalWidth = (1 + 4 + 1 + 1 + 1 + 1);
                const totalTrackWidth = LANES * LANE_WIDTH * viewport.scale + borderTotalWidth * 2;
                const trackStartX = (CANVAS_WIDTH - totalTrackWidth) / 2;
                const trackBgX = trackStartX + borderTotalWidth;
                const trackBgWidth = LANES * LANE_WIDTH * viewport.scale;

                console.log('🎵 绘制BPM线和数字:', {
                    text: `BPM ${(note as any).bpm}`,
                    beat: note.beat,
                    virtualY,
                    canvasPos,
                    trackStartX,
                    trackBgX,
                    trackBgWidth,
                    scale: viewport.scale
                });

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

                ctx.fillStyle = '#ff6666';
                ctx.font = `bold ${12 * viewport.scale}px Arial`;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(`BPM ${(note as any).bpm}`, textX, textY);
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

            // 计算新的滚动位置，保持鼠标位置不变
            const newScrollX = virtualMouse.x - mouseX / newScale;
            const newScrollY = virtualMouse.y - mouseY / newScale;

            setViewport(prev => ({
                ...prev,
                scale: newScale,
                scrollX: newScrollX,
                scrollY: newScrollY
            }));
        }
        // 普通滚轮滚动由父容器处理，不在这里处理
    }, [viewport]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        // 只有在按住特定键时才允许拖拽
        if (e.shiftKey || e.ctrlKey) {
            e.preventDefault();
            setDragging(true);
            setDragStart({ x: e.clientX, y: e.clientY });
        }
        // 不阻止默认行为，允许点击事件正常处理
    }, []);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
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
            onMousePositionChange({ lane, beat: preciseBeat });
        } else {
            onMousePositionChange(null);
        }

        // 禁用拖拽滚动，滚动由父容器处理
        if (dragging && dragStart) {
            // 拖拽滚动由父容器处理，虚拟画布不处理拖拽滚动
            setDragStart({ x: e.clientX, y: e.clientY });
        }
    }, [dragging, dragStart, viewport, onMousePositionChange, beatDisplay]);

    // 处理鼠标点击事件
    const handleClick = useCallback((e: React.MouseEvent) => {
        if (selectedTool === "mouse") {
            // 鼠标状态下点击音符进行选择
            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect) return;

            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const virtualMouse = canvasToVirtual(mouseX, mouseY);

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

                // 查找点击的音符
                const noteIndex = notes.findIndex(note => {
                    if (note.type === "Single" || note.type === "LDirectional" || note.type === "RDirectional") {
                        return Math.abs(note.beat - preciseBeat) < 0.0001 && note.lane === lane;
                    } else if (note.type === "Slide" || note.type === "Long") {
                        return note.connections.some(conn =>
                            Math.abs(conn.beat - preciseBeat) < 0.0001 && conn.lane === lane
                        );
                    }
                    return false;
                });

                if (noteIndex !== -1) {
                    if (isCombinationMode) {
                        if (selectedNotes.includes(noteIndex)) {
                            setSelectedNotes(selectedNotes.filter(i => i !== noteIndex));
                        } else {
                            setSelectedNotes([...selectedNotes, noteIndex]);
                        }
                    } else {
                        setSelectedNotes([noteIndex]);
                    }
                } else if (!isCombinationMode) {
                    setSelectedNotes([]);
                }
            }
            return;
        }

        // 其他工具的处理逻辑
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const virtualMouse = canvasToVirtual(mouseX, mouseY);

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

            // 音符放置逻辑
            if (selectedTool === "single") {
                const newNote: ChartNote = {
                    beat: preciseBeat,
                    lane: lane,
                    type: "Single"
                };
                _setNotes([...notes, newNote]);
            } else if (selectedTool === "flick") {
                const newNote: ChartNote = {
                    beat: preciseBeat,
                    lane: lane,
                    type: "Single",
                    flick: true
                };
                _setNotes([...notes, newNote]);
            } else if (selectedTool === "skill") {
                const newNote: ChartNote = {
                    beat: preciseBeat,
                    lane: lane,
                    type: "Single",
                    skill: true
                };
                _setNotes([...notes, newNote]);
            } else if (selectedTool === "ldirectional") {
                const newNote: ChartNote = {
                    beat: preciseBeat,
                    lane: lane,
                    type: "LDirectional",
                    length: 1
                };
                _setNotes([...notes, newNote]);
            } else if (selectedTool === "rdirectional") {
                const newNote: ChartNote = {
                    beat: preciseBeat,
                    lane: lane,
                    type: "RDirectional",
                    length: 1
                };
                _setNotes([...notes, newNote]);
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
    }, [selectedTool, selectedNotes, setSelectedNotes, isCombinationMode, notes, viewport, beatDisplay]);

    const handleMouseUp = useCallback(() => {
        setDragging(false);
        setDragStart(null);
    }, []);

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
        const totalVirtualHeight = beatToVirtualY(BEATS) * VIRTUAL_HEIGHT_MULTIPLIER;
        const scaledBounds = getScaledVirtualBounds(viewport.scale);
        // 确保初始滚动位置在最下面，但在虚拟边界内
        const initialScrollY = Math.max(scaledBounds.minY, Math.min(scaledBounds.maxY - CANVAS_HEIGHT / viewport.scale, totalVirtualHeight - CANVAS_HEIGHT / viewport.scale));

        console.log('🎯 初始视口设置:', {
            totalVirtualHeight,
            initialScrollY,
            scaledBounds,
            currentScrollY: viewport.scrollY
        });

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
            console.log('🎯 接收外部滚动位置:', { externalScrollY, currentScrollY: viewport.scrollY });
            setViewport(prev => {
                const scaledBounds = getScaledVirtualBounds(prev.scale);
                const newScrollY = Math.max(scaledBounds.minY, Math.min(scaledBounds.maxY - CANVAS_HEIGHT / prev.scale, externalScrollY));
                console.log('🔄 设置新的滚动位置:', { oldScrollY: prev.scrollY, newScrollY, externalScrollY });
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