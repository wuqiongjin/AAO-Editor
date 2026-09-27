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
// issue 102：打开、以及在代码框里输入，都不再同步跑全量重活（详见下方两段式填充 / 输入校验防抖 / 非受控 textarea）。
// 文本变换逻辑下沉到 editing/CodeEditorOps（纯函数，可单测）。
import { useEffect, useRef, useState, startTransition } from "react";
import { createPortal } from "react-dom";
import { Copy, Download, RotateCcw, RefreshCw, X } from "lucide-react";
import {
    convertNotesToChartCode, chartCodeToCompactJSON, normalizeChartCodeText,
    parseChartCodeFromJSON, validateChartCodeJSON,
    formatValidationError, convertChartCodeToNotes, hasBeat0Bpm,
    type ValidationError, type ChartCodeNote,
} from '../../editing/ChartConverter';
import { buildNoteCode, applyNoteCode, noteViewCodeToJSON, coerceNoteViewCode, validateNoteViewCodeText } from '../../editing/NoteCodeOps';
import { useEditing, usePlayback, useUI, useAudioSession } from '../../../app/ProviderTree';
import { t, tPlural } from '../../../i18n';
import { maxNoteEndSeconds, getBpmEvents } from '../../../audio/AudioTiming';
import {
    createHistory, pushHistoryIfChanged, undoHistory, redoHistory, currentHistory,
    TEXT_HISTORY_CAP, type HistoryState,
} from '../../editing/History';
import {
    insertTab, insertNewlineIndent, cutRange, pasteAt,
    type TextEditRange,
} from '../../editing/CodeEditorOps';
import { createDebouncedTask } from '../../editing/DebouncedTask';
import { scheduleIdle } from '../../editing/IdleSchedule';
import ActionBtn from '../../../ui/ActionBtn';
import ConfirmDialog from '../../../ui/ConfirmDialog';
import { useChartCodeEditor, type CodeEditorTarget } from './ChartCodeEditorProvider';
import { exportChartCodeSaveAs } from '../../project/exportChartCode';
import type { ChartNote } from '../../types';

// 错误列表最多展示的条数，其余折叠为「共 N 处」
const MAX_VISIBLE_ERRORS = 8;
/**
 * 输入校验防抖窗口（issue 102）：在代码框里打字，停手 250ms 才真正校验一次。
 * 每敲一个字都全量 `JSON.parse` + 逐条 `validateChartCode` 是重复劳动：连续打字时只有**最后一次**
 * 的结论有意义。250ms 静默后跑一次，既保住错误反馈，又不占输入带宽。
 */
const VALIDATE_DEBOUNCE_MS = 250;
/** 空闲调度兜底：requestIdleCallback 若长期没空档，最多等这么久也一定要填充文本 */
const IDLE_TIMEOUT_MS = 300;

interface Props {
    /** 当前视图目标（由 provider 持有，面包屑导航会换 target） */
    target: CodeEditorTarget;
    readOnly?: boolean;
    onReadonlyReject?: () => void;
}

