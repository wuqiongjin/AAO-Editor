// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import ShortcutsPage from '@/src/pages/settings/ShortcutsPage';
import { renderWithProviders } from '@/tests/support/providers';
import { stubPageShellEnv } from '@/tests/support/domEnv';
import { SETTINGS_KEY, seedZhSettings } from '@/tests/support/storage';
import { BEAT_SNAP_PRESETS } from '@/src/chart/editing/BeatSnap';

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

const getStoredCycleList = (): number[] => {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return [];
  return (JSON.parse(raw) as { beatSnapCycleList: number[] }).beatSnapCycleList;
};

describe('issue 216 · 常用循环档位配置弹窗 DOM 交互锁测', () => {
  beforeEach(() => {
    window.localStorage.clear();
    seedZhSettings({
      beatSnapCycleList: [4, 8, 12, 16],
    });
    stubPageShellEnv();
    Element.prototype.scrollTo = (() => {}) as unknown as typeof Element.prototype.scrollTo;
  });

  it('在快捷键设置页的 beatSnapCycle 行渲染配置按钮，点击弹出配置弹窗', () => {
    mountPage();

    const row = rowOf('循环常用档');
    const configBtn = within(row).getByRole('button', { name: '配置循环常用档' });
    expect(configBtn).toBeInTheDocument();

    // 点击打开弹窗
    fireEvent.click(configBtn);

    const dialog = screen.getByRole('dialog', { name: /节拍吸附循环常用档/ });
    expect(dialog).toBeInTheDocument();
  });

  it('渲染顶部循环序列流与 12 个快捷预设芯片，支持点击切换勾选', () => {
    mountPage();
    const row = rowOf('循环常用档');
    fireEvent.click(within(row).getByRole('button', { name: '配置循环常用档' }));

    const dialog = screen.getByRole('dialog', { name: /节拍吸附循环常用档/ });

    // 顶部循环序列流展示当前生效的 [4, 8, 12, 16]
    const seqList = within(dialog).getByRole('list', { name: '当前循环序列' });
    expect(within(seqList).getByText('1/4')).toBeInTheDocument();
    expect(within(seqList).getByText('1/8')).toBeInTheDocument();
    expect(within(seqList).getByText('1/12')).toBeInTheDocument();
    expect(within(seqList).getByText('1/16')).toBeInTheDocument();

    const chipsGroup = within(dialog).getByRole('group', { name: '快捷预设档位' });
    const chips = within(chipsGroup).getAllByRole('button');

    // 12 个预设全列
    expect(chips).toHaveLength(BEAT_SNAP_PRESETS.length);
    expect(chips.map((c) => c.textContent?.trim())).toEqual(
      BEAT_SNAP_PRESETS.map((p) => `1/${p}`),
    );

    // 默认 [4, 8, 12, 16] 勾选 (aria-pressed === 'true')
    const activePresets = [4, 8, 12, 16];
    for (const preset of BEAT_SNAP_PRESETS) {
      const chip = within(chipsGroup).getByRole('button', { name: `1/${preset}` });
      const expectedPressed = activePresets.includes(preset) ? 'true' : 'false';
      expect(chip).toHaveAttribute('aria-pressed', expectedPressed);
    }

    // 点击 1/24 进行勾选：加入序列流，升序排在末尾
    const chip24 = within(chipsGroup).getByRole('button', { name: '1/24' });
    fireEvent.click(chip24);
    expect(chip24).toHaveAttribute('aria-pressed', 'true');
    expect(getStoredCycleList()).toEqual([4, 8, 12, 16, 24]);
    expect(within(seqList).getByText('1/24')).toBeInTheDocument();

    // 点击 1/8 取消勾选：移出序列流
    const chip8 = within(chipsGroup).getByRole('button', { name: '1/8' });
    fireEvent.click(chip8);
    expect(chip8).toHaveAttribute('aria-pressed', 'false');
    expect(getStoredCycleList()).toEqual([4, 12, 16, 24]);
    expect(within(seqList).queryByText('1/8')).not.toBeInTheDocument();
  });

  it('输入自定义数值添加，自动按升序插入顶部循环序列流，并支持点击 × 移除', () => {
    mountPage();
    const row = rowOf('循环常用档');
    fireEvent.click(within(row).getByRole('button', { name: '配置循环常用档' }));

    const dialog = screen.getByRole('dialog', { name: /节拍吸附循环常用档/ });
    const input = within(dialog).getByRole('spinbutton', { name: '添加自定义细分' });
    const seqList = within(dialog).getByRole('list', { name: '当前循环序列' });

    // 输入 7 按回车添加
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // 存储更新，自动升序排列
    expect(getStoredCycleList()).toEqual([4, 7, 8, 12, 16]);
    expect(input).toHaveValue(null); // 输入框已清空

    // 顶部循环序列流中展示 1/7
    expect(within(seqList).getByText('1/7')).toBeInTheDocument();

    // 输入 5 点击「添加」按钮添加
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '添加' }));
    expect(getStoredCycleList()).toEqual([4, 5, 7, 8, 12, 16]);
    expect(within(seqList).getByText('1/5')).toBeInTheDocument();

    // 点击 1/7 的 × 按钮从循环序列中删除
    const remove7 = within(seqList).getByRole('button', { name: '从序列中移除 1/7' });
    fireEvent.click(remove7);
    expect(getStoredCycleList()).toEqual([4, 5, 8, 12, 16]);
    expect(within(seqList).queryByText('1/7')).not.toBeInTheDocument();
  });

  it('弹窗内的「恢复默认」按钮仅恢复循环列表为 [4, 8, 12, 16]，与外部快捷键状态解耦', () => {
    mountPage();
    const row = rowOf('循环常用档');
    fireEvent.click(within(row).getByRole('button', { name: '配置循环常用档' }));

    const dialog = screen.getByRole('dialog', { name: /节拍吸附循环常用档/ });
    const input = within(dialog).getByRole('spinbutton', { name: '添加自定义细分' });

    // 添加自定义数值
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(getStoredCycleList()).toContain(9);

    // 点击弹窗内「恢复默认」
    const resetBtn = within(dialog).getByRole('button', { name: '恢复默认' });
    fireEvent.click(resetBtn);

    // 恢复为 [4, 8, 12, 16]
    expect(getStoredCycleList()).toEqual([4, 8, 12, 16]);

    // 关闭弹窗
    fireEvent.click(within(dialog).getByRole('button', { name: '完成' }));
    expect(screen.queryByRole('dialog', { name: /节拍吸附循环常用档/ })).not.toBeInTheDocument();
  });

  it('允许用户取消勾选全部预设清空常用档位，展示友好兜底提示且不会过早重置', () => {
    mountPage();
    const row = rowOf('循环常用档');
    fireEvent.click(within(row).getByRole('button', { name: '配置循环常用档' }));

    const dialog = screen.getByRole('dialog', { name: /节拍吸附循环常用档/ });
    const chipsGroup = within(dialog).getByRole('group', { name: '快捷预设档位' });

    // 依次取消勾选 4, 8, 12, 16
    for (const preset of [4, 8, 12, 16]) {
      const chip = within(chipsGroup).getByRole('button', { name: `1/${preset}` });
      fireEvent.click(chip);
    }

    // 存储被清空为 []，所有芯片均为未选中，不会提前被重置为默认值
    expect(getStoredCycleList()).toEqual([]);
    for (const preset of [4, 8, 12, 16]) {
      const chip = within(chipsGroup).getByRole('button', { name: `1/${preset}` });
      expect(chip).toHaveAttribute('aria-pressed', 'false');
    }

    // 序列区域展示兜底提示
    expect(within(dialog).getByRole('status')).toHaveTextContent(/当前序列为空/);
  });

  it('点击未绑定功能的「启用」开关，直接唤起录制弹窗引导用户设键', () => {
    mountPage();
    const row = rowOf('循环常用档');
    const switchBtn = within(row).getByRole('button', { name: '启用循环常用档' });
    expect(switchBtn).toBeInTheDocument();

    fireEvent.click(switchBtn);

    // 唤起改键录制浮层
    expect(screen.getByText('先按所需的组合键，再按 enter 键。')).toBeInTheDocument();
    expect(screen.getByText(/循环常用档.*Enter 确认 · Esc 取消/)).toBeInTheDocument();
  });
});
