// @vitest-environment jsdom
// issue 180 锁测：片段库抽屉外壳（177 Q1 / Q8 / Q14）——内容归 164，这里只锁壳
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import PatternLibraryDrawer from '@/src/pages/workspace/PatternLibraryDrawer';
import { SETTINGS_KEY, seedZhSettings } from '@/tests/support/storage';

const storedDrawer = () =>
  (JSON.parse(localStorage.getItem(SETTINGS_KEY)!) as { layout: { patternDrawer?: { open: boolean; width: number } } })
    .layout.patternDrawer;

function setup(onResizingChange = vi.fn()) {
  seedZhSettings({ layout: { patternDrawer: { open: true, width: 300 } } });
  render(
    <ConfigProvider>
      <PatternLibraryDrawer onResizingChange={onResizingChange} />
    </ConfigProvider>,
  );
  return { onResizingChange };
}

const drawer = () => screen.getByRole('complementary', { name: '片段库' });

describe('issue 180 · 片段库抽屉外壳', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('空状态 + 「收藏选区」占位按钮置灰', () => {
    setup();
    expect(drawer()).toHaveTextContent('还没有收藏的片段');
    expect(screen.getByRole('button', { name: '收藏选区' })).toBeDisabled();
  });

  it('宽度取自设置', () => {
    setup();
    expect(drawer()).toHaveStyle({ width: '300px' });
  });

  it('关闭钮收起抽屉并落盘', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: '收起片段库' }));
    expect(storedDrawer()?.open).toBe(false);
  });

  it('拖左缘改宽：拖动中只改本地宽度，松手才落盘；拖动态上报给页面', () => {
    const { onResizingChange } = setup();
    const resizer = screen.getByRole('separator', { name: '拖动调整片段库宽度' });

    fireEvent.mouseDown(resizer, { clientX: 1000 });
    expect(onResizingChange).toHaveBeenLastCalledWith(true);
    fireEvent.mouseMove(document, { clientX: 980 });
    expect(drawer()).toHaveStyle({ width: '320px' });
    expect(storedDrawer()?.width).toBe(300);

    fireEvent.mouseUp(document, { clientX: 980 });
    expect(storedDrawer()?.width).toBe(320);
    expect(onResizingChange).toHaveBeenLastCalledWith(false);
  });

  it('拖得过窄夹到下限 220', () => {
    setup();
    const resizer = screen.getByRole('separator', { name: '拖动调整片段库宽度' });
    fireEvent.mouseDown(resizer, { clientX: 1000 });
    fireEvent.mouseMove(document, { clientX: 1200 });
    expect(drawer()).toHaveStyle({ width: '220px' });
    fireEvent.mouseUp(document);
    expect(storedDrawer()?.width).toBe(220);
  });
});
