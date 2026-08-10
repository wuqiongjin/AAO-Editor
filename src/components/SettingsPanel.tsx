import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FUNCTIONS, functionById, setFunctionBinding, loadConfig, getDefaultConfig,
  exportConfig, formatKey, setCapturingShortcut, type FunctionId,
} from '../utils/ShortcutConfig';
import { useConfig } from '../contexts';
import type { AppSettings } from '../utils/AppSettings';

// M1 收口（ADR-0003 §7）：config / onClose 经 hooks 直读，外部仅传关闭回调
interface SettingsPanelProps {
  onClose: () => void;
}

const MODAL_STYLE: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 'var(--z-modal)',
  backgroundColor: 'rgba(12, 14, 17, 0.5)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const PANEL_STYLE: React.CSSProperties = {
  backgroundColor: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)',
  width: '620px', maxHeight: '80vh', overflowY: 'auto',
  padding: 'var(--space-4) var(--space-5)', boxShadow: 'var(--shadow-lg)',
  fontFamily: 'var(--font-sans)', fontSize: 'var(--text-base)', color: 'var(--text)',
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
  fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
  background: 'var(--bg-inset)', color: 'var(--text)', borderRadius: 'var(--radius-sm)',
  padding: '4px 8px', border: '1px solid var(--border-strong)', textAlign: 'center', cursor: 'pointer',
  transition: 'background-color var(--dur) var(--ease), border-color var(--dur) var(--ease)',
};

