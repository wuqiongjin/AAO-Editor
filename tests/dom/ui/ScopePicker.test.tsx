// @vitest-environment jsdom
// issue 22（ADR-0015 §6）：作用域切换器的行为锁测。
//
// 只测组件自身的契约——展示态、打开/关闭、搜索过滤、键盘与焦点。它"被谁用、列表从哪来"
// 是页面接线的事，走 pages / workspace 下的测；组件是受控的，不读 store，所以这里不用 Provider。
//
// 两处按结构取节点，理由写在这里：
//   - `.scope-picker__tag`：徽标文案与行内「当前」小签同字，只能靠类名分开；
//   - `.pp-menu__scrim`：「点面板外」这个动作只有遮罩能表达。
// 视觉（面板宽度、右缘对齐、配色）jsdom 无布局引擎 → 人工门票。
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ScopePicker, { type ScopeOption } from '@/src/ui/ScopePicker';

// p2 故意 name / artist / audioName 全空：它是「显示名当匹配源」那条断言的靶子
// （只匹配原始字段的话，自动新建的工程在列表里搜不到）。
const OPTIONS: ScopeOption[] = [
  { id: 'p1', name: 'Alpha', artist: 'AYA', audioName: 'alpha.mp3', locked: false },
  { id: 'p2', name: null, artist: null, audioName: null, locked: true },
  { id: 'p3', name: 'こころのたね', artist: 'Ray', audioName: 'kokoro.mp3', locked: false },
];

function renderPicker(overrides: Partial<Parameters<typeof ScopePicker>[0]> = {}) {
  const onPick = vi.fn();
  const props = {
    scopeId: 'p1',
    currentId: 'p1' as string | null,
    scopeName: 'Alpha' as string | null,
    options: OPTIONS,
    ...overrides,
  };
  const utils = render(<ScopePicker {...props} onPick={onPick} />);
  return { onPick, ...utils };
}

/** 触发钮：可访问名带作用域工程名，用前缀锁住而不是拼全文（名字会变） */
const trigger = () => screen.getByRole('button', { name: /^作用域工程：/ });
const tag = () => document.querySelector('.scope-picker__tag') as HTMLElement;
const panel = () => screen.getByRole('listbox', { name: '选择本页作用的工程' });
const search = () => screen.getByRole('textbox', { name: '搜索工程' });
const scrim = () => document.querySelector('.pp-menu__scrim') as HTMLElement;
const rows = () => screen.getAllByRole('option');

function open() {
  fireEvent.click(trigger());
}

