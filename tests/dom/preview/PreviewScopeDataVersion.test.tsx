// @vitest-environment jsdom
// 票 70 · 激活重读的等价比较：保活页从隐藏变可见时仍会 flushPersist + store.get()，
// 但「读回来的是新对象」不等于「内容变了」。内容没变就不许换 project 身份（否则 scene 换代 →
// 画家换代 → 可见面板同步整批重画，长谱上就是用户报的那一小瞬卡顿）；真变了才递增 dataVersion，
// 由预览页用骨架盖住旧画布、分批重出。
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartNote } from '@/src/chart/types';
import type { ChartProject } from '@/src/project/ChartProject';

// vi.mock 会被提升到 import 之前：依赖都放在 hoisted 里，且 **引用必须稳定** ——
// useCurrentProject() 每次返回新 store 会让读 effect 的依赖永远在变。
const h = vi.hoisted(() => ({
  record: null as unknown,
  getCalls: 0,
  current: {
    projectId: 'pA',
    chartId: 'c1',
    catalogEpoch: 0,
    flushPersist: async () => {},
    store: {
      list: async (): Promise<unknown[]> => [],
      get: async (): Promise<unknown> => null,
    },
  },
}));

vi.mock('@/src/layouts/AppNav', () => ({
  useAppNav: () => ({ pageScope: null }),
}));
vi.mock('@/src/app/providers/CurrentProjectProvider', () => ({
  useCurrentProject: () => h.current,
}));

import { samePreviewProject, usePreviewScope } from '@/src/pages/preview/usePreviewScope';

const NOTES: ChartNote[] = [
  { type: 'BPM', beat: 0, bpm: 120 },
  { type: 'Single', beat: 1, lane: 0 },
  { type: 'Single', beat: 3, lane: 3 },
];

function makeProject(notes: ChartNote[] = NOTES): ChartProject {
  return {
    id: 'pA',
    name: 'Alpha',
    artist: null,
    source: { type: 'custom' },
    durationSeconds: 40,
    lastOpened: 1,
    charts: [{
      id: 'c1',
      notes,
      title: 'A1',
      diff: 2,
      level: null,
      completed: false,
      upload: null,
      lastModified: 1,
      appliedChartCodeText: null,
      chartCodePristine: false,
    }],
    audioName: null,
    coverName: null,
  };
}

beforeEach(() => {
  h.getCalls = 0;
  h.record = makeProject();
  // 模拟真实后端：每次 get() 都是反序列化出来的**新对象**（内容相同也要新引用）
  h.current.store.list = async () => [h.record];
  h.current.store.get = async () => {
    h.getCalls += 1;
    return structuredClone(h.record);
  };
});

describe('票 70 · usePreviewScope 激活重读', () => {
  it('内容没变：仍重读，但 project 身份与 dataVersion 都不动（不换代、不重画、不给骨架）', async () => {
    const { result, rerender } = renderHook(({ active }) => usePreviewScope(active), {
      initialProps: { active: true },
    });
    await act(async () => {});
    const first = result.current.project;
    expect(first).not.toBeNull();
    expect(result.current.dataVersion).toBe(1);
    expect(h.getCalls).toBe(1);

    // 去工作台再切回预览：active 翻转触发第二次重读
    rerender({ active: false });
    rerender({ active: true });
    await act(async () => {});

    expect(h.getCalls).toBe(2);                    // 读确实发生了
    expect(result.current.project).toBe(first);    // 但没提交新对象 → scene/painter 不换代
    expect(result.current.dataVersion).toBe(1);    // → 预览页不会显示骨架
  });

  it('激活瞬间先置 checking（paint 前盖住旧画布），读完成即收掉', async () => {
    const { result, rerender } = renderHook(({ active }) => usePreviewScope(active), {
      initialProps: { active: true },
    });
    await act(async () => {});
    expect(result.current.checking).toBe(false);

    rerender({ active: false });
    rerender({ active: true });
    // 异步读盘还没回来；此时页面必须已经盖住旧画布
    expect(result.current.checking).toBe(true);

    await act(async () => {});
    expect(result.current.checking).toBe(false);
  });

  it('内容真变了：交出新 project、dataVersion 递增，且作用域清空再回来不倒退', async () => {
    const { result, rerender } = renderHook(({ active }) => usePreviewScope(active), {
      initialProps: { active: true },
    });
    await act(async () => {});
    const first = result.current.project;
    expect(result.current.dataVersion).toBe(1);

    h.record = makeProject([...NOTES, { type: 'Single', beat: 5, lane: 6 }]);
    rerender({ active: false });
    rerender({ active: true });
    await act(async () => {});

    expect(result.current.project).not.toBe(first);
    expect(result.current.dataVersion).toBe(2);

    // 再切一次、内容没变：版本停在 2
    rerender({ active: false });
    rerender({ active: true });
    await act(async () => {});
    expect(result.current.dataVersion).toBe(2);
  });
});

describe('票 70 · samePreviewProject', () => {
  it('两份逐字段相等但引用不同的记录算同一份', () => {
    expect(samePreviewProject(makeProject(), structuredClone(makeProject()))).toBe(true);
  });

  it('音符 / 谱面时长 / 谱面元数据任一变化都算换代', () => {
    const base = makeProject();
    expect(samePreviewProject(base, makeProject([...NOTES, { type: 'Single', beat: 7, lane: 2 }]))).toBe(false);
    expect(samePreviewProject(base, { ...makeProject(), durationSeconds: 41 })).toBe(false);
    const titled = makeProject();
    titled.charts[0].title = '重命名';
    expect(samePreviewProject(base, titled)).toBe(false);
  });

  it('真实谱的原始音符类型（notesEqual 不认的 Directional）也能判等 / 判变', () => {
    const raw = [{ type: 'Directional', beat: 4, lane: 1, width: 2, direction: 'Left' }] as unknown as ChartNote[];
    expect(samePreviewProject(makeProject(raw), structuredClone(makeProject(raw)))).toBe(true);

    const changed = structuredClone(raw) as Array<Record<string, unknown>>;
    changed[0].lane = 3;
    expect(samePreviewProject(makeProject(raw), makeProject(changed as unknown as ChartNote[]))).toBe(false);
  });

  it('二进制字段不比：反序列化出的新 Blob 不该让静态预览白重画一次', () => {
    const withBlob = (): ChartProject => ({
      ...makeProject(),
      audioBlob: new Blob(['audio']),
      coverBlob: new Blob(['cover']),
    });
    expect(samePreviewProject(withBlob(), withBlob())).toBe(true);
  });

  it('null / 工程被删：与任何非 null 记录都不等', () => {
    expect(samePreviewProject(null, null)).toBe(true);
    expect(samePreviewProject(null, makeProject())).toBe(false);
    expect(samePreviewProject(makeProject(), null)).toBe(false);
  });
});
