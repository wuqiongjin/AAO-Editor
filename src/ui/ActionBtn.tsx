import type { ReactNode } from "react";
import './ui.css';

/** 动作按钮（primary=强调实底 / danger=危险 / 默认=中性描边）。
 *  交互态（hover / active / focus）全部走 CSS，组件不维护 useState。
 *  与 IconButton 共用同一交互系统，issue 49 阶段 1 #3。 */
export default function ActionBtn({ children, onClick, disabled, variant, autoFocus }: {
  children: ReactNode; onClick: () => void; disabled?: boolean;
  variant?: 'primary' | 'danger';
  /** 挂载即得焦点：确认弹窗的确认键靠它，键盘用户不必先 Tab 过去 */
  autoFocus?: boolean;
}) {
  const classes = ['action-btn'];
  if (variant === 'primary') classes.push('action-btn--primary');
  else if (variant === 'danger') classes.push('action-btn--danger');

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      autoFocus={autoFocus}
      className={classes.join(' ')}
    >
      {children}
    </button>
  );
}
