// @vitest-environment jsdom
// 票 43 Q2：关窗后在飞的 updateProject 不得把发布弹窗 target 设回来。
import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ChartProject, ProjectChart } from '@/src/project/ChartProject';
import { usePublishEntry } from '@/src/pages/projects/usePublishEntry';
import { ElectronCommunityTransport } from '@/src/community/electronTransport';
import { postCreateUrl, postDetailUrl, postListUrl } from '@/src/community/bestdori/endpoints';
import type { PublishInput, PublishOutcome, PublishStage } from '@/src/community/bestdori/publish';
import { isChartReadonly } from '@/src/project/chartReadonlyGate';
import { isProjectAudioLocked } from '@/src/project/workspaceProject';

vi.mock('@/src/community/bestdori/account', () => ({
  getCommunityAccount: () => ({ getSession: () => ({ account: { username: 'author' } }) }),
}));

afterEach(() => { vi.unstubAllGlobals(); });

const AT = 1_700_000_000_000;

function makeChart(): ProjectChart {
  return {
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
}

function makeProject(): ChartProject {
  return {
    id: 'p1',
    name: 'song',
    artist: 'RAS',
    source: { type: 'custom' },
    durationSeconds: 100,
    lastOpened: AT,
    charts: [makeChart()],
    audioName: 'a.mp3',
    coverName: null,
  };
}

describe('票 43 · usePublishEntry 关窗不复活', () => {
  it('close 之后才完成的 mutate 不得 setTarget 回来', async () => {
    let project = makeProject();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const store = {
      get: async () => project,
      save: async (next: ChartProject) => {
        await gate;
        project = next;
      },
    };
    const { result } = renderHook(() => usePublishEntry({
      store,
      flush: async () => {},
      notify: () => {},
      reload: async () => {},
    }));

    act(() => result.current.open(project, project.charts[0]));
    expect(result.current.target).not.toBeNull();

    let finished!: Promise<void>;
    act(() => {
      finished = result.current.updateProject((p) => ({ ...p, artist: 'x' }));
    });
    act(() => result.current.close());
    expect(result.current.target).toBeNull();

    release();
    await act(async () => { await finished; });
    expect(result.current.target).toBeNull();
  });
});

function startPublication(reply: 'unknown' | 'success' | 'rejected', ids: number[], refuseSave = false) {
  vi.stubGlobal('crypto', webcrypto);
  let project = makeProject();
  project.source = { type: 'bandori', id: 413 };
  project.charts[0].notes.push({ type: 'Single', beat: 1, lane: 0 });
  const posted = vi.fn();
  const lookedUp = vi.fn();
  const chartAt = Date.now() + 3000;
  const store = {
    get: async () => structuredClone(project),
    save: async (next: ChartProject) => {
      if (refuseSave) throw new Error('disk write failed');
      project = structuredClone(next);
    },
  };
  const body = {
    title: 'Expert', author: { username: 'author', nickname: 'Display' },
    diff: 3, level: 24, song: { type: 'bandori', id: 413 }, time: chartAt,
    chart: [{ bpm: 120, type: 'BPM', beat: 0 }, { lane: 0, beat: 1, type: 'Single' }], tags: [],
  };
  const transport = new ElectronCommunityTransport({
    async request(req) {
      if (req.url === postCreateUrl()) {
        posted();
        expect(project.charts[0].pendingPublish?.username).toBe('author');
        expect(project.charts[0].pendingPublish?.tags).toEqual([{ type: 'text', data: 'submitted' }]);
        if (reply === 'success') return { ok: true, responseType: 'json', status: 200, data: { result: true, id: 71 } };
        return { ok: false, error: { kind: 'invalid-response', message: 'fixture', httpStatus: 200,
          platformCode: reply === 'unknown' ? 'UNKNOWN' : 'POST_INVALID' } };
      }
      lookedUp(req);
      expect(req.revalidate).toBe(true);
      if (req.url === postListUrl()) {
        return { ok: true, responseType: 'json', status: 200, data: {
          result: true, count: ids.length, posts: ids.map((id) => ({ ...body, id })),
        } };
      }
      const id = Number(new URL(req.url).searchParams.get('id'));
      expect(req.url).toBe(postDetailUrl(id));
      const post = id === 99 ? { ...body, author: { username: 'someone-else', nickname: 'author' } } : body;
      return { ok: true, responseType: 'json', status: 200, data: { result: true, post } };
    },
  });
  const { result, unmount } = renderHook(() => usePublishEntry({
    store, transport, flush: async () => {}, notify: () => {}, reload: async () => {},
  }));
  act(() => result.current.open(project, project.charts[0]));
  const stages: PublishStage[] = [];
  const run = async (): Promise<PublishOutcome | undefined> => {
    const input: PublishInput = {
      published: false, title: 'Expert', artists: 'RAS', diff: 3, level: 24, content: 'notes',
      chartCode: result.current.target!.chartCode, song: { kind: 'bandori', songId: 413 },
      tags: [{ type: 'text', data: 'submitted' }],
    };
    let outcome: PublishOutcome | undefined;
    await act(async () => { outcome = await result.current.run(input, (stage) => stages.push(stage)); });
    return outcome;
  };
  return { result, unmount, run, store, posted, lookedUp, stages, getProject: () => project };
}

describe('票 58 · 发帖结果与上传记录恢复', () => {
  it('UNKNOWN 后唯一匹配补记，即使标签被平台省略，仍只发一次帖', async () => {
    const flow = startPublication('unknown', [71]);
    expect(await flow.run()).toEqual({ ok: true, postId: 71, recordWritten: true });
    expect(flow.posted).toHaveBeenCalledOnce();
    expect(flow.stages).toEqual(['post', 'check']);
    expect(flow.getProject().charts[0]).toMatchObject({ upload: { postId: 71, username: 'author' } });
    expect(flow.getProject().charts[0].pendingPublish).toBeUndefined();
  });

  it.each(['success', 'rejected'] as const)('%s 正常结束与解除待确认锁，零回查', async (reply) => {
    const flow = startPublication(reply, []);
    expect(await flow.run()).toMatchObject(reply === 'success' ? { ok: true } : { ok: false, failure: 'rejected' });
    expect(flow.posted).toHaveBeenCalledOnce();
    expect(flow.lookedUp).not.toHaveBeenCalled();
    expect(flow.getProject().charts[0].pendingPublish).toBeUndefined();
  });

  it('本机待确认状态写入失败时不尝试发帖', async () => {
    const flow = startPublication('unknown', [], true);
    expect(await flow.run()).toEqual({ ok: false, failure: 'local' });
    expect(flow.posted).not.toHaveBeenCalled();
  });

  it('未匹配时关窗重开仍锁定；重复调用不会重新发帖', async () => {
    const flow = startPublication('unknown', []);
    expect(await flow.run()).toEqual({ ok: false, failure: 'pending-confirmation' });
    expect(flow.result.current.recovery).toEqual({ status: 'unmatched' });
    const persisted = await flow.store.get();
    expect(isChartReadonly(persisted.charts[0])).toBe(true);
    expect(isProjectAudioLocked(persisted)).toBe(true);
    act(() => flow.result.current.close());
    act(() => flow.result.current.open(persisted, persisted.charts[0]));
    expect(await flow.run()).toEqual({ ok: false, failure: 'pending-confirmation' });
    expect(flow.posted).toHaveBeenCalledOnce();
  });

  it('多个匹配留待用户选择，选中后补记这一帖', async () => {
    const flow = startPublication('unknown', [71, 72]);
    expect(await flow.run()).toEqual({ ok: false, failure: 'pending-confirmation' });
    expect(flow.result.current.recovery).toMatchObject({ status: 'choose', posts: [{ id: 71 }, { id: 72 }] });
    expect(flow.getProject().charts[0].upload).toBeNull();
    await act(async () => { expect(await flow.result.current.recover(72)).toBe(true); });
    expect(flow.getProject().charts[0].upload?.postId).toBe(72);
  });

  it('按 ID 关联旧帖校验账号，拒绝用相同昵称冒充账号的帖子', async () => {
    const flow = startPublication('unknown', []);
    await act(async () => { expect(await flow.result.current.recover(99)).toBe(false); });
    expect(flow.result.current.recovery).toEqual({ status: 'mismatch' });
    expect(flow.getProject().charts[0].upload).toBeNull();
    await act(async () => { expect(await flow.result.current.recover(71)).toBe(true); });
    expect(flow.getProject().charts[0].upload?.postId).toBe(71);
    expect(flow.posted).not.toHaveBeenCalled();
  });
});
