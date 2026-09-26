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
import { ChartProjectStore, type ChartProject, type ChartProjectBackend } from '@/src/chart/project/ChartProject';
import { CurrentProjectProvider } from '@/src/app/providers/CurrentProjectProvider';
import { AudioSessionProvider } from '@/src/app/providers/AudioSessionProvider';

/** 内存版工程后端：读写都落在 Map 上，不落盘、不碰 IndexedDB。 */
export type MemoryProjectBackend = ChartProjectBackend & { disk: Map<string, ChartProject> };

export function makeMemoryProjectBackend(projects: ChartProject[] = []): MemoryProjectBackend {
  const disk = new Map<string, ChartProject>(projects.map((p) => [p.id, p]));
  return {
    disk,
    get: async (id) => disk.get(id) ?? null,
    save: async (project) => {
      disk.set(project.id, project);
    },
    list: async () => [...disk.values()],
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

/** 默认上下文：当前工程 + 音频会话。其余 Provider（Config / UI / Editing…）按需在测试里自己套。 */
export function TestProviders({ children, store, session }: TestProvidersProps) {
  const projectStore = useMemo(() => store ?? new ChartProjectStore(makeMemoryProjectBackend()), [store]);
  const audioSession = useMemo(() => session ?? makeTestAudioSession().session, [session]);
  return (
    <CurrentProjectProvider store={projectStore}>
      <AudioSessionProvider session={audioSession}>{children}</AudioSessionProvider>
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
