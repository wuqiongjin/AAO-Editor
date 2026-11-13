// @vitest-environment jsdom
// issue 186 锁测：画布左上角的片段粘贴胶囊（ADR-0023 §2 / CONTEXT「片段粘贴胶囊」）。
// 进片段粘贴态才出现、切走工具即消失、切换落 settings 且下次沿用。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { UIProvider, useUI } from '@/src/app/providers/UIProvider';
import type { Pattern } from '@/src/patterns/types';
import PatternPastePill from '@/src/pages/workspace/PatternPastePill';
import { SETTINGS_KEY, seedZhSettings } from '@/tests/support/storage';

const PATTERN: Pattern = {
  id: 'p1',
  name: '片段 1',
  createdAt: 1,
  notes: [{ type: 'Single', beat: 0, lane: 3 }],
  bpmContext: { startBpm: 200, events: [{ deltaBeat: 1, bpm: -120 }] },
};

function Harness() {
  const { setArmedTool, togglePatternPaste } = useUI();
  return (
    <>
      <button type="button" onClick={() => togglePatternPaste(PATTERN)}>card</button>
      <button type="button" onClick={() => setArmedTool('single')}>tool:single</button>
      <button type="button" onClick={() => setArmedTool('paste')}>tool:paste</button>
      <button type="button" onClick={() => setArmedTool(null)}>tool:pointer</button>
      <PatternPastePill />
    </>
  );
}

function setup(patch: Record<string, unknown> = {}) {
  seedZhSettings(patch);
  render(
    <ConfigProvider>
      <UIProvider>
        <Harness />
      </UIProvider>
    </ConfigProvider>,
  );
}

const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
// 读屏名 = 「片段粘贴：<当前模式>」——模式必须可被读到
const pill = () => screen.getByRole('button', { name: /^片段粘贴：/ });
const queryPill = () => screen.queryByRole('button', { name: /^片段粘贴：/ });
const panel = () => screen.getByRole('group', { name: '片段粘贴' });
const queryPanel = () => screen.queryByRole('group', { name: '片段粘贴' });
const storedWithBpm = () =>
  (JSON.parse(localStorage.getItem(SETTINGS_KEY)!) as { patternPaste?: { withBpm?: boolean } })
    .patternPaste?.withBpm;

describe('issue 186 · 片段粘贴胶囊', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('只在片段粘贴态出现：点卡片才出，切走工具即消失', () => {
    setup();
    expect(queryPill()).not.toBeInTheDocument();

    click('card');
    expect(pill()).toBeInTheDocument();

    click('tool:single');
    expect(queryPill()).not.toBeInTheDocument();

    click('card');
    click('tool:pointer');
    expect(queryPill()).not.toBeInTheDocument();
  });

  it('工具轨「粘贴」= 回剪贴板来源，胶囊跟着消失', () => {
    setup();
    click('card');
    expect(pill()).toBeInTheDocument();
    click('tool:paste');
    expect(queryPill()).not.toBeInTheDocument();
  });

  it('默认「含 BPM」，文案直接给速度跨度（起点 → 峰值）', () => {
    setup();
    click('card');
    expect(pill()).toHaveTextContent('含 BPM (200 → -120)');
    // 负值只给那个数字上危险色
    expect(screen.getByText('-120')).toHaveClass('is-negative');
    expect(screen.getByText('200')).not.toHaveClass('is-negative');
  });

  it('点开可切：选「不含 BPM」落 settings，胶囊文案随之变化', () => {
    setup();
    click('card');
    expect(queryPanel()).not.toBeInTheDocument();

    fireEvent.click(pill());
    const group = panel();
    // 弹层只有两档，且措辞与胶囊一致（panel 里没有第三行啰嗦的解释）
    expect(within(group).getAllByRole('button')).toHaveLength(2);
    expect(within(group).getByRole('button', { name: /^含 BPM/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(group).getByRole('button', { name: '不含 BPM' }));

    expect(pill()).toHaveTextContent('不含 BPM');
    expect(storedWithBpm()).toBe(false);
    expect(queryPanel()).not.toBeInTheDocument(); // 选完就收起
  });

  it('记住上次选择：下次进态直接是「不含 BPM」', () => {
    seedZhSettings({ patternPaste: { withBpm: false } });
    render(
      <ConfigProvider>
        <UIProvider>
          <Harness />
        </UIProvider>
      </ConfigProvider>,
    );
    click('card');
    expect(pill()).toHaveTextContent('不含 BPM');
    expect(pill()).not.toHaveTextContent('('); // 不含 BPM 档不带速度跨度
  });

  it('切回「含 BPM」也落 settings', () => {
    setup({ patternPaste: { withBpm: false } });
    click('card');
    fireEvent.click(pill());
    fireEvent.click(within(panel()).getByRole('button', { name: /^含 BPM/ }));
    expect(storedWithBpm()).toBe(true);
    expect(pill()).toHaveTextContent('含 BPM (200 → -120)');
  });

  it('点外面 / Esc 收回；切走工具再切回不残留展开态', () => {
    setup();
    click('card');
    fireEvent.click(pill());
    fireEvent.mouseDown(document.body);
    expect(queryPanel()).not.toBeInTheDocument();

    fireEvent.click(pill());
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(queryPanel()).not.toBeInTheDocument();
    expect(pill()).toBeInTheDocument();

    fireEvent.click(pill());
    click('tool:single');
    click('card');
    expect(pill()).toHaveAttribute('aria-expanded', 'false');
  });
});
