import {
  Music,
  Square,
  MousePointer,
  ZoomIn,
  ZoomOut,
  Copy,
  Scissors,
  Clipboard,
  Trash2,
  RotateCcw,
  Undo,
  Redo,
  Play,
  Pause,
} from "lucide-react";
import SpriteIcon, { NoteIcons } from './SpriteIcon';

interface ToolbarProps {
  selectedTool: string;
  setSelectedTool: (tool: string) => void;
  beatDisplay: number;
  setBeatDisplay: (beat: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onMirror: () => void;
  canCopy: boolean;
  canPaste: boolean;
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  isCombinationMode: boolean;
  setCombinationMode: (mode: boolean) => void;
}

export default function Toolbar({
  selectedTool,
  setSelectedTool,
  beatDisplay,
  setBeatDisplay,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onCopy,
  onCut,
  onPaste,
  onDelete,
  onMirror,
  canCopy,
  canPaste,
  scale,
  onZoomIn,
  onZoomOut,
  isCombinationMode,
  setCombinationMode,
}: ToolbarProps) {
  const tools = [
    { id: "mouse", icon: <MousePointer size={20} />, label: "鼠标状态" },
    { id: "bpm", icon: <Music size={20} />, label: "BPM键型" },
    { id: "single", icon: <SpriteIcon {...NoteIcons.tap} size={20} />, label: "单键音符" },
    { id: "flick", icon: <SpriteIcon {...NoteIcons.flick} size={20} />, label: "滑键音符" },
    { id: "skill", icon: <SpriteIcon {...NoteIcons.skill} size={20} />, label: "技能音符" },
    { id: "ldirectional", icon: <SpriteIcon {...NoteIcons.leftFlick} size={20} />, label: "左方向滑键" },
    { id: "rdirectional", icon: <SpriteIcon {...NoteIcons.rightFlick} size={20} />, label: "右方向滑键" },
    { id: "slide", icon: <SpriteIcon {...NoteIcons.slide} size={20} />, label: "滑条音符" },
  ];

  const beatOptions = [
    { value: 1, label: "1/1" },
    { value: 2, label: "1/2" },
    { value: 3, label: "1/3" },
    { value: 4, label: "1/4" },
    { value: 6, label: "1/6" },
    { value: 8, label: "1/8" },
    { value: 12, label: "1/12" },
    { value: 16, label: "1/16" },
  ];

  return (
    <div className="h-full flex flex-col bg-white">
      {/* 工具栏头部 - 子窗口标题栏 */}
      <div className="bg-gray-800 text-white px-4 py-3 border-b-2 border-gray-600 flex items-center justify-between">
        <div className="flex space-x-1">
          <div className="w-3 h-3 bg-red-500 rounded-full"></div>
          <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
          <div className="w-3 h-3 bg-green-500 rounded-full"></div>
        </div>
      </div>

      {/* 工具栏内容 - 可滚动 */}
      <div
        className="flex-1 p-4 space-y-6 overflow-y-auto bg-gray-50"
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: '#9ca3af #e5e7eb',
          height: 'calc(100vh - 60px)'
        }}
      >
        <div style={{
          height: '32px',
          backgroundColor: '#374151',
          color: 'white',
          fontSize: '12px',
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          borderBottom: '1px solid #4b5563',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', gap: '4px', marginRight: '8px' }}>
            <div style={{ width: '8px', height: '8px', backgroundColor: '#ef4444', borderRadius: '50%' }}></div>
            <div style={{ width: '8px', height: '8px', backgroundColor: '#eab308', borderRadius: '50%' }}></div>
            <div style={{ width: '8px', height: '8px', backgroundColor: '#22c55e', borderRadius: '50%' }}></div>
          </div>
          {/* 工具栏 */}
        </div>
        {/* 工具选择 */}
        <div>
          <h3 className="text-xs font-semibold mb-3 text-gray-600 uppercase tracking-wide">基础键型</h3>
          <div className="space-y-1">
            {tools.map((tool) => (
              <button
                key={tool.id}
                className={`w-full p-3 rounded-md text-sm flex items-center space-x-3 transition-all duration-200 ${selectedTool === tool.id
                  ? "bg-blue-200 text-blue-700 border-2 border-blue-500 shadow-lg ring-2 ring-blue-300 transform scale-105"
                  : "text-gray-700 hover:bg-gray-100 border-2 border-transparent hover:border-gray-300"
                  }`}
                onClick={() => {
                  console.log('Tool clicked:', tool.id, 'Current selectedTool:', selectedTool);
                  setSelectedTool(tool.id);
                }}
                title={tool.label}
                style={{
                  backgroundColor: selectedTool === tool.id ? '#dbeafe' : undefined,
                  borderColor: selectedTool === tool.id ? '#3b82f6' : undefined,
                  boxShadow: selectedTool === tool.id ? '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)' : undefined
                }}
              >
                <div className="flex-shrink-0">
                  {tool.icon}
                </div>
                <span className="text-left">{tool.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 节拍显示工具 */}
        <div>
          <h3 className="text-xs font-semibold mb-3 text-gray-600 uppercase tracking-wide">节拍显示</h3>
          <select
            value={beatDisplay}
            onChange={(e) => setBeatDisplay(Number(e.target.value))}
            className="w-full p-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            {beatOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* 缩放控制 */}
        <div>
          <h3 className="text-xs font-semibold mb-3 text-gray-600 uppercase tracking-wide">缩放</h3>
          <div className="flex gap-2">
            <button
              className="flex-1 p-2 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              onClick={onZoomIn}
              title="放大"
            >
              <ZoomIn size={16} className="mx-auto" />
            </button>
            <button
              className="flex-1 p-2 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              onClick={onZoomOut}
              title="缩小"
            >
              <ZoomOut size={16} className="mx-auto" />
            </button>
          </div>
          <div className="text-xs text-gray-500 mt-2 text-center">
            {Math.round(scale * 100)}%
          </div>
        </div>

        {/* 编辑功能 */}
        <div>
          <h3 className="text-xs font-semibold mb-3 text-gray-600 uppercase tracking-wide">编辑</h3>
          <div className="space-y-1">
            <button
              className={`w-full p-2 rounded-md text-sm flex items-center space-x-3 transition-colors ${canCopy ? "text-gray-700 hover:bg-gray-100" : "text-gray-400 cursor-not-allowed"
                }`}
              onClick={onCopy}
              disabled={!canCopy}
              title="复制 (Ctrl+C)"
            >
              <Copy size={16} />
              <span>复制</span>
            </button>
            <button
              className={`w-full p-2 rounded-md text-sm flex items-center space-x-3 transition-colors ${canCopy ? "text-gray-700 hover:bg-gray-100" : "text-gray-400 cursor-not-allowed"
                }`}
              onClick={onCut}
              disabled={!canCopy}
              title="剪切 (Ctrl+X)"
            >
              <Scissors size={16} />
              <span>剪切</span>
            </button>
            <button
              className={`w-full p-2 rounded-md text-sm flex items-center space-x-3 transition-colors ${canPaste ? "text-gray-700 hover:bg-gray-100" : "text-gray-400 cursor-not-allowed"
                }`}
              onClick={onPaste}
              disabled={!canPaste}
              title="粘贴 (Ctrl+V)"
            >
              <Clipboard size={16} />
              <span>粘贴</span>
            </button>
            <button
              className={`w-full p-2 rounded-md text-sm flex items-center space-x-3 transition-colors ${canCopy ? "text-gray-700 hover:bg-gray-100" : "text-gray-400 cursor-not-allowed"
                }`}
              onClick={onDelete}
              disabled={!canCopy}
              title="删除 (Delete)"
            >
              <Trash2 size={16} />
              <span>删除</span>
            </button>
            <button
              className={`w-full p-2 rounded-md text-sm flex items-center space-x-3 transition-colors ${canCopy ? "text-gray-700 hover:bg-gray-100" : "text-gray-400 cursor-not-allowed"
                }`}
              onClick={onMirror}
              disabled={!canCopy}
              title="镜像 (Ctrl+M)"
            >
              <RotateCcw size={16} />
              <span>镜像</span>
            </button>
            <button
              className={`w-full p-2 rounded-md text-sm flex items-center space-x-3 transition-colors ${canUndo ? "text-gray-700 hover:bg-gray-100" : "text-gray-400 cursor-not-allowed"
                }`}
              onClick={onUndo}
              disabled={!canUndo}
              title="撤销 (Ctrl+Z)"
            >
              <Undo size={16} />
              <span>撤销</span>
            </button>
            <button
              className={`w-full p-2 rounded-md text-sm flex items-center space-x-3 transition-colors ${canRedo ? "text-gray-700 hover:bg-gray-100" : "text-gray-400 cursor-not-allowed"
                }`}
              onClick={onRedo}
              disabled={!canRedo}
              title="还原 (Ctrl+Y)"
            >
              <Redo size={16} />
              <span>还原</span>
            </button>
          </div>
        </div>

        {/* 组合状态 */}
        <div>
          <h3 className="text-xs font-semibold mb-3 text-gray-600 uppercase tracking-wide">状态</h3>
          <button
            className={`w-full p-3 rounded-md text-sm flex items-center space-x-3 transition-colors ${isCombinationMode
              ? "bg-blue-100 text-blue-700 border border-blue-200"
              : "text-gray-700 hover:bg-gray-100 border border-transparent"
              }`}
            onClick={() => setCombinationMode(!isCombinationMode)}
            title="组合状态 - 支持多选音符"
          >
            <Square size={16} />
            <span>组合状态</span>
          </button>
        </div>

        {/* 播放控制 */}
        <div>
          <h3 className="text-xs font-semibold mb-3 text-gray-600 uppercase tracking-wide">播放</h3>
          <div className="flex gap-2">
            <button className="flex-1 p-2 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors" title="播放 (空格)">
              <Play size={16} className="mx-auto" />
            </button>
            <button className="flex-1 p-2 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors" title="暂停">
              <Pause size={16} className="mx-auto" />
            </button>
          </div>
        </div>

        {/* 额外内容确保滚动条出现 */}
        <div>
          <h3 className="text-xs font-semibold mb-3 text-gray-600 uppercase tracking-wide">设置</h3>
          <div className="space-y-2">
            <div className="p-2 bg-white border border-gray-300 rounded-md">
              <div className="text-sm text-gray-600">自动保存</div>
              <div className="text-xs text-gray-400">每30秒自动保存</div>
            </div>
            <div className="p-2 bg-white border border-gray-300 rounded-md">
              <div className="text-sm text-gray-600">网格对齐</div>
              <div className="text-xs text-gray-400">启用网格吸附</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
