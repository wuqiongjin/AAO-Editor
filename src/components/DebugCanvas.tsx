import { useState, useRef, useEffect, useCallback } from "react";
import type { ChartNote } from "../notes/Charts";

interface DebugCanvasProps {
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
const BEAT_HEIGHT = 50; // 减小节拍高度
const LANE_WIDTH = 30;
const CANVAS_WIDTH = 550;  // 谱面宽度
const CANVAS_HEIGHT = 900; // 谱面高度

export default function DebugCanvas({
    notes,
    setNotes,
    selectedTool,
    selectedNotes,
    setSelectedNotes,
    beatDisplay,
    onMousePositionChange,
    scale,
    isCombinationMode
}: DebugCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [debugInfo, setDebugInfo] = useState<string>("");

    // 简化的渲染函数
    const renderCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            setDebugInfo("Canvas ref is null");
            return;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            setDebugInfo("Canvas context is null");
            return;
        }

        console.log("开始渲染Canvas", { CANVAS_WIDTH, CANVAS_HEIGHT, scale });

        // 设置画布尺寸
        canvas.width = CANVAS_WIDTH;
        canvas.height = CANVAS_HEIGHT;

        // 清空画布
        ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // 绘制背景 - 使用明显的颜色测试
        ctx.fillStyle = '#111111'; // 稍微亮一点的黑色
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // 计算轨道在Canvas中的居中位置
        const borderTotalWidth = (1 + 4 + 1 + 1 + 1 + 1) * scale;
        const totalTrackWidth = LANES * LANE_WIDTH * scale + borderTotalWidth * 2;
        const trackStartX = (CANVAS_WIDTH - totalTrackWidth) / 2;

        // 绘制轨道内背景
        const trackBgX = trackStartX + borderTotalWidth;
        const trackBgY = 0;
        const trackBgWidth = LANES * LANE_WIDTH * scale;
        const trackBgHeight = CANVAS_HEIGHT;

        console.log("轨道背景参数", { trackBgX, trackBgY, trackBgWidth, trackBgHeight, trackStartX });

        ctx.fillStyle = '#001122'; // 深蓝色，更容易看到
        ctx.fillRect(trackBgX, trackBgY, trackBgWidth, trackBgHeight);

        // 绘制垂直线（轨道线）
        for (let lane = 0; lane <= LANES; lane++) {
            const x = trackStartX + borderTotalWidth + lane * LANE_WIDTH * scale;

            console.log(`绘制轨道线 ${lane}`, { x, trackStartX, borderTotalWidth, lane, LANE_WIDTH, scale });

            if (lane === 0 || lane === LANES) {
                // 外侧轨道边框 - 使用更明显的颜色
                ctx.fillStyle = '#00FF00'; // 绿色边框
                ctx.fillRect(x - 2, 0, 4, CANVAS_HEIGHT);
            } else {
                // 内部轨道线
                ctx.strokeStyle = '#666666';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, CANVAS_HEIGHT);
                ctx.stroke();
            }
        }

        // 绘制水平线（节拍线）
        for (let beat = 0; beat < 18; beat++) { // 增加节拍线数量以适应900高度
            const y = beat * BEAT_HEIGHT * scale;

            console.log(`绘制节拍线 ${beat}`, { y, beat, BEAT_HEIGHT, scale });

            if (y <= CANVAS_HEIGHT) {
                ctx.strokeStyle = '#FF0000'; // 红色节拍线
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(trackBgX, y);
                ctx.lineTo(trackBgX + trackBgWidth, y);
                ctx.stroke();
            }
        }

        // 绘制一个测试矩形 - 放在轨道区域内
        ctx.fillStyle = '#FFFF00'; // 黄色测试矩形
        ctx.fillRect(trackBgX + 50, 50, 100, 50);

        setDebugInfo(`Canvas尺寸: ${CANVAS_WIDTH}x${CANVAS_HEIGHT}, Scale: ${scale}, 轨道数: ${LANES}`);

    }, [scale]);

    // 初始渲染
    useEffect(() => {
        console.log("DebugCanvas useEffect 触发");
        renderCanvas();
    }, [renderCanvas]);

    return (
        <div style={{
            backgroundColor: '#000000',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            minHeight: '100vh'
        }}>
            <div style={{ color: 'white', marginBottom: '10px' }}>
                调试信息: {debugInfo}
            </div>
            <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'center',
                width: '100%'
            }}>
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
                <div style={{
                    position: 'relative',
                    backgroundColor: '#000000',
                    display: 'flex',
                    justifyContent: 'center'
                }}>
                    <canvas
                        ref={canvasRef}
                        width={CANVAS_WIDTH}
                        height={CANVAS_HEIGHT}
                        style={{
                            backgroundColor: '#000000',
                            display: 'block',
                            userSelect: 'none',
                            border: '2px solid #FF0000' // 红色边框，更容易看到
                        }}
                    />
                </div>
            </div>
        </div>
    );
}
