// @vitest-environment jsdom
// 票 70 复验整改：未编辑/未换作用域/未改目录时切回预览，零重读、零 flush、零遮罩；
// 只有真实发生工作台编辑（editEpoch 递增）或作用域/目录变更时才在 layout 阶段置 checking + 按需重读，
// 且工作台编辑不再无谓调用 store.list()，语义等价时仍保持 project 身份与 dataVersion 不变。
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartNote } from '@/src/chart/types';
import type { ChartProject } from '@/src/project/ChartProject';

// vi.mock 会被提升到 import 之前：依赖都放在 hoisted 里，且 **引用必须稳定** ——
// useCurrentProject() 每次返回新 store 会让读 effect 的依赖永远在变。
const h = vi.hoisted(() => ({
  record: null as unknown,
  getCalls: 0,
  listCalls: 0,
  flushCalls: 0,
  editEpoch: 0,
  current: {
    projectId: 'pA',
    chartId: 'c1',
    catalogEpoch: 0,
    flushPersist: async () => {
      h.flushCalls += 1;
    },
    getProjectEditEpoch: () => h.editEpoch,
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
  h.listCalls = 0;
  h.flushCalls = 0;
  h.editEpoch = 0;
  h.record = makeProject();
  // 模拟真实后端：每次 get() 都是反序列化出来的**新对象**（内容相同也要新引用）
  h.current.store.list = async () => {
    h.listCalls += 1;
    return [h.record];
  };
  h.current.store.get = async () => {
    h.getCalls += 1;
    return structuredClone(h.record);
  };
});

describe('票 70 · usePreviewScope 按需重读与抑制', () => {
  it('未编辑、未改目录、未换作用域：切回不重读、不 flush、不置 checking', async () => {
    const { result, rerender } = renderHook(({ active }) => usePreviewScope(active), {
      initialProps: { active: true },
    });
    await act(async () => {});
    const first = result.current.project;
    expect(first).not.toBeNull();
    expect(result.current.dataVersion).toBe(1);
    expect(h.getCalls).toBe(1);
    expect(h.listCalls).toBe(1);
    expect(h.flushCalls).toBe(0);

    // 去其他页面未做编辑再切回预览：零开销切回
    rerender({ active: false });
    rerender({ active: true });
    expect(result.current.checking).toBe(false);
    await act(async () => {});

    expect(h.getCalls).toBe(1);
    expect(h.listCalls).toBe(1);
    expect(h.flushCalls).toBe(0);
    expect(result.current.project).toBe(first);
    expect(result.current.dataVersion).toBe(1);
  });

  it('发生编辑后激活：layout 阶段立即置 checking、先 flush 再读单条（跳过 store.list）', async () => {
    const { result, rerender } = renderHook(({ active }) => usePreviewScope(active), {
      initialProps: { active: true },
    });
    await act(async () => {});
    expect(result.current.checking).toBe(false);

    rerender({ active: false });
    h.editEpoch += 1;
    rerender({ active: true });
    // 异步读盘还没回来；此时页面必须已经盖住旧画布
    expect(result.current.checking).toBe(true);

    await act(async () => {});
    expect(result.current.checking).toBe(false);
    expect(h.flushCalls).toBe(1);
    expect(h.getCalls).toBe(2);
    expect(h.listCalls).toBe(1);
    // 内容实际上相同（语义等价）：不提交新 project / 不递增 dataVersion
    expect(result.current.dataVersion).toBe(1);
  });

  it('发生编辑且内容真变了：交出新 project、dataVersion 递增，再切回无编辑保持版本稳定', async () => {
    const { result, rerender } = renderHook(({ active }) => usePreviewScope(active), {
      initialProps: { active: true },
    });
    await act(async () => {});
    const first = result.current.project;
    expect(result.current.dataVersion).toBe(1);

    h.record = makeProject([...NOTES, { type: 'Single', beat: 5, lane: 6 }]);
    rerender({ active: false });
    h.editEpoch += 1;
    rerender({ active: true });
    await act(async () => {});

    expect(result.current.project).not.toBe(first);
    expect(result.current.dataVersion).toBe(2);

    // 再切一次、无新编辑：不重读、版本停在 2
    rerender({ active: false });
    rerender({ active: true });
    await act(async () => {});
    expect(h.getCalls).toBe(2);
    expect(result.current.dataVersion).toBe(2);
  });

  it('票 69 复验整改：重新激活时在 layout 阶段同步重置临时谱面选卡，首帧不闪过旧选卡', async () => {
    const base = makeProject();
    h.record = {
      ...base,
      charts: [
        base.charts[0],
        { ...base.charts[0], id: 'c2', title: 'A2', diff: 3 },
      ],
    };
    const { result, rerender } = renderHook(({ active }) => usePreviewScope(active), {
      initialProps: { active: true },
    });
    await act(async () => {});
    expect(result.current.chartId).toBe('c1');

    act(() => { result.current.pickChart('c2'); });
    expect(result.current.chartId).toBe('c2');

    rerender({ active: false });
    rerender({ active: true });
    // layout 阶段已复位，不等异步 effect 即可直接拿到默认谱面
    expect(result.current.chartId).toBe('c1');
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
