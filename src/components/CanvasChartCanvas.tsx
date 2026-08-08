import { useState, useRef, useEffect, useCallback } from "react";
import type { ChartNote } from "../notes/Charts";
import CanvasSpriteIcon, { CanvasNoteIcons, CanvasSlideLineIcons, BaseSpriteIcons } from './CanvasSpriteIcon';
import { handleNoteReplacement, handleSlideToSlideCombination } from '../utils/NoteReplacementRules';
import { slideEndpointManager } from '../utils/SlideEndpointManager';

interface CanvasChartCanvasProps {
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

// 音符大小配置 - 可以在这里统一调整所有音符的大小
const NOTE_ICON_SIZE = 36; // 单键音符、技能键的大小
const DIRECTIONAL_ICON_SIZE = 45; // 方向滑键音符的大小
const SLIDE_ICON_SIZE = 36; // 滑条连接点的大小

// 音符高度压缩配置 - 可以调整音符的高度压缩比例
const NOTE_HEIGHT_SCALE = 0.6; // 单键音符、技能键的高度压缩比例，0.5表示压缩到50%的高度
const DIRECTIONAL_HEIGHT_SCALE = 0.33; // 方向滑键的高度压缩比例，0.33表示压缩到33%的高度
const SLIDE_HEIGHT_SCALE = 0.6; // 滑条连接点的高度压缩比例

export default function CanvasChartCanvas({
    notes,
    setNotes,
    selectedTool,
    selectedNotes,
    setSelectedNotes,
    beatDisplay,
    onMousePositionChange,
    scale,
    isCombinationMode
}: CanvasChartCanvasProps) {
    const [offsetY, setOffsetY] = useState(0);
    const [dragging, setDragging] = useState(false);
    const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
    const [slideBuffer, setSlideBuffer] = useState<{ beat: number; lane: number; subBeat?: number }[]>([]);
    const [isSelecting, setIsSelecting] = useState(false);
    const [selectionBox, setSelectionBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const spriteIcon = useRef<CanvasSpriteIcon>(new CanvasSpriteIcon());
    const animationFrameRef = useRef<number | undefined>(undefined);

    // ---------------------------
    // Helper: 获取按时间升序的 BPM 事件数组
    // 每个元素: { beat: number, bpm: number }
    // 保证至少包含 beat=0 的默认事件（如果用户没有设置）
    // ---------------------------
    const getSortedBpmEvents = () => {
        const bpmEvents: { beat: number; bpm: number }[] = [];
        for (const note of notes) {
            if (note.type === "BPM") {
                // Type assertion: note has BPM and beat fields
                bpmEvents.push({ beat: note.beat, bpm: (note as any).bpm });
            }
        }
        // sort ascending by beat
        bpmEvents.sort((a, b) => a.beat - b.beat);

        // 如果第一个事件不是在 beat 0，则插入默认初始 BPM（120）
        if (bpmEvents.length === 0 || bpmEvents[0].beat > 0) {
            bpmEvents.unshift({ beat: 0, bpm: 120 });
        } else {
            // 如果存在 beat 0 的事件，确保它是第一个（sort 已确保），否则也保留
        }

        return bpmEvents;
    };

    // ---------------------------
    // 将任意 beat（可以是小数）转换为从 beat 0 到该 beat 的累计像素高度（向上累加）
    // 依据每个 BPM 段：每一段的每个 beat 的像素高度 = BEAT_HEIGHT * (120 / bpm)
    // 最后乘以 scale。
    // ---------------------------
    const beatToOffset = (beat: number) => {
        const bpmEvents = getSortedBpmEvents();
        let offset = 0;
        for (let i = 0; i < bpmEvents.length; i++) {
            const cur = bpmEvents[i];
            const next = bpmEvents[i + 1];
            const segmentStart = cur.beat;
            const segmentEnd = next ? next.beat : Infinity;

            if (beat <= segmentStart) {
                // 目标beat位于此事件之前，结束
                break;
            }

            const segFrom = segmentStart;
            const segTo = Math.min(segmentEnd, beat);
            if (segTo > segFrom) {
                const lengthInBeats = segTo - segFrom;
                const perBeatHeight = (BEAT_HEIGHT * 120) / cur.bpm;
                offset += lengthInBeats * perBeatHeight * scale;
            }

            if (segmentEnd >= beat) {
                // 已覆盖到目标 beat，结束
                break;
            }
        }
        return offset;
    };

    // ---------------------------
    // 将从0开始的累计偏移（像素）反解为精确 beat（用于鼠标拾取）
    // 这里 totalHeight 是 beatToOffset(BEATS)
    // offset 为从 0 到目标 beat 的像素长度
    // ---------------------------
    const offsetToBeat = (offset: number) => {
        const bpmEvents = getSortedBpmEvents();
        let remaining = offset;
        for (let i = 0; i < bpmEvents.length; i++) {
            const cur = bpmEvents[i];
            const next = bpmEvents[i + 1];
            const segStart = cur.beat;
            const segEnd = next ? next.beat : Infinity;
            const segLenBeats = segEnd - segStart;
            const perBeatHeight = (BEAT_HEIGHT * 120) / cur.bpm * scale;

            // if segEnd is Infinity, treat large number but we will hit remaining earlier
            if (!isFinite(segEnd)) {
                // remaining is within this infinite last segment
                const beatOffset = remaining / perBeatHeight;
                return segStart + beatOffset;
            }

            const segHeight = segLenBeats * perBeatHeight;
            if (remaining <= segHeight) {
                // inside this segment
                const beatOffset = remaining / perBeatHeight;
                return segStart + beatOffset;
            } else {
                remaining -= segHeight;
            }
        }

        // 如果超出所有段，返回 BEATS（或更大），但限制为 BEATS
        return BEATS;
    };

    // ---------------------------
    // 计算音符的Y位置 - 自下往上布局
    // 使用 beatToOffset 获得从 0 到该 beat 的累计高度，再反转到 Canvas 坐标
    // ---------------------------
    const getNoteY = (beat: number, subBeat: number = 0) => {
        // 如果有 subBeat（0..beatDisplay-1），我们精确计算 offset 到 beat + subBeat/beatDisplay
        const preciseBeat = beat + (subBeat > 0 ? subBeat / beatDisplay : 0);
        const offsetFromZero = beatToOffset(preciseBeat);

        const totalOffset = beatToOffset(BEATS); // 总高度
        const finalY = totalOffset - offsetFromZero;

        // 移除二次缩放，因为 beatToOffset 已经处理了缩放
        return finalY;
    };

    // 重要：共享的总高度与宽度（用于左侧定位与Canvas高度一致）
    const totalHeight = beatToOffset(BEATS);

    // 计算边框总宽度：[1, 4, 1, 1, 1, 1] = 9px (未缩放)
    const borderTotalWidth = (1 + 4 + 1 + 1 + 1 + 1) * scale;

    // Canvas宽度保持原来的计算方式
    const canvasWidth = LANES * LANE_WIDTH * scale + borderTotalWidth * 2;

    // 限制Canvas高度，避免过大导致显示问题
    const maxHeight = 2000; // 最大高度限制
    const limitedHeight = Math.min(totalHeight, maxHeight);



    // 辅助函数：计算音符的正确X坐标（包含边框偏移）
    const getNoteX = (lane: number) => {
        return borderTotalWidth + lane * LANE_WIDTH * scale + LANE_WIDTH * scale / 2;
    };

    // 绘制网格
    const renderGrid = useCallback((ctx: CanvasRenderingContext2D) => {
        // 绘制水平线（节拍线）- 自下往上绘制
        for (let beat = 0; beat < BEATS; beat++) {
            const y = totalHeight - beatToOffset(beat); // beat 的顶部

            ctx.strokeStyle = '#555555';
            ctx.lineWidth = Math.max(2, 2 * scale);
            ctx.beginPath();
            ctx.moveTo(borderTotalWidth, y);
            ctx.lineTo(borderTotalWidth + LANES * LANE_WIDTH * scale, y);
            ctx.stroke();

            // 绘制子节拍线：对于每个 subBeat 位置直接计算对应的 absolute offset
            for (let subBeat = 1; subBeat < beatDisplay; subBeat++) {
                const preciseBeat = beat + subBeat / beatDisplay;
                const subY = totalHeight - beatToOffset(preciseBeat);

                ctx.strokeStyle = '#666666';
                ctx.lineWidth = Math.max(0.5, 1 * scale);
                ctx.setLineDash([4 * scale, 6 * scale]);
                ctx.globalAlpha = 0.8;
                ctx.beginPath();
                ctx.moveTo(borderTotalWidth, subY);
                ctx.lineTo(borderTotalWidth + LANES * LANE_WIDTH * scale, subY);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.globalAlpha = 1.0;
            }
        }

        // 绘制垂直线（轨道线）
        for (let lane = 0; lane <= LANES; lane++) {
            const x = lane * LANE_WIDTH * scale + borderTotalWidth; // 向右偏移边框宽度

            // 外侧轨道（第0条和第7条线）使用特殊的渐变边框
            if (lane === 0 || lane === LANES) {
                // 创建多层边框效果：#004C4C (1px), #004D4D (5px), #009898 (1px), #00A6A6 (1px), #008186 (1px), #003D44 (1px)
                const borderColors = ['#004C4C', '#004D4D', '#009898', '#00A6A6', '#008186', '#003D44'];
                const borderWidths = [1, 4, 1, 1, 1, 1];
                let currentOffset = 0;

                // 对于右侧轨道（lane === LANES），需要向左绘制边框
                const isRightBorder = lane === LANES;

                borderColors.forEach((color, index) => {
                    const width = borderWidths[index] * scale;

                    // 向外绘制边框：
                    // 左侧轨道：向左扩展（负方向）
                    // 右侧轨道：向右扩展（正方向）
                    const rectX = isRightBorder ? (x + currentOffset) : (x - currentOffset - width);

                    ctx.fillStyle = color;
                    ctx.fillRect(rectX, 0, width, totalHeight);
                    currentOffset += width;
                });
            } else {
                // 内部轨道线使用较暗的颜色
                ctx.strokeStyle = '#333333';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, totalHeight);
                ctx.stroke();
            }
        }
    }, [totalHeight, beatToOffset, beatDisplay, scale, borderTotalWidth]);

    // 绘制音符
    const renderNotes = useCallback((ctx: CanvasRenderingContext2D) => {
        // 第一层：普通音符和方向键主体
        notes.forEach((note, idx) => {
            const isSelected = selectedNotes.includes(idx);

            if (note.type === "Single") {
                const subBeat = note.subBeat || 0;
                const y = getNoteY(note.beat, subBeat);
                const x = getNoteX(note.lane);
                const iconSize = NOTE_ICON_SIZE * scale;
                const iconHeight = iconSize * NOTE_HEIGHT_SCALE;

                // 根据音符类型选择对应的sprite图标
                let iconConfig = BaseSpriteIcons.tap;
                if (note.flick) {
                    iconConfig = BaseSpriteIcons.flick;
                } else if (note.skill) {
                    iconConfig = BaseSpriteIcons.skill;
                }


                // 渲染主图标
                spriteIcon.current.render(ctx, {
                    ...iconConfig,
                    canvasX: x,
                    canvasY: y,
                    canvasSize: iconSize,
                    canvasWidth: iconSize,
                    canvasHeight: iconHeight,
                    scale,
                    renderLayer: 'main'
                });

                // 选中状态 - 使用黄色边框
                if (isSelected) {
                    ctx.strokeStyle = 'yellow';
                    ctx.lineWidth = 3 * scale;
                    ctx.globalAlpha = 0.8;
                    ctx.beginPath();
                    ctx.arc(x, y, iconSize / 2 + 4, 0, 2 * Math.PI);
                    ctx.stroke();
                    ctx.globalAlpha = 1.0;
                }
            } else if (note.type === "LDirectional") {
                const subBeat = note.subBeat || 0;
                const y = getNoteY(note.beat, subBeat);
                const x = getNoteX(note.lane);
                const iconSize = DIRECTIONAL_ICON_SIZE * scale;
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
                    canvasX: x,
                    canvasY: y,
                    canvasSize: iconSize,
                    canvasWidth: iconSize,
                    canvasHeight: iconHeight,
                    scale,
                    renderLayer: 'main'
                });

                // 选中状态
                if (isSelected) {
                    ctx.strokeStyle = 'yellow';
                    ctx.lineWidth = 3 * scale;
                    ctx.globalAlpha = 0.8;
                    ctx.beginPath();
                    ctx.arc(x, y, iconSize / 2 + 4, 0, 2 * Math.PI);
                    ctx.stroke();
                    ctx.globalAlpha = 1.0;
                }
            } else if (note.type === "RDirectional") {
                const subBeat = note.subBeat || 0;
                const y = getNoteY(note.beat, subBeat);
                const x = getNoteX(note.lane);
                const iconSize = DIRECTIONAL_ICON_SIZE * scale;
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
                    canvasX: x,
                    canvasY: y,
                    canvasSize: iconSize,
                    canvasWidth: iconSize,
                    canvasHeight: iconHeight,
                    scale,
                    renderLayer: 'main'
                });

                // 选中状态
                if (isSelected) {
                    ctx.strokeStyle = 'yellow';
                    ctx.lineWidth = 3 * scale;
                    ctx.globalAlpha = 0.8;
                    ctx.beginPath();
                    ctx.arc(x, y, iconSize / 2 + 4, 0, 2 * Math.PI);
                    ctx.stroke();
                    ctx.globalAlpha = 1.0;
                }
            } else if (note.type === "BPM") {
                const y = getNoteY(note.beat);
                ctx.strokeStyle = 'red';
                ctx.lineWidth = 3;
                ctx.setLineDash([5, 5]);
                ctx.beginPath();
                ctx.moveTo(borderTotalWidth, y);
                ctx.lineTo(borderTotalWidth + LANES * LANE_WIDTH * scale, y);
                ctx.stroke();
                ctx.setLineDash([]);
            } else if (note.type === "Slide" || note.type === "Long") {
                const connections = note.connections;
                if (connections.length < 2) return;

                const iconSize = SLIDE_ICON_SIZE * scale;
                const iconHeight = iconSize * SLIDE_HEIGHT_SCALE;

                // 渲染连接线
                for (let i = 0; i < connections.length - 1; i++) {
                    const conn1 = connections[i];
                    const conn2 = connections[i + 1];
                    const subBeat1 = conn1.subBeat || 0;
                    const subBeat2 = conn2.subBeat || 0;
                    const y1 = getNoteY(conn1.beat, subBeat1);
                    const y2 = getNoteY(conn2.beat, subBeat2);
                    const x1 = getNoteX(conn1.lane);
                    const x2 = getNoteX(conn2.lane);

                    // 计算四边形的四个顶点
                    const halfLaneWidth = (LANE_WIDTH * scale) / 2;
                    const left1 = x1 - halfLaneWidth;
                    const right1 = x1 + halfLaneWidth;
                    const left2 = x2 - halfLaneWidth;
                    const right2 = x2 + halfLaneWidth;

                    const quadPoints = [
                        [left1, y1],   // 左上
                        [right1, y1],  // 右上
                        [right2, y2],  // 右下
                        [left2, y2]    // 左下
                    ];

                    const minX = Math.min(left1, right1, left2, right2);
                    const maxX = Math.max(left1, right1, left2, right2);
                    const minY = Math.min(y1, y2);
                    const maxY = Math.max(y1, y2);
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
                        scale
                    });

                    ctx.restore();
                }

