// @vitest-environment jsdom
// issue 178 锁测：顶栏节拍吸附胶囊（177 Q4 / Q5 / Q16 + 网格 4×3）
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { UIProvider } from '@/src/app/providers/UIProvider';
import BeatSnapCapsule from '@/src/pages/workspace/BeatSnapCapsule';
import { SETTINGS_KEY, seedZhSettings } from '@/tests/support/storage';

function setup(patch: Record<string, unknown> = {}) {
  seedZhSettings(patch);
  render(
    <ConfigProvider>
      <UIProvider>
        <BeatSnapCapsule />
      </UIProvider>
    </ConfigProvider>,
  );
}

const pill = () => screen.getByRole('button', { name: '节拍吸附' });
const dialog = () => screen.getByRole('dialog', { name: '节拍吸附' });
const queryDialog = () => screen.queryByRole('dialog', { name: '节拍吸附' });
const customInput = () => within(dialog()).getByRole('textbox', { name: '自定义细分' });
const storedSnap = () => (JSON.parse(localStorage.getItem(SETTINGS_KEY)!) as { beatSnap: number }).beatSnap;

describe('issue 178 · 节拍吸附胶囊', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('胶囊显示当前档位；读的是上次存下的值', () => {
    setup({ beatSnap: 12 });
    expect(pill()).toHaveTextContent('1/12');
  });

  it('点击弹出 12 档预设，当前档高亮；选一档即写盘并收回', () => {
    setup();
    fireEvent.click(pill());
    const chips = within(dialog()).getAllByRole('button', { name: /^1\/\d+$/ });
    expect(chips.map((c) => c.textContent)).toEqual(
      ['1/1', '1/2', '1/3', '1/4', '1/6', '1/8', '1/12', '1/16', '1/24', '1/32', '1/48', '1/64'],
    );
    expect(within(dialog()).getByRole('button', { name: '1/4' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(within(dialog()).getByRole('button', { name: '1/24' }));
    expect(storedSnap()).toBe(24);
    expect(pill()).toHaveTextContent('1/24');
    expect(queryDialog()).not.toBeInTheDocument();
  });

  it('滚轮在胶囊上步进：上滚变细、下滚变粗', () => {
    setup();
    fireEvent.wheel(pill(), { deltaY: -100 });
    expect(pill()).toHaveTextContent('1/6');
    fireEvent.wheel(pill(), { deltaY: 100 });
    fireEvent.wheel(pill(), { deltaY: 100 });
    expect(pill()).toHaveTextContent('1/3');
    expect(storedSnap()).toBe(3);
  });

  it('自定义：合法值回车生效并收回，胶囊显示该值', () => {
    setup();
    fireEvent.click(pill());
    fireEvent.change(customInput(), { target: { value: '7' } });
    fireEvent.keyDown(customInput(), { key: 'Enter' });
    expect(storedSnap()).toBe(7);
    expect(pill()).toHaveTextContent('1/7');
    expect(queryDialog()).not.toBeInTheDocument();
  });

  it('自定义：越界回车无效、标红、面板不收', () => {
    setup();
    fireEvent.click(pill());
    fireEvent.change(customInput(), { target: { value: '193' } });
    fireEvent.keyDown(customInput(), { key: 'Enter' });
    expect(pill()).toHaveTextContent('1/4');
    expect(customInput()).toHaveAttribute('aria-invalid', 'true');
    expect(dialog()).toBeInTheDocument();
  });

  it('点外面 / Esc 收回', () => {
    setup();
    fireEvent.click(pill());
    fireEvent.mouseDown(document.body);
    expect(queryDialog()).not.toBeInTheDocument();

    fireEvent.click(pill());
    fireEvent.keyDown(customInput(), { key: 'Escape' });
    expect(queryDialog()).not.toBeInTheDocument();
  });
});
