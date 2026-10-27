// @vitest-environment jsdom
// 33 票：工作台音频资源异常横幅（丢失 / 被替换）——hydrate 路径的检测与双动作。
//
// 照 ChartSwitcherAudioEntry.test.tsx 注入假 store/引擎：本测试挂一个与工作台同接线的
// 轻量宿体（useCurrentProject + useAudioSession + useAppNav + useAudioAnomaly +
// AudioAnomalyBanner），模拟一次「恢复 → hydrate（解码异步）」：
//   - 丢失（半态记录）：横幅出现 / 去音频页重新导入（带作用域）/ 清除音频记录（force 写路径）；
//   - 替换（字节在、时长不符）：横幅出现 / 按音频重新对齐（realign 写路径）/ 暂不处理不再出现；
//   - 切工程（新旧音频时长相同、快照值不变）：替换照样判得出——锁定工程没有防抖自愈；
//   - 记录与音频一致：不出横幅。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { useEffect, useMemo, useRef } from 'react';
import AudioAnomalyBanner from '@/src/pages/workspace/AudioAnomalyBanner';
import { useAudioAnomaly } from '@/src/pages/workspace/useAudioAnomaly';
import { AppNavProvider, type AppNavValue } from '@/src/layouts/AppNav';
import { useCurrentProject } from '@/src/app/providers/CurrentProjectProvider';
import { useAudioSession } from '@/src/app/providers/AudioSessionProvider';
import { createAudioSession } from '@/src/audio/AudioSession';
import type { AudioEngine } from '@/src/audio/AudioEngine';
import { ChartProjectStore, type ChartProject, type ProjectChart } from '@/src/project/ChartProject';
import { FakeAudioEngine, makeMemoryProjectBackend, renderWithProviders } from '@/tests/support/providers';
import { clearProjectAudio, importProjectAudio, type ProjectAudioDeps } from '@/src/audio/projectAudio';

const AT = 1_700_000_000_000;

/** 解码后给出固定时长的假引擎（替换场景：字节在，但时长与记录不符）；decoded 可在测试中改写 */
class FixedDurationEngine extends FakeAudioEngine {
  decoded: number | null;
  constructor(decoded: number | null) {
    super();
    this.decoded = decoded;
  }
  override async load(): Promise<void> {
    this.state = 'ready';
    this.duration = this.decoded;
  }
}

function chart(id: string): ProjectChart {
  return {
    id, notes: [{ beat: 0, type: 'BPM', bpm: 120 }], title: '测试谱面', diff: 3, level: 27,
    completed: false, upload: null, lastModified: AT, appliedChartCodeText: null, chartCodePristine: false,
  };
}

/** 半态工程：记录说有音频（audioName 在），字节不在（audio.bin 被删） */
function lostProject(): ChartProject {
  return {
    id: 'p1', name: '甲工程', artist: null, source: { type: 'bandori', id: 29 },
    durationSeconds: 90, lastOpened: AT, charts: [chart('c1')], audioName: '丢了的歌.mp3', coverName: null,
  };
}

/** 替换工程：字节在，记录时长 90，解码后实际 130 */
function replacedProject(): ChartProject {
  return {
    id: 'p1', name: '甲工程', artist: null, source: { type: 'bandori', id: 29 },
    durationSeconds: 90, lastOpened: AT, charts: [chart('c1')],
    audioName: 'a.mp3', audioBlob: new Blob([new Uint8Array([1, 2, 3])]), coverName: null,
  };
}

/** 一致工程：记录时长与解码时长相同 */
function consistentProject(): ChartProject {
  return {
    id: 'p1', name: '甲工程', artist: null, source: { type: 'custom' },
    durationSeconds: 90, lastOpened: AT, charts: [chart('c1')],
    audioName: 'a.mp3', audioBlob: new Blob([new Uint8Array([1, 2, 3])]), coverName: null,
  };
}

let setActivePage: ReturnType<typeof vi.fn>;
let ctx: { current: ReturnType<typeof useCurrentProject> | null };
let anomalyCtl: { current: ReturnType<typeof useAudioAnomaly> | null };

beforeEach(() => {
  window.localStorage.clear();
  setActivePage = vi.fn();
  ctx = { current: null };
  anomalyCtl = { current: null };
});

function Probe() {
  ctx.current = useCurrentProject();
  return null;
}

