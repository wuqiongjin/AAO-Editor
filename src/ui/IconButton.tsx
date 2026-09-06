import type { ReactNode, MouseEvent } from 'react';
import './ui.css';

// 统一按钮：全站按钮交互态（hover / active / disabled / danger / outlined）走 CSS。
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
  const isSquare = !label;
  const classes = ['icon-btn', `icon-btn--${width}`];
  if (isSquare) classes.push('icon-btn--square');
  if (size === 'sm') classes.push('icon-btn--sm');
  if (active) classes.push('icon-btn--active');
  if (danger) classes.push('icon-btn--danger');
  if (outlined) classes.push('icon-btn--outlined');

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={classes.join(' ')}
      {...(rest as Record<string, unknown>)}
    >
      {icon && <span className="icon-btn__icon">{icon}</span>}
      {label && <span className="icon-btn__label">{label}</span>}
    </button>
  );
}
