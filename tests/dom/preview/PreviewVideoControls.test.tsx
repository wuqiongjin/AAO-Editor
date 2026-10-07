// @vitest-environment jsdom
// chart-preview 20 的控件锁测（票面「锁测」：`tests/dom/preview/` —— 控件 → 回放接口调用）。
//
// 为什么是 DOM 测试：要锁的是"这一排控件真的接到了回放上"——倍速五档 / 循环开关 / 主音量
// 三个旋钮的操作路径（受控组件 + 事件），纯函数单测看不到；至于"声音有没有变、倍速听感同步不
// 同步"是单测测不到的，票里已列为人工验收项。
//
// 回放那一侧换成替身（`createSimPlayback`）：只断言**接口调用**，不碰 Web Audio / rAF。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';

const calls = vi.hoisted(() => ({
  setOptions: vi.fn(),
  setFrame: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  seek: vi.fn(),
  restart: vi.fn(),
  setDuration: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock('@/src/preview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/preview')>();
  return {
    ...actual,
    // 素材：给"不缺"的一份（缺 = 空态，控件根本不渲染）
    loadSimAssets: vi.fn(async () => ({
      background: null,
      field: null,
      playLine: null,
      bandColor: '#5fd68a',
      bandColorSp: '#8fe6c0',
      sprites: null,
      missing: false,
      server: 'jp',
    })),
    createSimPlayback: vi.fn(() => ({
      setFrame: calls.setFrame,
      setOptions: calls.setOptions,
      play: calls.play,
      pause: calls.pause,
      seek: calls.seek,
      restart: calls.restart,
      toggle: calls.play,
      setDuration: calls.setDuration,
      render: vi.fn(),
      dispose: calls.dispose,
    })),
  };
});

import PreviewVideoStage from '@/src/pages/preview/PreviewVideoStage';
import { SIM_PLAYBACK_RATES, type SimScene } from '@/src/preview';
import type { AppSettings } from '@/src/chart/config/AppSettings';

const scene: SimScene = {
  notes: [],
  beatDisplay: 4,
  noteSpeed: 9.5,
  noteSize: 1,
  slideOpacity: 0.8,
  simultaneousClickLines: true,
  colorAssist: false,
  mirror: false,
};

// jsdom 没有布局：`clientWidth/clientHeight` 恒 0 ⇒ 舞台量不出尺寸 ⇒ 回放根本不创建（控件虽渲染，
// 但接不到回放上）。这里钉一个舞台尺寸，让"素材 + 尺寸都到齐"这条路径真的走通。
for (const [prop, value] of [['clientWidth', 960], ['clientHeight', 540]] as const) {
  Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, value });
}

async function renderStage(volume = 1) {
  const onVolumeChange = vi.fn();
  const view = render(
    <PreviewVideoStage
      scene={scene}
      duration={12}
      audio={null}
      keySetId="skin00"
      seVolume={1}
      volume={volume}
      onVolumeChange={onVolumeChange}
      imageQuality="high"
      noteSkin={'default' as AppSettings['visual']['noteSkin']}
    />,
  );
  // 素材是异步进场的：等回放真的建起来（控件要接到它上面）
  await waitFor(() => expect(calls.setFrame).toHaveBeenCalled());
  calls.setOptions.mockClear();
  return { ...view, onVolumeChange };
}

beforeEach(() => {
  calls.setOptions.mockClear();
  calls.setFrame.mockClear();
});

describe('动态预览播放条 · 播放器控件（chart-preview 20）', () => {
  it('倍速：五档照 Bestdori，切档走 setOptions({ rate })', async () => {
    const { container } = await renderStage();
    const select = container.querySelector('select.pv-bar__rate') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect([...select.options].map((o) => o.value)).toEqual(['0.5', '0.75', '1', '1.5', '2']);
    expect([...SIM_PLAYBACK_RATES]).toEqual([0.5, 0.75, 1, 1.5, 2]);

    fireEvent.change(select, { target: { value: '2' } });
    expect(calls.setOptions).toHaveBeenCalledWith(expect.objectContaining({ rate: 2 }));
  });

  it('倍速不改谱面秒数：进度条量程仍是谱面长度', async () => {
    const { container } = await renderStage();
    const seek = container.querySelector('input.pv-bar__seek') as HTMLInputElement;
    expect(Number(seek.max)).toBe(12); // duration = 12s
    fireEvent.change(container.querySelector('select.pv-bar__rate') as HTMLSelectElement, { target: { value: '0.5' } });
    expect(Number((container.querySelector('input.pv-bar__seek') as HTMLInputElement).max)).toBe(12);
  });

  it('循环：按钮是开关（aria-pressed），开了走 setOptions({ loop: true })', async () => {
    const { container } = await renderStage();
    const loopBtn = container.querySelector('button[aria-pressed]') as HTMLButtonElement;
    expect(loopBtn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(loopBtn);
    expect(calls.setOptions).toHaveBeenCalledWith(expect.objectContaining({ loop: true }));
    expect((container.querySelector('button[aria-pressed]') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
  });

  it('主音量：滑杆走 onVolumeChange（落 settings.audio.volume），不自己摸引擎', async () => {
    const { container, onVolumeChange } = await renderStage(1);
    const slider = container.querySelector('label.pv-bar__volume input') as HTMLInputElement;
    expect(Number(slider.min)).toBe(0);
    expect(Number(slider.max)).toBe(1);
    expect(Number(slider.step)).toBe(0.05);

    fireEvent.change(slider, { target: { value: '0.35' } });
    expect(onVolumeChange).toHaveBeenCalledWith(0.35);
    // 音量不进 setOptions 的"倍速 / 循环"那两个键：它是设置域的值，由页面回写后再透传
    expect(calls.setOptions).not.toHaveBeenCalledWith(expect.objectContaining({ volume: 0.35 }));
  });

  it('控件都不重建引擎：旋钮只走 setOptions（创建回放只发生一次）', async () => {
    const { container } = await renderStage();
    const { createSimPlayback } = await import('@/src/preview');
    const before = (createSimPlayback as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    fireEvent.click(container.querySelector('button[aria-pressed]') as HTMLButtonElement);
    fireEvent.change(container.querySelector('select.pv-bar__rate') as HTMLSelectElement, { target: { value: '1.5' } });
    expect((createSimPlayback as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(before);
  });
});