/** 与工作台同接线的轻量宿体：恢复 → hydrate → noteRestoredProject 全走真实 hook */
function Harness() {
  const { projectId, store, flushPersist, notifyCatalogChanged } = useCurrentProject();
  const [snap, session] = useAudioSession();
  const deps = useMemo<ProjectAudioDeps>(() => ({
    store, currentProjectId: projectId, flushPersist, notifyCatalogChanged,
    // 音频页的导入探针（注入定值：新文件记 130s）
    probeDuration: async () => 130,
  }), [store, projectId, flushPersist, notifyCatalogChanged]);
  const anomaly = useAudioAnomaly({
    projectId,
    deps,
    audioDuration: snap.audioDuration,
    audioLoadGeneration: snap.audioLoadGeneration,
    goToAudioPage: () => {
      if (projectId != null) {
        (setActivePage as unknown as AppNavValue['setActivePage'])('audio', { scope: { projectId } });
      }
    },
  });
  anomalyCtl.current = anomaly;
  const noteRestoredProjectRef = useRef(anomaly.noteRestoredProject);
  noteRestoredProjectRef.current = anomaly.noteRestoredProject;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const depsRef = useRef(deps);
  depsRef.current = deps;

  // 工作台两条路径共用的会话对齐：读回记录 → hydrate（解码异步，时长随后落快照）
  const hydrateRecord = async (loaded: ChartProject) => {
    sessionRef.current.hydrateFromProject({
      audioName: loaded.audioName,
      audioBlob: loaded.audioBlob,
      durationSeconds: loaded.durationSeconds,
    });
  };

  // 模拟工作台恢复：读记录 → noteRestoredProject（检测入口）→ hydrate
  useEffect(() => {
    if (projectId == null) return;
    let cancelled = false;
    void (async () => {
      const loaded = await store.get(projectId);
      if (cancelled || loaded == null) return;
      noteRestoredProjectRef.current(loaded, { restoreAudio: true });
      await hydrateRecord(loaded);
    })();
    return () => { cancelled = true; };
  }, [projectId, store]);

  // 模拟音频页写当前工程记录（票 15 定案 8）+ 工作台的「记录侧音频变更」路径
  //（WorkspacePage.handleRecordAudioChanged 同款：hydrateFromProject 重新对齐会话）。
  const recordAudioChanged = async (write: () => Promise<unknown>) => {
    if (projectId == null) return;
    await write();
    const loaded = await store.get(projectId);
    if (loaded == null) return;
    await hydrateRecord(loaded);
    anomaly.noteRecordAudioChanged(loaded);
  };

  return (
    <>
      <button onClick={() => {
        if (projectId == null) return;
        void recordAudioChanged(() => importProjectAudio(depsRef.current, projectId, new File([new Uint8Array([4, 5, 6])], 'b.mp3')));
      }}>
        模拟音频页更换音频
      </button>
      <button onClick={() => {
        if (projectId == null) return;
        void (async () => {
          const loaded = await store.get(projectId);
          if (loaded == null) return;
          // 记录侧也可能交出半态（记录说有音频、字节不在）
          const next: ChartProject = { ...loaded, audioName: '半态.mp3' };
          delete next.audioBlob;
          await store.save(next);
          await hydrateRecord(next);
          anomaly.noteRecordAudioChanged(next);
        })();
      }}>
        模拟记录侧交出半态记录
      </button>
      <button onClick={() => {
        if (projectId == null) return;
        void recordAudioChanged(() => clearProjectAudio(depsRef.current, projectId));
      }}>
        模拟音频页清除音频
      </button>
      {anomaly.anomaly != null && (
        <AudioAnomalyBanner
          anomaly={anomaly.anomaly}
          busy={anomaly.busy}
          onReimport={anomaly.reimport}
          onClearRecord={() => void anomaly.clearRecordAudio()}
          onRealign={() => void anomaly.realign()}
          onDismiss={anomaly.dismiss}
        />
      )}
    </>
  );
}

/** 挂载并打开第一个工程；返回后端（可断言 disk）与打开更多工程的能力 */
async function mount(projects: ChartProject[], decoded: number | null) {
  const engine = new FixedDurationEngine(decoded);
  const session = createAudioSession({
    keySetId: 'skin00',
    seVolume: 1,
    engineFactory: () => engine as unknown as AudioEngine,
  });
  const backend = makeMemoryProjectBackend(projects);
  const nav: AppNavValue = {
    activePage: 'workspace',
    setActivePage: setActivePage as unknown as AppNavValue['setActivePage'],
    pageScope: null,
    navCollapsed: true,
    setNavCollapsed: () => {},
  };
  renderWithProviders(
    <AppNavProvider value={nav}>
      <Probe />
      <Harness />
    </AppNavProvider>,
    { store: new ChartProjectStore(backend), session },
  );
  // 宏任务一级的 flush：hydrate 的 store.get → engine.load → emit → setState 是几跳微任务链，
  // 只 await Promise.resolve() 冲不完（切工程场景实测差一跳）。
  const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { await ctx.current!.open(projects[0].id); });
  await flush();
  return {
    backend,
    engine,
    flush,
    open: async (id: string) => {
      await act(async () => { await ctx.current!.open(id); });
      await flush();
    },
  };
}

