// @vitest-environment jsdom
// issue 180 锁测：窄工具轨（177 Q2 / Q10 / Q11）——15 键 5 组、持工具态、即时动作的置灰
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { UIProvider, useUI } from '@/src/app/providers/UIProvider';
import { EditingProvider, useEditing } from '@/src/app/providers/EditingProvider';
import WorkspaceToolRail from '@/src/pages/workspace/WorkspaceToolRail';
import { seedZhSettings } from '@/tests/support/storage';

function ArmedProbe() {
  const { armedTool } = useUI();
  return <output data-testid="armed">{armedTool ?? 'pointer'}</output>;
}

function SelectOne() {
  const { setNotes, setSelectedItems } = useEditing();
  return (
    <button
      type="button"
      onClick={() => {
        setNotes([{ type: 'Single', beat: 0, lane: 3 }]);
        setSelectedItems([{ kind: 'note', noteIndex: 0 }]);
      }}
    >
      select-one
    </button>
  );
}

function setup() {
  seedZhSettings();
  render(
    <ConfigProvider>
      <UIProvider>
        <EditingProvider>
          <SelectOne />
          <ArmedProbe />
          <WorkspaceToolRail />
        </EditingProvider>
      </UIProvider>
    </ConfigProvider>,
  );
}

const rail = () => screen.getByRole('navigation', { name: '工具栏' });
const tool = (name: string) => within(rail()).getByRole('button', { name });
const armed = () => screen.getByTestId('armed').textContent;

describe('issue 180 · 工作台窄工具轨', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('15 键按 5 组排列：指针｜七种键型｜BPM｜复制剪切粘贴｜删除镜像音符代码', () => {
    setup();
    const groups = rail().querySelectorAll('.wtr__group');
    const names = [...groups].map((g) =>
      within(g as HTMLElement).getAllByRole('button').map((b) => b.getAttribute('aria-label')),
    );
    expect(names).toEqual([
      ['指针'],
      ['单键', '滑键', '技能', '左滑', '右滑', '滑条', '曲线'],
      ['BPM'],
      ['复制', '剪切', '粘贴'],
      ['删除', '镜像', '音符代码'],
    ]);
  });

  it('点工具进持工具态并高亮；再点同一个落回指针', () => {
    setup();
    expect(tool('指针')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(tool('滑条'));
    expect(armed()).toBe('slide');
    expect(tool('滑条')).toHaveAttribute('aria-pressed', 'true');
    expect(tool('指针')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(tool('滑条'));
    expect(armed()).toBe('pointer');
    fireEvent.click(tool('删除'));
    expect(armed()).toBe('delete');
    fireEvent.click(tool('指针'));
    expect(armed()).toBe('pointer');
  });

  it('tooltip 写名称 + 快捷键', () => {
    setup();
    const tip = within(tool('单键')).getByRole('tooltip');
    expect(tip).toHaveTextContent('单键');
    expect(tip.querySelectorAll('kbd').length).toBeGreaterThan(0);
  });

  it('复制 / 剪切是即时动作：无选区置灰并提示，有选区可点且不进持工具态', () => {
    setup();
    expect(tool('复制')).toBeDisabled();
    expect(tool('剪切')).toBeDisabled();
    expect(within(tool('复制')).getByRole('tooltip')).toHaveTextContent('先选中音符');
    expect(tool('复制')).not.toHaveAttribute('aria-pressed');

    fireEvent.click(screen.getByRole('button', { name: 'select-one' }));
    expect(tool('复制')).toBeEnabled();
    expect(tool('粘贴')).toBeDisabled();
    fireEvent.click(tool('复制'));
    expect(armed()).toBe('pointer');
    // 复制后剪贴板非空 → 粘贴可进态
    expect(tool('粘贴')).toBeEnabled();
    fireEvent.click(tool('粘贴'));
    expect(armed()).toBe('paste');
  });

  it('粘贴空剪贴板置灰，tooltip 说明原因', () => {
    setup();
    expect(tool('粘贴')).toBeDisabled();
    expect(within(tool('粘贴')).getByRole('tooltip')).toHaveTextContent('剪贴板为空');
  });
});
