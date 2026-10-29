// @vitest-environment jsdom
// chart-preview 20 的控件锁测（票面「锁测」：`tests/dom/preview/` —— 控件 → 回放接口调用）；
// chart-preview 22 起播放条是工作台同一件 `PlayBar`，本文件同时守「复用后新增的通路」。
//
// 为什么是 DOM 测试：要锁的是"这一排控件真的接到了回放上"——倍速（选档 / 自定义值 / 越界钳回）、
// 主音量、空格（play）与时间码双击编辑四条操作路径（受控组件 + 事件），纯函数单测看不到；
// 至于"声音有没有变、倍速听感同步不同步"是单测测不到的，票里已列为人工验收项。
//
// 回放那一侧换成替身（`createSimPlayback`）：只断言**接口调用**，不碰 Web Audio / rAF。
// 查询口径按 `tests/README.md` 的 dom 约定：role / text（进度条与音量都是 `role="slider"` 带名字，
// 时间码用它的 `title` 提示定位，编辑输入框是唯一的 `textbox`）。
//
// 2026-10-07 用户验收回修（票内「验收回修」）：
//   - 撤掉「回开头」与「循环」两钮 ⇒ 这里守"不许回来"（含 setOptions 不再带 loop）；
//   - 倍速：触钮 = 播放条那一排的同款图标钮（图标 + 当前倍速），点开在它上方翻出
//     一列常用档 + 一个自定义输入。
// 2026-10-08 issue 22：进度条换成 PlayBar 的自绘拖拽条（量程看 aria-valuemax）；
//   loop / restart 已从回放层收掉，替身里不再有这两个洞。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SIM_BAND_MATERIAL, SIM_BAND_MATERIAL_SP } from '@/src/preview/video/sim/simGeometry';

const calls = vi.hoisted(() => ({
  setOptions: vi.fn(),
  setFrame: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  seek: vi.fn(),
  setDuration: vi.fn(),
  dispose: vi.fn(),
  lastOnTick: null as ((seconds: number, playing: boolean) => void) | null,
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
      bandMaterial: { ...SIM_BAND_MATERIAL },
      bandMaterialSp: { ...SIM_BAND_MATERIAL_SP },
      sprites: null,
      missing: false,
      server: 'jp',
    })),
    createSimPlayback: vi.fn((opts?: { initialSeconds?: number; onTick?: (seconds: number, playing: boolean) => void }) => {
      calls.lastOnTick = opts?.onTick ?? null;
      if (opts?.initialSeconds && opts.initialSeconds > 0) {
        calls.seek(opts.initialSeconds);
        opts.onTick?.(opts.initialSeconds, false);
      }
      return {
        setFrame: calls.setFrame,
        setOptions: calls.setOptions,
        play: calls.play,
        pause: calls.pause,
        seek: calls.seek,
        toggle: calls.play,
        setDuration: calls.setDuration,
        render: vi.fn(),
        dispose: calls.dispose,
      };
    }),
  };
});

import PreviewVideoStage from '@/src/pages/preview/PreviewVideoStage';
import { PLAYBACK_RATE_RANGE, SIM_PLAYBACK_RATE_PRESETS, SIM_PLAYBACK_RATE_STEP, type SimPlaybackAudio, type SimScene } from '@/src/preview';
import { getDefaultConfig } from '@/src/chart/config/ShortcutConfig';
import { t } from '@/src/i18n';
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

/** 默认快捷键（空格 = play）——预览页的接管口径就在这份配置上 */
const SHORTCUTS = getDefaultConfig();

// jsdom 没有布局：`clientWidth/clientHeight` 恒 0 ⇒ 舞台量不出尺寸 ⇒ 回放根本不创建（控件虽渲染，
// 但接不到回放上）。这里钉一个舞台尺寸，让"素材 + 尺寸都到齐"这条路径真的走通。
for (const [prop, value] of [['clientWidth', 960], ['clientHeight', 540]] as const) {
  Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, value });
}