describe('票 33 · 工作台音频异常横幅（丢失）', () => {
  it('半态记录（audioName 在、字节不在）→ 丢失横幅出现', async () => {
    await mount([lostProject()], null);

    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent('音频文件丢失（原文件：丢了的歌.mp3）');
  });

  it('「去音频页重新导入」带作用域跳音频页，且横幅即清', async () => {
    await mount([lostProject()], null);

    fireEvent.click(screen.getByRole('button', { name: '去音频页重新导入' }));

    expect(setActivePage).toHaveBeenCalledWith('audio', { scope: { projectId: 'p1' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('「清除音频记录」走 force 写路径：audioName 清、source 翻 custom、横幅即清', async () => {
    const { backend } = await mount([lostProject()], null);

    fireEvent.click(screen.getByRole('button', { name: '清除音频记录' }));
    await act(async () => { await Promise.resolve(); });

    const after = backend.disk.get('p1')!;
    expect(after.audioName).toBeNull();
    expect(after.source).toEqual({ type: 'custom' });
    expect(after.durationSeconds).toBe(90); // 时长保留（与普通清除同口径）
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('票 33 · 工作台音频异常横幅（替换）', () => {
  it('解码后时长与记录差 > 0.5s → 替换横幅出现', async () => {
    await mount([replacedProject()], 130);

    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent('音频文件与工程记录不一致');
  });

  it('「按音频重新对齐」走 realign 写路径：时长变、source 变 custom、audioName 不变、横幅即清', async () => {
    const { backend } = await mount([replacedProject()], 130);

    fireEvent.click(screen.getByRole('button', { name: /按音频重新对齐/ }));
    await act(async () => { await Promise.resolve(); });

    const after = backend.disk.get('p1')!;
    expect(after.durationSeconds).toBe(130);
    expect(after.source).toEqual({ type: 'custom' });
    expect(after.audioName).toBe('a.mp3'); // 外部替换拿不到新文件名：展示名不动
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('「暂不处理」本会话不再提示（不落盘，记录一个字不变）', async () => {
    const { backend } = await mount([replacedProject()], 130);

    fireEvent.click(screen.getByRole('button', { name: '暂不处理' }));

    expect(screen.queryByRole('alert')).toBeNull();
    // 再喂一次同样的信号（重渲染 / 快照再变）也不回来
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('alert')).toBeNull();
    const after = backend.disk.get('p1')!;
    expect(after.durationSeconds).toBe(90);
    expect(after.source).toEqual({ type: 'bandori', id: 29 });
  });

  it('切工程：新旧音频时长相同（快照值不变）替换照样判得出——否则锁定工程的记录永远错', async () => {
    // p1 解码 90s（与记录一致）；p2 记录 120s、解码仍是 90s（音频被换成同时长的另一份）
    const p2: ChartProject = {
      ...replacedProject(),
      id: 'p2',
      durationSeconds: 120,
    };
    const { open } = await mount([consistentProject(), p2], 90);

    expect(screen.queryByRole('alert')).toBeNull(); // p1 一致，不出横幅
    await open('p2');

    expect(screen.getByRole('alert')).toHaveTextContent('音频文件与工程记录不一致');
  });
});

describe('票 33 · 工作台音频异常横幅（无异常）', () => {
  it('记录与音频一致 → 不出横幅', async () => {
    await mount([consistentProject()], 90);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('票 33 回归 · 音频页写当前工程音频（保活工作台的记录侧变更路径）', () => {
  it('更换音频：记录与解码一致 → 不出替换横幅，记录落为新时长', async () => {
    const { backend, engine, flush } = await mount([consistentProject()], 90);
    engine.decoded = 130; // 新文件解码时长（与探针写入记录的 130 一致）

    fireEvent.click(screen.getByRole('button', { name: '模拟音频页更换音频' }));
    await flush();

    expect(screen.queryByRole('alert')).toBeNull();
    const after = backend.disk.get('p1')!;
    expect(after.durationSeconds).toBe(130);
    expect(after.source).toEqual({ type: 'custom' });
  });

  it('清除音频：不出横幅，且已有横幅即清（记录侧已无音频）', async () => {
    const { backend, flush } = await mount([replacedProject()], 130);
    expect(screen.getByRole('alert')).toHaveTextContent('音频文件与工程记录不一致');

    fireEvent.click(screen.getByRole('button', { name: '模拟音频页清除音频' }));
    await flush();

    expect(screen.queryByRole('alert')).toBeNull();
    expect(backend.disk.get('p1')!.audioName).toBeNull();
  });

  it('记录侧交出半态记录（有音频名、无字节）→ 丢失横幅照出', async () => {
    await mount([consistentProject()], 90);

    fireEvent.click(screen.getByRole('button', { name: '模拟记录侧交出半态记录' }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    expect(screen.getByRole('alert')).toHaveTextContent('音频文件丢失（原文件：半态.mp3）');
  });

  it('记录侧变更后记录仍与解码不符（外部换文件）→ 替换横幅照出', async () => {
    // 探针写记录 130，引擎对任何字节都解出 90 → 记录与解码真不符
    await mount([consistentProject()], 90);

    fireEvent.click(screen.getByRole('button', { name: '模拟音频页更换音频' }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    expect(screen.getByRole('alert')).toHaveTextContent('音频文件与工程记录不一致');
  });
});
