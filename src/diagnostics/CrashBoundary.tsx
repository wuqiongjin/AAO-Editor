/**
 * 渲染崩溃兜底（ADR-0019 §5 / 票 03）：错误态 + 重试；原始错误只进 logger。
 */
import { Component, Fragment, useCallback, useState, type ReactNode } from 'react';
import { AlertTriangle, Download, RotateCcw } from 'lucide-react';
import { useConfig, useCurrentProject } from '../app/ProviderTree';
import { t, type MessageKey } from '../i18n';
import EmptyState from '../ui/EmptyState';
import { showToast } from '../ui/Toast';
import { exportDiagnostics } from './exportDiagnostics';
import { logger, type Logger } from './logger';
import { trail } from './trail';
import './crash.css';

export type CrashScope = 'app' | 'page' | 'canvas';

export interface CrashBoundaryProps {
  scope: CrashScope;
  children: ReactNode;
  logger?: Pick<Logger, 'error'>;
  onExportDiagnostics?: (includeChart: boolean) => void | Promise<void>;
}

interface CrashState {
  error: Error | null;
  resetKey: number;
}

export class CrashBoundary extends Component<CrashBoundaryProps, CrashState> {
  state: CrashState = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<CrashState> {
    return { error };
  }

  componentDidCatch(error: Error): void {
    const log = this.props.logger ?? logger;
    log.error(`[crash:${this.props.scope}]`, error.message || 'render error', error);
    // 崩溃路径只求尽力落盘：componentDidCatch 是同步的，不等 Promise；
    // 需要「落盘后再组包」的场景（导出诊断包）走 exportDiagnostics 里的 await trail.flush()。
    void trail.flush();
  }

  private retry = (): void => {
    this.setState((s) => ({ error: null, resetKey: s.resetKey + 1 }));
  };

  render() {
    if (this.state.error) {
      return (
        <CrashFallback
          scope={this.props.scope}
          onRetry={this.retry}
          onExportDiagnostics={this.props.onExportDiagnostics}
        />
      );
    }
    return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>;
  }
}

function CrashFallback({
  scope,
  onRetry,
  onExportDiagnostics,
}: {
  scope: CrashScope;
  onRetry: () => void;
  onExportDiagnostics?: (includeChart: boolean) => void | Promise<void>;
}) {
  const [includeChart, setIncludeChart] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const titleKey = `crash.${scope}.title` as MessageKey;
  const bodyKey = `crash.${scope}.body` as MessageKey;

  const exportAction = onExportDiagnostics
    ? {
        label: t('settings.diagnostics.export'),
        icon: Download,
        disabled: exportBusy,
        onClick: () => {
          if (exportBusy) return;
          setExportBusy(true);
          void Promise.resolve(onExportDiagnostics(includeChart)).finally(() => setExportBusy(false));
        },
      }
    : undefined;

  return (
    <div className="crash-fallback">
      <EmptyState
        icon={AlertTriangle}
        title={t(titleKey)}
        description={t(bodyKey)}
        primaryAction={{ label: t('crash.retry'), onClick: onRetry, icon: RotateCcw }}
        secondaryAction={exportAction}
      >
        {onExportDiagnostics ? (
          <label className="crash-fallback__opt">
            <input
              type="checkbox"
              checked={includeChart}
              onChange={(e) => setIncludeChart(e.target.checked)}
            />
            {t('settings.diagnostics.includeChart')}
          </label>
        ) : null}
      </EmptyState>
    </div>
  );
}

/** 接设置 / 当前工程，崩溃态可导出诊断包（票 04 已落地）。 */
export function CrashBoundaryHost({
  scope,
  pageId,
  children,
}: {
  scope: CrashScope;
  pageId: string;
  children: ReactNode;
}) {
  const { settings } = useConfig();
  const { projectId, store } = useCurrentProject();

  const onExport = useCallback(async (includeChart: boolean) => {
    try {
      const result = await exportDiagnostics({
        pageId,
        projectId,
        settings,
        includeChart,
        getProject: (id) => store.get(id),
      });
      if ('unavailable' in result) {
        showToast(t('settings.diagnostics.failed'), 'danger');
        return;
      }
      if (!result.cancelled) showToast(t('settings.diagnostics.exported'), 'success');
    } catch (err) {
      logger.error('[diagnostics]', '导出诊断包失败', err);
      showToast(t('settings.diagnostics.failed'), 'danger');
    }
  }, [pageId, projectId, settings, store]);

  return (
    <CrashBoundary scope={scope} onExportDiagnostics={onExport}>
      {children}
    </CrashBoundary>
  );
}