async function renderStage(opts: {
  volume?: number;
  audio?: SimPlaybackAudio | null;
  active?: boolean;
  chartId?: string | null;
  initialSeconds?: number;
  onSecondsChange?: (s: number) => void;
  scene?: SimScene;
} = {}) {
  const {
    volume = 1,
    audio = null,
    active = true,
    chartId = null,
    initialSeconds = 0,
    onSecondsChange,
    scene: curScene = scene,
  } = opts;
  const onVolumeChange = vi.fn();
  const view = render(
    <PreviewVideoStage
      active={active}
      scene={curScene}
      duration={12}
      audio={audio}
      keySetId="skin00"
      seVolume={1}
      volume={volume}
      onVolumeChange={onVolumeChange}
      imageQuality="high"
      noteSkin={'default' as AppSettings['visual']['noteSkin']}
      shortcuts={SHORTCUTS}
      chartId={chartId}
      initialSeconds={initialSeconds}
      onSecondsChange={onSecondsChange}
    />,
  );
  // 素材是异步进场的：等回放真的建起来（控件要接到它上面）
  await waitFor(() => expect(calls.setFrame).toHaveBeenCalled());
  calls.setOptions.mockClear();
  return { ...view, onVolumeChange };
}

/** 倍速触钮：可访问名就是当前倍速（`1×` / `1.5×`…），面板里的档位是 menuitem、不会混进来 */
const trigger = () => screen.getByRole('button', { name: /×$/ });
const openPanel = () => fireEvent.click(trigger());
const customInput = () => screen.getByRole('spinbutton');
/** 最后一次写下去的倍速（`setOptions({ rate })`） */
const lastRate = () => (calls.setOptions.mock.lastCall?.[0] as { rate?: number } | undefined)?.rate;
/** 播放条的进度条（PlayBar 自绘，`role="slider"`；量程看 aria-valuemax = 谱面长度秒） */
const seekTrack = () => screen.getByRole('slider', { name: t('play.progress') });
/** 当前时间码：它就是"双击编辑"提示挂着的那一件（`title` 为可访问名来源） */
const currentTime = () => screen.getByTitle(t('play.editTime'));
const timeInput = () => screen.queryByRole('textbox');

beforeEach(() => {
  calls.setOptions.mockClear();
  calls.setFrame.mockClear();
  calls.play.mockClear();
  calls.seek.mockClear();
});

