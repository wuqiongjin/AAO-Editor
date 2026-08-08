import { useMemo, useRef, useState } from 'react';
import {
  FUNCTIONS, functionById, setFunctionBinding, loadConfig, getDefaultConfig,
  exportConfig, formatKey, type ShortcutConfig, type FunctionId,
} from '../utils/ShortcutConfig';

interface SettingsPanelProps {
  config: ShortcutConfig;
  onChange: (cfg: ShortcutConfig) => void;
  onClose: () => void;
}

const MODAL_STYLE: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 1000,
  backgroundColor: 'rgba(0,0,0,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const PANEL_STYLE: React.CSSProperties = {
  backgroundColor: '#ffffff', borderRadius: '8px',
  width: '620px', maxHeight: '80vh', overflowY: 'auto',
  padding: '16px 20px', boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
  fontFamily: 'system-ui, sans-serif', fontSize: '14px',
};

/** 由按键事件构建规范绑定串（小写修饰键 + 小写主键）；纯修饰键 / 无法记录的按键返回 null */
function comboFromKeyEvent(e: React.KeyboardEvent): string | null {
  if (['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) return null;
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push('ctrl');
  if (e.altKey) mods.push('alt');
  if (e.shiftKey) mods.push('shift');
  const main = e.key === ' ' ? ' ' : e.key.toLowerCase();
  return [...mods, main].join('+');
}

const CODE_INPUT_STYLE: React.CSSProperties = {
  width: '150px', boxSizing: 'border-box',
  fontFamily: '"SF Mono", Consolas, Menlo, monospace', fontSize: '13px',
  background: '#1e1e1e', color: '#d4d4d4', borderRadius: '4px',
  padding: '4px 8px', border: '1px solid #3c3c3c', textAlign: 'center', cursor: 'pointer',
};
const RECORDING_STYLE: React.CSSProperties = { ...CODE_INPUT_STYLE, borderColor: '#569cd6', color: '#569cd6' };
const ERROR_STYLE: React.CSSProperties = { ...CODE_INPUT_STYLE, borderColor: '#dc2626' };

/**
 * 快捷键记录输入框（类 VSCode）：点击后进入"记录"态，捕获用户按键动作组合成键位，
 * Enter 确认、Esc 取消；展示为大写键帽文本。底层用 <input> 使编辑器全局 keydown 放行（不误触发）。
 */
function ShortcutInput({ value, hasError, onCommit }: {
  value: string; hasError: boolean; onCommit: (binding: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Enter') {
      if (recording && draft) onCommit(draft);
      setRecording(false);
      setDraft(null);
      return;
    }
    if (e.key === 'Escape') {
      setRecording(false);
      setDraft(null);
      return;
    }
    const combo = comboFromKeyEvent(e);
    if (combo) {
      setDraft(combo);
      setRecording(true);
    }
  };

  const style = hasError ? ERROR_STYLE : recording ? RECORDING_STYLE : CODE_INPUT_STYLE;
  const shown = recording ? (draft ? formatKey(draft) : '…') : formatKey(value);

  return (
    <input
      style={style}
      value={shown}
      readOnly
      onFocus={e => { (e.target as HTMLInputElement).select(); }}
      onKeyDown={handleKeyDown}
      title={recording ? '按下组合键，Enter 确认，Esc 取消' : '点击以记录新的快捷键'}
    />
  );
}

/**
 * 快捷键设置面板（ADR-0002 §5）
 * Q6 定案：按「具体功能」编辑单键；支持按功能名部分匹配搜索。
 * 本次改版：① 展示统一大写（不区分大小写）；② 输入改为"记录按键动作"式（类 VSCode），非手输文本。
 */
export default function SettingsPanel({ config, onChange, onClose }: SettingsPanelProps) {
  const [query, setQuery] = useState('');
  const [error, setError] = useState<{ id: FunctionId; msg: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FUNCTIONS;
    return FUNCTIONS.filter(f => f.label.toLowerCase().includes(q) || f.category.toLowerCase().includes(q));
  }, [query]);

  const commit = (id: FunctionId, binding: string) => {
    const next = { ...config };
    const conflict = setFunctionBinding(next, id, binding);
    if (conflict) {
      setError({ id, msg: `键位 "${formatKey(binding)}" 已被功能「${functionById(conflict).label}」占用` });
      return;
    }
    setError(null);
    onChange(next);
  };

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const merged = loadConfig({ getItem: () => JSON.stringify(parsed) });
        onChange(merged);
        setError(null);
      } catch {
        setError({ id: 'undo', msg: '导入失败：JSON 格式不正确' });
      }
    };
    reader.readAsText(file);
  };

  const handleExport = () => {
    const blob = new Blob([exportConfig(config)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'shortcuts.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={MODAL_STYLE} onClick={onClose}>
      <div style={PANEL_STYLE} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '16px' }}>快捷键设置</h3>
          <button onClick={onClose} style={closeBtnStyle}>关闭</button>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
          <input
            placeholder="搜索功能名称…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ flex: 1, border: '1px solid #d1d5db', borderRadius: '4px', padding: '5px 8px', fontSize: '13px' }}
          />
          <button style={toolBtnStyle} onClick={handleExport}>导出 JSON</button>
          <button style={toolBtnStyle} onClick={() => fileRef.current?.click()}>导入 JSON</button>
          <button style={toolBtnStyle} onClick={() => onChange(getDefaultConfig())}>恢复默认</button>
          <input
            ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleImport(f); e.target.value = ''; }}
          />
        </div>

        <div style={{ color: '#6b7280', fontSize: '12px', marginBottom: '10px' }}>
          点击右侧键位框进入记录态，直接按下想要的组合键，按 Enter 确认、Esc 取消（不区分大小写）。
        </div>

        {error && (
          <div style={{ color: '#dc2626', marginBottom: '10px', fontSize: '13px' }}>{error.msg}</div>
        )}

        {visible.length === 0 && (
          <div style={{ color: '#6b7280', padding: '12px 0' }}>无匹配功能</div>
        )}

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: '#6b7280', fontSize: '12px', textAlign: 'left' }}>
              <th style={{ padding: '4px 6px', borderBottom: '1px solid #e5e7eb' }}>功能</th>
              <th style={{ padding: '4px 6px', borderBottom: '1px solid #e5e7eb' }}>快捷键</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(f => (
              <tr key={f.id}>
                <td style={{ padding: '6px', borderBottom: '1px solid #f3f4f6' }}>
                  <span style={{ color: '#9ca3af', fontSize: '12px', marginRight: '8px' }}>{f.category}</span>
                  {f.label}
                </td>
                <td style={{ padding: '6px', borderBottom: '1px solid #f3f4f6' }}>
                  <ShortcutInput
                    value={config[f.id]}
                    hasError={error?.id === f.id}
                    onCommit={binding => commit(f.id, binding)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const closeBtnStyle: React.CSSProperties = {
  border: '1px solid #d1d5db', background: '#f3f4f6', borderRadius: '4px', padding: '2px 10px', cursor: 'pointer',
};
const toolBtnStyle: React.CSSProperties = {
  border: '1px solid #d1d5db', background: '#ffffff', borderRadius: '4px', padding: '3px 10px', cursor: 'pointer',
};
