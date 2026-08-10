import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FUNCTIONS, functionById, setFunctionBinding, loadConfig, getDefaultConfig,
  exportConfig, formatKey, setCapturingShortcut, type FunctionId,
} from '../utils/ShortcutConfig';
import { useConfig } from '../contexts';

// M1 收口（ADR-0003 §7）：config / onClose 经 hooks 直读，外部仅传关闭回调
interface SettingsPanelProps {
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

/** 由按键事件构建规范绑定串（小写修饰键 + 小写主键）；纯修饰键返回 null。React 与原生 KeyboardEvent 结构兼容。 */
function comboFromKeyEvent(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): string | null {
  if (['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) return null;
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push('ctrl');
  if (e.altKey) mods.push('alt');
  if (e.shiftKey) mods.push('shift');
  const main = e.key === ' ' ? ' ' : e.key.toLowerCase();
  return [...mods, main].join('+');
}

const KEY_DISPLAY_STYLE: React.CSSProperties = {
  width: '150px', boxSizing: 'border-box',
  fontFamily: '"SF Mono", Consolas, Menlo, monospace', fontSize: '13px', fontWeight: 600,
  background: '#f1f5f9', color: '#1e293b', borderRadius: '6px',
  padding: '4px 8px', border: '1px solid #cbd5e1', textAlign: 'center', cursor: 'pointer',
};

/** 快捷键显示块（键帽样式）：点击后打开独立记录弹窗（类 VSCode）；disabled 时显示已屏蔽 */
function ShortcutDisplay({ value, hasError, onClick }: {
  value: string; hasError: boolean; onClick: () => void;
}) {
  const style = hasError
    ? { ...KEY_DISPLAY_STYLE, borderColor: '#dc2626', color: '#dc2626' }
    : KEY_DISPLAY_STYLE;
  return (
    <button type="button" style={style} onClick={onClick} title="点击修改快捷键">
      {formatKey(value)}
    </button>
  );
}

/** 已屏蔽占位 */
function ShortcutDisabled() {
  return (
    <span style={{ width: '150px', display: 'inline-block', textAlign: 'center', color: '#9ca3af', fontSize: '13px', fontStyle: 'italic' }}>
      已屏蔽
    </span>
  );
}

/**
 * 独立的快捷键记录弹窗（类 VSCode）：
 * 打开时挂载 window keydown 捕获用户按键组合，Enter 确认、Esc 取消；
 * 通过 isCapturingShortcut 让编辑器全局快捷键放行，避免误触发。
 */
function ShortcutRecorder({ id, onCommit, onCancel }: {
  id: FunctionId; onCommit: (binding: string) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);

  useEffect(() => {
    setCapturingShortcut(true);
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Enter') {
        if (draftRef.current) onCommit(draftRef.current);
        onCancel();
        return;
      }
      if (e.key === 'Escape') {
        onCancel();
        return;
      }
      const combo = comboFromKeyEvent(e);
      if (combo) {
        draftRef.current = combo;
        setDraft(combo);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      setCapturingShortcut(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1100, backgroundColor: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onCancel}
    >
      <div
        style={{
          backgroundColor: '#ffffff', borderRadius: '12px', padding: '28px 44px',
          border: '2px solid #3b82f6', boxShadow: '0 16px 40px rgba(15,23,42,0.25)',
          textAlign: 'center', fontFamily: '"SF Mono", Consolas, Menlo, monospace',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontSize: '38px', fontWeight: 700, marginBottom: '16px', color: '#2563eb' }}>
          {draft ? formatKey(draft) : '…'}
        </div>
        <div style={{ fontSize: '13px', color: '#475569' }}>先按所需的组合键，再按 enter 键。</div>
        <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '12px' }}>{functionById(id).label}　·　Enter 确认 · Esc 取消</div>
      </div>
    </div>
  );
}

/**
 * 快捷键设置面板（ADR-0002 §5）
 * Q6 定案：按「具体功能」编辑单键；支持按功能名部分匹配搜索。
 * 展示统一大写（不区分大小写）；修改时点击键位弹出独立记录弹窗（类 VSCode，非手输文本）。
 */
export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  // M1 收口：直读 ConfigContext / UIContext，组件对外只暴露关闭回调
  const { settings, setShortcutConfig } = useConfig();
  const config = settings.shortcuts;
  const onChange = setShortcutConfig;
  const [query, setQuery] = useState('');
  const [error, setError] = useState<{ id: FunctionId; msg: string } | null>(null);
  const [editingId, setEditingId] = useState<FunctionId | null>(null);
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

  // 启用/屏蔽（屏蔽 = 清空绑定为 null，不触发；重新启用恢复默认绑定）
  const setEnabled = (id: FunctionId, enabled: boolean) => {
    const next = { ...config };
    next[id] = enabled ? getDefaultConfig()[id] : null;
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
          <button style={toolBtnStyle} onClick={() => { setError(null); onChange(getDefaultConfig()); }}>恢复默认</button>
          <input
            ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleImport(f); e.target.value = ''; }}
          />
        </div>

        <div style={{ color: '#6b7280', fontSize: '12px', marginBottom: '10px' }}>
          点击右侧键位框，在弹出的弹窗中按下想要的组合键，再按 Enter 确认（不区分大小写）。
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
              <th style={{ padding: '4px 6px', borderBottom: '1px solid #e5e7eb', textAlign: 'center', width: '70px' }}>启用</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(f => {
              const bound = config[f.id] !== null;
              return (
                <tr key={f.id} style={{ opacity: bound ? 1 : 0.55 }}>
                  <td style={{ padding: '6px', borderBottom: '1px solid #f3f4f6' }}>
                    <span style={{ color: '#9ca3af', fontSize: '12px', marginRight: '8px' }}>{f.category}</span>
                    {f.label}
                  </td>
                  <td style={{ padding: '6px', borderBottom: '1px solid #f3f4f6' }}>
                    {bound
                      ? <ShortcutDisplay
                          value={config[f.id] as string}
                          hasError={error?.id === f.id}
                          onClick={() => setEditingId(f.id)}
                        />
                      : <ShortcutDisabled />}
                  </td>
                  <td style={{ padding: '6px', borderBottom: '1px solid #f3f4f6', textAlign: 'center' }}>
                    <label style={{ fontSize: '12px', color: '#4b5563', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={bound}
                        onChange={e => setEnabled(f.id, e.target.checked)}
                      />
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editingId && (
        <ShortcutRecorder
          id={editingId}
          onCommit={binding => commit(editingId, binding)}
          onCancel={() => setEditingId(null)}
        />
      )}
    </div>
  );
}

const closeBtnStyle: React.CSSProperties = {
  border: '1px solid #d1d5db', background: '#f3f4f6', borderRadius: '4px', padding: '2px 10px', cursor: 'pointer',
};
const toolBtnStyle: React.CSSProperties = {
  border: '1px solid #d1d5db', background: '#ffffff', borderRadius: '4px', padding: '3px 10px', cursor: 'pointer',
};
