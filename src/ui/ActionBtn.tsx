import type { ReactNode } from "react";
import './ui.css';

/** 动作按钮（primary=强调实底 / danger=危险 / 默认=中性描边）。
 *  交互态（hover / active / focus）全部走 CSS，组件不维护 useState。
 *  与 IconButton 共用同一交互系统，issue 49 阶段 1 #3。 */
export default function ActionBtn({ children, onClick, disabled, variant, autoFocus, type = 'button', form }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean;
  variant?: 'primary' | 'danger' | 'danger-solid';
  /** 挂载即得焦点：确认弹窗的确认键靠它，键盘用户不必先 Tab 过去 */
  autoFocus?: boolean;
  /**
   * 提交键（票 39 的登录弹窗）：`type="submit"` + `form` 关联到弹窗里的 `<form>`。
   * 弹窗的底栏在 `<form>` 外面（Dialog 的 body / foot 是两段），所以**必须**用 `form` 关联 ——
   * 否则「两个输入框 + 表单外按钮」这组合在 HTML 里按 Enter 什么都不会发生
   * （隐式提交只在表单自带提交键时才触发）。
   */
  type?: 'button' | 'submit';
  form?: string;
}) {
  const classes = ['action-btn'];
  if (variant === 'primary') classes.push('action-btn--primary');
  else if (variant === 'danger') classes.push('action-btn--danger');
  else if (variant === 'danger-solid') classes.push('action-btn--danger-solid');

  return (
    <button
      type={type}
      form={form}
      onClick={onClick}
      disabled={disabled}
      autoFocus={autoFocus}
      className={classes.join(' ')}
    >
      {children}
    </button>
  );
}
