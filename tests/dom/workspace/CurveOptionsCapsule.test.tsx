// @vitest-environment jsdom
// issue 179 & issue 235 锁测：画布左上角的曲线选项胶囊（177 Q15 / 235 图形化选型与 18 款模板）
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { UIProvider, useUI, type ArmedTool } from '@/src/app/providers/UIProvider';
import CurveOptionsCapsule from '@/src/pages/workspace/CurveOptionsCapsule';
import { SETTINGS_KEY, seedZhSettings } from '@/tests/support/storage';

function Arm({ tool }: { tool: ArmedTool | null }) {
  const { setArmedTool } = useUI();
  return <button type="button" onClick={() => setArmedTool(tool)}>{`arm:${tool ?? 'pointer'}`}</button>;
}

function setup(patch: Record<string, unknown> = {}) {
  seedZhSettings(patch);
  render(
    <ConfigProvider>
      <UIProvider>
        <Arm tool="curve" />
        <Arm tool="single" />
        <CurveOptionsCapsule />
      </UIProvider>
    </ConfigProvider>,
  );
}

const arm = (tool: string) => fireEvent.click(screen.getByRole('button', { name: `arm:${tool}` }));
const pill = () => screen.getByRole('button', { name: '曲线配置' });
const queryPill = () => screen.queryByRole('button', { name: '曲线配置' });
const form = () => screen.getByRole('group', { name: '曲线配置' });
const queryForm = () => screen.queryByRole('group', { name: '曲线配置' });

describe('issue 179 · 曲线选项胶囊', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('只在曲线持工具态出现；切走工具即消失', () => {
    setup();
    expect(queryPill()).not.toBeInTheDocument();
    arm('curve');
    expect(pill()).toBeInTheDocument();
    arm('single');
    expect(queryPill()).not.toBeInTheDocument();
  });

  it('胶囊摘要：族 · 型 · 精度（去掉括号里的中文释义）', () => {
    setup();
    arm('curve');
    expect(pill()).toHaveTextContent('曲线');
    expect(pill()).toHaveTextContent('Sine · In · 1/16');
  });

  it('选了模板时摘要显示模板名·偏向·幅度，且药丸含 SVG 迷你预览', () => {
    setup({ curve: { family: 'sine', type: 'in', precision: 16, templateId: 'wave' } });
    arm('curve');
    expect(pill()).toHaveTextContent('双波浪 · 右偏 · 中');
    expect(pill().querySelector('svg')).not.toBeNull();
  });

  it('点开 = 缓动函数/形状模板两段切换；改缓动/精度/模板参数均写盘持久化', () => {
    setup();
    arm('curve');
    expect(queryForm()).not.toBeInTheDocument();
    fireEvent.click(pill());

    // 缓动模式：缓动族 + 缓动型 2 个下拉框 + 1/16|1/32|1/64 精度胶囊
    const selects = within(form()).getAllByRole('combobox');
    expect(selects).toHaveLength(2);
    fireEvent.change(within(form()).getByRole('combobox', { name: '缓动族' }), { target: { value: 'bounce' } });
    fireEvent.click(within(form()).getByRole('button', { name: '1/32' }));
    const stored = () => JSON.parse(localStorage.getItem(SETTINGS_KEY)!).curve as {
      family: string;
      precision: number;
      templateId: string | null;
      templateMirrored: boolean;
      templateScale: number;
      templateDensity: number;
    };
    expect(stored().family).toBe('bounce');
    expect(stored().precision).toBe(32);

    // 切到形状模板页：展示 18 张 SVG 缩略图卡，可按分类筛选
    fireEvent.click(within(form()).getByRole('tab', { name: '形状模板' }));
    expect(form().querySelectorAll('.ccp__card')).toHaveLength(18);
    fireEvent.click(within(form()).getByRole('button', { name: '面筋/锁链' }));
    expect(form().querySelectorAll('.ccp__card')).toHaveLength(6);

    // 选面筋·梳齿：第 3 排切换为「段密」（稀疏/标准/稠密），修改偏向/幅度/段密均写盘
    fireEvent.click(within(form()).getByRole('button', { name: '面筋·梳齿' }));
    expect(within(form()).queryByRole('button', { name: '1/64' })).not.toBeInTheDocument();
    fireEvent.click(within(form()).getByRole('button', { name: '↰ 左偏' }));
    fireEvent.click(within(form()).getByRole('button', { name: '大' }));
    fireEvent.click(within(form()).getByRole('button', { name: '稠密' }));
    expect(stored().templateId).toBe('gluten-comb');
    expect(stored().templateMirrored).toBe(true);
    expect(stored().templateScale).toBe(1.5);
    expect(stored().templateDensity).toBe(2);
    expect(pill()).toHaveTextContent('面筋·梳齿 · 左偏 · 大 · 稠密');

    // 切回平滑弧弯大弧：第 3 排还原为「精度」且可切换 1/64 写盘
    fireEvent.click(within(form()).getByRole('button', { name: '全部' }));
    fireEvent.click(within(form()).getByRole('button', { name: '大弧' }));
    expect(within(form()).getByRole('button', { name: '1/64' })).toBeEnabled();
    fireEvent.click(within(form()).getByRole('button', { name: '1/64' }));
    expect(stored().precision).toBe(64);
  });

  it('英文界面渲染全部 18 款模板与控件且无缺词回退', () => {
    seedZhSettings({ uiLanguage: 'en', curve: { family: 'sine', type: 'in', precision: 16, templateId: 'soft-elastic' } });
    render(
      <ConfigProvider>
        <UIProvider>
          <Arm tool="curve" />
          <CurveOptionsCapsule />
        </UIProvider>
      </ConfigProvider>,
    );
    arm('curve');
    const enPill = screen.getByRole('button', { name: 'Curve' });
    expect(enPill).toHaveTextContent('Soft elastic · Right · M');
    fireEvent.click(enPill);
    const enForm = screen.getByRole('group', { name: 'Curve' });
    expect(within(enForm).getByRole('tab', { name: 'Shapes' })).toHaveAttribute('aria-selected', 'true');
    const cards = Array.from(enForm.querySelectorAll('.ccp__card'));
    expect(cards).toHaveLength(18);
    for (const card of cards) {
      expect(card.textContent?.trim()).not.toMatch(/^(shape\.|No template)/);
      expect(card.getAttribute('title')).not.toMatch(/^shapeTip\./);
    }
  });

  it('切走工具再切回：先出收起的胶囊，不残留上次展开的表单', () => {
    setup();
    arm('curve');
    fireEvent.click(pill());
    expect(form()).toBeInTheDocument();
    arm('single');
    arm('curve');
    expect(queryForm()).not.toBeInTheDocument();
    expect(pill()).toHaveAttribute('aria-expanded', 'false');
  });

  it('点外面 / Esc 收回（无关闭钮）', () => {
    setup();
    arm('curve');
    fireEvent.click(pill());
    fireEvent.mouseDown(document.body);
    expect(queryForm()).not.toBeInTheDocument();

    fireEvent.click(pill());
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(queryForm()).not.toBeInTheDocument();
    expect(queryPill()).toBeInTheDocument();
  });
});
