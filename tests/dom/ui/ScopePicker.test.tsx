// @vitest-environment jsdom
// issue 22（ADR-0015 §6）：作用域切换器的行为锁测。
//
// 只测组件自身的契约——展示态、打开/关闭、搜索过滤、键盘与焦点。它"被谁用、列表从哪来"
// 是页面接线的事，走 pages / workspace 下的测；组件是受控的，不读 store，所以这里不用 Provider。
//
// 两处按结构取节点，理由写在这里：
//   - `.scope-picker__tag`：徽标文案与行内「当前」小签同字，只能靠类名分开；
//   - `.pp-menu__scrim`：「点面板外」这个动作只有遮罩能表达。
// 视觉里的**定位**不靠布局引擎：触发钮量测用 mock 注入（issue 11 #1 起：贴边对齐——预览页左缘 /
// 音频页右缘，空间不足时收窄宽度、开着时伸缩跟随，全走这组用例）；配色与真实渲染宽度 jsdom
// 量不出来，仍是人工门票。
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
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
/** 面板内联左缘 / 宽度（数字）：定位断言用（深层的真实渲染宽度 jsdom 量不出） */
const panelLeft = () => Number.parseFloat(panel().style.left);
const panelWidth = () => Number.parseFloat(panel().style.width);

function open() {
  fireEvent.click(trigger());
}

/** 量测替身的矩形：宽 140 / 高 26（右下角由 left / bottom 决定） */
function rectAt(left: number, bottom: number): DOMRect {
  return {
    left,
    right: left + 140,
    top: bottom - 26,
    bottom,
    width: 140,
    height: 26,
    x: left,
    y: bottom - 26,
    toJSON: () => ({}),
  } as DOMRect;
}

/** 触发钮的量测替身（jsdom 无布局引擎：面板定位的输入只能显式注入） */
function mockTriggerRect(rect: { left: number; bottom: number }) {
  vi.spyOn(trigger(), 'getBoundingClientRect').mockReturnValue(rectAt(rect.left, rect.bottom));
}

// 翻转判定读 window.innerWidth：用 stub 注入视口宽，逐条还原（其余用例吃 jsdom 默认视口）
afterEach(() => { vi.unstubAllGlobals(); });

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

  describe('issue 11 #1 · 面板定位（默认左对齐 · 预览页工具栏左簇）：空间不足时收窄，伸缩跟随', () => {
    it('有空间时面板左缘 = 触发钮左缘（与相邻的谱面切换器同口径）', () => {
      renderPicker();
      mockTriggerRect({ left: 120, bottom: 30 });
      open();

      expect(panel().style.left).toBe('120px');
      expect(panel().style.top).toBe('34px');   // 触发钮下缘 + 4
    });

    it('触发钮贴视口左缘时面板至少留 8px，不压边', () => {
      renderPicker();
      mockTriggerRect({ left: 2, bottom: 30 });
      open();

      expect(panel().style.left).toBe('8px');
    });

    it('右侧放不下时仍左对齐触发钮，面板收窄到刚好放下（不翻转、不钳平位置）', () => {
      // 触发钮住区块头右侧（音频页）：left 950，视口 1200 装不下 950 起的 288 宽面板。
      // v1 钳平→两边都不贴；v2 翻转右缘→用户仍要左对齐。本版钉死左缘，收窄宽度。
      vi.stubGlobal('innerWidth', 1200);
      renderPicker();
      mockTriggerRect({ left: 950, bottom: 30 });
      open();

      expect(panelLeft()).toBe(950);                                       // 左缘仍贴触发钮左缘
      expect(panelLeft()).not.toBe(1090 - 288);                            // 不是翻转后的右缘对齐
      expect(panelLeft()).not.toBe(window.innerWidth - 288 - 8);           // 不是钳平推出来的位置
      const w = Number.parseFloat(panel().style.width);
      expect(w).toBe(1200 - 950 - 8);                                      // 宽度 = 可用空间
      expect(panel().style.minWidth).toBe('0px');                          // 内联覆盖 CSS min-width
      expect(panelLeft() + w).toBeLessThanOrEqual(window.innerWidth - 8);  // 右缘不顶出视口
    });

    it('面板开着时伸缩窗口：重新量触发钮，面板跟随（不留在旧位置）', () => {
      const rect = { left: 120, bottom: 30 };
      renderPicker();
      vi.spyOn(trigger(), 'getBoundingClientRect')
        .mockImplementation(() => rectAt(rect.left, rect.bottom));
      open();
      expect(panel().style.left).toBe('120px');
      expect(panel().style.top).toBe('34px');

      rect.left = 400;    // 伸缩后触发钮随布局移动
      rect.bottom = 50;
      fireEvent(window, new Event('resize'));

      expect(panel().style.left).toBe('400px');
      expect(panel().style.top).toBe('54px');
    });

    it('布局晚一拍（壳几何由 ResizeObserver 异步应用）：resize 当帧量旧位，后续帧补测跟上', async () => {
      // 应用的内容壳几何（--aps-inset-l / --aps-body-w）由 AppPageShell 的 RO 在布局落定后异步应用，
      // window resize 事件先于它派发；最大化是**单发** resize，正好走这条路径（2026-10-05 用户报）。
      const rect = { left: 120, bottom: 30 };
      renderPicker();
      vi.spyOn(trigger(), 'getBoundingClientRect')
        .mockImplementation(() => rectAt(rect.left, rect.bottom));
      open();
      expect(panel().style.left).toBe('120px');

      fireEvent(window, new Event('resize'));
      expect(panel().style.left).toBe('120px');

      rect.left = 640;                             // 一拍之后壳几何才落定（模拟 RO 迟到）
      rect.bottom = 70;
      await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 60)); });

      expect(panel().style.left).toBe('640px');
      expect(panel().style.top).toBe('74px');
    });
  });

  describe('issue 11 #1 · 面板定位：音频页右对齐（align="right"）', () => {
    it('左侧空间够时面板右缘贴触发钮右缘，宽度用目标 288', () => {
      vi.stubGlobal('innerWidth', 1200);
      renderPicker({ align: 'right' });
      mockTriggerRect({ left: 800, bottom: 30 });   // right = 940
      open();

      expect(panelWidth()).toBe(288);
      expect(panelLeft() + panelWidth()).toBe(940); // 右缘 = 触发钮右缘
      expect(panel().style.top).toBe('34px');
    });

    it('左侧空间不足时收窄宽度，右缘仍贴触发钮右缘（不推到两边不贴）', () => {
      vi.stubGlobal('innerWidth', 400);
      renderPicker({ align: 'right' });
      mockTriggerRect({ left: 100, bottom: 30 });   // right = 240
      open();

      expect(panelWidth()).toBe(240 - 8);           // 收窄到左缘留白（232）
      expect(panelLeft()).toBe(8);
      expect(panelLeft() + panelWidth()).toBe(240); // 右缘仍 = 触发钮右缘
    });
  });
});
