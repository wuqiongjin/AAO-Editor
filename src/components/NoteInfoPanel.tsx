import { useState, useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, Copy, RotateCcw } from "lucide-react";
import type { ChartNote } from "../notes/Charts";
import { convertNotesToChartCode, chartCodeToJSON, parseChartCodeFromJSON, validateChartCode, convertChartCodeToNotes } from "../utils/ChartConverter";
import { mirrorNote } from "../utils/NoteEditing";

interface NoteInfoPanelProps {
    selectedNotes: number[];
    notes: ChartNote[];
    onNotesChange: (notes: ChartNote[]) => void;
}

export default function NoteInfoPanel({ selectedNotes, notes, onNotesChange }: NoteInfoPanelProps) {
    const [isCombinationMode, setIsCombinationMode] = useState(false);
    const [chartCode, setChartCode] = useState("");
    const [isCodeEditorCollapsed, setIsCodeEditorCollapsed] = useState(false);
    const [isValid, setIsValid] = useState(true);
    const [validationErrors, setValidationErrors] = useState<string[]>([]);
    const [isDirty, setIsDirty] = useState(false);
    const [lastAppliedCode, setLastAppliedCode] = useState("");
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const selectedNoteObjects = selectedNotes.map(index => notes[index]).filter(Boolean);

    // 验证谱面代码
    const validateCode = (code: string) => {
        try {
            const parsed = parseChartCodeFromJSON(code);
            const validation = validateChartCode(parsed);
            setIsValid(validation.valid);
            setValidationErrors(validation.errors);
            return validation.valid;
        } catch (error) {
            setIsValid(false);
            setValidationErrors(['JSON格式错误: ' + (error as Error).message]);
            return false;
        }
    };

    // 获取默认BPM音符的保底状态
    const getDefaultBPMCode = () => {
        const defaultCode = convertNotesToChartCode([{ beat: 0, type: "BPM", bpm: 120 }]);
        return chartCodeToJSON(defaultCode);
    };

    // 当音符数据变化时更新代码
    useEffect(() => {
        if (!isDirty) {
            const code = convertNotesToChartCode(notes);
            const jsonString = chartCodeToJSON(code);
            setChartCode(jsonString);
            setLastAppliedCode(jsonString);
        }
    }, [notes, isDirty]);

    // 处理代码变化
    const handleCodeChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newCode = event.target.value;
        setChartCode(newCode);
        setIsDirty(true);

        // 如果代码为空，自动设置为默认BPM状态
        if (newCode.trim() === '') {
            const defaultCode = getDefaultBPMCode();
            setChartCode(defaultCode);
            setIsValid(true);
            setValidationErrors([]);
            return;
        }

        // 只验证格式，不自动回退
        validateCode(newCode);
    };

    // 应用谱面代码到编辑器
    const handleApply = () => {
        // 重新验证代码
        const isValidCode = validateCode(chartCode);

        if (!isValidCode) {
            alert('谱面代码格式错误，已回退到上次应用的状态');
            setChartCode(lastAppliedCode);
            setIsDirty(false);
            setIsValid(true);
            setValidationErrors([]);
            return;
        }

        try {
            const parsedCode = parseChartCodeFromJSON(chartCode);
            const newNotes = convertChartCodeToNotes(parsedCode);
            onNotesChange(newNotes);
            setIsDirty(false);
            setLastAppliedCode(chartCode);
            alert('谱面代码已成功应用到编辑器');
        } catch (error) {
            alert('应用谱面代码失败，已回退到上次应用的状态: ' + (error as Error).message);
            setChartCode(lastAppliedCode);
            setIsDirty(false);
            setIsValid(true);
            setValidationErrors([]);
        }
    };

    // 重置为默认BPM状态
    const handleReset = () => {
        const defaultCode = getDefaultBPMCode();
        setChartCode(defaultCode);
        setIsDirty(false);
        setIsValid(true);
        setValidationErrors([]);
    };

    // 复制到剪贴板
    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(chartCode);
            alert('谱面代码已复制到剪贴板');
        } catch (error) {
            alert('复制失败: ' + (error as Error).message);
        }
    };

    // 处理键盘输入，支持Tab缩进、自动格式化和文本编辑快捷键
    const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // 处理文本编辑快捷键
        if (event.ctrlKey || event.metaKey) {
            const textarea = event.currentTarget;
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const value = textarea.value;

            switch (event.key.toLowerCase()) {
                case 'c':
                    // 复制选中文本
                    event.preventDefault();
                    if (start !== end) {
                        const selectedText = value.substring(start, end);
                        navigator.clipboard.writeText(selectedText);
                    }
                    break;
                case 'x':
                    // 剪切选中文本
                    event.preventDefault();
                    if (start !== end) {
                        const selectedText = value.substring(start, end);
                        navigator.clipboard.writeText(selectedText);
                        const newValue = value.substring(0, start) + value.substring(end);
                        setChartCode(newValue);
                        setIsDirty(true);
                        setTimeout(() => {
                            textarea.selectionStart = textarea.selectionEnd = start;
                        }, 0);
                    }
                    break;
                case 'v':
                    // 粘贴文本
                    event.preventDefault();
                    navigator.clipboard.readText().then(text => {
                        const newValue = value.substring(0, start) + text + value.substring(end);
                        setChartCode(newValue);
                        setIsDirty(true);
                        setTimeout(() => {
                            textarea.selectionStart = textarea.selectionEnd = start + text.length;
                        }, 0);
                    });
                    break;
                case 'z':
                    // 撤销（这里简化为清空，实际可以维护历史记录）
                    event.preventDefault();
                    setChartCode(lastAppliedCode);
                    setIsDirty(false);
                    break;
                case 'a':
                    // 全选
                    event.preventDefault();
                    textarea.select();
                    break;
            }
            return;
        }

        // 处理Tab和Enter键
        if (event.key === 'Tab') {
            event.preventDefault();
            const textarea = event.currentTarget;
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const value = textarea.value;

            // 插入4个空格作为缩进
            const newValue = value.substring(0, start) + '    ' + value.substring(end);
            setChartCode(newValue);
            setIsDirty(true);

            // 设置光标位置
            setTimeout(() => {
                textarea.selectionStart = textarea.selectionEnd = start + 4;
            }, 0);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const textarea = event.currentTarget;
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const value = textarea.value;

            // 获取当前行的缩进
            const beforeCursor = value.substring(0, start);
            const lastLineStart = beforeCursor.lastIndexOf('\n') + 1;
            const currentLine = value.substring(lastLineStart, start);
            const indent = currentLine.match(/^(\s*)/)?.[1] || '';

            // 根据当前字符决定缩进
            let newIndent = indent;
            if (currentLine.trim().endsWith('{') || currentLine.trim().endsWith('[')) {
                newIndent = indent + '    '; // 增加缩进
            } else if (currentLine.trim().startsWith('}') || currentLine.trim().startsWith(']')) {
                newIndent = indent.substring(0, Math.max(0, indent.length - 4)); // 减少缩进
            }

            const newValue = value.substring(0, start) + '\n' + newIndent + value.substring(end);
            setChartCode(newValue);
            setIsDirty(true);

            // 设置光标位置
            setTimeout(() => {
                textarea.selectionStart = textarea.selectionEnd = start + 1 + newIndent.length;
            }, 0);
        }
    };

    const handleDeleteSelected = () => {
        if (selectedNotes.length === 0) return;

        const newNotes = notes.filter((_, index) => !selectedNotes.includes(index));
        onNotesChange(newNotes);
    };

    const handleMirrorSelected = () => {
        if (selectedNotes.length === 0) return;

        // 复用领域唯一镜像实现（C5:修 4-lane bug，并使方向键 L↔R/滑条连接点同步翻转，与画布镜像语义一致）
        const newNotes = notes.map((note, index) => selectedNotes.includes(index) ? mirrorNote(note) : note);
        onNotesChange(newNotes);
    };

    return (
        <div className="h-full flex flex-col">
            {/* 音符信息区块 */}
            <div className="bg-white border-b border-gray-200 shadow-sm">
                <div className="p-4 border-b border-gray-100">
                    <h3 className="text-lg font-semibold mb-2 text-gray-800">音符信息</h3>
                </div>

                <div className="p-4">
                    {/* 组合状态切换 */}
                    <div className="mb-4">
                        <label className="flex items-center">
                            <input
                                type="checkbox"
                                checked={isCombinationMode}
                                onChange={(e) => setIsCombinationMode(e.target.checked)}
                                className="mr-2"
                            />
                            组合状态
                        </label>
                    </div>

                    {/* 选中音符数量 */}
                    <div className="mb-4">
                        <span className="text-sm text-gray-600">
                            已选中 {selectedNotes.length} 个音符
                        </span>
                    </div>

                    {/* 操作按钮 */}
                    <div className="space-y-2">
                        <button
                            onClick={handleDeleteSelected}
                            disabled={selectedNotes.length === 0}
                            className="w-full px-3 py-2 bg-red-500 text-white rounded disabled:bg-gray-300 disabled:cursor-not-allowed hover:bg-red-600 transition-colors"
                        >
                            删除选中
                        </button>
                        <button
                            onClick={handleMirrorSelected}
                            disabled={selectedNotes.length === 0}
                            className="w-full px-3 py-2 bg-blue-500 text-white rounded disabled:bg-gray-300 disabled:cursor-not-allowed hover:bg-blue-600 transition-colors"
                        >
                            镜像选中
                        </button>
                    </div>
                </div>

                {/* 选中音符详情 */}
                <div className="max-h-64 overflow-y-auto p-4 bg-gray-50">
                    {selectedNoteObjects.length > 0 ? (
                        <div className="space-y-3">
                            {selectedNoteObjects.map((note, index) => (
                                <div key={index} className="p-3 bg-white rounded border shadow-sm">
                                    <div className="font-medium text-gray-800">
                                        {note.type === "Single" && "单键音符"}
                                        {note.type === "Slide" && "滑条音符"}
                                        {note.type === "BPM" && "BPM标记"}
                                    </div>
                                    {note.type === "Single" && (
                                        <div className="text-sm text-gray-600 mt-1">
                                            <div>轨道: {note.lane}</div>
                                            <div>节拍: {note.beat}</div>
                                            {note.flick && <div className="text-red-500">滑键</div>}
                                        </div>
                                    )}
                                    {note.type === "Slide" && (
                                        <div className="text-sm text-gray-600 mt-1">
                                            <div>连接点: {note.connections.length}</div>
                                            {note.connections.map((conn, i) => (
                                                <div key={i}>
                                                    点{i + 1}: 轨道{conn.lane}, 节拍{conn.beat}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {note.type === "BPM" && (
                                        <div className="text-sm text-gray-600 mt-1">
                                            <div>节拍: {note.beat}</div>
                                            <div>BPM: {note.bpm}</div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-gray-500 text-center py-8">
                        </div>
                    )}
                </div>
            </div>

            {/* 分割线 */}
            <div className="border-t border-gray-200"></div>

            {/* 谱面代码编辑器区块 */}
            <div className={`bg-white transition-all duration-300 ${isCodeEditorCollapsed ? 'flex-shrink-0' : 'flex-1'}`}>
                <div className="p-4 border-b border-gray-100">
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-gray-800">谱面代码编辑器
                            <button
                                onClick={() => setIsCodeEditorCollapsed(!isCodeEditorCollapsed)}
                                className="ml-2 p-1 hover:bg-gray-100 rounded transition-colors"
                                title={isCodeEditorCollapsed ? "展开" : "折叠"}
                            >
                                {isCodeEditorCollapsed ? (
                                    <ChevronDown size={20} className="text-gray-500" />
                                ) : (
                                    <ChevronUp size={20} className="text-gray-500" />
                                )}
                            </button>
                        </h3>
                    </div>
                </div>

                {!isCodeEditorCollapsed && (
                    <div className="flex flex-col h-full">
                        {/* 错误信息 */}
                        {!isValid && validationErrors.length > 0 && (
                            <div className="p-3 bg-red-50 border-b border-red-200">
                                <h4 className="font-semibold text-red-800 mb-2 text-sm">错误信息:</h4>
                                <ul className="text-xs text-red-700 space-y-1">
                                    {validationErrors.map((error, index) => (
                                        <li key={index}>• {error}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* 代码编辑器 */}
                        <div className="flex-1 p-4">
                            <textarea
                                ref={textareaRef}
                                value={chartCode}
                                onChange={handleCodeChange}
                                onKeyDown={handleKeyDown}
                                className="w-full h-full p-3 border border-gray-300 rounded font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                placeholder="谱面代码将在这里显示..."
                                style={{
                                    scrollbarWidth: 'thin',
                                    scrollbarColor: '#9ca3af #e5e7eb',
                                    minHeight: '300px',
                                    width: '90%',
                                    height: '100%',
                                    tabSize: 4,
                                }}
                                spellCheck={false}
                            />
                        </div>

                        {/* 工具栏 */}
                        <div className="p-4 border-t border-gray-200 bg-gray-50">
                            <div className="flex gap-2 flex-wrap">
                                <button
                                    onClick={handleApply}
                                    disabled={!isValid}
                                    className="px-4 py-2 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                                >
                                    应用更改
                                </button>
                                <button
                                    onClick={handleReset}
                                    className="px-4 py-2 bg-gray-500 text-white text-sm rounded hover:bg-gray-600 transition-colors"
                                >
                                    <RotateCcw size={16} className="inline mr-1" />
                                    重置
                                </button>
                                <button
                                    onClick={handleCopy}
                                    className="px-4 py-2 bg-purple-500 text-white text-sm rounded hover:bg-purple-600 transition-colors"
                                >
                                    <Copy size={16} className="inline mr-1" />
                                    复制
                                </button>
                                {isDirty && (
                                    <span className="px-3 py-2 text-orange-600 text-sm flex items-center">
                                        未保存的更改
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
