import { useState, useEffect, useRef, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Copy, RotateCcw } from "lucide-react";
import { convertNotesToChartCode, chartCodeToJSON, parseChartCodeFromJSON, validateChartCode, convertChartCodeToNotes } from "../utils/ChartConverter";
import { useEditing } from "../contexts";
import { selectionNoteIndices } from "../utils/SelectionEditing";

/** 动作按钮（primary=强调实底 / danger=危险 / 默认=中性描边），带 hover/pressed 令牌化样式 */
function ActionBtn({ children, onClick, disabled, variant }: {
  children: ReactNode; onClick: () => void; disabled?: boolean;
  variant?: 'primary' | 'danger';
}) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);

  let bg = 'var(--bg-inset)';
  let fg = 'var(--text)';
  let border = '1px solid var(--border)';
  if (variant === 'primary') {
    bg = hover ? 'var(--accent-hover)' : 'var(--accent)';
    fg = 'var(--text-on-accent)';
    border = '1px solid transparent';
  } else if (variant === 'danger') {
    bg = hover ? 'var(--danger)' : 'var(--danger-soft)';
    fg = 'var(--danger-text)';
    border = '1px solid transparent';
  } else {
    bg = hover ? 'var(--bg-hover)' : 'var(--bg-inset)';
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: 'var(--space-2) var(--space-3)',
        backgroundColor: bg, color: fg, border, borderRadius: 'var(--radius-sm)',
        fontSize: 'var(--text-sm)', fontFamily: 'inherit', cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex', alignItems: 'center', gap: 'var(--space-1)', opacity: disabled ? 0.5 : 1,
        transform: pressed ? 'scale(0.98)' : undefined,
        transition: 'background-color var(--dur) var(--ease), color var(--dur) var(--ease), transform var(--dur) var(--ease)',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPressed(false); }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
    >
      {children}
    </button>
  );
}

// M1 收口（ADR-0003 §7）：notes / 选中条目直读 EditingContext，组件不再接收 selectedNotes/notes/onNotesChange props

export default function NoteInfoPanel() {
    const { notes, selectedItems, handleNotesChange, deleteSelected, mirror } = useEditing();
    const selectedNotes = selectionNoteIndices(selectedItems);
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

    // 应用谱面代码：经 useEditing.handleNotesChange 走历史记录
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
            handleNotesChange(newNotes);
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

    // 删除/镜像选中：直接走 useEditing 的领域操作（与画布/Toolbar 走同一路径）
    const handleDeleteSelected = () => {
        if (selectedNotes.length === 0) return;
        deleteSelected();
    };

    const handleMirrorSelected = () => {
        if (selectedNotes.length === 0) return;
        mirror();
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 'var(--space-3)' }}>
            {/* 音符信息区块 */}
            <div style={{
                backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden',
            }}>
                <div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border)' }}>
                    <h3 style={{ margin: 0, fontSize: 'var(--text-sm)', fontWeight: 600 }}>音符信息</h3>
                </div>

                <div style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    {/* 组合状态切换 */}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={isCombinationMode}
                            onChange={(e) => setIsCombinationMode(e.target.checked)}
                            style={{ accentColor: 'var(--accent)', cursor: 'pointer' }}
                        />
                        组合状态
                    </label>

                    {/* 选中音符数量 */}
                    <div>
                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                            已选中 {selectedNotes.length} 个音符
                        </span>
                    </div>

                    {/* 操作按钮 */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                        <ActionBtn
                            onClick={handleDeleteSelected}
                            disabled={selectedNotes.length === 0}
                            variant="danger"
                        >删除选中</ActionBtn>
                        <ActionBtn
                            onClick={handleMirrorSelected}
                            disabled={selectedNotes.length === 0}
                        >镜像选中</ActionBtn>
                    </div>
                </div>

                {/* 选中音符详情 */}
                <div style={{
                    maxHeight: 256, overflowY: 'auto', padding: 'var(--space-3) var(--space-4)',
                    borderTop: '1px solid var(--border)', backgroundColor: 'var(--bg-inset)',
                }}>
                    {selectedNoteObjects.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                            {selectedNoteObjects.map((note, index) => (
                                <div key={index} style={{
                                    padding: 'var(--space-3)', backgroundColor: 'var(--bg-elevated)',
                                    borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
                                    boxShadow: 'var(--shadow-sm)',
                                }}>
                                    <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>
                                        {note.type === "Single" && "单键音符"}
                                        {note.type === "Slide" && "滑条音符"}
                                        {note.type === "BPM" && "BPM标记"}
                                    </div>
                                    {note.type === "Single" && (
                                        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 'var(--space-1)', fontVariantNumeric: 'tabular-nums' }}>
                                            <div>轨道: {note.lane}</div>
                                            <div>节拍: {note.beat}</div>
                                            {note.flick && <div style={{ color: 'var(--danger-text)' }}>滑键</div>}
                                        </div>
                                    )}
                                    {note.type === "Slide" && (
                                        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 'var(--space-1)', fontVariantNumeric: 'tabular-nums' }}>
                                            <div>连接点: {note.connections.length}</div>
                                            {note.connections.map((conn, i) => (
                                                <div key={i}>
                                                    点{i + 1}: 轨道{conn.lane}, 节拍{conn.beat}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {note.type === "BPM" && (
                                        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 'var(--space-1)', fontVariantNumeric: 'tabular-nums' }}>
                                            <div>节拍: {note.beat}</div>
                                            <div>BPM: {note.bpm}</div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div style={{ color: 'var(--text-subtle)', textAlign: 'center', padding: 'var(--space-8) 0', fontSize: 'var(--text-sm)' }}>
                            未选中音符
                        </div>
                    )}
                </div>
            </div>

            {/* 谱面代码编辑器区块 */}
            <div style={{
                backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-sm)',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
                flex: isCodeEditorCollapsed ? '0 0 auto' : 1, minHeight: isCodeEditorCollapsed ? 'auto' : 0,
                transition: 'flex var(--dur) var(--ease)',
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
                                    width: '100%', height: '100%', minHeight: 260, boxSizing: 'border-box', resize: 'none',
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
        </div>
    );
}
