// @vitest-environment jsdom
// issue 180 锁测：窄工具轨（177 Q2 / Q10 / Q11）——15 键 5 组、持工具态
// issue 256：复制 / 剪切进动作族，按钮只 arm/释放，不写剪贴板
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

function CopySel() {
  const { copy } = useEditing();
  return (
    <button type="button" onClick={() => copy()}>
      copy-sel
    </button>
  );
}

function ClipboardProbe() {
  const { clipboard } = useEditing();
  return <output data-testid="clip">{clipboard.length}</output>;
}

/** issue 186：点片段卡片 = 进片段粘贴持工具态（此处用探针模拟抽屉的那次回调） */
function PastePattern() {
  const { togglePatternPaste } = useUI();
  return (
    <button
      type="button"
      onClick={() => togglePatternPaste({
        id: 'p1',
        name: '片段 1',
        createdAt: 1,
        notes: [{ type: 'Single', beat: 0, lane: 3 }],
        bpmContext: { startBpm: 120, events: [] },
      })}
    >
      paste-pattern
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
          <CopySel />
          <PastePattern />
          <ArmedProbe />
          <ClipboardProbe />
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

  it('issue 256：复制 / 剪切与删除同构——无选区可进态；有选区点击也只进态、不写剪贴板；再点落回指针', () => {
    setup();
    expect(tool('复制')).toBeEnabled();
    expect(tool('剪切')).toBeEnabled();
    expect(tool('复制')).toHaveAttribute('aria-pressed', 'false');
    expect(tool('剪切')).not.toHaveClass('is-danger');
    expect(tool('删除')).toHaveClass('is-danger');

    fireEvent.click(tool('复制'));
    expect(armed()).toBe('copy');
    expect(tool('复制')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('clip')).toHaveTextContent('0');

    fireEvent.click(screen.getByRole('button', { name: 'select-one' }));
    fireEvent.click(tool('剪切'));
    expect(armed()).toBe('cut');
    expect(tool('剪切')).toHaveAttribute('aria-pressed', 'true');
    expect(tool('复制')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('clip')).toHaveTextContent('0');
    expect(tool('粘贴')).toBeDisabled();

    fireEvent.click(tool('剪切'));
    expect(armed()).toBe('pointer');
    expect(tool('剪切')).toHaveAttribute('aria-pressed', 'false');
  });

  it('粘贴空剪贴板置灰，tooltip 说明原因', () => {
    setup();
    expect(tool('粘贴')).toBeDisabled();
    expect(within(tool('粘贴')).getByRole('tooltip')).toHaveTextContent('剪贴板为空');
  });
});

describe('issue 186 · 片段粘贴态下的「粘贴」钮', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('剪贴板非空 → 回剪贴板来源（仍持粘贴工具，不退出）', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'select-one' }));
    fireEvent.click(screen.getByRole('button', { name: 'copy-sel' }));

    fireEvent.click(screen.getByRole('button', { name: 'paste-pattern' }));
    expect(armed()).toBe('paste');
    expect(tool('粘贴')).toBeEnabled();

    fireEvent.click(tool('粘贴'));
    expect(armed()).toBe('paste'); // 只是换了负载来源
    // 已是纯剪贴板态 → 再点一次 = 落回指针（§2 原则 3）
    fireEvent.click(tool('粘贴'));
    expect(armed()).toBe('pointer');
  });

  it('剪贴板为空 → 这一击退到指针（空剪贴板不进粘贴态，ADR-0008 §2.1）', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'paste-pattern' }));
    expect(armed()).toBe('paste');
    // 片段态下钮不能置灰，否则「回剪贴板」与「高亮退出」两条出口都没了
    expect(tool('粘贴')).toBeEnabled();

    fireEvent.click(tool('粘贴'));
    expect(armed()).toBe('pointer');
  });
});
