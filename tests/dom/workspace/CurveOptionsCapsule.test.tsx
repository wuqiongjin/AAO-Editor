// @vitest-environment jsdom
// issue 179 锁测：画布左上角的曲线选项胶囊（177 Q15）
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

  it('选了模板时摘要显示模板名', () => {
    setup({ curve: { family: 'sine', type: 'in', precision: 16, templateId: 'wave' } });
    arm('curve');
    expect(pill()).toHaveTextContent('波浪 ×2');
  });

  it('点开 = 四行带标签表单；改一项写盘；选了模板时前三项置灰', () => {
    setup();
    arm('curve');
    expect(queryForm()).not.toBeInTheDocument();
    fireEvent.click(pill());
    const selects = within(form()).getAllByRole('combobox');
    expect(selects).toHaveLength(4);

    fireEvent.change(within(form()).getByRole('combobox', { name: '缓动族' }), { target: { value: 'bounce' } });
    const stored = () => (JSON.parse(localStorage.getItem(SETTINGS_KEY)!) as { curve: { family: string } }).curve;
    expect(stored().family).toBe('bounce');

    fireEvent.change(within(form()).getByRole('combobox', { name: '模板' }), { target: { value: 'wave' } });
    expect(within(form()).getByRole('combobox', { name: '缓动族' })).toBeDisabled();
    expect(within(form()).getByRole('combobox', { name: '缓动型' })).toBeDisabled();
    expect(within(form()).getByRole('combobox', { name: '精度' })).toBeDisabled();
    expect(within(form()).getByRole('combobox', { name: '模板' })).toBeEnabled();
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
