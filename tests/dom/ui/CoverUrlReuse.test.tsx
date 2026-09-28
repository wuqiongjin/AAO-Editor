// @vitest-environment jsdom
// issue 19 #3：封面 objectURL 的**复用**与**回收**。
//
// 复用：同一 Blob 在多个封面实例间共享同一个 URL（切视图不重新建 URL、不重新解码 —— 这是"闪一下"的根）。
// 回收：最后一个引用卸载后 revoke（不把 Blob 钉在内存里）。
// 时序：同一次提交里的「旧视图卸载 → 新视图挂载」先后 release/acquire 同一 Blob，中间不得 revoke
//      （hub 卸载 + 详情挂载就是这种形状；单位置换 key 的 rerender 即是它的最小复现）。
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useCoverUrl } from '@/src/ui/CoverField';

let created: string[];
let revoked: string[];

beforeEach(() => {
  created = [];
  revoked = [];
  let seq = 0;
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: () => {
      seq += 1;
      const url = `blob:probe/${seq}`;
      created.push(url);
      return url;
    },
    revokeObjectURL: (url: string) => {
      revoked.push(url);
    },
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function Probe({ blob }: { blob?: Blob }) {
  const url = useCoverUrl(blob);
  return <div data-testid="probe" data-url={url ?? ''} />;
}

/** 同一测试里可能挂了多个 render 根（都在 body 下），按各自 container 取，别用全局 getBy*。 */
function probeUrl(view: { container: HTMLElement }): string {
  return view.container.querySelector('[data-testid="probe"]')?.getAttribute('data-url') ?? '';
}

function pngByte(): Blob {
  return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
}

describe('issue 19 #3 · 封面 objectURL 复用与回收', () => {
  it('同一 Blob 的多个实例共用一个 URL；最后一个卸载才 revoke', async () => {
    const blob = pngByte();
    const first = render(<Probe blob={blob} />);
    const second = render(<Probe blob={blob} />);

    expect(created).toHaveLength(1);
    const url = probeUrl(first);
    expect(url).not.toBe('');
    expect(probeUrl(second)).toBe(url);

    // 还有引用在 → 不回收
    first.unmount();
    await Promise.resolve();
    expect(revoked).toHaveLength(0);

    // 最后一个引用卸载 → 微任务里回收
    second.unmount();
    await waitFor(() => expect(revoked).toEqual([url]));
  });

  it('同一次提交里换实例（旧卸载 + 新挂载，同一 Blob）：不新建也不撤销', async () => {
    const blob = pngByte();
    const view = render(<Probe key="old" blob={blob} />);
    expect(created).toHaveLength(1);
    const url = probeUrl(view);

    // key 变化 = 同一提交内旧实例下、新实例上（hub → 详情的最小形状）
    view.rerender(<Probe key="new" blob={blob} />);
    const newUrl = probeUrl(view);
    expect(newUrl).toBe(url);

    await waitFor(() => expect(created).toHaveLength(1));
    expect(revoked).toHaveLength(0);
  });

  it('换成另一个 Blob：新 URL 顶上，旧 URL 回收', async () => {
    const a = pngByte();
    const b = pngByte();
    const view = render(<Probe blob={a} />);
    const urlA = probeUrl(view);

    view.rerender(<Probe blob={b} />);
    const urlB = probeUrl(view);
    expect(urlB).not.toBe(urlA);
    expect(created).toHaveLength(2);

    await waitFor(() => expect(revoked).toEqual([urlA]));
  });

  it('空 Blob：不建 URL，回退 null', () => {
    render(<Probe blob={new Blob([], { type: 'image/png' })} />);
    expect(created).toHaveLength(0);
    expect(document.querySelector('[data-testid="probe"]')?.getAttribute('data-url')).toBe('');
  });
});
