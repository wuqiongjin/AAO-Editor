// 谱面代码弹窗（深模块，ADR-0003 §9 谱面代码为未来 AI 通道）：
// 封装「代码文本撤销栈 / 单向同步 / 校验 / 应用」为一整体，对外只读 hooks 直读领域状态。
// issue 37：由「常驻内嵌面板」改为「按需弹窗」——
//   * 单向同步：打开时「画布→代码」同步一次；应用时「代码→画布」；不随画布编辑实时同步。
//   * 打开才构建/渲染 textarea（成本归零）。
//   * 关闭即丢弃草稿：再次打开从画布全新同步，无残留状态泄漏。
// issue 59 §2–§6：同一个弹窗组件承载两种视图——
//   * 完整谱面代码视图（target.kind === 'chart'，永远不看选区）
//   * 对象视图（target.kind === 'note'：整条音符 / 滑条结点，§4 三种初值）
//   两级面包屑只向上返回（§6），Esc 逐档退：结点 → 滑条 → 完整代码 → 关弹窗。
// 文本变换逻辑下沉到 editing/CodeEditorOps（纯函数，可单测）。
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, RotateCcw, RefreshCw, X } from "lucide-react";
import {
    convertNotesToChartCode, chartCodeToJSON, parseChartCodeFromJSON, validateChartCodeJSON,
    formatValidationError, convertChartCodeToNotes, hasBeat0Bpm,
    type ChartCodeNote, type ValidationError,
} from '../../editing/ChartConverter';
import { buildNoteCode, applyNoteCode } from '../../editing/NoteCodeOps';
import { useEditing, usePlayback, useUI } from '../../../app/ProviderTree';
import { maxNoteEndSeconds, getBpmEvents } from '../../../audio/AudioTiming';
import {
    createHistory, pushHistory, undoHistory, redoHistory, currentHistory,
    type HistoryState,
} from '../../editing/History';
import {
    insertTab, insertNewlineIndent, cutRange, pasteAt,
    type TextEditRange,
} from '../../editing/CodeEditorOps';
import ActionBtn from '../../../ui/ActionBtn';
import { useChartCodeEditor, type CodeEditorTarget } from './ChartCodeEditorProvider';

// 错误列表最多展示的条数，其余折叠为「共 N 处」
const MAX_VISIBLE_ERRORS = 8;

interface Props {
    /** 当前视图目标（由 provider 持有，面包屑导航会换 target） */
    target: CodeEditorTarget;
}