describe('issue 22 · 作用域切换器', () => {
  describe('展示态：当前 / 非当前由徽标 + 容器两处一起说', () => {
    it('作用域就是当前工程：徽标「当前」，容器不带非当前态', () => {
      renderPicker({ scopeId: 'p1', currentId: 'p1' });

      expect(tag()).toHaveTextContent('当前');
      expect(tag()).toHaveClass('is-current');
      expect(document.querySelector('.scope-picker')).not.toHaveClass('is-other');
    });

    it('作用域是别的工程：徽标「非当前工程」+ 容器进 is-other（被框出来，但不报警）', () => {
      renderPicker({ scopeId: 'p3', currentId: 'p1', scopeName: 'こころのたね' });

      expect(tag()).toHaveTextContent('非当前工程');
      expect(tag()).toHaveClass('is-other');
      expect(document.querySelector('.scope-picker')).toHaveClass('is-other');
    });

    it('压根没有当前工程时不算「当前」（没有可比的基准，就别声称自己在当前工程上）', () => {
      renderPicker({ scopeId: 'p1', currentId: null });

      expect(tag()).toHaveTextContent('非当前工程');
    });

    it('工程没名字时触发钮说的是「未命名工程」，不是空一片', () => {
      renderPicker({ scopeId: 'p2', currentId: 'p1', scopeName: null });

      expect(screen.getByRole('button', { name: '作用域工程：未命名工程，点击切换' })).toBeInTheDocument();
      expect(trigger()).toHaveTextContent('未命名工程');
    });

    it('触发钮带 aria-haspopup / aria-expanded，展开时是 true', () => {
      renderPicker();
      expect(trigger()).toHaveAttribute('aria-haspopup', 'listbox');
      expect(trigger()).toHaveAttribute('aria-expanded', 'false');

      open();
      expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    });
  });

  describe('浮层：必须是 portal，且打开即聚焦搜索框', () => {
    it('面板挂在 body 下（不被卡片的 stacking context / overflow: clip 困住）', () => {
      renderPicker();
      open();

      expect(panel().parentElement).toBe(document.body);
      // 关键的一半：它不在组件自己的子树里 —— 组件住区块头，那里有动画终止态建的常驻
      // stacking context 与 overflow: clip
      expect(document.querySelector('.scope-picker')).not.toContainElement(panel());
    });

    it('打开即把焦点落在搜索框（不用再手点一下）', () => {
      renderPicker();
      open();

      expect(search()).toHaveFocus();
    });

    it('再次点触发钮收起，面板从 DOM 里消失', () => {
      renderPicker();
      open();
      fireEvent.click(trigger());

      expect(screen.queryByRole('listbox')).toBeNull();
      expect(document.querySelector('.pp-menu__scrim')).toBeNull();
    });

    it('重新打开时清空上一次的搜索词（收起前的过滤不该带回列表）', () => {
      renderPicker();
      open();
      fireEvent.change(search(), { target: { value: 'ray' } });
      expect(rows()).toHaveLength(1);

      fireEvent.keyDown(window, { key: 'Escape' });
      open();

      expect(search()).toHaveValue('');
      expect(rows()).toHaveLength(3);
    });
  });

  describe('列表：当前项置顶并分组，其余按调用方给的序', () => {
    it('当前项被提到最前、带「当前」小签，且与其余之间有一条分组线', () => {
      // 调用方给的序里 p2 在中间 —— 置顶是组件做的，不是"恰好就排在第一个"
      renderPicker({ scopeId: 'p2', currentId: 'p2', scopeName: null });
      open();

      expect(rows()[0]).toHaveTextContent('未命名工程');
      expect(rows()[0].querySelector('.pp-current-tag')).toHaveTextContent('当前');
      expect(rows()[0]).toHaveAttribute('aria-selected', 'true');
      expect(rows()[1]).not.toHaveTextContent('未命名工程');
      expect(document.querySelector('.scope-panel__sep')).not.toBeNull();
    });

    it('当前工程不在候选里（例如刚被删）时不硬塞分隔线', () => {
      renderPicker({ scopeId: 'p1', currentId: 'gone' });
      open();

      expect(document.querySelector('.pp-current-tag')).toBeNull();
      expect(document.querySelector('.scope-panel__sep')).toBeNull();
    });

    it('只有当前工程一项时也不画分隔线（没有"其余"可分组）', () => {
      renderPicker({
        scopeId: 'p1',
        currentId: 'p1',
        options: [OPTIONS[0]],
      });
      open();

      expect(rows()).toHaveLength(1);
      expect(document.querySelector('.scope-panel__sep')).toBeNull();
    });

    it('锁标识只出现在锁定的工程上', () => {
      renderPicker({ scopeId: 'p1', currentId: 'p1' });
      open();

      const locks = document.querySelectorAll('.scope-panel__lock');
      expect(locks).toHaveLength(1);
      expect(rows()[1]).toContainElement(locks[0] as HTMLElement);
      expect(locks[0]).toHaveAttribute('title', '含已上传谱面：音频不可更换或清除');
    });
  });

  describe('搜索：匹配显示名与歌手', () => {
    it('搜得到没有名字的工程（匹配的是显示名「未命名工程」，不是原始 name）', () => {
      renderPicker();
      open();
      fireEvent.change(search(), { target: { value: '未命名' } });

      expect(rows()).toHaveLength(1);
      expect(rows()[0]).toHaveTextContent('未命名工程');
    });

    it('搜得到歌手，且大小写不敏感', () => {
      renderPicker();
      open();
      fireEvent.change(search(), { target: { value: 'ray' } });

      expect(rows()).toHaveLength(1);
      expect(rows()[0]).toHaveTextContent('こころのたね');
      expect(rows()[0]).not.toHaveTextContent('Alpha');
    });

    it('没有命中时给出空态文案，而不是留一片空面板', () => {
      renderPicker();
      open();
      fireEvent.change(search(), { target: { value: 'zzz' } });

      expect(screen.queryAllByRole('option')).toHaveLength(0);
      expect(document.querySelector('.scope-panel__empty')).toHaveTextContent('没有匹配的工程');
    });
  });

  describe('关闭：选一项 / Esc（还给焦点）/ 点面板外', () => {
    it('点一项 → onPick(工程 id) 并关闭', () => {
      const { onPick } = renderPicker();
      open();

      fireEvent.click(screen.getByRole('option', { name: /こころのたね/ }));

      expect(onPick).toHaveBeenCalledTimes(1);
      expect(onPick).toHaveBeenCalledWith('p3');
      expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('点当前项也行（幂等选择，不该被吞掉）', () => {
      const { onPick } = renderPicker();
      open();

      fireEvent.click(screen.getByRole('option', { name: /Alpha/ }));

      expect(onPick).toHaveBeenCalledWith('p1');
    });

    it('Esc 关面板并把焦点还给触发钮', () => {
      const { onPick } = renderPicker();
      open();

      fireEvent.keyDown(window, { key: 'Escape' });

      expect(screen.queryByRole('listbox')).toBeNull();
      expect(trigger()).toHaveFocus();
      expect(onPick).not.toHaveBeenCalled();
    });

    it('点面板外（遮罩）关闭，不误触发选择', () => {
      const { onPick } = renderPicker();
      open();

      fireEvent.click(scrim());

      expect(screen.queryByRole('listbox')).toBeNull();
      expect(onPick).not.toHaveBeenCalled();
    });
  });
});
