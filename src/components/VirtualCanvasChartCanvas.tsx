import { useState, useRef, useEffect, useCallback } from "react";
import type { ChartNote } from "../notes/Charts";
import CanvasSpriteIcon, { CanvasNoteIcons, CanvasSlideLineIcons, BaseSpriteIcons } from './CanvasSpriteIcon';
import { handleNoteReplacement, handleSlideToSlideCombination } from '../utils/NoteReplacementRules';
import { slideEndpointManager } from '../utils/SlideEndpointManager';

interface VirtualCanvasChartCanvasProps {
    notes: ChartNote[];
    setNotes: (notes: ChartNote[]) => void;
    selectedTool: string;
    selectedNotes: number[];
    setSelectedNotes: (notes: number[]) => void;
    beatDisplay: number;
    onMousePositionChange: (position: { lane: number; beat: number } | null) => void;
    scale: number;
    isCombinationMode: boolean;
}

const LANES = 7;   // 七条轨道
const BEATS = 360;  // 显示 64 小节，(后续根据音频长度自动计算)
const BEAT_HEIGHT = 220; // 每个节拍的高度（基准，当 bpm=120 时为 BEAT_HEIGHT）
const LANE_WIDTH = 30; // 每个轨道的宽度

// 音符大小配置
const NOTE_ICON_SIZE = 36;
const DIRECTIONAL_ICON_SIZE = 45;
const SLIDE_ICON_SIZE = 36;

// 音符高度压缩配置
const NOTE_HEIGHT_SCALE = 0.6;
const DIRECTIONAL_HEIGHT_SCALE = 0.33;
const SLIDE_HEIGHT_SCALE = 0.6;

// 虚拟画布配置
const CANVAS_WIDTH = 1920;  // 固定画布宽度
const CANVAS_HEIGHT = 1080; // 固定画布高度
const MAX_SCALE = 3.0;      // 最大缩放比例
const MIN_SCALE = 0.1;      // 最小缩放比例
const VIEWPORT_PADDING = 200; // 视口外额外渲染的像素

// 视口状态接口
interface ViewportState {
    scrollX: number;
    scrollY: number;
    scale: number;
    virtualWidth: number;
    virtualHeight: number;
}

