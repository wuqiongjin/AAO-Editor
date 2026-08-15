// 谱面代码编辑器（深模块，ADR-0003 §9 谱面代码为未来 AI 通道）：
// 封装「代码文本撤销栈 / 双向同步 / 校验 / 应用」为一整体，对外只读 hooks 直读领域状态。
// 文本变换逻辑下沉到 utils/CodeEditorOps（纯函数，可单测）。
import { useState, useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, Copy, RotateCcw, RefreshCw } from "lucide-react";
import { convertNotesToChartCode, chartCodeToJSON, parseChartCodeFromJSON, validateChartCode, convertChartCodeToNotes, hasBeat0Bpm } from "../utils/ChartConverter";
import { useEditing, usePlayback, useUI } from "../contexts";
import { maxNoteEndSeconds, getBpmEvents } from "../utils/AudioTiming";
import type { ChartNote } from "../notes/Charts";
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

    // 代码文本真实撤销/重做：chartCode 由 textHistory 撤销栈派生（复用 History 纯模块）
    const [textHistory, setTextHistory] = useState<HistoryState<string>>(() => createHistory(""));
    const chartCode = currentHistory(textHistory);
    const [isCodeEditorCollapsed, setIsCodeEditorCollapsed] = useState(false);
    const [isValid, setIsValid] = useState(true);
    const [validationErrors, setValidationErrors] = useState<string[]>([]);
    const [lastAppliedCode, setLastAppliedCode] = useState("");
    // 上次应用/同步时的画布音符数，用于 dirty + canvas 变动的过期检测
    const [appliedNotesCount, setAppliedNotesCount] = useState(notes.length);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    // 记录上次生成代码所依据的 notes，仅当 notes 真正变化时才重建代码（避免撤销到已应用态时误清撤销栈）
    const prevNotesRef = useRef<ChartNote[] | null>(null);
    // dirty = 代码草稿与上次应用状态不一致（派生，随 chartCode/lastAppliedCode 自动更新）
    const isDirty = chartCode !== lastAppliedCode;
    // 过期：用户有未应用草稿，且画布自上次同步后已变化
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

    // 当音符数据变化时更新代码（非 dirty 时同步；dirty 时保留用户草稿）。
    // 仅当 notes 真正变化（或首次）才重建代码——撤销到已应用态时 isDirty 会变 false，
    // 但 notes 未变，不应重建（否则会清空文本撤销栈，抹掉 redo 分支）。
    // issue 35 F5：画布→代码同步防抖 250ms——密集音符下每次编辑都全量
    // convertNotesToChartCode + chartCodeToJSON（≈100KB+ 字符串）+ textarea 全量赋值，
    // 是放置卡顿主因之一；连续编辑只在停顿后重建一次。首次挂载仍立即同步。
    // prevNotesRef 只在重建真正发生时才推进：防抖期间用户转为 dirty 取消了本次同步，
    // 之后 isDirty 回落时 notesChanged 仍为 true，代码最终会与画布一致（不留陈旧态）。
    useEffect(() => {
        if (isDirty) return;
        const firstRun = prevNotesRef.current === null;
        const notesChanged = prevNotesRef.current !== notes;
        if (!(firstRun || notesChanged)) return;
        const build = () => {
            const code = convertNotesToChartCode(notes);
            const jsonString = chartCodeToJSON(code);
            setTextHistory(createHistory(jsonString));
            setLastAppliedCode(jsonString);
            setAppliedNotesCount(notes.length);
            prevNotesRef.current = notes;
        };
        if (firstRun) {
            build();
            return;
        }
        const timer = window.setTimeout(build, 250);
        return () => window.clearTimeout(timer);
    }, [notes, isDirty]);

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

    // 应用谱面代码：经 useEditing.handleNotesChange 走历史记录
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

    // 用画布刷新代码（丢弃草稿，从当前画布重新生成）
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
        <div style={{
            backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-sm)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            flex: isCodeEditorCollapsed ? '0 0 auto' : 1, minHeight: isCodeEditorCollapsed ? 'auto' : 0,
        }}>
            <div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0, fontSize: 'var(--text-sm)', fontWeight: 600 }}>谱面代码编辑器</h3>
                <button
                    onClick={() => setIsCodeEditorCollapsed(!isCodeEditorCollapsed)}
                    title={isCodeEditorCollapsed ? "展开" : "折叠"}
                    style={{
                        width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                        backgroundColor: 'transparent', color: 'var(--text-muted)',
                        transition: 'background-color var(--dur) var(--ease), color var(--dur) var(--ease)',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                    {isCodeEditorCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </button>
            </div>

            {!isCodeEditorCollapsed && (
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
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

                    {/* 代码编辑器 */}
                    <div style={{ flex: 1, padding: 'var(--space-3)', minHeight: 0 }}>
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
                        <ActionBtn onClick={handleReset}><RotateCcw size={16} />重置</ActionBtn>
                        <ActionBtn onClick={handleCopy}><Copy size={16} />复制</ActionBtn>
                        {isDirty && (
                            <span style={{ color: 'var(--warning)', fontSize: 'var(--text-xs)' }}>未保存的更改</span>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