describe('动态预览播放条 · 播放器控件（chart-preview 20）', () => {
  it('倍速：触钮是播放条那一排的同款图标钮（图标 + 当前倍速），面板是点开才有的', async () => {
    await renderStage();
    expect(trigger().textContent).toBe('1×');
    expect(trigger().querySelector('svg')).toBeTruthy(); // 与播放/音量同一套图标钮，不是一串裸文字
    // 收起时播放条上不该挂着档位表 / 输入框
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull();

    openPanel();
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('倍速：选常用档走 setOptions({ rate })，触钮跟着变并点亮，面板收起', async () => {
    await renderStage();
    openPanel();
    expect(screen.getAllByRole('menuitem').map((b) => b.textContent))
      .toEqual(['0.25×', '0.5×', '0.75×', '1×', '1.25×', '1.5×', '2×']);

    fireEvent.click(screen.getByRole('menuitem', { name: '1.5×' }));
    expect(lastRate()).toBe(1.5);
    expect(trigger().textContent).toBe('1.5×'); // 当前值就写在钮上
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('倍速：触钮没有"选中"态（值是写在钮上的，不是开关）', async () => {
    await renderStage();
    expect(trigger().className).not.toMatch(/icon-btn--active/);
    openPanel();
    fireEvent.click(screen.getByRole('menuitem', { name: '1.5×' }));
    expect(trigger().className).not.toMatch(/icon-btn--active/); // 非原速也一样：它不是一个 toggle
    expect(trigger().getAttribute('aria-pressed')).toBeNull();
  });

  it('倍速：常用档 0.25× 起、2× 止（0.1× 与 3× / 4× 都不进表），都在区间内、升序去重', async () => {
    await renderStage();
    expect([...SIM_PLAYBACK_RATE_PRESETS]).toEqual([0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]);
    // 下限那一档故意不进表：0.1× 只有手填到得了（表里的最低档仍是 0.25×）
    expect(Math.min(...SIM_PLAYBACK_RATE_PRESETS)).toBeGreaterThan(PLAYBACK_RATE_RANGE.min);
    expect(Math.max(...SIM_PLAYBACK_RATE_PRESETS)).toBe(2);
    for (const [i, r] of SIM_PLAYBACK_RATE_PRESETS.entries()) {
      expect(r).toBeGreaterThanOrEqual(PLAYBACK_RATE_RANGE.min);
      expect(r).toBeLessThanOrEqual(PLAYBACK_RATE_RANGE.max);
      if (i > 0) expect(r).toBeGreaterThan(SIM_PLAYBACK_RATE_PRESETS[i - 1]!);
    }
  });

  it('倍速：手填**敲一下就生效**（不用回车），回车只是"确认"且面板不关', async () => {
    await renderStage();
    openPanel();

    fireEvent.change(customInput(), { target: { value: '2.4' } });
    expect(lastRate()).toBe(2.4); // 无需 Enter / 失焦：不是常用档里的一档也照收
    expect(trigger().textContent).toBe('2.4×');

    fireEvent.change(customInput(), { target: { value: '1.35' } });
    expect(lastRate()).toBe(1.35);
    expect((customInput() as HTMLInputElement).value).toBe('1.35');

    fireEvent.keyDown(customInput(), { key: 'Enter' }); // 确认（面板不关，方便连着试）
    expect(lastRate()).toBe(1.35);
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('倍速：半截 / 越界输入不打断打字，确认时才钳回并回显', async () => {
    await renderStage();
    openPanel();
    fireEvent.change(customInput(), { target: { value: '1.5' } });
    expect(lastRate()).toBe(1.5);

    // 越界：不即时应用（否则刚敲下 9 就被拉回 4，字也跟着变），只给提示色
    fireEvent.change(customInput(), { target: { value: '9' } });
    expect(lastRate()).toBe(1.5);
    expect(customInput().className).toMatch(/is-out-of-range/);
    fireEvent.change(customInput(), { target: { value: '' } });
    expect(lastRate()).toBe(1.5); // 空的 = 没这回事

    fireEvent.change(customInput(), { target: { value: '9' } });
    fireEvent.blur(customInput());
    expect(lastRate()).toBe(PLAYBACK_RATE_RANGE.max); // 上限仍是引擎那份 4
    expect(trigger().textContent).toBe('4×');
    expect((customInput() as HTMLInputElement).value).toBe('4');

    fireEvent.change(customInput(), { target: { value: '0.05' } });
    fireEvent.blur(customInput());
    expect(lastRate()).toBe(PLAYBACK_RATE_RANGE.min);
    expect((customInput() as HTMLInputElement).value).toBe('0.1');
  });

  it(`倍速：↑↓ 按 ${SIM_PLAYBACK_RATE_STEP} 步进`, async () => {
    await renderStage();
    openPanel();
    fireEvent.change(customInput(), { target: { value: '1' } });
    fireEvent.keyDown(customInput(), { key: 'Enter' });
    fireEvent.keyDown(customInput(), { key: 'ArrowUp' });
    expect(lastRate()).toBeCloseTo(1 + SIM_PLAYBACK_RATE_STEP, 6);
    fireEvent.keyDown(customInput(), { key: 'ArrowDown' });
    fireEvent.keyDown(customInput(), { key: 'ArrowDown' });
    expect(lastRate()).toBeCloseTo(1 - SIM_PLAYBACK_RATE_STEP, 6);
  });

  it('倍速不改谱面秒数：进度条量程仍是谱面长度', async () => {
    await renderStage();
    expect(seekTrack().getAttribute('aria-valuemax')).toBe('12'); // duration = 12s
    openPanel();
    fireEvent.click(screen.getByRole('menuitem', { name: '2×' }));
    expect(seekTrack().getAttribute('aria-valuemax')).toBe('12');
  });

  it('票 20 验收定案：播放条无「回开头」与「循环」两钮，loop 也不再往下传', async () => {
    await renderStage();
    // 回开头与循环均无入口
    expect(screen.queryByRole('button', { name: /^(回到开头|Restart|循环播放|Loop)$/ })).toBeNull();
    expect(screen.queryAllByRole('button', { pressed: true })).toEqual([]); // 循环是唯一的开关钮（倍速是菜单，不是开关）

    openPanel();
    fireEvent.click(screen.getByRole('menuitem', { name: '0.5×' }));
    expect(calls.setOptions).not.toHaveBeenCalledWith(expect.objectContaining({ loop: expect.anything() }));
  });

  it('主音量：滑杆走 onVolumeChange（落 settings.audio.volume），不自己摸引擎', async () => {
    const { onVolumeChange } = await renderStage({ volume: 1 });
    const slider = screen.getByRole('slider', { name: t('play.volume') }) as HTMLInputElement;
    expect(Number(slider.min)).toBe(0);
    expect(Number(slider.max)).toBe(1);
    expect(Number(slider.step)).toBe(0.05);

    fireEvent.change(slider, { target: { value: '0.35' } });
    expect(onVolumeChange).toHaveBeenCalledWith(0.35);
    // 音量不进"倍速"那一路：它是设置域的值，由页面回写后再透传
    expect(calls.setOptions).not.toHaveBeenCalledWith(expect.objectContaining({ volume: 0.35 }));
  });

  it('控件都不重建引擎：旋钮只走 setOptions（创建回放只发生一次）', async () => {
    await renderStage();
    const { createSimPlayback } = await import('@/src/preview');
    const before = (createSimPlayback as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    openPanel();
    fireEvent.click(screen.getByRole('menuitem', { name: '1.5×' }));
    openPanel();
    fireEvent.change(customInput(), { target: { value: '2' } });
    fireEvent.blur(customInput());
    expect((createSimPlayback as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(before);
  });
});

describe('动态预览播放条 · 与工作台播放器共用（chart-preview 22）', () => {
  it('空格：预览页 active 时接管 play → 回放 toggle()', async () => {
    await renderStage();
    expect(calls.play).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: ' ' });
    expect(calls.play).toHaveBeenCalledTimes(1);
  });

  it('空格：焦点在输入框内放行原生（不触发 toggle）', async () => {
    await renderStage();
    openPanel();
    fireEvent.keyDown(customInput(), { key: ' ' });
    expect(calls.play).not.toHaveBeenCalled();
  });

  it('空格：预览页失活时不接管（保活挂载的别的页在放）', async () => {
    await renderStage({ active: false });
    fireEvent.keyDown(window, { key: ' ' });
    expect(calls.play).not.toHaveBeenCalled();
  });

  it('时间码双击：输入秒回车 → seek；越界钳到 [0, duration]', async () => {
    await renderStage();
    expect(timeInput()).toBeNull();

    fireEvent.doubleClick(currentTime());
    expect(timeInput()).toBeTruthy();
    fireEvent.change(timeInput()!, { target: { value: '0:05' } }); // mm:ss（既有解析口径）
    fireEvent.keyDown(timeInput()!, { key: 'Enter' });
    expect(calls.seek).toHaveBeenLastCalledWith(5);

    // 越界：上钳到 duration、下钳到 0（与工作台同一条提交路径）
    fireEvent.doubleClick(currentTime());
    fireEvent.change(timeInput()!, { target: { value: '5:00' } });
    fireEvent.keyDown(timeInput()!, { key: 'Enter' });
    expect(calls.seek).toHaveBeenLastCalledWith(12);

    fireEvent.doubleClick(currentTime());
    fireEvent.change(timeInput()!, { target: { value: '0:00' } });
    fireEvent.keyDown(timeInput()!, { key: 'Enter' });
    expect(calls.seek).toHaveBeenLastCalledWith(0);
  });

  it('时间码双击：有音频时照样可编辑（issue 22 Q3：预览不照工作台 canPlay gate 走）', async () => {
    const audio: SimPlaybackAudio = { name: 'song.mp3', blob: new Blob() };
    await renderStage({ audio });

    fireEvent.doubleClick(currentTime());
    expect(timeInput()).toBeTruthy();
    fireEvent.change(timeInput()!, { target: { value: '0:03.5' } });
    fireEvent.keyDown(timeInput()!, { key: 'Enter' });
    expect(calls.seek).toHaveBeenLastCalledWith(3.5);
  });

  it('时间码双击：未输入/未修改任何内容失焦或回车不触发 seek（issue 38 锁）', async () => {
    await renderStage({ initialSeconds: 4.5 });
    calls.seek.mockClear();

    // 双击打开输入框，不输入任何内容直接按 Enter
    fireEvent.doubleClick(currentTime());
    expect(timeInput()).toBeTruthy();
    fireEvent.keyDown(timeInput()!, { key: 'Enter' });
    expect(timeInput()).toBeNull();
    expect(calls.seek).not.toHaveBeenCalled();

    // 再次双击打开，不输入任何内容直接 blur
    fireEvent.doubleClick(currentTime());
    expect(timeInput()).toBeTruthy();
    fireEvent.blur(timeInput()!);
    expect(timeInput()).toBeNull();
    expect(calls.seek).not.toHaveBeenCalled();
  });

  it('时间码双击：按 Escape 取消编辑不触发 seek（issue 38 锁）', async () => {
    await renderStage({ initialSeconds: 2.0 });
    calls.seek.mockClear();

    fireEvent.doubleClick(currentTime());
    expect(timeInput()).toBeTruthy();
    fireEvent.change(timeInput()!, { target: { value: '0:10' } });
    fireEvent.keyDown(timeInput()!, { key: 'Escape' });
    expect(timeInput()).toBeNull();
    expect(calls.seek).not.toHaveBeenCalled();
  });

  it('播放进度：切页/对象重建但谱面语义一致时不重置回 0；内容真正修改或换谱才重置', async () => {
    const onSecondsChange = vi.fn();
    const initialNotes = [{ type: 'Single' as const, beat: 0, lane: 0 }];
    const { rerender } = await renderStage({
      chartId: 'chart-1',
      initialSeconds: 5.5,
      onSecondsChange,
      scene: { ...scene, notes: initialNotes },
    });
    // 挂载时恢复 initialSeconds
    expect(calls.seek).toHaveBeenCalledWith(5.5);

    calls.seek.mockClear();
    calls.pause.mockClear();

    // 模拟切页激活：从 IndexedDB 重新读出结构相同的深拷贝 notes（新引用，但内容相同）
    const identicalNotes = [{ type: 'Single' as const, beat: 0, lane: 0 }];
    rerender(
      <PreviewVideoStage
        active={true}
        scene={{ ...scene, notes: identicalNotes }}
        duration={12}
        audio={null}
        keySetId="skin00"
        seVolume={1}
        volume={1}
        onVolumeChange={vi.fn()}
        imageQuality="high"
        noteSkin={'default' as AppSettings['visual']['noteSkin']}
        shortcuts={SHORTCUTS}
        chartId="chart-1"
        onSecondsChange={onSecondsChange}
      />,
    );

    // 语义未改：不重置、不 seek(0)、不 pause()
    expect(calls.seek).not.toHaveBeenCalled();
    expect(calls.pause).not.toHaveBeenCalled();

    // 真正修改音符（增加一个音符）：触发重置回 0 并暂停
    const modifiedNotes = [
      { type: 'Single' as const, beat: 0, lane: 0 },
      { type: 'Single' as const, beat: 1, lane: 1 },
    ];
    rerender(
      <PreviewVideoStage
        active={true}
        scene={{ ...scene, notes: modifiedNotes }}
        duration={12}
        audio={null}
        keySetId="skin00"
        seVolume={1}
        volume={1}
        onVolumeChange={vi.fn()}
        imageQuality="high"
        noteSkin={'default' as AppSettings['visual']['noteSkin']}
        shortcuts={SHORTCUTS}
        chartId="chart-1"
        onSecondsChange={onSecondsChange}
      />,
    );

    expect(calls.pause).toHaveBeenCalled();
    expect(calls.seek).toHaveBeenCalledWith(0);
    expect(onSecondsChange).toHaveBeenCalledWith(0);
  });

  it('chart-preview 57 · 播放期 onTick 按 80ms 节流 PlayBar HUD 与 onSecondsChange，起停切换与暂停态立即提交', async () => {
    const { act } = await import('@testing-library/react');
    const onSecondsChange = vi.fn();
    let now = 1000;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      await renderStage({ onSecondsChange });
      expect(calls.lastOnTick).toBeTypeOf('function');
      onSecondsChange.mockClear();

      // 1. 起播切换（false -> true）：立即提交 1.0s
      act(() => {
        calls.lastOnTick!(1.0, true);
      });
      expect(seekTrack().getAttribute('aria-valuenow')).toBe('1');
      expect(onSecondsChange).toHaveBeenCalledTimes(1);
      expect(onSecondsChange).toHaveBeenLastCalledWith(1.0);

      // 2. 播放中仅过 16ms（< 80ms）：PlayBar HUD 与父级 onSecondsChange 均被节流，不触发 60Hz 重渲
      now = 1016;
      act(() => {
        calls.lastOnTick!(2.0, true);
      });
      expect(onSecondsChange).toHaveBeenCalledTimes(1);
      expect(seekTrack().getAttribute('aria-valuenow')).toBe('1');

      // 3. 满 80ms（1080ms）：PlayBar HUD 与 onSecondsChange 同步更新到 3.0s
      now = 1080;
      act(() => {
        calls.lastOnTick!(3.0, true);
      });
      expect(seekTrack().getAttribute('aria-valuenow')).toBe('3');
      expect(onSecondsChange).toHaveBeenCalledTimes(2);
      expect(onSecondsChange).toHaveBeenLastCalledWith(3.0);

      // 4. 暂停态（playing = false）：即使仅过 5ms 也立即提交
      now = 1085;
      act(() => {
        calls.lastOnTick!(4.0, false);
      });
      expect(seekTrack().getAttribute('aria-valuenow')).toBe('4');
      expect(onSecondsChange).toHaveBeenCalledTimes(3);
      expect(onSecondsChange).toHaveBeenLastCalledWith(4.0);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