export default function VirtualCanvasChartCanvas({
    notes,
    setNotes,
    selectedTool,
    selectedNotes,
    setSelectedNotes,
    beatDisplay,
    onMousePositionChange,
    scale,
    isCombinationMode
}: VirtualCanvasChartCanvasProps) {
    // 视口状态
    const [viewport, setViewport] = useState<ViewportState>({
        scrollX: 0,
        scrollY: 0,
        scale: scale,
        virtualWidth: LANES * LANE_WIDTH + (1 + 4 + 1 + 1 + 1 + 1) * 2,
        virtualHeight: BEAT_HEIGHT * BEATS
    });

    const [dragging, setDragging] = useState(false);
    const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
    const [slideBuffer, setSlideBuffer] = useState<{ beat: number; lane: number; subBeat?: number }[]>([]);
    const [isSelecting, setIsSelecting] = useState(false);
    const [selectionBox, setSelectionBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const spriteIcon = useRef<CanvasSpriteIcon>(new CanvasSpriteIcon());
    const animationFrameRef = useRef<number | undefined>(undefined);

    // ---------------------------
    // BPM 事件处理（与原代码相同）
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
        return {
            minX: viewport.scrollX - padding,
            maxX: viewport.scrollX + CANVAS_WIDTH / viewport.scale + padding,
            minY: viewport.scrollY - padding,
            maxY: viewport.scrollY + CANVAS_HEIGHT / viewport.scale + padding
        };
    };

    // ---------------------------
    // 音符位置计算
    // ---------------------------
    const getNoteVirtualY = (beat: number, subBeat: number = 0) => {
        const preciseBeat = beat + (subBeat > 0 ? subBeat / beatDisplay : 0);
        const virtualY = beatToVirtualY(preciseBeat);
        const totalVirtualHeight = beatToVirtualY(BEATS);
        return totalVirtualHeight - virtualY;
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
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // 设置固定画布尺寸
        canvas.width = CANVAS_WIDTH;
        canvas.height = CANVAS_HEIGHT;

        // 清空画布
        ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // 绘制背景
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // 计算虚拟总尺寸
        const totalVirtualHeight = beatToVirtualY(BEATS);
        const borderTotalWidth = (1 + 4 + 1 + 1 + 1 + 1);
        const totalVirtualWidth = LANES * LANE_WIDTH + borderTotalWidth * 2;

        // 更新视口状态
        setViewport(prev => ({
            ...prev,
            virtualWidth: totalVirtualWidth,
            virtualHeight: totalVirtualHeight
        }));

        // 绘制轨道内背景 - 简化版本，直接绘制
        const trackBgX = borderTotalWidth * viewport.scale;
        const trackBgY = 0;
        const trackBgWidth = LANES * LANE_WIDTH * viewport.scale;
        const trackBgHeight = CANVAS_HEIGHT;
        ctx.fillStyle = '#00000A';
        ctx.fillRect(trackBgX, trackBgY, trackBgWidth, trackBgHeight);

        // 绘制基本网格 - 简化版本
        renderSimpleGrid(ctx);

        // 获取可见音符并渲染
        const visibleNotes = getVisibleNotes();
        renderNotes(ctx, visibleNotes);

        // 绘制选择框
        if (selectionBox) {
            renderSelectionBox(ctx);
        }

        // 绘制滑条缓冲区
        renderSlideBuffer(ctx);

    }, [notes, selectedNotes, viewport, selectionBox, slideBuffer, beatDisplay]);

    // 简化的网格渲染函数
    const renderSimpleGrid = useCallback((ctx: CanvasRenderingContext2D) => {
        const borderTotalWidth = (1 + 4 + 1 + 1 + 1 + 1);

        // 绘制垂直线（轨道线）
        for (let lane = 0; lane <= LANES; lane++) {
            const x = (borderTotalWidth + lane * LANE_WIDTH) * viewport.scale;

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

        // 绘制水平线（节拍线）- 简化版本
        for (let beat = 0; beat < 20; beat++) {
            const y = (beat * BEAT_HEIGHT * 120 / 120) * viewport.scale; // 简化计算

            if (y <= CANVAS_HEIGHT) {
                ctx.strokeStyle = '#555555';
                ctx.lineWidth = Math.max(2, 2 * viewport.scale);
                ctx.beginPath();
                ctx.moveTo(borderTotalWidth * viewport.scale, y);
                ctx.lineTo((borderTotalWidth + LANES * LANE_WIDTH) * viewport.scale, y);
                ctx.stroke();
            }
        }
    }, [viewport]);


    // 绘制音符
    const renderNotes = useCallback((ctx: CanvasRenderingContext2D, visibleNotes: { note: ChartNote; index: number }[]) => {
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
                const canvasStart = virtualToCanvas(0, virtualY);
                const canvasEnd = virtualToCanvas(LANES * LANE_WIDTH + (1 + 4 + 1 + 1 + 1 + 1) * 2, virtualY);

                ctx.strokeStyle = 'red';
                ctx.lineWidth = 3;
                ctx.setLineDash([5, 5]);
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

    // ---------------------------
    // 事件处理
    // ---------------------------
    const handleWheel = useCallback((e: WheelEvent) => {
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
    }, [viewport]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setDragging(true);
        setDragStart({ x: e.clientX, y: e.clientY });
    }, []);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const virtualMouse = canvasToVirtual(mouseX, mouseY);

        // 计算轨道和节拍
        const borderTotalWidth = (1 + 4 + 1 + 1 + 1 + 1);
        const adjustedX = virtualMouse.x - borderTotalWidth;
        const lane = Math.floor(adjustedX / LANE_WIDTH);

        const beat = virtualYToBeat(viewport.scrollY + CANVAS_HEIGHT / viewport.scale - virtualMouse.y);

        if (lane >= 0 && lane < LANES && beat >= 0) {
            const preciseBeat = Math.round(beat * 10000000000000000) / 10000000000000000;
            onMousePositionChange({ lane, beat: preciseBeat });
        } else {
            onMousePositionChange(null);
        }

        // 处理拖拽
        if (dragging && dragStart) {
            const deltaX = e.clientX - dragStart.x;
            const deltaY = e.clientY - dragStart.y;

            setViewport(prev => ({
                ...prev,
                scrollX: prev.scrollX - deltaX / prev.scale,
                scrollY: prev.scrollY - deltaY / prev.scale
            }));

            setDragStart({ x: e.clientX, y: e.clientY });
        }
    }, [dragging, dragStart, viewport, onMousePositionChange]);

    const handleMouseUp = useCallback(() => {
        setDragging(false);
        setDragStart(null);
    }, []);

    // ---------------------------
    // 点击事件处理
    // ---------------------------
    const handleClick = (beat: number, lane: number, subBeat: number = 0) => {
        if (selectedTool === "mouse") {
            // 鼠标状态下点击音符进行选择
            const noteIndex = notes.findIndex(note => {
                if (note.type === "Single" || note.type === "LDirectional" || note.type === "RDirectional") {
                    return note.beat === beat && note.lane === lane && note.subBeat === subBeat;
                } else if (note.type === "Slide" || note.type === "Long") {
                    // 检查滑条/长按音符的连接点
                    return note.connections.some(conn =>
                        conn.beat === beat && conn.lane === lane && conn.subBeat === subBeat
                    );
                }
                return false;
            });

            if (noteIndex !== -1) {
                if (isCombinationMode) {
                    // 组合模式下，如果音符已选中，则取消选中；否则选中
                    if (selectedNotes.includes(noteIndex)) {
                        setSelectedNotes(selectedNotes.filter(i => i !== noteIndex));
                    } else {
                        // 否则选中该音符
                        setSelectedNotes([...selectedNotes, noteIndex]);
                    }
                } else {
                    // 非组合模式下，直接选中该音符
                    setSelectedNotes([noteIndex]);
                }
            } else if (!isCombinationMode) {
                // 点击空白区域时取消选择
                setSelectedNotes([]);
            }
            return;
        }

        // 直接使用传入的精确beat值，不再重复计算
        const preciseBeat = beat;
        // subBeat应该为0，因为beat已经包含了精确位置信息
        const preciseSubBeat = 0;

        if (selectedTool === "single") {
            const result = handleNoteReplacement(notes, preciseBeat, lane, preciseSubBeat, "Single");
            if (result.shouldReplace) {
                setNotes(result.newNotes);
            }
        } else if (selectedTool === "flick") {
            const result = handleNoteReplacement(notes, preciseBeat, lane, preciseSubBeat, "flick");
            if (result.shouldReplace) {
                setNotes(result.newNotes);
            }
        } else if (selectedTool === "skill") {
            const result = handleNoteReplacement(notes, preciseBeat, lane, preciseSubBeat, "skill");
            if (result.shouldReplace) {
                setNotes(result.newNotes);
            }
        } else if (selectedTool === "ldirectional") {
            const result = handleNoteReplacement(notes, preciseBeat, lane, preciseSubBeat, "ldirectional");
            if (result.shouldReplace) {
                setNotes(result.newNotes);
            }
        } else if (selectedTool === "rdirectional") {
            const result = handleNoteReplacement(notes, preciseBeat, lane, preciseSubBeat, "rdirectional");
            if (result.shouldReplace) {
                setNotes(result.newNotes);
            }
        } else if (selectedTool === "bpm") {
            const bpm = parseInt(prompt("请输入 BPM 数值") || "0", 10);
            if (!isNaN(bpm) && bpm > 0) {
                // 限制beat精度为16位小数
                const finalBeat = Math.round(preciseBeat * 10000000000000000) / 10000000000000000;

                // 查找几乎相等的 BPM（考虑浮点） -> 检查是否已存在相同beat的BPM，如果存在则覆盖
                const existingBpmIndex = notes.findIndex(note =>
                    note.type === "BPM" && Math.abs(note.beat - finalBeat) < 0.0000000000000001
                );
                if (existingBpmIndex !== -1) {
                    // 覆盖现有BPM
                    const newNotes = [...notes];
                    newNotes[existingBpmIndex] = { beat: finalBeat, type: "BPM", bpm };
                    setNotes(newNotes);
                } else {
                    // 添加新BPM
                    setNotes([...notes, { beat: finalBeat, type: "BPM", bpm }]);
                }
            }
        } else if (selectedTool === "slide" || selectedTool === "long") {
            const newBuffer = [...slideBuffer, { beat: preciseBeat, lane, subBeat: preciseSubBeat }];
            if (newBuffer.length === 2) {
                // 检查滑条是否横向放置
                const [p1, p2] = newBuffer;
                if (p1.beat === p2.beat && p1.subBeat === p2.subBeat) {
                    alert("滑条音符不允许横向放置！");
                    setSlideBuffer([]);
                    return;
                }

                // 此步骤非常关键: 不管用户放置的slide是正向还是反向, 都能找到正确的起点和终点
                // sort newBuffer by beat (make sure the first beat is the smaller one)
                newBuffer.sort((a, b) => a.beat - b.beat);

                // 检查是否可以与现有滑条组合
                const combinationResult = handleSlideToSlideCombination(notes, newBuffer);
                if (combinationResult.shouldCombine) {
                    setNotes(combinationResult.newNotes);
                } else {
                    // 创建新的滑条
                    const newNotes: ChartNote[] = [...notes, { type: selectedTool === "slide" ? "Slide" : "Long", connections: newBuffer }];
                    setNotes(newNotes);
                    slideEndpointManager.updateEndpoints(newNotes);
                }
                setSlideBuffer([]);
            } else {
                setSlideBuffer(newBuffer);
            }
        }
    };

    // 处理Canvas点击事件
    const handleCanvasClick = (e: React.MouseEvent) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const virtualMouse = canvasToVirtual(x, y);

        // 计算点击位置对应的轨道和节拍
        const borderTotalWidth = (1 + 4 + 1 + 1 + 1 + 1);
        const adjustedX = virtualMouse.x - borderTotalWidth;
        const lane = Math.floor(adjustedX / LANE_WIDTH);

        // 反向计算：从点击位置计算 beat
        const beat = virtualYToBeat(viewport.scrollY + CANVAS_HEIGHT / viewport.scale - virtualMouse.y);

        if (lane >= 0 && lane < LANES && beat >= 0) {
            // 保持行为兼容：向 nearest subBeat 对齐
            const subBeatPosition = beat * beatDisplay;
            const nearestSubBeat = Math.round(subBeatPosition);
            const preciseBeat = nearestSubBeat / beatDisplay;
            handleClick(preciseBeat, lane);
        }
    };

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

    // 初始视口设置
    useEffect(() => {
        const totalVirtualHeight = beatToVirtualY(BEATS);
        const beatsToShow = 4;
        const totalBeatHeight = beatToVirtualY(beatsToShow);
        const initialScrollY = totalVirtualHeight - totalBeatHeight;

        setViewport(prev => ({
            ...prev,
            scrollY: Math.max(0, initialScrollY),
            virtualHeight: totalVirtualHeight,
            virtualWidth: LANES * LANE_WIDTH + (1 + 4 + 1 + 1 + 1 + 1) * 2
        }));
    }, []);

    // 同步外部scale变化
    useEffect(() => {
        setViewport(prev => ({
            ...prev,
            scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale))
        }));
    }, [scale]);

    // 收集BPM标记
    const bpmMarks = notes.filter(note => note.type === "BPM");

    return (
        <div
            ref={containerRef}
            className="w-full h-full overflow-hidden"
            style={{ backgroundColor: '#000000' }}
        >
            <div className="p-4" style={{ backgroundColor: '#000000' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                    {/* 左侧 BPM 数字列 */}
                    <div
                        style={{
                            width: 80,
                            flexShrink: 0,
                            position: 'relative',
                            pointerEvents: 'none',
                            height: CANVAS_HEIGHT,
                            backgroundColor: '#000000'
                        }}
                    >
                        <div style={{ position: 'relative', height: CANVAS_HEIGHT }}>
                            {bpmMarks.map((note, idx) => {
                                const virtualY = getNoteVirtualY(note.beat);
                                const canvasPos = virtualToCanvas(0, virtualY);
                                const y = Math.max(0, Math.min(CANVAS_HEIGHT, canvasPos.y));

                                return (
                                    <div
                                        key={`bpm-left-${idx}`}
                                        style={{
                                            position: 'absolute',
                                            left: 10,
                                            top: `${y}px`,
                                            transform: 'translateY(-50%)',
                                            fontWeight: 700,
                                            fontSize: 12,
                                            color: '#ff6666',
                                            whiteSpace: 'nowrap',
                                            textShadow: '1px 1px 2px rgba(0,0,0,0.8)'
                                        }}
                                    >
                                        BPM {(note as any).bpm}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* 画布区域 */}
                    <div style={{ position: 'relative', backgroundColor: '#000000' }}>
                        <canvas
                            ref={canvasRef}
                            width={CANVAS_WIDTH}
                            height={CANVAS_HEIGHT}
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onClick={handleCanvasClick}
                            style={{
                                backgroundColor: '#000000',
                                cursor: dragging ? "grabbing" : "default",
                                display: 'block',
                                userSelect: 'none',
                                border: '1px solid #333'
                            }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