                // 渲染连接点
                connections.forEach((conn, i) => {
                    const subBeat = conn.subBeat || 0;
                    const y = getNoteY(conn.beat, subBeat);
                    const x = getNoteX(conn.lane);
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
                        canvasX: x,
                        canvasY: y,
                        canvasSize: iconSize,
                        canvasWidth: iconSize,
                        canvasHeight: iconHeight,
                        scale
                    });
                });

                // 选中状态
                if (isSelected) {
                    const minX = Math.min(...connections.map(c => c.lane * LANE_WIDTH * scale)) - 10 * scale;
                    const minY = Math.min(...connections.map(c => getNoteY(c.beat, c.subBeat || 0))) - 10 * scale;
                    const maxX = Math.max(...connections.map(c => c.lane * LANE_WIDTH * scale)) + 10 * scale;
                    const maxY = Math.max(...connections.map(c => getNoteY(c.beat, c.subBeat || 0))) + 10 * scale;

                    ctx.strokeStyle = 'yellow';
                    ctx.lineWidth = 2 * scale;
                    ctx.setLineDash([5, 5]);
                    ctx.globalAlpha = 0.7;
                    ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
                    ctx.setLineDash([]);
                    ctx.globalAlpha = 1.0;
                }
            }
        });

        // 第二层：装饰器层 - 确保装饰器在所有音符之上
        notes.forEach((note) => {
            if (note.type === "LDirectional" || note.type === "RDirectional") {
                const subBeat = note.subBeat || 0;
                const y = getNoteY(note.beat, subBeat);
                const x = getNoteX(note.lane);
                const iconSize = DIRECTIONAL_ICON_SIZE * scale;
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
                    canvasX: x,
                    canvasY: y,
                    canvasSize: iconSize,
                    canvasWidth: iconSize,
                    canvasHeight: iconHeight,
                    scale,
                    renderLayer: 'decorators'
                });
            } else if (note.type === "Single" && note.flick) {
                // 滑键音符的装饰器层渲染
                const subBeat = note.subBeat || 0;
                const y = getNoteY(note.beat, subBeat);
                const x = getNoteX(note.lane);
                const iconSize = NOTE_ICON_SIZE * scale;
                const iconHeight = iconSize * NOTE_HEIGHT_SCALE;

                spriteIcon.current.render(ctx, {
                    ...CanvasNoteIcons.flick,
                    canvasX: x,
                    canvasY: y,
                    canvasSize: iconSize,
                    canvasWidth: iconSize,
                    canvasHeight: iconHeight,
                    scale,
                    renderLayer: 'decorators'
                });
            }
        });
    }, [notes, selectedNotes, getNoteY, getNoteX, scale, borderTotalWidth, spriteIcon]);

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
            const y = getNoteY(point.beat, subBeat);
            const x = getNoteX(point.lane);

            ctx.fillStyle = 'orange';
            ctx.globalAlpha = 0.7;
            ctx.beginPath();
            ctx.arc(x, y, 8 * scale, 0, 2 * Math.PI);
            ctx.fill();
            ctx.globalAlpha = 1.0;
        });
    }, [slideBuffer, getNoteY, getNoteX, scale]);

    // ---------------------------
    // Canvas渲染函数
    // ---------------------------
    const renderCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            console.log('Canvas ref is null');
            return;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            console.log('Canvas context is null');
            return;
        }

        // 设置Canvas尺寸
        canvas.width = canvasWidth;
        canvas.height = totalHeight;


        // 确保Canvas有最小尺寸
        if (canvasWidth <= 0 || totalHeight <= 0) {
            console.error('Canvas尺寸无效，使用默认尺寸');
            canvas.width = 400;
            canvas.height = 600;
        }

        // 清空画布
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 绘制背景
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 绘制轨道内背景
        ctx.fillStyle = '#00000A';
        ctx.fillRect(borderTotalWidth, 0, LANES * LANE_WIDTH * scale, totalHeight);

        // 绘制网格
        renderGrid(ctx);

        // 绘制音符
        renderNotes(ctx);

        // 绘制选择框
        if (selectionBox) {
            renderSelectionBox(ctx);
        }

        // 绘制滑条缓冲区
        renderSlideBuffer(ctx);

    }, [notes, selectedNotes, scale, limitedHeight, canvasWidth, borderTotalWidth, selectionBox, slideBuffer, beatDisplay, renderGrid, renderNotes, renderSelectionBox, renderSlideBuffer]);

    // 初始滚动位置（显示 4.5 个 beat）
    useEffect(() => {
        const scrollToInitialPosition = () => {
            let scrollContainer = canvasRef.current?.parentElement;

            while (scrollContainer && scrollContainer !== document.body) {
                const computedStyle = window.getComputedStyle(scrollContainer);
                if (computedStyle.overflow === 'auto' || computedStyle.overflowY === 'auto') {
                    break;
                }
                scrollContainer = scrollContainer.parentElement;
            }
            if (scrollContainer) {
                const beatsToShow = 4; // 初始页面显示4个beat
                // 计算 0..beatsToShow 的累计高度
                const totalBeatHeight = beatToOffset(beatsToShow);

                // 总高度使用 BEATS
                const totalHeight = beatToOffset(BEATS);
                const scrollPosition = totalHeight - totalBeatHeight;
                scrollContainer.scrollTop = Math.max(0, scrollPosition);
            }
        };

        // 2次延迟尝试，确保DOM完全渲染
        const rafId = requestAnimationFrame(() => { scrollToInitialPosition(); });
        const timeoutId = setTimeout(scrollToInitialPosition, 100);
        const timeoutId2 = setTimeout(scrollToInitialPosition, 500);
        return () => {
            cancelAnimationFrame(rafId);
            clearTimeout(timeoutId);
            clearTimeout(timeoutId2);
        };
        // 只在组件首次挂载时执行初始滚动，不监听 notes 变化
    }, []);

    // 监听变化并重新渲染
    useEffect(() => {
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
        }
        animationFrameRef.current = requestAnimationFrame(renderCanvas);
    }, [renderCanvas]);

    // 清理动画帧
    useEffect(() => {
        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, []);

    // 强制在组件挂载时渲染一次
    useEffect(() => {
        renderCanvas();
    }, [renderCanvas]);

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

    const handleMouseDown = (e: React.MouseEvent) => {
        // 阻止默认的拖拽和选择行为
        e.preventDefault();

        if (selectedTool === "mouse" && e.ctrlKey) {
            // Ctrl+鼠标拖拽进行区域选择
            setIsSelecting(true);
            const rect = canvasRef.current?.getBoundingClientRect();
            if (rect) {
                setSelectionBox({
                    x1: e.clientX - rect.left,
                    y1: e.clientY - rect.top,
                    x2: e.clientX - rect.left,
                    y2: e.clientY - rect.top
                });
            }
        }
        // 其他情况下不允许拖拽画布
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) {
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // 计算鼠标位置对应的轨道和节拍（考虑边框偏移）
            const adjustedX = x - borderTotalWidth;
            const lane = Math.floor(adjustedX / (LANE_WIDTH * scale));

            // 反向计算：从鼠标位置计算 beat
            const relativeY = y - offsetY;
            const totalHeight = beatToOffset(BEATS);
            const reversedYFromTop = totalHeight - relativeY; // 这是 offsetFromZero（像素）
            let beat = 0;

            if (reversedYFromTop <= 0) {
                beat = 0;
            } else if (reversedYFromTop >= totalHeight) {
                beat = BEATS;
            } else {
                beat = offsetToBeat(reversedYFromTop);
            }

            if (lane >= 0 && lane < LANES && beat >= 0) {
                // 限制小数位数为16位
                const preciseBeat = Math.round(beat * 10000000000000000) / 10000000000000000;
                onMousePositionChange({ lane, beat: preciseBeat });
            } else {
                onMousePositionChange(null);
            }
        }

        if (isSelecting && selectionBox) {
            const rect = canvasRef.current?.getBoundingClientRect();
            if (rect) {
                setSelectionBox({
                    ...selectionBox,
                    x2: e.clientX - rect.left,
                    y2: e.clientY - rect.top
                });
            }
        } else if (dragging && dragStart && selectedTool === "mouse" && e.shiftKey) {
            // 只有在Shift+鼠标拖拽时才移动画布
            setOffsetY(offsetY + (e.clientY - dragStart.y));
            setDragStart({ x: e.clientX, y: e.clientY });
        }
    };

    const handleMouseUp = () => {
        if (isSelecting && selectionBox) {
            // 完成区域选择
            const minX = Math.min(selectionBox.x1, selectionBox.x2);
            const maxX = Math.max(selectionBox.x1, selectionBox.x2);
            const minY = Math.min(selectionBox.y1, selectionBox.y2);
            const maxY = Math.max(selectionBox.y1, selectionBox.y2);

            const selectedIndices: number[] = [];
            notes.forEach((note, index) => {
                if (note.type === "Single" || note.type === "LDirectional" || note.type === "RDirectional") {
                    const noteX = getNoteX(note.lane); // 音符中心X位置
                    const noteY = getNoteY(note.beat, note.subBeat || 0); // 音符中心Y位置

                    if (noteX >= minX && noteX <= maxX && noteY >= minY && noteY <= maxY) {
                        selectedIndices.push(index);
                    }
                } else if (note.type === "Slide" || note.type === "Long") {
                    // 检查滑条/长按音符的连接点是否在选择区域内
                    const hasVisibleConnection = note.connections.some(conn => {
                        if (conn.hidden) return false; // 跳过隐藏连接点
                        const x = getNoteX(conn.lane);
                        const y = getNoteY(conn.beat, conn.subBeat || 0);
                        return x >= minX && x <= maxX && y >= minY && y <= maxY;
                    });

                    if (hasVisibleConnection) {
                        selectedIndices.push(index);
                    }
                }
            });

            setSelectedNotes(selectedIndices);
            setIsSelecting(false);
            setSelectionBox(null);
        } else {
            setDragging(false);
        }
    };

    // 处理Canvas点击事件
    const handleCanvasClick = (e: React.MouseEvent) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // 计算点击位置对应的轨道和节拍
        const adjustedX = x - borderTotalWidth;
        const lane = Math.floor(adjustedX / (LANE_WIDTH * scale));

        // 反向计算：从点击位置计算 beat（与ChartCanvas.tsx保持一致）
        const relativeY = y - offsetY;
        const totalHeightInner = totalHeight;
        const reversedY = totalHeightInner - relativeY;

        // 使用 offsetToBeat 直接反向计算
        let beat = 0;
        if (reversedY <= 0) {
            beat = 0;
        } else if (reversedY >= totalHeightInner) {
            beat = BEATS;
        } else {
            beat = offsetToBeat(reversedY);
        }

        if (lane >= 0 && lane < LANES && beat >= 0) {
            // 保持行为兼容：向 nearest subBeat 对齐
            const subBeatPosition = beat * beatDisplay;
            const nearestSubBeat = Math.round(subBeatPosition);
            const preciseBeat = nearestSubBeat / beatDisplay;
            handleClick(preciseBeat, lane);
        }
    };

    // 收集所有BPM标记用于在画布外部显示
    const bpmMarks = notes.filter(note => note.type === "BPM");

    return (
        <div className="w-full h-full overflow-auto" style={{ backgroundColor: '#000000' }}>
            {/* 用一个统一的内边距容器 */}
            <div className="p-4" style={{ backgroundColor: '#000000' }}>
                <div
                    // 这个 wrapper 包含左侧 BPM 列和 Canvas 画布，translateY 只应用到这里
                    style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        transform: `translateY(${offsetY}px)`,
                        minHeight: totalHeight
                    }}
                >
                    {/* 左侧 BPM 数字列（在画布外部） */}
                    <div
                        style={{
                            width: 80,
                            flexShrink: 0,
                            position: 'relative',
                            // pointerEvents: 'none' 确保不会拦截鼠标事件（比如放置音符）
                            pointerEvents: 'none',
                            height: totalHeight,
                            backgroundColor: '#000000' // BMP列背景也设为黑色
                        }}
                    >
                        {/* 内层 relative 容器用于让每个 BPM 数字用 absolute top: ypx 定位 */}
                        <div style={{ position: 'relative', height: totalHeight }}>
                            {bpmMarks.map((note, idx) => {
                                const rawY = getNoteY(note.beat);
                                // 保证在容器范围内（防止越界）
                                const y = Math.max(0, Math.min(totalHeight, rawY));
                                return (
                                    <div
                                        key={`bpm-left-${idx}`}
                                        style={{
                                            position: 'absolute',
                                            left: 10,                 // 保证在画布外（横坐标不在画布内）
                                            top: `${y}px`,
                                            transform: 'translateY(-50%)',
                                            fontWeight: 700,
                                            fontSize: 12,
                                            color: '#ff6666', // 调整为更亮的红色，在黑色背景下更可见
                                            whiteSpace: 'nowrap',
                                            textShadow: '1px 1px 2px rgba(0,0,0,0.8)' // 添加文字阴影增强可读性
                                        }}
                                    >
                                        BPM {(note as any).bpm}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* 画布区域 */}
                    <div style={{ position: 'relative', backgroundColor: '#000000', overflow: 'visible' }}>
                        <canvas
                            ref={canvasRef}
                            className="border"
                            width={canvasWidth}
                            height={totalHeight}
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onClick={handleCanvasClick}
                            style={{
                                backgroundColor: '#000000', // 轨道外背景样式
                                cursor: dragging ? "grabbing" : (isSelecting ? "crosshair" : "default"),
                                display: 'block', // 避免 inline canvas 造成 baseline 问题
                                userSelect: 'none', // 禁用文本选择
                                WebkitUserSelect: 'none', // Safari 兼容
                                MozUserSelect: 'none', // Firefox 兼容
                                msUserSelect: 'none', // IE 兼容
                                overflow: 'visible', // 允许directional修饰器显示在Canvas边界外
                                border: '1px solid #333', // 添加边框以便调试
                                width: `${canvasWidth}px`, // 明确设置CSS宽度
                                height: `${totalHeight}px` // 明确设置CSS高度
                            }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}