import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, RotateCcw, Search, SearchX } from 'lucide-react';
import AppPageShell from '../layouts/AppPageShell';
import EmptyState from '../ui/EmptyState';
import {
  FUNCTIONS, functionById, setFunctionBinding, getDefaultConfig,
  formatKey, setCapturingShortcut, type FunctionId,
} from '../chart/config/ShortcutConfig';
import { useConfig } from '../app/ProviderTree';

// 快捷键页（issue 28 Q14 + issue 44 内容壳迁移）：
//   - 接入 <AppPageShell>：不写 Sidebar（无页内子类别），Body 走 mode="fill" width="default"（表格自身滚）；
//   - 页顶只读信息区列出应用级快捷键（切页，不可编辑），便于发现；
//   - 下方平铺搜索表：搜索 / 点击键位编辑 / 启用·禁用 / 恢复默认；
//   - 导入/导出统一收敛到「设置 → 配置数据」，本页不再提供。

// 应用级快捷键（切页，硬绑定不可编辑）
const APP_SHORTCUTS: Array<{ label: string; combo: string }> = [
  { label: '切换到工作台', combo: 'Ctrl/⌘+Shift+1' },
  { label: '切换到音频', combo: 'Ctrl/⌘+Shift+2' },
  { label: '切换到素材', combo: 'Ctrl/⌘+Shift+3' },
  { label: '切换到快捷键', combo: 'Ctrl/⌘+Shift+4' },
  { label: '切换到设置', combo: 'Ctrl/⌘+Shift+5' },
];

/**
 * 把可能含「/」备选的组合串展开为一条条完整快捷键。
 * 例：'Ctrl/⌘+Shift+1' → [['Ctrl','Shift','1'], ['⌘','Shift','1']]
 * 即一个功能支持多个（可互相替换的）快捷键时，各自生成一个独立键块。
 */
function expandCombo(combo: string): string[][] {
  return combo
    .split('+')
    .map(seg => seg.split('/'))
    .reduce<string[][]>((acc, alts) => alts.flatMap(alt => acc.map(prefix => [...prefix, alt])), [[]]);
}

/** 把一组按键渲染为「键块 + 键块 + 键块」；加号作为键间分隔、不渲染进键块内部 */
function KeyChips({ parts }: { parts: string[] }) {
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="combo-plus" aria-hidden="true">+</span>}
          <kbd>{p}</kbd>
        </Fragment>
      ))}
    </>
  );
}

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
      className="shortcut-recorder"
      onClick={onCancel}
    >
      <div
        className="shortcut-recorder__panel"
        onClick={e => e.stopPropagation()}
      >
        <div className="shortcut-recorder__keys">
          {draft ? formatKey(draft) : '…'}
        </div>
        <div className="shortcut-recorder__hint">先按所需的组合键，再按 enter 键。</div>
        <div className="shortcut-recorder__meta">{functionById(id).label}　·　Enter 确认 · Esc 取消</div>
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

  // 应用级（切页）快捷键：仅展示、只读，不参与配置/编辑；随搜索过滤
  const visibleApp = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return APP_SHORTCUTS;
    return APP_SHORTCUTS.filter(s => s.label.toLowerCase().includes(q) || s.combo.toLowerCase().includes(q));
  }, [query]);

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
    <AppPageShell>
      <AppPageShell.Header
        eyebrow="输入与效率"
        title="快捷键"
        description="搜索功能，点击键位后直接录入新的组合键。冲突会在保存前提示。"
      />

      <AppPageShell.Body mode="fill">

        <section className="shortcut-surface surface-section app-stagger">
        {/* 删掉 settings-heading（与 page header "快捷键" 重复），改在 toolbar 上加 padding-top 让搜索框与卡片间距与其它页一致 */}
        <div className="shortcut-toolbar">
          <label className="search-field"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索功能或按键" /></label>
          <button className="button-secondary" type="button" onClick={() => { setError(null); setShortcutConfig(getDefaultConfig()); }}><RotateCcw size={15} />恢复默认</button>
        </div>

        {error && <div className="shortcut-error">{error.msg}</div>}

        <div className="shortcut-table" role="table" aria-label="快捷键列表">
          <div className="shortcut-row shortcut-head" role="row">
            <span>类别</span><span>功能</span><span>快捷键</span><span>修改</span><span>启用</span>
          </div>

          {/* 应用级（切页）快捷键：只读展示，固定绑定、不支持自定义/启用/修改 */}
          {visibleApp.map((s) => (
            <div className="shortcut-row is-system" role="row" key={s.label}>
              <span className="shortcut-group">系统</span>
              <strong>{s.label}</strong>
              {/* 每个可替换的快捷键各成一个独立键块（如 Ctrl+Shift+1 与 ⌘+Shift+1），并排在同一行 */}
              <div className="sys-keybindings">
                {expandCombo(s.combo).map((parts, i) => (
                  <span className="key-binding is-disabled" key={i} title={`${s.label} · 固定绑定，不支持修改`}>
                    <KeyChips parts={parts} />
                  </span>
                ))}
              </div>
              <span aria-hidden="true" />
              <span aria-hidden="true" />
            </div>
          ))}

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
                    {formatKey(config[f.id] as string).split('+').map((part, k) => (
                      <Fragment key={k}>
                        {k > 0 && <span className="combo-plus" aria-hidden="true">+</span>}
                        <kbd>{part}</kbd>
                      </Fragment>
                    ))}
                  </button>
                ) : (
                  <span className="key-binding is-disabled">已屏蔽</span>
                )}
                <button
                  className="edit-binding"
                  type="button"
                  disabled={!bound}
                  onClick={() => bound && setEditingId(f.id)}
                  title={bound ? '修改快捷键' : '已屏蔽，先启用才能修改'}
                  aria-label={`修改${f.label}的快捷键`}
                ><Pencil size={14} /></button>
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
          {visible.length === 0 && visibleApp.length === 0 && (
            <EmptyState
              icon={SearchX}
              title="没有匹配的功能"
              description="尝试其他关键词，或清除搜索框后查看全部快捷键。"
              primaryAction={{
                label: '清除搜索',
                onClick: () => setQuery(''),
              }}
            />
          )}
        </div>
      </section>

      {editingId && (
        <ShortcutRecorder
          id={editingId}
          onCommit={(binding) => commit(editingId, binding)}
          onCancel={() => setEditingId(null)}
        />
      )}
      </AppPageShell.Body>
    </AppPageShell>
  );
}
