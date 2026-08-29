import { useState, type ReactNode } from "react";

/** 动作按钮（primary=强调实底 / danger=危险 / 默认=中性描边），带 hover/pressed 令牌化样式。
 *  与 Toolbar 的 ToolbarButton 语义不同：ActionBtn 用于面板内按钮，带文字标签。 */
export default function ActionBtn({ children, onClick, disabled, variant }: {
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