export default function ChartCodeEditorModal({ target, readOnly, onReadonlyReject }: Props) {
    const { notes, handleNotesChange, selectedItems, chartCodePristine, appliedChartCodeText, rememberAppliedChartCode } = useEditing();
    const { canPlay } = usePlayback();
    // issue 145 #2：谱面时长的单一真相源是 AudioSession，播放条的 duration 只是它的同步下游。
    // 读/写都走 session，否则音频页的数字与这里的判断基准会各说一套。
    const [audioSnap, session] = useAudioSession();
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
    // issue 102：文本尚未填充的空壳期（序列化 + stringify 还没跑完）。
    // true 期间右上角 / 应用按钮 / dirty 一律按"还没内容"处理，不把 loading 当成"草稿为空"。
    const [generating, setGenerating] = useState(true);
    // 两处确认改成「先问后做」：弹窗等用户点键，待办先存在这里，确认了才往下走
    const [askClose, setAskClose] = useState(false);
    const [askOverwrite, setAskOverwrite] = useState<{ delta: number; code: ChartCodeNote[]; text: string } | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    // issue 102：输入校验的防抖体（打字停手后才跑）。组件不禁 SSR，构造走惰性 useState（不每次渲染重建）。
    const [validationTask] = useState(() => createDebouncedTask(VALIDATE_DEBOUNCE_MS));
    const idleCancelRef = useRef<(() => void) | null>(null);
    // issue 102：target effect 的依赖只有 target（notes 变化不重同步），它的闭包因此是那一轮的 notes。
    // 空闲回调要按**填充那一刻**的画布生成文本 / 记 appliedNotesCount，故留一份最新引用。
    const notesRef = useRef(notes);
    notesRef.current = notes;

    const isChartView = target.kind === 'chart';
    // §4：结点视图 = 滑条某个 connection 的独立形态投影
    const isNodeView = target.kind === 'note' && target.connIndex !== undefined;
    // issue 93：子段视图 = span 且**无** connIndex（span + connIndex 并存是结点入口的 trail 形态，显示结点视图）
    const isSegmentView = target.kind === 'note' && target.span !== undefined && target.connIndex === undefined;

    // dirty = 代码文本与被同步的基准不一致（派生）。
    // 空壳期不入 dirty：那时还没生成过文本，不能拿空串当"草稿被清空"去弹关闭确认。
    const isDirty = !generating && chartCode !== lastAppliedCode;
    // 过期：有未应用草稿，且画布自上次同步后已变化（应用时需覆盖确认）
    const isStale = isDirty && notes.length !== appliedNotesCount;

    /**
     * 重置草稿五件套（打开 / 换档 / 刷新 / 应用后都走同一落点，避免五处各写一遍）。
     * `snapshotCount` 显式传入而不是读 `notes.length`：填充发生在空闲回调里，
     * 那时 effect 闭包里的 `notes` 已经可能是上一轮的（详见 notesRef）。
     */
    const resetDraft = (jsonString: string, snapshotCount: number) => {
        setTextHistory(createHistory(jsonString));
        setLastAppliedCode(jsonString);
        setAppliedNotesCount(snapshotCount);
        setIsValid(true);
        setValidationErrors([]);
    };

    /**
     * 当前视图的代码文本（issue 94：对象视图 = 裸对象 JSON，无外层 []；完整视图 = 数组）。
     * 画布**显式入参**而非取闭包 —— 同上：调用点在空闲回调里，必须拿那一刻的最新画布。
     */
    const currentViewText = (snapshot: ChartNote[]): string => {
        const code = target.kind === 'chart'
            ? convertNotesToChartCode(snapshot)
            : buildNoteCode(snapshot, target) ?? [];
        // 完整视图走「每条音符一行」：行数才是大文本框排版成本的主导项（见 ChartConverter 注释）；
        // 对象视图只有一条音符，继续用可读缩进。
        return isChartView ? chartCodeToCompactJSON(code) : noteViewCodeToJSON(code);
    };

    /**
     * 重新从画布生成当前视图文本（打开 / 换档 / 「从画布刷新」共用）。
     *
     * issue 102 两段式：**先出空壳，再填空**。生成整份代码 + 写进文本框是大谱面上的一次重活，
     * 同步做会把弹窗首帧一起拖住。故：
     *   ① 同步阶段只清空并标记 generating → 弹窗骨架（含占位符）立即上屏；
     *   ② 空闲后再算文本，放进 `startTransition` 里落进撤销栈（可被后续交互打断）。
     * 填充本身仍是一次性开销，只是不再挡住"弹窗出现"。
     */
    const regenerateDraft = () => {
        idleCancelRef.current?.();
        // 换档时上一视图可能还挂着待跑的校验：撤掉它，否则它会带着**旧代码**在新视图上落地
        validationTask.cancel();
        setGenerating(true);
        setTextHistory(createHistory(""));
        // `scheduleIdle`：优先 requestIdleCallback（不抢首帧 / 不抢画布动画），退化 setTimeout(0)；
        // IDLE_TIMEOUT_MS = 主线程持续繁忙时的兜底等待上限。返回的取消函数由 effect cleanup 收掉。
        idleCancelRef.current = scheduleIdle(() => {
            const snapshot = notesRef.current;
            const text = currentViewText(snapshot);
            startTransition(() => {
                resetDraft(text, snapshot.length);
                setGenerating(false);
            });
        }, IDLE_TIMEOUT_MS);
    };

    // 打开 / 面包屑换档时重建草稿（单向「画布→代码」）。只依赖 target：
    // notes 变化不触发重同步（那是 isStale 的职责，由用户显式「从画布刷新」）。
    useEffect(() => {
        // 对象视图的目标已消失（谱面被改动 / System 无可展示代码）→ 直接关；
        // 完整代码视图允许空谱（`[]` 是合法起点，随后由保底 BPM 逻辑接管）。
        if (target.kind === 'note' && buildNoteCode(notes, target) === null) { close(); return; }
        regenerateDraft();
        return () => { idleCancelRef.current?.(); idleCancelRef.current = null; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [target]);

    // 卸载时收掉待跑的校验（以及它可能还在计时的 timer）
    useEffect(() => () => validationTask.cancel(), [validationTask]);

    /**
     * issue 102：textarea 改走**非受控**。
     *
     * 受控 `value={chartCode}` 的代价是：**每敲一个字都可能把整份大文本重写回 DOM**
     * （`node.value = <整份>` 连带全量重排），代价随谱面大小线性涨。
     * 现在 DOM 文本由浏览器自己维护，React 侧文本（history）只是"影子副本"；
     * 只有两者不一致时才写一次 DOM —— 那只发生在程序化改动（填充 / 撤销 / 重做 / 重置 / 刷新 / Tab / 粘贴）。
     * 用户正常键入不会触发这条分支，因此输入延迟与谱面规模解耦。
     */
    useEffect(() => {
        const ta = textareaRef.current;
        if (!ta || ta.value === chartCode) return;
        ta.value = chartCode;
    }, [chartCode]);

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
        return chartCodeToCompactJSON(defaultCode);
    };

    // 关闭弹窗：有未应用草稿时确认（丢弃后关闭），否则直接关闭。
    // 同时就是 Esc 的语义 —— 对象视图**不再逐档退**（用户 2026-09-09 定案）：
    // 无论停在完整代码 / 整条音符 / 滑条结点哪一级，Esc 都是直接关弹窗；
    // 向上看走面包屑（`完整谱面代码 › 所属滑条 › 音符代码`）上的按钮。
    // 确认弹窗已经开着的话，这次触发（Esc / 点遮罩）归弹窗自己：
    // 不再问第二次，也不能顺势把本弹窗关掉（草稿还没处置）。
    const requestClose = () => {
        if (askClose || askOverwrite) return;
        if (isDirty) {
            setAskClose(true);
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
            validationTask.cancel();
            setIsValid(true);
            setValidationErrors([]);
            return;
        }

        // 压入撤销栈（真实文本撤销/重做）
        setTextHistory(prev => pushHistoryIfChanged(prev, newCode, Object.is, TEXT_HISTORY_CAP));
        // issue 102：只验证格式，不自动回退；且**不敲一个字就校验一次** ——
        // 全量 parse + 逐条校验等到静默 250ms 后跑一次（连打只留最后一次）。
        // 「应用」会即时结算（`handleApply` 里 cancel + 同步验证），不受防抖影响。
        validationTask.schedule(() => validateCode(newCode));
    };

    // 对象视图回写被拒（coerce/回写校验不过）：错误全留在上方列表，弹 alert 后停在当前视图
    const rejectNoteApply = (errors: ValidationError[]) => {
        setIsValid(false);
        setValidationErrors(errors);
        alert(tPlural('chartCode.alertErrors', errors.length));
    };

    /** 应用失败的统一出口：回滚文本 + 清掉错误列表，两条入口（直接应用 / 确认后应用）共用 */
    const failApply = (error: unknown) => {
        alert(t('chartCode.applyFail', { message: (error as Error).message }));
        setTextHistory(createHistory(lastAppliedCode));
        setIsValid(true);
        setValidationErrors([]);
    };

    /**
     * 回写画布这一步：覆盖是「问完才做」的，所以直接应用与确认后应用两条入口
     * 都得走同一个出口 —— 成功与失败两种收尾都在这一个函数里。
     */
    const commitApply = (parsedCode: ChartCodeNote[], text: string) => {
        try {
            const newNotes = convertChartCodeToNotes(parsedCode);
            handleNotesChange(newNotes);
            rememberAppliedChartCode(text);
            // ADR-0005 §4.5：无音频导入谱面代码时，若代码比当前谱面长度更长，自动延长谱面长度到代码最后音符结束时间
            if (!canPlay) {
                const endSeconds = maxNoteEndSeconds(newNotes, beatDisplay, getBpmEvents(newNotes));
                // issue 145 #2：谱面时长的单一真相源是 AudioSession（`useAudioBridge` 单向 session → PlaybackContext）。
                // 此前只写 PlaybackContext → 音频页「谱面时长」不跟着变，且 session 下次 emit 会把旧值反向覆盖回来。
                if (endSeconds > audioSnap.chartDuration) {
                    session.setChartDuration(endSeconds);
                }
            }
            setLastAppliedCode(text);
            setAppliedNotesCount(newNotes.length);
            setTextHistory(createHistory(text));
            alert(t('chartCode.applyOk'));
        } catch (error) {
            failApply(error);
        }
    };

    // 应用谱面代码：经 useEditing.handleNotesChange 走历史记录（单向「代码→画布」）
    const handleApply = () => {
        if (readOnly) {
            onReadonlyReject?.();
            return;
        }
        // 应用必须拿**当下**的结论：撤掉防抖里那次待跑的校验（跑的话也只是覆盖同样的结论）
        validationTask.cancel();
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
            // 覆盖风险确认：画布已在草稿之后被改动，覆盖是有损操作 —— 问完才回写
            if (isStale) {
                setAskOverwrite({
                    delta: Math.abs(notes.length - appliedNotesCount),
                    code: parsedCode,
                    text: chartCode,
                });
                return;
            }
            commitApply(parsedCode, chartCode);
        } catch (error) {
            failApply(error);
        }
    };

    // 重置为默认BPM状态（仅完整代码视图）
    const handleReset = () => {
        const defaultCode = getDefaultBPMCode();
        validationTask.cancel();
        setTextHistory(createHistory(defaultCode));
        setIsValid(true);
        setValidationErrors([]);
    };

    // 用画布刷新代码（丢弃草稿，从当前画布重新生成；单向同步下画布可能已变）。
    // issue 102：大谱面的重新生成同样成本高，走与打开一致的两段式。
    const handleRefreshFromCanvas = () => {
        validationTask.cancel();
        regenerateDraft();
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

    // 另存为：一律**按画布**生成（不导出未应用的草稿）；
    // 范围随**当前档位**走 —— 完整谱面视图存整份，对象视图只存这一层（整条 / 子段 / 结点）。
    const handleSaveAs = async () => {
        try {
            await exportChartCodeSaveAs(
                notes,
                isChartView ? undefined : target,
                isChartView && chartCodePristine ? appliedChartCodeText : undefined,
            );
        } catch (error) {
            alert(t('chartCode.exportFail', { message: (error as Error).message }));
        }
    };

    // 文本编辑后更新文本并恢复选区。
    // issue 102：非受控 textarea 下这里**直接写 DOM**（连同选区一次到位），
    // 再由 setTextHistory 同步影子副本；写完后两值相等，同步 effect 不会二次重写。
    const applyTextEdit = (next: TextEditRange) => {
        const ta = textareaRef.current;
        if (ta) {
            ta.value = next.value;
            ta.selectionStart = next.start;
            ta.selectionEnd = next.end;
        }
        setTextHistory(prev => pushHistoryIfChanged(prev, next.value, Object.is, TEXT_HISTORY_CAP));
        // 这些变换不走 onChange，得自己排一次校验（仍走防抖）
        validationTask.schedule(() => validateCode(next.value));
    };

    /** 撤销/重做也要重排校验：否则错误列表与「应用」可用性会停留在回退前的结论上 */
    const restoreFromHistory = (move: (state: HistoryState<string>) => HistoryState<string> | null) => {
        const next = move(textHistory);
        if (!next) return;
        setTextHistory(next);
        validationTask.schedule(() => validateCode(currentHistory(next)));
    };

    // 处理键盘输入：文本变换走 CodeEditorOps 纯函数；撤销/重做走文本撤销栈；剪贴板走 navigator
    const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        const ta = event.currentTarget;
        // issue 102：`ta.value` 的读取是 O(文本长度)（860KB 级），普通键入键用不到它 ——
        // 改成按需构造，避免为了一个用不上的 range 每键都把全文读出来。
        const rangeOf = (): TextEditRange => ({ value: ta.value, start: ta.selectionStart, end: ta.selectionEnd });

        if (event.ctrlKey || event.metaKey) {
            const range = rangeOf();
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
                    // 粘贴：外部代码常是多行缩进的，原样落进来会让行数翻几倍、之后每敲一个字都按那个行数付费。
                    // 完整视图下若粘的是合法谱面代码数组 → 重排成「每条一行」；
                    // 解析不过 / 对象视图 → 原样插入，一个字不改（用户要自己改完的半成品不能被改写）。
                    event.preventDefault();
                    navigator.clipboard.readText().then(text => applyTextEdit(
                        pasteAt(range, isChartView ? normalizeChartCodeText(text) : text),
                    ));
                    break;
                case 'z':
                    // 撤销文本编辑（真实撤销栈，仅作用代码文本，不碰谱面）
                    event.preventDefault();
                    restoreFromHistory(undoHistory);
                    break;
                case 'y':
                    // 重做文本编辑（真实重做栈）
                    event.preventDefault();
                    restoreFromHistory(redoHistory);
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
            applyTextEdit(insertTab(rangeOf()));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            applyTextEdit(insertNewlineIndent(rangeOf()));
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
                    {/* issue 102：**非受控**（不传 value）——文本由 DOM 自己持有，
                        只在 React 侧文本与 DOM 不一致时由上面的 effect 写一次，详见该 effect 注释。 */}
                    <textarea
                        ref={textareaRef}
                        onChange={handleCodeChange}
                        onKeyDown={handleKeyDown}
                        // 空壳期只读：此时文本还没生成，用户打进去的字会被随后填充覆盖
                        readOnly={generating}
                        spellCheck={false}
                        placeholder={generating ? t('chartCode.generating') : t('chartCode.placeholder')}
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
                    {/* 空壳期不可应用：那时 chartCode 还是空串，应用会把谱面清空 */}
                    <ActionBtn onClick={handleApply} disabled={!isValid || generating} variant="primary">{t('chartCode.apply')}</ActionBtn>
                    <ActionBtn onClick={handleRefreshFromCanvas}><RefreshCw size={16} />{t('chartCode.refresh')}</ActionBtn>
                    {/* 空壳期：复制会把空串当内容写进剪贴板、重置会被随后填充覆盖 —— 都先禁用 */}
                    {isChartView && <ActionBtn onClick={handleReset} disabled={generating}><RotateCcw size={16} />{t('chartCode.reset')}</ActionBtn>}
                    <ActionBtn onClick={handleCopy} disabled={generating}><Copy size={16} />{t('chartCode.copy')}</ActionBtn>
                    <ActionBtn onClick={handleSaveAs}><Download size={16} />{t('chartCode.saveAs')}</ActionBtn>
                    {isDirty && (
                        <span style={{ color: 'var(--warning)', fontSize: 'var(--text-xs)' }}>{t('chartCode.dirty')}</span>
                    )}
                    <span style={{ flex: 1 }} />
                    <ActionBtn onClick={requestClose}>{t('chartCode.close')}</ActionBtn>
                </div>
            </div>
            {/* 两处确认弹窗（丢弃草稿 / 覆盖应用）：它们各自 portal 到 body，
                DOM 上是本弹窗的兄弟、层高也更高；JSX 写在这里只为少一层缩进。
                Esc / 点遮罩先归它们 —— requestClose 见它们开着就自己让路（issue 13）。 */}
            {askClose && (
                <ConfirmDialog
                    title={t('chartCode.confirmCloseTitle')}
                    message={t('chartCode.confirmClose')}
                    confirmLabel={t('ui.discard')}
                    onConfirm={() => { setAskClose(false); close(); }}
                    onCancel={() => setAskClose(false)}
                />
            )}
            {askOverwrite && (
                <ConfirmDialog
                    title={t('chartCode.confirmOverwriteTitle')}
                    message={t('chartCode.confirmOverwrite', { count: askOverwrite.delta })}
                    confirmLabel={t('ui.overwrite')}
                    onConfirm={() => {
                        const pending = askOverwrite;
                        setAskOverwrite(null);
                        commitApply(pending.code, pending.text);
                    }}
                    onCancel={() => setAskOverwrite(null)}
                />
            )}
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
