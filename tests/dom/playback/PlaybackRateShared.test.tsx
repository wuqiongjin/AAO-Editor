// @vitest-environment jsdom
// chart-preview 58 / 59：工作台与动态预览共用同一份「本次运行」的倍速值。
// 一处改值，另一处实时回显一致；刷新 / 重启回落 1×（不落设置、不进 schema）。
// 跨页挂载时序单测盖不到 ⇒ Playwright 真机手工验收；这里锁「共享单点 + 受控件实时同步」这一机制。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import PlaybackRate from '@/src/playback/PlaybackRate';
import {
  getPlaybackRate,
  resetPlaybackRate,
  setPlaybackRate,
  usePlaybackRate,
} from '@/src/playback/playbackRateState';

/** 两处 rateSlot 的代表：都从共享单点取值、都写回共享单点（与两处页面接线同构） */
function Harness() {
  const [rate, setRate] = usePlaybackRate();
  return (
    <>
      <PlaybackRate value={rate} onChange={setRate} />
      <PlaybackRate value={rate} onChange={setRate} />
    </>
  );
}

/** 两个触钮（可访问名就是当前倍速 `1×` / `2×`…；DOM 顺序 = 工作台、预览）。
 *  只按 role / text 查询（`tests/README.md` 的 dom 约定），不绑 testid / DOM 结构。 */
const triggers = () => screen.getAllByRole('button', { name: /×$/ });

beforeEach(() => resetPlaybackRate());

describe('倍速值 · 工作台与动态预览共用一份（chart-preview 58 / 59）', () => {
  it('初值 1×，两处回显一致', () => {
    expect(getPlaybackRate()).toBe(1);
    render(<Harness />);
    expect(triggers().map((b) => b.textContent)).toEqual(['1×', '1×']);
  });

  it('工作台改值 → 动态预览实时回显一致；预览侧改值 → 工作台同样一致', () => {
    render(<Harness />);

    // 工作台选 2×：同一时刻只开一处面板，档位表 / 输入框全局唯一，不会混
    fireEvent.click(triggers()[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: '2×' }));
    expect(getPlaybackRate()).toBe(2);
    expect(triggers().map((b) => b.textContent)).toEqual(['2×', '2×']); // 实时同步到另一处

    // 预览侧手填 0.5×（敲一下就生效）
    fireEvent.click(triggers()[1]);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '0.5' } });
    expect(getPlaybackRate()).toBe(0.5);
    expect(triggers()[0].textContent).toBe('0.5×'); // 反向也一致
  });

  it('刷新 / 重启口径：复位共享单点回 1×，两处跟着回显', () => {
    render(<Harness />);
    fireEvent.click(triggers()[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: '2×' }));
    expect(triggers()[1].textContent).toBe('2×');

    act(() => { resetPlaybackRate(); }); // 脱离 React 事件循环的写回，需 act 冲刷订阅者重渲
    expect(getPlaybackRate()).toBe(1);
    expect(triggers().map((b) => b.textContent)).toEqual(['1×', '1×']);
  });

  it('共享单点自身钳在引擎区间内，非法值不让它漂移', () => {
    setPlaybackRate(99);
    expect(getPlaybackRate()).toBe(4);
    setPlaybackRate(0);
    expect(getPlaybackRate()).toBe(0.1);
    setPlaybackRate(1.35);
    expect(getPlaybackRate()).toBe(1.35); // 档位表之外的手填值照收
  });
});
