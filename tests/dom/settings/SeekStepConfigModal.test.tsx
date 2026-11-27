// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import ShortcutsPage from '@/src/pages/settings/ShortcutsPage';
import { renderWithProviders } from '@/tests/support/providers';
import { stubPageShellEnv } from '@/tests/support/domEnv';
import { SETTINGS_KEY, seedZhSettings } from '@/tests/support/storage';

function mountPage() {
  return renderWithProviders(
    <ConfigProvider>
      <ShortcutsPage />
    </ConfigProvider>,
  );
}

const rowOf = (label: string): HTMLElement => {
  const cell = screen.getAllByText(label)[0];
  const row = cell.closest('.shortcut-row');
  if (!row) throw new Error(`找不到「${label}」所在行`);
  return row as HTMLElement;
};

const storedSteps = (): { back: number; forward: number } => {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return { back: NaN, forward: NaN };
  const parsed = JSON.parse(raw) as { seekStepBackSeconds: number; seekStepForwardSeconds: number };
  return { back: parsed.seekStepBackSeconds, forward: parsed.seekStepForwardSeconds };
};

describe('issue 251 · 键盘 seek 步长弹窗 DOM', () => {
  beforeEach(() => {
    window.localStorage.clear();
    seedZhSettings({
      seekStepBackSeconds: 1,
      seekStepForwardSeconds: 1,
    });
    stubPageShellEnv();
    Element.prototype.scrollTo = (() => {}) as unknown as typeof Element.prototype.scrollTo;
  });

  it('播放桶两行都有齿轮，点任一枚弹出同一弹窗两格', () => {
    mountPage();
    const backRow = rowOf('后退一步');
    const forwardRow = rowOf('前进一步');
    expect(within(backRow).getByRole('button', { name: '配置键盘 seek 步长' })).toBeInTheDocument();
    expect(within(forwardRow).getByRole('button', { name: '配置键盘 seek 步长' })).toBeInTheDocument();

    fireEvent.click(within(forwardRow).getByRole('button', { name: '配置键盘 seek 步长' }));
    const dialog = screen.getByRole('dialog', { name: /键盘 seek 步长/ });
    expect(within(dialog).getByRole('spinbutton', { name: '后退步长（秒）' })).toHaveValue(1);
    expect(within(dialog).getByRole('spinbutton', { name: '前进步长（秒）' })).toHaveValue(1);
  });

  it('改一格另一格不变；弹窗内恢复默认两格回 1', () => {
    mountPage();
    fireEvent.click(within(rowOf('后退一步')).getByRole('button', { name: '配置键盘 seek 步长' }));
    const dialog = screen.getByRole('dialog', { name: /键盘 seek 步长/ });
    const back = within(dialog).getByRole('spinbutton', { name: '后退步长（秒）' });
    const forward = within(dialog).getByRole('spinbutton', { name: '前进步长（秒）' });

    fireEvent.change(back, { target: { value: '2.5' } });
    fireEvent.blur(back);
    expect(storedSteps()).toEqual({ back: 2.5, forward: 1 });
    expect(forward).toHaveValue(1);

    fireEvent.click(within(dialog).getByRole('button', { name: '恢复默认' }));
    expect(storedSteps()).toEqual({ back: 1, forward: 1 });
    expect(back).toHaveValue(1);
    expect(forward).toHaveValue(1);
  });
});
