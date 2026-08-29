import type { ComponentType, MouseEvent, ReactNode } from 'react';
import './ui.css';

// 空态三段式组件（issue 49 阶段 2，2026-08-30 用户拍板）：
// 替代旧的"灰色提示文字"（如 .empty-result / "未设置"等），按 redesign-skill
// "Empty states are mini onboarding moments" 给出图标 + 标题 + 描述 + 主操作。
//
// 阶段 2 v1 沿用版（subagent v1 已被用户回滚，本版由 v2 重建）：
//   - 三段式：icon（subtle 色） + title（base 粗体） + description（muted 副文）
//            + 可选 primaryAction（实底主按钮）/ secondaryAction（描边次按钮）；
//   - 主按钮复用 ActionBtn 变体（避免再造按钮交互态）；
//   - padding / icon size 暂用默认值（var(--space-8) 32px / 48px），待用户拍板；
//   - 所有 children 直通顶部，便于在 description 下追加"次要说明 / 链接 / 图例"。
//
// 不假设"空态一定垂直居中"——外层 box 决定（卡片内 / 列表内 / 全页）。

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
