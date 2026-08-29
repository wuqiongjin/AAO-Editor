import type { ReactNode, MouseEvent } from 'react';
import './ui.css';

// 统一按钮（issue 22 交互统一，Q6）：全站唯一按钮交互态出处。
// 覆盖三种历史写法（ToolbarButton 内联 / PlayBar onMouseEnter / Editor inlineIconBtn）：
// hover / active(scale) / disabled / danger / outlined / active 全套态 + focus-visible 焦点环。
// 交互态全部走 CSS（issue 49 阶段 1 #3+#4），组件不维护 useState。
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
