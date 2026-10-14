// DOM 测试的 Provider 替身（issue 08）。
//
// 页面组件脱离 Electron / IndexedDB / Web Audio 被渲染，前提是「当前工程」与
// 「音频会话」两个上下文有默认实现。两个 Provider 本身都留了注入点（store / session），
// 所以这里只补**注入物**，不复制 Provider 逻辑：
//   - 当前工程：内存版 ChartProjectBackend（Map<id, ChartProject>）
//   - 音频会话：createAudioSession + 假引擎（不碰 Web Audio）
//
// 约定：本目录只放测试基建，文件名不含 `.test.` —— 不参与 vitest 收集。
import { useMemo, type ReactElement, type ReactNode } from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { AudioSession, createAudioSession } from '@/src/audio/AudioSession';
import type { AudioEngine } from '@/src/audio/AudioEngine';
import { ChartProjectStore, type ChartProject, type ChartProjectBackend, type ProjectBinarySources } from '@/src/project/ChartProject';
import { CurrentProjectProvider } from '@/src/app/providers/CurrentProjectProvider';
import { AudioSessionProvider } from '@/src/app/providers/AudioSessionProvider';
import { NowProvider } from '@/src/app/providers/NowProvider';

/**
 * 内存版工程后端：读写都落在 Map 上，不落盘、不碰 IndexedDB。
 * `staged` 记下「这份素材来自下载暂存」（真实后端由主进程把暂存文件拷进工程目录，内存替身没有 fs，
 * 只把声明留下来给断言用；工程记录侧的 `audioName` / `coverName` 照常写）。
 */
export type MemoryProjectBackend = ChartProjectBackend & {
  disk: Map<string, ChartProject>;
  staged: Map<string, ProjectBinarySources>;
  /** `deferList` 模式下放行 list()（issue 29）；未开该选项时是空操作。 */
  releaseList: () => void;
};

/**
 * `cloneBlobsOnRead`：每次读回都新建 Blob 对象，近似 IndexedDB `getAll()` 反序列化 /
 * Electron `blobFromBytes` 的真实语义（chart-projects 21 的复现条件——封面 URL 按 Blob 身份缓存，
 * 身份一换就重解码、全封面闪）。默认关：多数测试不关心 Blob 身份，按引用存最省事。
 */
export function makeMemoryProjectBackend(
  projects: ChartProject[] = [],
  opts: { cloneBlobsOnRead?: boolean; deferList?: boolean } = {},
): MemoryProjectBackend {
  const disk = new Map<string, ChartProject>(projects.map((p) => [p.id, p]));
  const read = (p: ChartProject | undefined): ChartProject | null => {
    if (!p) return null;
    if (!opts.cloneBlobsOnRead) return p;
    return {
      ...p,
      ...(p.audioBlob ? { audioBlob: new Blob([p.audioBlob], { type: p.audioBlob.type }) } : {}),
      ...(p.coverBlob ? { coverBlob: new Blob([p.coverBlob], { type: p.coverBlob.type }) } : {}),
    };
  };
  const staged = new Map<string, ProjectBinarySources>();
  /**
   * `deferList`（issue 29）：list() 全部挂在手动闸门上，`releaseList()` 才放行 ——
   * 测试才能停在"目录还没读回来"那一帧，验"未就绪 ≠ 0 工程"。默认开闸（现有用例不受影响）。
   */
  let gateOpen = !opts.deferList;
  let openGate: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    openGate = () => {
      gateOpen = true;
      resolve();
    };
  });
  return {
    disk,
    staged,
    releaseList: () => openGate(),
    get: async (id) => read(disk.get(id)),
    save: async (project, sources = {}) => {
      disk.set(project.id, project);
      if (sources.audioStagedPath || sources.coverStagedPath) staged.set(project.id, sources);
    },
    list: async () => {
      if (!gateOpen) await gate;
      return [...disk.values()].map((p) => read(p)!);
    },
    delete: async (id) => {
      disk.delete(id);
    },
  };
}

/** 假音频引擎：只满足 AudioSession 构造与常规调用，不创建 AudioContext。 */
export class FakeAudioEngine {
  duration: number | null = null;
  isPlaying = false;
  state: 'idle' | 'ready' | 'playing' | 'paused' = 'idle';

  async load(): Promise<void> {
    this.state = 'ready';
  }
  clear(): void {
    this.duration = null;
    this.state = 'idle';
  }
  setKeySetId(): void {}
  async previewKeySample(): Promise<void> {}
  setVolume(): void {}
  setSeVolume(): void {}
  setChart(): void {}
  async play(): Promise<void> {
    this.isPlaying = true;
    this.state = 'playing';
  }
  pause(): void {
    this.isPlaying = false;
    this.state = 'paused';
  }
  seek(): void {}
  tick(): void {}
  getSeconds(): number {
    return 0;
  }
}

/**
 * 默认音频会话：假引擎 + 三个可调的 snapshot 字段（素材包 / SE 音量 / 谱面时长）。
 * 与生产对齐说明：生产里这三个值来自 ConfigProvider 的 settings.audio，本替身不读 settings ——
 * 需要"跟着设置走"的测试请自己套 ConfigProvider 并注入 session，别改这里的默认值。
 */
export function makeTestAudioSession(opts: {
  keySetId?: string;
  seVolume?: number;
  chartDuration?: number;
} = {}): { session: AudioSession; engine: FakeAudioEngine } {
  const engine = new FakeAudioEngine();
  const session = createAudioSession({
    keySetId: opts.keySetId ?? 'skin00',
    seVolume: opts.seVolume ?? 1,
    chartDuration: opts.chartDuration,
    engineFactory: () => engine as unknown as AudioEngine,
  });
  return { session, engine };
}

/** 可注入的 Provider 参数；不传就用默认替身。 */
export interface TestProvidersProps {
  children: ReactNode;
  /** 指定 store 即指定后端（内存后端 → 可断言 disk） */
  store?: ChartProjectStore;
  /** 指定 session 即可控音频状态（audioName / chartDuration…） */
  session?: AudioSession;
}

/** 默认上下文：当前工程 + 音频会话 + 共享 ticker（issue 36，relTime 的 now 来源）。
 *  其余 Provider（Config / UI / Editing…）按需在测试里自己套。 */
export function TestProviders({ children, store, session }: TestProvidersProps) {
  const projectStore = useMemo(() => store ?? new ChartProjectStore(makeMemoryProjectBackend()), [store]);
  const audioSession = useMemo(() => session ?? makeTestAudioSession().session, [session]);
  return (
    <CurrentProjectProvider store={projectStore}>
      <AudioSessionProvider session={audioSession}>
        <NowProvider>{children}</NowProvider>
      </AudioSessionProvider>
    </CurrentProjectProvider>
  );
}

/** render + 默认 Provider。需要更多 Provider 时用 RTL 的 `wrapper` 自己套一层。 */
export function renderWithProviders(
  ui: ReactElement,
  options: Omit<RenderOptions, 'wrapper'> & Omit<TestProvidersProps, 'children'> = {},
): RenderResult {
  const { store, session, ...rest } = options;
  return render(ui, {
    ...rest,
    wrapper: ({ children }) => (
      <TestProviders store={store} session={session}>
        {children}
      </TestProviders>
    ),
  });
}
