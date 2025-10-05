import { useState } from "react";
import ChartCanvas from "./ChartCanvas";
import CanvasChartCanvas from "./CanvasChartCanvas";
import OptimizedCanvasChartCanvas from "./OptimizedCanvasChartCanvas";
import type { ChartNote } from "../notes/Charts";

interface CanvasChartCanvasExampleProps {
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

type CanvasType = "svg" | "canvas" | "optimized-canvas";

export default function CanvasChartCanvasExample({
    notes,
    setNotes,
    selectedTool,
    selectedNotes,
    setSelectedNotes,
    beatDisplay,
    onMousePositionChange,
    scale,
    isCombinationMode
}: CanvasChartCanvasExampleProps) {
    const [canvasType, setCanvasType] = useState<CanvasType>("svg");

    const renderCanvas = () => {
        const commonProps = {
            notes,
            setNotes,
            selectedTool,
            selectedNotes,
            setSelectedNotes,
            beatDisplay,
            onMousePositionChange,
            scale,
            isCombinationMode
        };

        switch (canvasType) {
            case "svg":
                return <ChartCanvas {...commonProps} />;
            case "canvas":
                return <CanvasChartCanvas {...commonProps} />;
            case "optimized-canvas":
                return <OptimizedCanvasChartCanvas {...commonProps} />;
            default:
                return <ChartCanvas {...commonProps} />;
        }
    };

    return (
        <div className="w-full h-full">
            {/* 画布类型选择器 */}
            <div className="mb-4 p-2 bg-gray-800 rounded">
                <label className="text-white mr-4">画布类型:</label>
                <select
                    value={canvasType}
                    onChange={(e) => setCanvasType(e.target.value as CanvasType)}
                    className="bg-gray-700 text-white px-2 py-1 rounded"
                >
                    <option value="svg">SVG画布 (原始版本)</option>
                    <option value="canvas">Canvas画布 (基础版本)</option>
                    <option value="optimized-canvas">Canvas画布 (性能优化版本)</option>
                </select>

                <div className="mt-2 text-sm text-gray-300">
                    {canvasType === "svg" && "使用SVG渲染，适合少量音符，交互性好"}
                    {canvasType === "canvas" && "使用Canvas渲染，适合大量音符，性能更好"}
                    {canvasType === "optimized-canvas" && "使用分层Canvas渲染，最高性能，适合1000+音符"}
                </div>
            </div>

            {/* 渲染选中的画布 */}
            {renderCanvas()}
        </div>
    );
}
