import { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, Search } from 'lucide-react';
import {
  FUNCTIONS, functionById, setFunctionBinding, getDefaultConfig,
  formatKey, setCapturingShortcut, type FunctionId,
} from '../utils/ShortcutConfig';
import { useConfig } from '../contexts';

// 快捷键页（issue 28 Q14）：
// - 页顶只读信息区列出应用级快捷键（切页，不可编辑），便于发现。
// - 下方平铺搜索表：搜索 / 点击键位编辑 / 启用·禁用 / 恢复默认。
// - 导入/导出统一收敛到「设置 → 配置数据」，本页不再提供。

// 应用级快捷键（切页，硬绑定不可编辑）
const APP_SHORTCUTS: Array<{ label: string; combo: string }> = [
  { label: '切换到工作台', combo: 'Ctrl/⌘+Shift+1' },
  { label: '切换到音频', combo: 'Ctrl/⌘+Shift+2' },
  { label: '切换到设置', combo: 'Ctrl/⌘+Shift+3' },
  { label: '切换到快捷键', combo: 'Ctrl/⌘+Shift+4' },
];

/** 由按键事件构建规范绑定串（小写）；纯修饰键返回 null。 */
function comboFromKeyEvent(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): string | null {
  if (['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) return null;
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push('ctrl');
  if (e.altKey) mods.push('alt');
  if (e.shiftKey) mods.push('shift');
  const main = e.key === ' ' ? ' ' : e.key.toLowerCase();
  return [...mods, main].join('+');
}

/** 独立的快捷键记录弹窗（类 VSCode）：Enter 确认、Esc 取消。 */
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

export default function ShortcutsPage() {
  const { settings, setShortcutConfig } = useConfig();
  const config = settings.shortcuts;
  const [query, setQuery] = useState('');
  const [error, setError] = useState<{ id: FunctionId; msg: string } | null>(null);
  const [editingId, setEditingId] = useState<FunctionId | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FUNCTIONS;
    return FUNCTIONS.filter(f =>
      f.label.toLowerCase().includes(q) || f.category.toLowerCase().includes(q) ||
      (config[f.id] != null && config[f.id]!.toLowerCase().includes(q))
    );
  }, [query, config]);

  const commit = (id: FunctionId, binding: string) => {
    const next = { ...config };
    const conflict = setFunctionBinding(next, id, binding);
    if (conflict) {
      setError({ id, msg: `键位 "${formatKey(binding)}" 已被功能「${functionById(conflict).label}」占用` });
      return;
    }
    setError(null);
    setShortcutConfig(next);
  };

  const setEnabled = (id: FunctionId, enabled: boolean) => {
    const next = { ...config };
    next[id] = enabled ? getDefaultConfig()[id] : null;
    setError(null);
    setShortcutConfig(next);
  };

  return (
    <div className="page-content is-wide is-fill">
      <header className="page-intro">
        <span>输入与效率</span>
        <h2>快捷键</h2>
        <p>搜索功能，点击键位后直接录入新的组合键。冲突会在保存前提示。</p>
      </header>

      <section className="shortcut-surface surface-section">
        <div className="app-shortcut-list">
          <span>应用级快捷键（不可编辑）</span>
          {APP_SHORTCUTS.map((s) => (
            <span key={s.label} title={`${s.label} · 不可编辑`}>
              <span style={{ color: 'var(--text-muted)', marginRight: 4 }}>{s.label}</span>
              {s.combo.split('+').map((part) => <kbd key={part}>{part}</kbd>)}
            </span>
          ))}
          <span className="app-shortcut-note">切页快捷键固定绑定，不支持自定义。</span>
        </div>

        <div className="shortcut-toolbar">
          <label className="search-field"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索功能或按键" /></label>
          <button className="button-secondary" type="button" onClick={() => { setError(null); setShortcutConfig(getDefaultConfig()); }}><RotateCcw size={15} />恢复默认</button>
        </div>

        {error && <div className="shortcut-error">{error.msg}</div>}

        <div className="shortcut-table" role="table" aria-label="快捷键列表">
          <div className="shortcut-row shortcut-head" role="row">
            <span>类别</span><span>功能</span><span>快捷键</span><span>启用</span>
          </div>
          {visible.map((f) => {
            const bound = config[f.id] !== null;
            return (
              <div
                className={`shortcut-row${bound ? '' : ' disabled'}`}
                role="row"
                key={f.id}
                onDoubleClick={(e) => {
                  // 双击整行打开编辑；双击「启用」开关 / 键位按钮不重复触发（它们各自有单击/双击语义）
                  if ((e.target as HTMLElement).closest('button')) return;
                  setEditingId(f.id);
                }}
              >
                <span className="shortcut-group">{f.category}</span>
                <strong>{f.label}</strong>
                {bound ? (
                  <button
                    className="key-binding"
                    type="button"
                    onClick={() => setEditingId(f.id)}
                    title="点击修改快捷键"
                    style={error?.id === f.id ? { borderColor: 'var(--danger)', color: 'var(--danger-text)' } : undefined}
                  >
                    {formatKey(config[f.id] as string).split('+').map((part) => <kbd key={part}>{part}</kbd>)}
                  </button>
                ) : (
                  <span className="key-binding is-disabled">已屏蔽</span>
                )}
                <label style={{ display: 'flex', justifyContent: 'center' }}>
                  <button
                    className={`switch compact${bound ? ' is-on' : ''}`}
                    type="button"
                    aria-label={`${bound ? '禁用' : '启用'}${f.label}`}
                    onClick={() => setEnabled(f.id, !bound)}
                  ><span /></button>
                </label>
              </div>
            );
          })}
          {visible.length === 0 && <div className="empty-result">没有匹配的功能</div>}
        </div>
      </section>

      {editingId && (
        <ShortcutRecorder
          id={editingId}
          onCommit={(binding) => commit(editingId, binding)}
          onCancel={() => setEditingId(null)}
        />
      )}
    </div>
  );
}
