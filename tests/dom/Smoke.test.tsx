// @vitest-environment jsdom
// issue 08：DOM 测试基建冒烟。证明「RTL + jsdom + Provider 替身」真的能渲染并断言行为。
// 只按 role / text 查询，只断言行为——不断言 DOM 结构、不覆盖视觉结论（jsdom 无布局引擎）。
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ActionBtn from '@/src/ui/ActionBtn';
import { useAudioSession } from '@/src/app/providers/AudioSessionProvider';
import { useCurrentProject } from '@/src/app/providers/CurrentProjectProvider';
import { makeTestAudioSession, renderWithProviders } from '@/tests/support/providers';

/** 探针：同时读两个默认上下文，把状态渲染成可查询的文本。 */
function SessionProbe() {
  const { projectId } = useCurrentProject();
  const [snapshot] = useAudioSession();
  return (
    <div>
      <span>{projectId ?? '未打开工程'}</span>
      <span>{`时长 ${snapshot.chartDuration}`}</span>
    </div>
  );
}

describe('issue 08 · DOM 测试基建', () => {
  it('真实组件能被渲染：按 role/name 查询，点击回调真的触发', () => {
    const onClick = vi.fn();
    render(<ActionBtn onClick={onClick}>删除音符</ActionBtn>);

    const button = screen.getByRole('button', { name: '删除音符' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('默认 Provider 替身可用：当前工程为空、音频会话取默认时长', () => {
    renderWithProviders(<SessionProbe />);

    expect(screen.getByText('未打开工程')).toBeInTheDocument();
    expect(screen.getByText('时长 30')).toBeInTheDocument();
  });

  it('注入的音频会话生效：组件读到注入值而非默认值', () => {
    const { session } = makeTestAudioSession({ chartDuration: 120 });
    renderWithProviders(<SessionProbe />, { session });

    expect(screen.getByText('时长 120')).toBeInTheDocument();
    expect(screen.queryByText('时长 30')).toBeNull();
  });
});
