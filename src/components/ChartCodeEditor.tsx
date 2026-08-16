// 谱面代码编辑器（深模块，ADR-0003 §9 谱面代码为未来 AI 通道）：
// 封装「代码文本撤销栈 / 单向同步 / 校验 / 应用」为一整体，对外只读 hooks 直读领域状态。
// issue 37：由「常驻内嵌面板」改为「按需弹窗」——
//   * 单向同步：打开时「画布→代码」同步一次；应用时「代码→画布」；不随画布编辑实时同步。
//   * 打开才构建/渲染 textarea（成本归零：关闭即卸载 textarea，无画布→代码字符串成本，
//     避免 issue 36 RC-A 的受控 textarea 全量赋值 + 巨型文本布局 + gBCR 强制重排主因）。
//   * 关闭即丢弃草稿：再次打开从画布全新同步，无残留状态泄漏。
// 文本变换逻辑下沉到 utils/CodeEditorOps（纯函数，可单测）。
import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { Braces, Copy, RotateCcw, RefreshCw, X } from "lucide-react";
import { convertNotesToChartCode, chartCodeToJSON, parseChartCodeFromJSON, validateChartCode, convertChartCodeToNotes, hasBeat0Bpm } from "../utils/ChartConverter";
import { useEditing, usePlayback, useUI } from "../contexts";
import { maxNoteEndSeconds, getBpmEvents } from "../utils/AudioTiming";
import {
    createHistory, pushHistory, undoHistory, redoHistory, currentHistory,
    type HistoryState,
} from "../utils/History";
import {
    insertTab, insertNewlineIndent, cutRange, pasteAt,
    type TextEditRange,
} from "../utils/CodeEditorOps";
import ActionBtn from "./ActionBtn";

