// @vitest-environment jsdom
// issue 232：工作台播放期 80ms 时间码 HUD 节流刷新与页面根重渲染解耦。
// WorkspacePage 消费 usePlaybackState()，不消费 80ms 高频刷新的 currentSeconds；
// currentSeconds 由专职轻量组件（WorkspacePlayBar / CanvasPlayheadHud）消费。
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import React, { useRef } from 'react';
import { render, act, screen } from '@testing-library/react';
import { PlaybackProvider, usePlaybackState, usePlaybackSeconds } from '@/src/app/providers/PlaybackProvider';
import WorkspacePlayBar from '@/src/pages/workspace/WorkspacePlayBar';

describe('issue 232 · 播放头 80ms 刷新与工作台根解耦', () => {
  it('usePlaybackState 不随 currentSeconds 更新触发重渲染，而 usePlaybackSeconds 触发重渲染', async () => {
    let stateRenderCount = 0;
    let secondsRenderCount = 0;
    let updateSeconds: (s: number) => void = () => {};

    function StateConsumer() {
      stateRenderCount++;
      const { setCurrentSeconds, isPlaying } = usePlaybackState();
      updateSeconds = setCurrentSeconds;
      return <div data-testid="state-val">{isPlaying ? 'playing' : 'stopped'}</div>;
    }

    function SecondsConsumer() {
      secondsRenderCount++;
      const seconds = usePlaybackSeconds();
      return <div data-testid="seconds-val">{seconds.toFixed(2)}</div>;
    }

    render(
      <PlaybackProvider>
        <StateConsumer />
        <SecondsConsumer />
      </PlaybackProvider>
    );

    expect(stateRenderCount).toBe(1);
    expect(secondsRenderCount).toBe(1);
    expect(screen.getByTestId('seconds-val')).toHaveTextContent('0.00');

    // 触发 80ms 时间码更新
    act(() => {
      updateSeconds(1.23);
    });

    // usePlaybackState 组件不应重渲
    expect(stateRenderCount).toBe(1);
    // usePlaybackSeconds 组件应重渲
    expect(secondsRenderCount).toBe(2);
    expect(screen.getByTestId('seconds-val')).toHaveTextContent('1.23');
  });

  it('WorkspacePlayBar 直读 usePlaybackSeconds 并正确渲染 PlayBar', () => {
    let updateSeconds: (s: number) => void = () => {};

    function TestHost() {
      const { setCurrentSeconds } = usePlaybackState();
      updateSeconds = setCurrentSeconds;
      return (
        <WorkspacePlayBar
          isPlaying={false}
          duration={120}
          volume={0.8}
          shortcutKey="Space"
          onTogglePlay={() => {}}
          onVolumeChange={() => {}}
          onSeek={() => {}}
        />
      );
    }

    render(
      <PlaybackProvider>
        <TestHost />
      </PlaybackProvider>
    );

    // 验证初始时间码 00:00
    expect(screen.getByText('00:00.0')).toBeInTheDocument();

    act(() => {
      updateSeconds(65.4);
    });

    // 验证更新后时间码 01:05.4
    expect(screen.getByText('01:05.4')).toBeInTheDocument();
  });
});
