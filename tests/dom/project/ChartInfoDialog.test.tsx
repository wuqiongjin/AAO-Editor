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
    expect(onUpdate).toHaveBeenCalledWith({ title: 'Expert', diff: 3, level: null });
  });
});
