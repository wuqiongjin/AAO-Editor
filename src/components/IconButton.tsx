import { useState, type ReactNode, type MouseEvent } from 'react';

// 统一按钮（issue 22 交互统一，Q6）：全站唯一按钮交互态出处。
// 覆盖三种历史写法（ToolbarButton 内联 / PlayBar onMouseEnter / Editor inlineIconBtn）：
// hover / pressed(scale) / active / disabled / danger / outlined 全套态 + focus-visible 焦点环。
interface IconButtonProps {
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  title?: string;
  active?: boolean;
  outlined?: boolean;
  danger?: boolean;
  icon?: ReactNode;
  label?: string;
  /** 宽度策略：'full' 铺满父级（左对齐文字），'auto' 仅内容宽度（居中） */
  width?: 'full' | 'auto';
  size?: 'sm' | 'md';
  [key: string]: unknown;
}

export default function IconButton({
  onClick, disabled, title, active, outlined, danger, icon, label,
  width = 'full', size = 'md',
  ...rest
}: IconButtonProps) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);

  let bg = 'transparent';
  let fg: string | undefined;
  let border = '1px solid transparent';
  if (active) {
    bg = 'var(--accent-soft)'; fg = 'var(--accent-text)'; border = '1px solid var(--accent)';
  } else if (danger) {
    bg = hover ? 'var(--danger-soft)' : 'transparent'; fg = 'var(--danger-text)';
  } else if (outlined) {
    bg = hover ? 'var(--bg-hover)' : 'var(--bg-inset)'; border = '1px solid var(--border)'; fg = 'var(--text)';
  } else {
    bg = hover ? 'var(--bg-hover)' : 'transparent'; fg = disabled ? 'var(--text-subtle)' : 'var(--text)';
  }

  const isSquare = !label;
  const pad = size === 'sm'
    ? (isSquare ? '6px' : '5px var(--space-2)')
    : (isSquare ? '8px' : 'var(--space-2) var(--space-3)');
  const fontSize = size === 'sm' ? 'var(--text-xs)' : 'var(--text-sm)';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      style={{
        width: width === 'full' ? '100%' : undefined,
        display: 'flex', alignItems: 'center', justifyContent: isSquare ? 'center' : 'flex-start',
        gap: 'var(--space-3)',
        padding: pad,
        borderRadius: 'var(--radius-sm)',
        border,
        backgroundColor: bg,
        color: fg,
        cursor: disabled ? 'not-allowed' : 'pointer',
        textAlign: 'left',
        fontFamily: 'inherit', fontSize,
        opacity: disabled ? 0.45 : 1,
        transform: pressed ? 'scale(0.98)' : undefined,
        outline: 'none',
        transition: 'background-color var(--dur) var(--ease), color var(--dur) var(--ease), border-color var(--dur) var(--ease), transform var(--dur) var(--ease)',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPressed(false); }}
      onMouseDown={(e) => { if (!disabled) { e.preventDefault(); setPressed(true); } }}
      onMouseUp={() => setPressed(false)}
      {...(rest as Record<string, unknown>)}
    >
      {icon && <span style={{ display: 'flex', flexShrink: 0 }}>{icon}</span>}
      {label && <span style={{ whiteSpace: 'nowrap' }}>{label}</span>}
    </button>
  );
}