/** 快捷键显示块（键帽样式）：点击后打开独立记录弹窗（类 VSCode）；disabled 时显示已屏蔽 */
function ShortcutDisplay({ value, hasError, onClick }: {
  value: string; hasError: boolean; onClick: () => void;
}) {
  const style = hasError
    ? { ...KEY_DISPLAY_STYLE, borderColor: 'var(--danger)', color: 'var(--danger-text)' }
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
    <span style={{ width: '150px', display: 'inline-block', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 'var(--text-sm)', fontStyle: 'italic' }}>
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
      style={{ position: 'fixed', inset: 0, zIndex: 'var(--z-recorder)', backgroundColor: 'rgba(12,14,17,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onCancel}
    >
      <div
        style={{
          backgroundColor: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', padding: '28px 44px',
          border: '2px solid var(--accent)', boxShadow: 'var(--shadow-lg)',
          textAlign: 'center', fontFamily: 'var(--font-mono)', color: 'var(--text)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontSize: '38px', fontWeight: 700, marginBottom: '16px', color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
          {draft ? formatKey(draft) : '…'}
        </div>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>先按所需的组合键，再按 enter 键。</div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-subtle)', marginTop: '12px' }}>{functionById(id).label}　·　Enter 确认 · Esc 取消</div>
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
  const { settings, setShortcutConfig, setTheme } = useConfig();
  const config = settings.shortcuts;
  const theme = settings.theme;
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

  const themeOptions: Array<{ value: AppSettings['theme']; label: string }> = [
    { value: 'light', label: '亮色' },
    { value: 'dark', label: '暗色' },
    { value: 'system', label: '跟随系统' },
  ];

  return (
    <div style={MODAL_STYLE} onClick={onClose}>
      <div style={PANEL_STYLE} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>快捷键设置</h3>
          <button onClick={onClose} style={closeBtnStyle}>关闭</button>
        </div>

        {/* 外观 / 主题（ADR-0003 §5） */}
        <div style={{
          border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
          padding: 'var(--space-3) var(--space-4)', marginBottom: 'var(--space-3)',
        }}>
          <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }}>外观 / 主题</div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            {themeOptions.map(o => {
              const active = theme === o.value;
              return (
                <button
                  key={o.value}
                  onClick={() => setTheme(o.value)}
                  style={{
                    padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)',
                    border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
                    backgroundColor: active ? 'var(--accent-soft)' : 'var(--bg-inset)',
                    color: active ? 'var(--accent-text)' : 'var(--text)',
                    cursor: 'pointer', fontSize: 'var(--text-sm)', fontFamily: 'inherit',
                    display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                    transition: 'background-color var(--dur) var(--ease), border-color var(--dur) var(--ease), color var(--dur) var(--ease)',
                  }}
                >
                  <input
                    type="radio"
                    checked={active}
                    onChange={() => setTheme(o.value)}
                    style={{ accentColor: 'var(--accent)', margin: 0, cursor: 'pointer' }}
                  />
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
          <input
            placeholder="搜索功能名称…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{
              flex: 1, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
              padding: '5px 8px', fontSize: 'var(--text-sm)', backgroundColor: 'var(--bg-inset)', color: 'var(--text)',
              outline: 'none', transition: 'border-color var(--dur) var(--ease)',
            }}
          />
          <button style={toolBtnStyle} onClick={handleExport}>导出 JSON</button>
          <button style={toolBtnStyle} onClick={() => fileRef.current?.click()}>导入 JSON</button>
          <button style={toolBtnStyle} onClick={() => { setError(null); onChange(getDefaultConfig()); }}>恢复默认</button>
          <input
            ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleImport(f); e.target.value = ''; }}
          />
        </div>

        <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)', marginBottom: '10px' }}>
          点击右侧键位框，在弹出的弹窗中按下想要的组合键，再按 Enter 确认（不区分大小写）。
        </div>

        {error && (
          <div style={{ color: 'var(--danger-text)', marginBottom: '10px', fontSize: 'var(--text-sm)' }}>{error.msg}</div>
        )}

        {visible.length === 0 && (
          <div style={{ color: 'var(--text-muted)', padding: '12px 0' }}>无匹配功能</div>
        )}

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: 'var(--text-subtle)', fontSize: 'var(--text-xs)', textAlign: 'left' }}>
              <th style={{ padding: '4px 6px', borderBottom: '1px solid var(--border)' }}>功能</th>
              <th style={{ padding: '4px 6px', borderBottom: '1px solid var(--border)' }}>快捷键</th>
              <th style={{ padding: '4px 6px', borderBottom: '1px solid var(--border)', textAlign: 'center', width: '70px' }}>启用</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(f => {
              const bound = config[f.id] !== null;
              return (
                <tr key={f.id} style={{ opacity: bound ? 1 : 0.55 }}>
                  <td style={{ padding: '6px', borderBottom: '1px solid var(--border-faint)' }}>
                    <span style={{ color: 'var(--text-subtle)', fontSize: 'var(--text-xs)', marginRight: '8px' }}>{f.category}</span>
                    {f.label}
                  </td>
                  <td style={{ padding: '6px', borderBottom: '1px solid var(--border-faint)' }}>
                    {bound
                      ? <ShortcutDisplay
                          value={config[f.id] as string}
                          hasError={error?.id === f.id}
                          onClick={() => setEditingId(f.id)}
                        />
                      : <ShortcutDisabled />}
                  </td>
                  <td style={{ padding: '6px', borderBottom: '1px solid var(--border-faint)', textAlign: 'center' }}>
                    <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={bound}
                        onChange={e => setEnabled(f.id, e.target.checked)}
                        style={{ accentColor: 'var(--accent)', cursor: 'pointer' }}
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
  border: '1px solid var(--border)', background: 'var(--bg-inset)', color: 'var(--text)',
  borderRadius: 'var(--radius-sm)', padding: '2px 10px', cursor: 'pointer', fontFamily: 'inherit',
  transition: 'background-color var(--dur) var(--ease)',
};
const toolBtnStyle: React.CSSProperties = {
  border: '1px solid var(--border)', background: 'var(--bg-inset)', color: 'var(--text)',
  borderRadius: 'var(--radius-sm)', padding: '3px 10px', cursor: 'pointer', fontFamily: 'inherit',
  fontSize: 'var(--text-xs)', transition: 'background-color var(--dur) var(--ease)',
};
