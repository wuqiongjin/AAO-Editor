// 谱面代码弹窗（深模块，ADR-0003 §9 谱面代码为未来 AI 通道）：
// 封装「代码文本撤销栈 / 单向同步 / 校验 / 应用」为一整体，对外只读 hooks 直读领域状态。
// issue 37：由「常驻内嵌面板」改为「按需弹窗」——
//   * 单向同步：打开时「画布→代码」同步一次；应用时「代码→画布」；不随画布编辑实时同步。
//   * 打开才构建/渲染 textarea（成本归零）。
//   * 关闭即丢弃草稿：再次打开从画布全新同步，无残留状态泄漏。
// issue 59 §2–§6：同一个弹窗组件承载两种视图——
//   * 完整谱面代码视图（target.kind === 'chart'，永远不看选区）
//   * 对象视图（target.kind === 'note'：整条音符 / 滑条结点，§4 三种初值）
//   * issue 94：对象视图展示 = 裸 JSON 对象（无外层 `[]`）；输入容错裸对象/数组（coerceNoteViewCode）
//   两级面包屑只向上返回（§6），Esc 逐档退：结点 → 滑条 → 完整代码 → 关弹窗。
// 文本变换逻辑下沉到 editing/CodeEditorOps（纯函数，可单测）。
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Download, RotateCcw, RefreshCw, X } from "lucide-react";
import {
    convertNotesToChartCode, chartCodeToJSON, parseChartCodeFromJSON, validateChartCodeJSON,
    formatValidationError, convertChartCodeToNotes, hasBeat0Bpm,
    type ChartCodeNote, type ValidationError,
} from '../../editing/ChartConverter';
import { buildNoteCode, applyNoteCode, noteViewCodeToJSON, coerceNoteViewCode, validateNoteViewCodeText } from '../../editing/NoteCodeOps';
import { useEditing, usePlayback, useUI } from '../../../app/ProviderTree';
import { t, tPlural } from '../../../i18n';
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
import { exportChartCodeSaveAs } from '../../project/exportChartCode';

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
    // issue 69：面包屑改用 trail（记住的深层）+ navigate（只切视图、不动 trail）
    const { trail, navigate, close } = useChartCodeEditor();

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
    // issue 93：子段视图 = span 且**无** connIndex（span + connIndex 并存是结点入口的 trail 形态，显示结点视图）
    const isSegmentView = target.kind === 'note' && target.span !== undefined && target.connIndex === undefined;

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

    // 当前视图的代码文本初值（issue 94：对象视图 = 裸对象 JSON，无外层 []；完整视图 = 数组）
    const currentViewText = () => {
        const code = currentViewCode();
        return isChartView ? chartCodeToJSON(code) : noteViewCodeToJSON(code);
    };

    // 打开 / 面包屑换档时重建草稿（单向「画布→代码」）。只依赖 target：
    // notes 变化不触发重同步（那是 isStale 的职责，由用户显式「从画布刷新」）。
    useEffect(() => {
        // 对象视图的目标已消失（谱面被改动 / System 无可展示代码）→ 直接关；
        // 完整代码视图允许空谱（`[]` 是合法起点，随后由保底 BPM 逻辑接管）。
        if (target.kind === 'note' && buildNoteCode(notes, target) === null) { close(); return; }
        resetDraft(currentViewText());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [target]);

    // 验证谱面代码：返回全部错误（空数组 = 合法）。
    // 完整视图走 validateChartCodeJSON 而不是 parseChartCodeFromJSON——后者遇语法错误返回 []，
    // 空数组"零错误"会让 JSON 语法错误在应用时被误报成"缺少第 0 拍 BPM"。
    // 对象视图（issue 94）：先容错裸对象/数组（validateNoteViewCodeText），再走同一套规则。
    const validateCode = (code: string): ValidationError[] => {
        const { errors } = isChartView
            ? validateChartCodeJSON(code)
            : { errors: validateNoteViewCodeText(code) };
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
    // 向上看走面包屑（`完整谱面代码 › 所属滑条 › 音符代码`）上的按钮。
    const requestClose = () => {
        if (isDirty && !window.confirm(t('chartCode.confirmClose'))) {
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

    // 对象视图回写被拒（coerce/回写校验不过）：错误全留在上方列表，弹 alert 后停在当前视图
    const rejectNoteApply = (errors: ValidationError[]) => {
        setIsValid(false);
        setValidationErrors(errors);
        alert(tPlural('chartCode.alertErrors', errors.length));
    };

    // 应用谱面代码：经 useEditing.handleNotesChange 走历史记录（单向「代码→画布」）
    const handleApply = () => {
        const errors = validateCode(chartCode);

        // 撞错 = 整份拒（issue 59 §1.2）：不回写画布，也不静默修正 / 丢弃草稿——
        // 错误全留在上方列表里，供用户对照逐条改。
        if (errors.length > 0) {
            alert(tPlural('chartCode.alertErrorsApply', errors.length));
            return;
        }

        try {
            // 对象视图（§5）：整条 = 恰好 1 条 + 合法 + 字段集匹配 → 替换原 noteIndex；
            //              结点 = 只接受 Single → 写回该 connection。
            // issue 94：裸对象 / 单元素数组都接受（coerce 统一成数组后走既有回写校验）
            if (target.kind === 'note') {
                const coerced = coerceNoteViewCode(chartCode);
                if (!coerced.ok) { rejectNoteApply(coerced.errors); return; }
                const r = applyNoteCode(notes, target, coerced.code);
                if (!r.ok) { rejectNoteApply(r.errors); return; }
                handleNotesChange(r.notes);
                close(); // 对象视图是"点谁看谁"，回写即完成
                return;
            }

            const parsedCode = parseChartCodeFromJSON(chartCode);

            // 强制校验：beat0 必须有 BPM 音符（保底语义，ADR-0001 谱面必须有初始 BPM）
            if (!hasBeat0Bpm(parsedCode)) {
                alert(t('chartCode.needBpm0'));
                return;
            }
            // 覆盖风险确认：画布已在草稿之后被改动
            if (isStale) {
                const delta = Math.abs(notes.length - appliedNotesCount);
                if (!window.confirm(t('chartCode.confirmOverwrite', { count: delta }))) {
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
            alert(t('chartCode.applyOk'));
        } catch (error) {
            alert(t('chartCode.applyFail', { message: (error as Error).message }));
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
        resetDraft(currentViewText());
    };

    // 复制到剪贴板
    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(chartCode);
            alert(t('chartCode.copyOk'));
        } catch (error) {
            alert(t('chartCode.copyFail', { message: (error as Error).message }));
        }
    };

    // issue 118：另存为当前画布谱面（忽略弹窗草稿）
    const handleSaveAs = async () => {
        try {
            await exportChartCodeSaveAs(notes);
        } catch (error) {
            alert(t('chartCode.exportFail', { message: (error as Error).message }));
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

    // issue 69：面包屑第 2 档文案 —— trail 是滑条结点或子段 → 其父级为"所属滑条"；trail 是整条音符 → "音符代码"
    const crumb2Label = trail?.connIndex !== undefined || trail?.span !== undefined ? t('chartCode.slideParent') : t('chartCode.note');
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
                        {/* §6 面包屑：自左向右 = 顶层 → 当前（issue 93 起四档：
                            `完整谱面代码 › 所属滑条 › 子段代码 › 音符代码`，单段滑条无"子段代码"档；
                            issue 95：层名由视图决定、与入口无关 —— 段视图恒「子段代码」、结点视图恒「音符代码」。），
                            **永远显示**（连完整谱面代码视图也有 —— 旧实现那里只有个 <h3> 标题）。
                        issue 69：档位由 **trail**（记住的深层）决定，而不是由当前视图决定 ——
                        于是从 node 一路点回 chart 后，面包屑仍保留「所属滑条 / 音符代码」两档，
                        用户能再点回去（解决"回不去了"）。
                        · 当前层 = 加粗、不可点（用于"显示出当前在哪个层级"）
                        · 其余档 = 可点，各层间随意切换
                        · **不加"‹ 返回"按钮**（用户口径）：切换能力由面包屑项本身承担。 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', marginRight: 'auto' }}>
                        {/* 第 1 档：完整谱面代码 */}
                        {isChartView ? (
                            <span style={crumbCurrentStyle}>{t('chartCode.full')}</span>
                        ) : (
                            <button onClick={() => navigate({ kind: 'chart' })} title={t('chartCode.full')} style={crumbButtonStyle}>{t('chartCode.full')}</button>
                        )}
                        {/* 第 2 档：本次会话进过深层才有（trail） */}
                        {trail && (
                            <>
                                <span style={crumbSepStyle}>›</span>
                                {!isChartView && !isNodeView && !isSegmentView ? (
                                    <span style={crumbCurrentStyle}>{crumb2Label}</span>
                                ) : (
                                    <button
                                        onClick={() => navigate({ kind: 'note', noteIndex: trail.noteIndex })}
                                        title={crumb2Label}
                                        style={crumbButtonStyle}
                                    >{crumb2Label}</button>
                                )}
                            </>
                        )}
                        {/* 第 3 档（issue 93）：trail 记过子段（span）才有 —— 该逻辑段序列化为独立 Slide 代码。
                            单段滑条不产生 span（与整条层内容相同，冗余）→ 此档自然不出现。 */}
                        {trail?.span !== undefined && (
                            <>
                                <span style={crumbSepStyle}>›</span>
                                {isSegmentView ? (
                                    <span style={crumbCurrentStyle}>{t('chartCode.segment')}</span>
                                ) : (
                                    <button
                                        onClick={() => navigate({ kind: 'note', noteIndex: trail.noteIndex, span: trail.span })}
                                        title={t('chartCode.segment')}
                                        style={crumbButtonStyle}
                                    >{t('chartCode.segment')}</button>
                                )}
                            </>
                        )}
                        {/* 第 4 档：trail 是滑条结点时才有（issue 95：档名统一为「音符代码」） */}
                        {trail?.connIndex !== undefined && (
                            <>
                                <span style={crumbSepStyle}>›</span>
                                {isNodeView ? (
                                    <span style={crumbCurrentStyle}>{t('chartCode.note')}</span>
                                ) : (
                                    <button
                                        onClick={() => navigate({ kind: 'note', noteIndex: trail.noteIndex, connIndex: trail.connIndex })}
                                        title={t('chartCode.note')}
                                        style={crumbButtonStyle}
                                    >{t('chartCode.note')}</button>
                                )}
                            </>
                        )}
                    </div>
                    <button
                        onClick={requestClose}
                        title={t('chartCode.close')}
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
                        {t('chartCode.selectionHint', { count: selectedItems.length })}
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
                            {t('chartCode.stale', { count: Math.abs(notes.length - appliedNotesCount) })}
                        </span>
                        <ActionBtn onClick={handleRefreshFromCanvas}><RefreshCw size={14} />{t('chartCode.refreshCanvas')}</ActionBtn>
                    </div>
                )}

                {/* 错误信息（一次列完全部，带定位路径；超过 MAX_VISIBLE_ERRORS 条折叠为「共 N 处」） */}
                {!isValid && validationErrors.length > 0 && (
                    <div style={{ padding: 'var(--space-3)', backgroundColor: 'var(--danger-soft)', borderBottom: '1px solid var(--danger)', color: 'var(--danger-text)' }}>
                        <h4 style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>
                            {t('chartCode.errorsTitle', { count: validationErrors.length })}
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
                                {t('chartCode.errorsMore', { count: validationErrors.length - MAX_VISIBLE_ERRORS })}
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
                        placeholder={t('chartCode.placeholder')}
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
                    <ActionBtn onClick={handleApply} disabled={!isValid} variant="primary">{t('chartCode.apply')}</ActionBtn>
                    <ActionBtn onClick={handleRefreshFromCanvas}><RefreshCw size={16} />{t('chartCode.refresh')}</ActionBtn>
                    {isChartView && <ActionBtn onClick={handleReset}><RotateCcw size={16} />{t('chartCode.reset')}</ActionBtn>}
                    <ActionBtn onClick={handleCopy}><Copy size={16} />{t('chartCode.copy')}</ActionBtn>
                    <ActionBtn onClick={handleSaveAs}><Download size={16} />{t('chartCode.saveAs')}</ActionBtn>
                    {isDirty && (
                        <span style={{ color: 'var(--warning)', fontSize: 'var(--text-xs)' }}>{t('chartCode.dirty')}</span>
                    )}
                    <span style={{ flex: 1 }} />
                    <ActionBtn onClick={requestClose}>{t('chartCode.close')}</ActionBtn>
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
