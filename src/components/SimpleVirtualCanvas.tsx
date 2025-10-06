import { useState, useRef, useEffect, useCallback } from "react";
import type { ChartNote } from "../notes/Charts";

interface SimpleVirtualCanvasProps {
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

const LANES = 7;
const BEATS = 360;
const BEAT_HEIGHT = 220;
const LANE_WIDTH = 30;
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

export default function SimpleVirtualCanvas({
    notes,
    setNotes,
    selectedTool,
    selectedNotes,
    setSelectedNotes,
    beatDisplay,
    onMousePositionChange,
    scale,
    isCombinationMode
}: SimpleVirtualCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // 简化的渲染函数
    const renderCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // 设置画布尺寸
        canvas.width = CANVAS_WIDTH;
        canvas.height = CANVAS_HEIGHT;

        // 清空画布
        ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // 绘制背景
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // 绘制轨道内背景
        const borderTotalWidth = (1 + 4 + 1 + 1 + 1 + 1) * scale;
        const trackBgX = borderTotalWidth;
        const trackBgY = 0;
        const trackBgWidth = LANES * LANE_WIDTH * scale;
        const trackBgHeight = CANVAS_HEIGHT;
        ctx.fillStyle = '#00000A';
        ctx.fillRect(trackBgX, trackBgY, trackBgWidth, trackBgHeight);

        // 绘制垂直线（轨道线）
        for (let lane = 0; lane <= LANES; lane++) {
            const x = borderTotalWidth + lane * LANE_WIDTH * scale;

            if (lane === 0 || lane === LANES) {
                // 外侧轨道边框
                const borderColors = ['#004C4C', '#004D4D', '#009898', '#00A6A6', '#008186', '#003D44'];
                const borderWidths = [1, 4, 1, 1, 1, 1];
                let currentOffset = 0;
                const isRightBorder = lane === LANES;

                borderColors.forEach((color, index) => {
                    const width = borderWidths[index] * scale;
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
        for (let beat = 0; beat < 20; beat++) {
            const y = beat * BEAT_HEIGHT * scale;

            if (y <= CANVAS_HEIGHT) {
                ctx.strokeStyle = '#555555';
                ctx.lineWidth = Math.max(2, 2 * scale);
                ctx.beginPath();
                ctx.moveTo(borderTotalWidth, y);
                ctx.lineTo(borderTotalWidth + LANES * LANE_WIDTH * scale, y);
                ctx.stroke();
            }
        }

        // 绘制BPM线（如果有BPM音符）
        notes.forEach((note) => {
            if (note.type === "BPM") {
                const y = note.beat * BEAT_HEIGHT * scale;
                if (y <= CANVAS_HEIGHT) {
                    ctx.strokeStyle = 'red';
                    ctx.lineWidth = 3;
                    ctx.setLineDash([5, 5]);
                    ctx.beginPath();
                    ctx.moveTo(borderTotalWidth, y);
                    ctx.lineTo(borderTotalWidth + LANES * LANE_WIDTH * scale, y);
                    ctx.stroke();
                    ctx.setLineDash([]);
                }
            }
        });

    }, [notes, scale]);

    // 初始渲染
    useEffect(() => {
        renderCanvas();
    }, [renderCanvas]);

    return (
        <div className="w-full h-full overflow-auto" style={{ backgroundColor: '#000000' }}>
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
                            {notes.filter(note => note.type === "BPM").map((note, idx) => {
                                const y = note.beat * BEAT_HEIGHT * scale;
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
                            style={{
                                backgroundColor: '#000000',
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
