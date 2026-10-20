// @vitest-environment jsdom
// 票 03：渲染错误被 boundary 接住 → i18n 错误态；重试重挂子树；原始错误不进界面。
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createLogger } from '@/src/diagnostics/logger';
import { CrashBoundary } from '@/src/diagnostics/CrashBoundary';
import { setActiveUiLanguage, t } from '@/src/i18n';

const AT = new Date('2026-10-19T09:00:00.000Z');
const SECRET = 'secret-stack-token-xyz';

function silentLogger(writes: unknown[]) {
  return createLogger({
    now: () => AT,
    write: (payload) => writes.push(payload),
    console: { error() {}, warn() {}, info() {} },
  });
}

function Boom({ fail }: { fail: boolean }) {
  if (fail) throw new Error(SECRET);
  return <div>alive</div>;
}

function Host({
  log,
  scope = 'page',
  onExport,
}: {
  log: ReturnType<typeof createLogger>;
  scope?: 'app' | 'page' | 'canvas';
  onExport?: (includeChart: boolean) => void;
}) {
  const [fail, setFail] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setFail(false)}>heal</button>
      <CrashBoundary scope={scope} logger={log} onExportDiagnostics={onExport}>
        <Boom fail={fail} />
      </CrashBoundary>
    </>
  );
}

describe('票 03 · CrashBoundary', () => {
  beforeEach(() => {
    setActiveUiLanguage('zh-CN');
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('接住子树渲染错误：显示 i18n 错误态，不展示原始错误串', () => {
    const writes: unknown[] = [];
    render(
      <CrashBoundary scope="page" logger={silentLogger(writes)}>
        <Boom fail />
      </CrashBoundary>,
    );

    expect(screen.getByText(t('crash.page.title'))).toBeInTheDocument();
    expect(screen.getByText(t('crash.page.body'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('crash.retry') })).toBeInTheDocument();
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
    expect(screen.queryByText('alive')).not.toBeInTheDocument();
    expect(writes.some((row) => (row as { module: string }).module === '[crash:page]')).toBe(true);
  });

  it('app / canvas 的文案与日志模块各不相同', () => {
    const writes: unknown[] = [];
    const log = silentLogger(writes);
    const { unmount } = render(
      <CrashBoundary scope="app" logger={log}>
        <Boom fail />
      </CrashBoundary>,
    );
    expect(screen.getByText(t('crash.app.title'))).toBeInTheDocument();
    expect(writes.some((row) => (row as { module: string }).module === '[crash:app]')).toBe(true);
    unmount();

    render(
      <CrashBoundary scope="canvas" logger={log}>
        <Boom fail />
      </CrashBoundary>,
    );
    expect(screen.getByText(t('crash.canvas.title'))).toBeInTheDocument();
    expect(writes.some((row) => (row as { module: string }).module === '[crash:canvas]')).toBe(true);
  });

  it('点重试后重置并重挂子树', () => {
    const writes: unknown[] = [];
    render(<Host log={silentLogger(writes)} />);
    expect(screen.getByText(t('crash.page.title'))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'heal' }));
    fireEvent.click(screen.getByRole('button', { name: t('crash.retry') }));

    expect(screen.getByText('alive')).toBeInTheDocument();
    expect(screen.queryByText(t('crash.page.title'))).not.toBeInTheDocument();
  });

  it('canvas 点重试后重置并重挂子树', () => {
    render(<Host log={silentLogger([])} scope="canvas" />);
    expect(screen.getByText(t('crash.canvas.title'))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'heal' }));
    fireEvent.click(screen.getByRole('button', { name: t('crash.retry') }));

    expect(screen.getByText('alive')).toBeInTheDocument();
    expect(screen.queryByText(t('crash.canvas.title'))).not.toBeInTheDocument();
  });

  it('导出诊断包把勾选状态交给注入的导出函数', async () => {
    const exported: boolean[] = [];
    render(
      <CrashBoundary
        scope="app"
        logger={silentLogger([])}
        onExportDiagnostics={(includeChart) => {
          exported.push(includeChart);
        }}
      >
        <Boom fail />
      </CrashBoundary>,
    );

    const exportBtn = () => screen.getByRole('button', { name: t('settings.diagnostics.export') });
    fireEvent.click(exportBtn());
    expect(exported).toEqual([false]);
    await waitFor(() => expect(exportBtn()).not.toBeDisabled());

    fireEvent.click(screen.getByRole('checkbox', { name: t('settings.diagnostics.includeChart') }));
    fireEvent.click(exportBtn());
    expect(exported).toEqual([false, true]);
  });
});