export default function ChartCodeEditorModal({ target }: Props) {
    const { notes, handleNotesChange, selectedItems } = useEditing();
    const { canPlay, duration, setDuration } = usePlayback();
    const { beatDisplay } = useUI();
    const { openChartCode, openNoteCode, close } = useChartCodeEditor();

    // 代码文本真实撤销/重做：chartCode 由 textHistory 撤销栈派生（复用 History 纯模块）
    const [textHistory, setTextHistory] = useState<HistoryState<string>>(() => createHistory(""));
    const chartCode = currentHistory(textHistory);
    const [isValid, setIsValid] = useState(true);
    // 校验错误列表（issue 59 §1：一次收集全部，带定位路径；展示前 N 条 + 「共 N 处」）
    const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
    // dirty 基准：打开时（或应用后）同步的最新代码串
    const [lastAppliedCode, setLastAppliedCode] = useState("");
    // 打开/应用时的画布音符数，用于 dirty + canvas 变动的过期检测（单向同步下画布可能已变）
    const [appliedNotesCount, setAppliedNotesCount] = useState(notes.length);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const isChartView = target.kind === 'chart';
    // §4：结点视图 = 滑条某个 connection 的独立形态投影
    const isNodeView = target.kind === 'note' && target.connIndex !== undefined;

    // dirty = 代码文本与被同步的基准不一致（派生）
    const isDirty = chartCode !== lastAppliedCode;
    // 过期：有未应用草稿，且画布自上次同步后已变化（应用时需覆盖确认）
    const isStale = isDirty && notes.length !== appliedNotesCount;

    /** 重置草稿五件套（打开 / 换档 / 刷新 / 应用后都走同一落点，避免五处各写一遍） */
    const resetDraft = (jsonString: string) => {
        setTextHistory(createHistory(jsonString));
        setLastAppliedCode(jsonString);
        setAppliedNotesCount(notes.length);
        setIsValid(true);
        setValidationErrors([]);
    };

    /** 当前视图的代码初值（完整谱面 / 对象视图） */
    const currentViewCode = (): ChartCodeNote[] =>
        target.kind === 'chart'
            ? convertNotesToChartCode(notes)
            : buildNoteCode(notes, target) ?? [];

    // 打开 / 面包屑换档时重建草稿（单向「画布→代码」）。只依赖 target：
    // notes 变化不触发重同步（那是 isStale 的职责，由用户显式「从画布刷新」）。
    useEffect(() => {
        // 对象视图的目标已消失（谱面被改动 / System 无可展示代码）→ 直接关；
        // 完整代码视图允许空谱（`[]` 是合法起点，随后由保底 BPM 逻辑接管）。
        if (target.kind === 'note' && buildNoteCode(notes, target) === null) { close(); return; }
        resetDraft(chartCodeToJSON(currentViewCode()));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [target]);

    // 验证谱面代码：返回全部错误（空数组 = 合法）。
    // 走 validateChartCodeJSON 而不是 parseChartCodeFromJSON——后者遇语法错误返回 []，
    // 空数组"零错误"会让 JSON 语法错误在应用时被误报成"缺少第 0 拍 BPM"。
    const validateCode = (code: string): ValidationError[] => {
        const { errors } = validateChartCodeJSON(code);
        setIsValid(errors.length === 0);
        setValidationErrors(errors);
        return errors;
    };

    // 获取默认BPM音符的保底状态（仅完整代码视图有意义）
    const getDefaultBPMCode = () => {
        const defaultCode = convertNotesToChartCode([{ beat: 0, type: "BPM", bpm: 120 }]);
        return chartCodeToJSON(defaultCode);
    };

    // 关闭弹窗：有未应用草稿时确认（丢弃后关闭），否则直接关闭。
    // 同时就是 Esc 的语义 —— 对象视图**不再逐档退**（用户 2026-09-09 定案）：
    // 无论停在完整代码 / 整条音符 / 滑条结点哪一级，Esc 都是直接关弹窗；
    // 向上看走面包屑（`完整谱面代码 › 所属滑条 › 滑条结点代码`）上的按钮。
    const requestClose = () => {
        if (isDirty && !window.confirm('谱面代码有未应用的更改，关闭将丢弃这些更改，确定关闭？')) {
            return;
        }
        close();
    };

    // 弹窗打开期间接管 Esc（issue 57 bug3）：不让后面的左右侧栏折叠吃到。
    // window 捕获阶段监听、先于 useShortcutDispatch 的冒泡监听，stopPropagation 直接截断全局链路。
    const requestCloseRef = useRef(requestClose);
    requestCloseRef.current = requestClose;
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            // 忽略长按的自动重复（连发会连吃多档）
            if (e.repeat) return;
            e.preventDefault();
            e.stopPropagation();
            requestCloseRef.current();
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, []);

    // 处理代码变化：压入撤销栈；空代码（仅完整视图）回到保底状态
    const handleCodeChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newCode = event.target.value;

        // 空代码 → 保底状态（第0拍 120bpm）；对象视图没有"保底"概念，照实走校验
        if (newCode.trim() === '' && isChartView) {
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
        const errors = validateCode(chartCode);

        // 撞错 = 整份拒（issue 59 §1.2）：不回写画布，也不静默修正 / 丢弃草稿——
        // 错误全留在上方列表里，供用户对照逐条改。
        if (errors.length > 0) {
            alert(`谱面代码有 ${errors.length} 处错误，未应用（详见上方错误列表）`);
            return;
        }

        try {
            const parsedCode = parseChartCodeFromJSON(chartCode);

            // 对象视图（§5）：整条 = 恰好 1 条 + 合法 + 字段集匹配 → 替换原 noteIndex；
            //              结点 = 只接受 Single → 写回该 connection
            if (target.kind === 'note') {
                const r = applyNoteCode(notes, target, parsedCode);
                if (!r.ok) {
                    setIsValid(false);
                    setValidationErrors(r.errors);
                    alert(`有 ${r.errors.length} 处错误，未应用（详见上方错误列表）`);
                    return;
                }
                handleNotesChange(r.notes);
                close(); // 对象视图是"点谁看谁"，回写即完成
                return;
            }

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

    // 重置为默认BPM状态（仅完整代码视图）
    const handleReset = () => {
        const defaultCode = getDefaultBPMCode();
        setTextHistory(createHistory(defaultCode));
        setIsValid(true);
        setValidationErrors([]);
    };

    // 用画布刷新代码（丢弃草稿，从当前画布重新生成；单向同步下画布可能已变）
    const handleRefreshFromCanvas = () => {
        resetDraft(chartCodeToJSON(currentViewCode()));
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

    const title = isChartView ? '谱面代码编辑器' : isNodeView ? '滑条结点代码' : '音符代码';
    // §2：完整代码视图在选区 ≥2 时给一行非阻断提示（「谱面代码」按钮永远展示完整谱面）
    const showSelectionHint = isChartView && selectedItems.length >= 2;

    return createPortal(
        <div
            style={{
                position: 'fixed', inset: 0, zIndex: 'var(--z-modal)',
                backgroundColor: 'rgba(0,0,0,0.4)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onMouseDown={requestClose}
        >
            <div
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: 'min(920px, 92vw)', height: 'min(640px, 86vh)',
                    backgroundColor: 'var(--bg-elevated)',
                    border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
                    boxShadow: 'var(--shadow-lg)',
                    display: 'flex', flexDirection: 'column', overflow: 'hidden',
                }}
            >
                {/* 头部：标题 + 两级面包屑（§6 只向上返回）+ 关闭 */}
                <div style={{
                    padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                    backgroundColor: 'var(--bg)',
                }}>
                    {/* §6 面包屑：自左向右 = 顶层 → 当前（`完整谱面代码 › 所属滑条 › 滑条结点代码`）。
                        只向上返回、不下钻；末项是当前视图本身，不是按钮。 */}
                    {isChartView ? (
                        <h3 style={{ margin: 0, marginRight: 'auto', fontSize: 'var(--text-sm)', fontWeight: 600 }}>{title}</h3>
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', marginRight: 'auto' }}>
                            <button onClick={openChartCode} title="返回完整谱面代码" style={crumbButtonStyle}>完整谱面代码</button>
                            <span style={crumbSepStyle}>›</span>
                            {isNodeView ? (
                                <>
                                    <button
                                        onClick={() => openNoteCode({ noteIndex: target.noteIndex })}
                                        title="返回所属滑条"
                                        style={crumbButtonStyle}
                                    >所属滑条</button>
                                    <span style={crumbSepStyle}>›</span>
                                    <span style={crumbCurrentStyle}>滑条结点代码</span>
                                </>
                            ) : (
                                <span style={crumbCurrentStyle}>{title}</span>
                            )}
                        </div>
                    )}
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

                {/* 多选提示行（§2）：非阻断，仅说明本视图展示的是完整谱面 */}
                {showSelectionHint && (
                    <div style={{
                        padding: 'var(--space-2) var(--space-4)', backgroundColor: 'var(--accent-soft)',
                        borderBottom: '1px solid var(--border)', color: 'var(--accent-text)',
                        fontSize: 'var(--text-xs)',
                    }}>
                        已选 {selectedItems.length} 个音符，代码视图展示完整谱面；复制选中片段请用『复制为谱面代码』
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

                {/* 错误信息（一次列完全部，带定位路径；超过 MAX_VISIBLE_ERRORS 条折叠为「共 N 处」） */}
                {!isValid && validationErrors.length > 0 && (
                    <div style={{ padding: 'var(--space-3)', backgroundColor: 'var(--danger-soft)', borderBottom: '1px solid var(--danger)', color: 'var(--danger-text)' }}>
                        <h4 style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>
                            错误信息（共 {validationErrors.length} 处）:
                        </h4>
                        <ul style={{
                            margin: 0, paddingLeft: 'var(--space-4)', fontSize: 'var(--text-xs)',
                            display: 'flex', flexDirection: 'column', gap: 'var(--space-1)',
                            maxHeight: 132, overflowY: 'auto',
                        }}>
                            {validationErrors.slice(0, MAX_VISIBLE_ERRORS).map((error, index) => (
                                <li key={index}>• {formatValidationError(error)}</li>
                            ))}
                        </ul>
                        {validationErrors.length > MAX_VISIBLE_ERRORS && (
                            <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-xs)', opacity: 0.85 }}>
                                … 另有 {validationErrors.length - MAX_VISIBLE_ERRORS} 处未列出
                            </div>
                        )}
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
                    {/* 「重置」= 回到保底 BPM 谱面，只对完整代码视图有意义 */}
                    {isChartView && <ActionBtn onClick={handleReset}><RotateCcw size={16} />重置</ActionBtn>}
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
    );
}

/** 面包屑按钮样式（与头部同基调的轻量文字按钮） */
const crumbButtonStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 2,
    padding: '2px var(--space-2)',
    border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    backgroundColor: 'transparent', color: 'var(--text-muted)',
    fontFamily: 'inherit', fontSize: 'var(--text-xs)', cursor: 'pointer',
    transition: 'background-color var(--dur) var(--ease), color var(--dur) var(--ease)',
};

/** 面包屑分隔符 */
const crumbSepStyle: React.CSSProperties = {
    color: 'var(--text-subtle)', fontSize: 'var(--text-xs)', userSelect: 'none',
};

/** 面包屑末项 = 当前视图（不可点） */
const crumbCurrentStyle: React.CSSProperties = {
    padding: '2px var(--space-2)',
    color: 'var(--text)', fontSize: 'var(--text-xs)', fontWeight: 600,
};
