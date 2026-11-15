// @vitest-environment jsdom
// 票 43：谱面信息弹窗等级越界就地标红，保存不写、窗不关。
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChartInfoDialog } from '@/src/project/ui/ChartInfoDialog';
import type { ChartProject, ProjectChart } from '@/src/project/ChartProject';

const AT = 1_700_000_000_000;

const chart: ProjectChart = {
  id: 'c1',
  notes: [{ beat: 0, type: 'BPM', bpm: 120 }],
  title: 'Expert',
  diff: 3,
  level: 24,
  completed: false,
  upload: null,
  lastModified: AT,
  appliedChartCodeText: null,
  chartCodePristine: false,
};

const project: ChartProject = {
  id: 'p1',
  name: 'song',
  artist: 'RAS',
  source: { type: 'custom' },
  durationSeconds: 100,
  lastOpened: AT,
  charts: [chart],
  audioName: null,
  coverName: null,
};

describe('票 43 · ChartInfoDialog 等级', () => {
  it('越界：输入标红，保存禁用且不回调', () => {
    const onUpdate = vi.fn();
    render(
      <ChartInfoDialog
        project={project}
        chart={chart}
        onClose={vi.fn()}
        onAdd={vi.fn()}
        onUpdate={onUpdate}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('可稍后填写'), { target: { value: '0' } });
    const save = screen.getByRole('button', { name: '保存' });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '编辑谱面信息' })).toBeInTheDocument();
  });

  it('空等级仍可保存为 null', () => {
    const onUpdate = vi.fn();
    render(
      <ChartInfoDialog
        project={project}
        chart={chart}
        onClose={vi.fn()}
        onAdd={vi.fn()}
        onUpdate={onUpdate}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('可稍后填写'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(onUpdate).toHaveBeenCalledWith({
      title: 'Expert', diff: 3, level: null,
      // 票 79：谱师署名随表单一起回传（空 = 清空）
      charterCredit: null,
    });
  });
});

describe('票 79 · 新增谱面的谱师署名', () => {
  const renderAdd = () => {
    const onAdd = vi.fn();
    render(
      <ChartInfoDialog
        project={project}
        chart={null}
        onClose={vi.fn()}
        onAdd={onAdd}
        onUpdate={vi.fn()}
      />,
    );
    return onAdd;
  };

  it('留空 ⇒ 不把 charterCredit 递下去，让创建侧落登录账号名默认值', () => {
    const onAdd = renderAdd();
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0]).not.toHaveProperty('charterCredit');
  });

  it('手填 ⇒ 原样递下去（手动填写优先），联合创作的名字不拆', () => {
    const onAdd = renderAdd();
    fireEvent.change(
      screen.getByPlaceholderText('默认用登录账号昵称，可手填（联合创作写一起即可）'),
      { target: { value: '  A、B / C  ' } },
    );
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    expect(onAdd.mock.calls[0][0].charterCredit).toBe('A、B / C');
  });
});
