import type { ComponentType, MouseEvent, ReactNode } from 'react';
import './ui.css';

// 空态三段式组件：icon + title + description + 可选 primary/secondary 操作按钮。
// 外层 box 决定是否垂直居中（卡片内 / 列表内 / 全页）。

export type EmptyStateAction = {
  label: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  icon?: ComponentType<{ size?: number }>;
  disabled?: boolean;
};

export interface EmptyStateProps {
  icon: ComponentType<{ size?: number }>;
  title: string;
  description?: string;
  primaryAction?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  children?: ReactNode;
}

export default function EmptyState({
  icon: Icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  children,
}: EmptyStateProps) {
  return (
    <div className="empty-state" role="status" aria-live="polite">
      <div className="empty-state__icon" aria-hidden="true">
        <Icon size={48} />
      </div>
      <div className="empty-state__title">{title}</div>
      {description && <div className="empty-state__description">{description}</div>}
      {(primaryAction || secondaryAction) && (
        <div className="empty-state__actions">
          {primaryAction && (
            <ActionButton action={primaryAction} variant="primary" />
          )}
          {secondaryAction && (
            <ActionButton action={secondaryAction} variant="secondary" />
          )}
        </div>
      )}
      {children}
    </div>
  );
}

/* ---- 内部：按钮统一（与 ActionBtn 风格一致；阶段 2 暂不导出复用）---- */
function ActionButton({ action, variant }: { action: EmptyStateAction; variant: 'primary' | 'secondary' }) {
  const Icon = action.icon;
  return (
    <button
      type="button"
      className={`action-btn action-btn--${variant}`}
      onClick={action.onClick}
      disabled={action.disabled}
    >
      {Icon && <span className="action-btn__icon"><Icon size={15} /></span>}
      <span>{action.label}</span>
    </button>
  );
}