export default function ChartCodeEditor() {
    const { notes, handleNotesChange } = useEditing();
    const { canPlay, duration, setDuration } = usePlayback();
    const { beatDisplay } = useUI();

    const [open, setOpen] = useState(false);
    // 代码文本真实撤销/重做：chartCode 由 textHistory 撤销栈派生（复用 History 纯模块）
    const [textHistory, setTextHistory] = useState<HistoryState<string>>(() => createHistory(""));
    const chartCode = currentHistory(textHistory);
    const [isValid, setIsValid] = useState(true);
    const [validationErrors, setValidationErrors] = useState<string[]>([]);
    // dirty 基准：打开时（或应用后）同步的最新代码串
    const [lastAppliedCode, setLastAppliedCode] = useState("");
    // 打开/应用时的画布音符数，用于 dirty + canvas 变动的过期检测（单向同步下画布可能已变）
    const [appliedNotesCount, setAppliedNotesCount] = useState(notes.length);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // dirty = 代码文本与被同步的基准不一致（派生）
    const isDirty = chartCode !== lastAppliedCode;
    // 过期：有未应用草稿，且画布自上次同步后已变化（应用时需覆盖确认）
    const isStale = isDirty && notes.length !== appliedNotesCount;

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

    // 打开弹窗：以当前画布全量构建代码（单向「画布→代码」，同步进行一次）。
    // 关闭即丢弃草稿——每次打开都从画布重建基准，重置撤销栈，无残留状态。
    const handleOpen = () => {
        const code = convertNotesToChartCode(notes);
        const jsonString = chartCodeToJSON(code);
        setTextHistory(createHistory(jsonString));
        setLastAppliedCode(jsonString);
        setAppliedNotesCount(notes.length);
        setIsValid(true);
        setValidationErrors([]);
        setOpen(true);
    };

    // 关闭弹窗：有未应用草稿时确认（丢弃后关闭），否则直接关闭
    const requestClose = () => {
        if (isDirty && !window.confirm('谱面代码有未应用的更改，关闭将丢弃这些更改，确定关闭？')) {
            return;
        }
        setOpen(false);
    };

    // 处理代码变化：压入撤销栈；空代码回到保底状态
    const handleCodeChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newCode = event.target.value;

        // 空代码 → 保底状态（第0拍 120bpm）
        if (newCode.trim() === '') {
            const defaultCode = getDefaultBPMCode();
            setTextHistory(createHistory(defaultCode));
            setIsValid(true);
            setValidationErrors([]);
            return;
        }

        // 压入撤销栈（真实文本撤销/重做）
        setTextHistory(prev => pushHistory(prev, newCode));
        // 只验证格式，不自动回退
        validateCode(newCode);
    };

    // 应用谱面代码：经 useEditing.handleNotesChange 走历史记录（单向「代码→画布」）
    const handleApply = () => {
        const isValidCode = validateCode(chartCode);

        if (!isValidCode) {
            alert('谱面代码格式错误，已回退到上次应用的状态');
            setTextHistory(createHistory(lastAppliedCode));
            setIsValid(true);
            setValidationErrors([]);
            return;
        }

        try {
            const parsedCode = parseChartCodeFromJSON(chartCode);
            // 强制校验：beat0 必须有 BPM 音符（保底语义，ADR-0001 谱面必须有初始 BPM）
            if (!hasBeat0Bpm(parsedCode)) {
                alert('谱面必须包含第 0 拍的 BPM 音符，无法应用');
                return;
            }
            // 覆盖风险确认：画布已在草稿之后被改动
            if (isStale) {
                const delta = Math.abs(notes.length - appliedNotesCount);
                if (!window.confirm(`应用将覆盖画布上的 ${delta} 个音符改动，确定应用？`)) {
                    return;
                }
            }
            const newNotes = convertChartCodeToNotes(parsedCode);
            handleNotesChange(newNotes);
            // ADR-0005 §4.5：无音频导入谱面代码时，若代码比当前谱面长度更长，自动延长谱面长度到代码最后音符结束时间
            if (!canPlay) {
                const endSeconds = maxNoteEndSeconds(newNotes, beatDisplay, getBpmEvents(newNotes));
                if (endSeconds > duration) {
                    setDuration(endSeconds);
                }
            }
            setLastAppliedCode(chartCode);
            setAppliedNotesCount(newNotes.length);
            setTextHistory(createHistory(chartCode));
            alert('谱面代码已成功应用到编辑器');
        } catch (error) {
            alert('应用谱面代码失败，已回退到上次应用的状态: ' + (error as Error).message);
            setTextHistory(createHistory(lastAppliedCode));
            setIsValid(true);
            setValidationErrors([]);
        }
    };

    // 重置为默认BPM状态
    const handleReset = () => {
        const defaultCode = getDefaultBPMCode();
        setTextHistory(createHistory(defaultCode));
        setIsValid(true);
        setValidationErrors([]);
    };

    // 用画布刷新代码（丢弃草稿，从当前画布重新生成；单向同步下画布可能已变）
    const handleRefreshFromCanvas = () => {
        const code = convertNotesToChartCode(notes);
        const jsonString = chartCodeToJSON(code);
        setTextHistory(createHistory(jsonString));
        setLastAppliedCode(jsonString);
        setAppliedNotesCount(notes.length);
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

    // 文本编辑后恢复选区并压入撤销栈
    const applyTextEdit = (next: TextEditRange) => {
        setTextHistory(prev => pushHistory(prev, next.value));
        requestAnimationFrame(() => {
            const ta = textareaRef.current;
            if (ta) { ta.selectionStart = next.start; ta.selectionEnd = next.end; }
        });
    };

    // 处理键盘输入：文本变换走 CodeEditorOps 纯函数；撤销/重做走文本撤销栈；剪贴板走 navigator
    const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        const ta = event.currentTarget;
        const range: TextEditRange = { value: ta.value, start: ta.selectionStart, end: ta.selectionEnd };

        if (event.ctrlKey || event.metaKey) {
            switch (event.key.toLowerCase()) {
                case 'c':
                    // 复制选中文本
                    event.preventDefault();
                    if (range.start !== range.end) {
                        navigator.clipboard.writeText(ta.value.substring(range.start, range.end));
                    }
                    break;
                case 'x':
                    // 剪切选中文本
                    event.preventDefault();
                    if (range.start !== range.end) {
                        navigator.clipboard.writeText(ta.value.substring(range.start, range.end));
                        applyTextEdit(cutRange(range));
                    }
                    break;
                case 'v':
                    // 粘贴文本
                    event.preventDefault();
                    navigator.clipboard.readText().then(text => applyTextEdit(pasteAt(range, text)));
                    break;
                case 'z':
                    // 撤销文本编辑（真实撤销栈，仅作用代码文本，不碰谱面）
                    event.preventDefault();
                    setTextHistory(prev => undoHistory(prev) ?? prev);
                    break;
                case 'y':
                    // 重做文本编辑（真实重做栈）
                    event.preventDefault();
                    setTextHistory(prev => redoHistory(prev) ?? prev);
                    break;
                case 'a':
                    // 全选
                    event.preventDefault();
                    ta.select();
                    break;
            }
            return;
        }

        if (event.key === 'Tab') {
            event.preventDefault();
            applyTextEdit(insertTab(range));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            applyTextEdit(insertNewlineIndent(range));
        }
    };

    return (
        <>
            {/* 入口按钮（工具列「编辑」分组内）——点击才打开弹窗，常驻状态不做任何代码同步 */}
            <button
                onClick={handleOpen}
                title="打开谱面代码编辑器"
                style={{
                    width: '100%',
                    display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
                    gap: 'var(--space-3)',
                    padding: 'var(--space-2) var(--space-3)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid transparent',
                    backgroundColor: 'transparent', color: 'var(--text)',
                    cursor: 'pointer', textAlign: 'left',
                    fontFamily: 'inherit', fontSize: 'var(--text-sm)',
                    transition: 'background-color var(--dur) var(--ease), color var(--dur) var(--ease)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
                <span style={{ display: 'flex', flexShrink: 0 }}><Braces size={20} /></span>
                <span>谱面代码</span>
            </button>

            {/* 按需弹窗：render 到 body，遮罩覆盖画布；关闭即卸载文本区（成本归零） */}
            {open && createPortal(
                <div
                    style={{
                        position: 'fixed', inset: 0, zIndex: 'var(--z-modal)',
                        backgroundColor: 'rgba(0,0,0,0.4)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                    onClick={requestClose}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            width: 'min(920px, 92vw)', height: 'min(640px, 86vh)',
                            backgroundColor: 'var(--bg-elevated)',
                            border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
                            boxShadow: 'var(--shadow-lg)',
                            display: 'flex', flexDirection: 'column', overflow: 'hidden',
                        }}
                    >
                        {/* 头部 */}
                        <div style={{
                            padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border)',
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            backgroundColor: 'var(--bg)',
                        }}>
                            <h3 style={{ margin: 0, fontSize: 'var(--text-sm)', fontWeight: 600 }}>谱面代码编辑器</h3>
                            <button
                                onClick={requestClose}
                                title="关闭"
                                style={{
                                    width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                                    backgroundColor: 'transparent', color: 'var(--text-muted)',
                                    transition: 'background-color var(--dur) var(--ease), color var(--dur) var(--ease)',
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
                                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* 过期提示：草稿未应用 + 画布已变动 */}
                        {isStale && (
                            <div style={{
                                padding: 'var(--space-3)', backgroundColor: 'var(--warning-soft)',
                                borderBottom: '1px solid var(--warning)', color: 'var(--warning)',
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)',
                            }}>
                                <span style={{ fontSize: 'var(--text-xs)' }}>
                                    代码已过期（画布已更新 {Math.abs(notes.length - appliedNotesCount)} 个音符），应用将覆盖画布改动。
                                </span>
                                <ActionBtn onClick={handleRefreshFromCanvas}><RefreshCw size={14} />用画布刷新代码</ActionBtn>
                            </div>
                        )}

                        {/* 错误信息 */}
                        {!isValid && validationErrors.length > 0 && (
                            <div style={{ padding: 'var(--space-3)', backgroundColor: 'var(--danger-soft)', borderBottom: '1px solid var(--danger)', color: 'var(--danger-text)' }}>
                                <h4 style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>错误信息:</h4>
                                <ul style={{ margin: 0, paddingLeft: 'var(--space-4)', fontSize: 'var(--text-xs)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                                    {validationErrors.map((error, index) => (
                                        <li key={index}>• {error}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* 代码编辑器 */}
                        <div style={{ flex: 1, padding: 'var(--space-3)', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                            <textarea
                                ref={textareaRef}
                                value={chartCode}
                                onChange={handleCodeChange}
                                onKeyDown={handleKeyDown}
                                spellCheck={false}
                                placeholder="谱面代码将在这里显示..."
                                style={{
                                    width: '100%', height: '100%', minHeight: 0, boxSizing: 'border-box', resize: 'none',
                                    padding: 'var(--space-3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                                    backgroundColor: 'var(--bg-inset)', color: 'var(--text)',
                                    fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', lineHeight: 1.6,
                                    tabSize: 4, outline: 'none',
                                    transition: 'border-color var(--dur) var(--ease)',
                                }}
                            />
                        </div>

                        {/* 工具栏 */}
                        <div style={{
                            padding: 'var(--space-3) var(--space-4)', borderTop: '1px solid var(--border)',
                            backgroundColor: 'var(--bg-inset)', display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center',
                        }}>
                            <ActionBtn onClick={handleApply} disabled={!isValid} variant="primary">应用更改</ActionBtn>
                            <ActionBtn onClick={handleRefreshFromCanvas}><RefreshCw size={16} />从画布刷新</ActionBtn>
                            <ActionBtn onClick={handleReset}><RotateCcw size={16} />重置</ActionBtn>
                            <ActionBtn onClick={handleCopy}><Copy size={16} />复制</ActionBtn>
                            {isDirty && (
                                <span style={{ color: 'var(--warning)', fontSize: 'var(--text-xs)' }}>未保存的更改</span>
                            )}
                            <span style={{ flex: 1 }} />
                            <ActionBtn onClick={requestClose}>关闭</ActionBtn>
                        </div>
                    </div>
                </div>,
                document.body,
            )}
        </>
    );
}
