// @vitest-environment jsdom
// 票 15 症状 a 的回归网：
// 有工程 A、B——进 A 的工作台、音频页给 A 传了音频、再切到 B，音频页显示的必须不再是 A 的音频。
//
// 直接渲染整个 Editor 不现实（它要四域 Provider + 画布），所以这里复刻 Editor 那条**接线**
// （useCurrentProject + useAudioSession + useChartProjectPersistence 三件套）作为被测对象：
// 症状 a 的根因就在这条接线上（epoch 单独递增时既不 flush 也不 onRestore），不在画布。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import { ChartProjectStore, type ChartProject } from '@/src/project/ChartProject';
import { createUnnamedProject, isProjectAudioLocked } from '@/src/project/workspaceProject';
import { useChartProjectPersistence } from '@/src/project/useChartProjectPersistence';
import {
  useCurrentProject,
  type CurrentProjectContextValue,
} from '@/src/app/providers/CurrentProjectProvider';
import { useAudioSession } from '@/src/app/providers/AudioSessionProvider';
import type { AudioSession } from '@/src/audio/AudioSession';
import {
  makeMemoryProjectBackend,
  renderWithProviders,
  type MemoryProjectBackend,
} from '@/tests/support/providers';

const NOW = 1_700_000_000_000;

function withAudio(id: string, audioName: string, durationSeconds: number): ChartProject {
  const project = createUnnamedProject({ id, chartId: `c-${id}`, now: NOW });
  return { ...project, audioName, audioBlob: new Blob([new Uint8Array([1, 2, 3])]), durationSeconds };
}

function withoutAudio(id: string): ChartProject {
  return createUnnamedProject({ id, chartId: `c-${id}`, now: NOW });
}

interface Wiring {
  ctx: CurrentProjectContextValue | null;
  session: AudioSession | null;
  /** onRecordAudioChanged 被调次数：锁住"只在真的不一致时才重新对齐" */
  audioRealigns: number;
}

/**
 * Editor 那条持久化接线的复刻：projectId / chartId / catalogEpoch / notes / 音频四件套 → hook。
 * 音频两侧都接：onRestore（切工程）与 onRecordAudioChanged（记录被别人改）。
 */
function WiringProbe({ capture }: { capture: { current: Wiring } }) {
  const ctx = useCurrentProject();
  const [snap, session] = useAudioSession();
  capture.current.ctx = ctx;
  capture.current.session = session;

  useChartProjectPersistence({
    projectId: ctx.projectId,
    chartId: ctx.chartId,
    catalogEpoch: ctx.catalogEpoch,
    store: ctx.store,
    notes: [],
    durationSeconds: snap.chartDuration,
    audioName: snap.audioName,
    audioBlob: session.getAudioBlob(),
    onRestore: (project, _chart, opts) => {
      const audioLocked = isProjectAudioLocked(project);
      session.setAudioLocked(audioLocked);
      if (!opts.restoreAudio) return;
      session.hydrateFromProject({
        audioName: project.audioName,
        audioBlob: project.audioBlob,
        durationSeconds: project.durationSeconds,
        audioLocked,
      });
    },
    onRecordAudioChanged: (project) => {
      capture.current.audioRealigns += 1;
      session.hydrateFromProject({
        audioName: project.audioName,
        audioBlob: project.audioBlob,
        durationSeconds: project.durationSeconds,
        audioLocked: isProjectAudioLocked(project),
      });
    },
  });

  return (
    <>
      <span data-testid="audio-name">{snap.audioName ?? '无音频'}</span>
      <span data-testid="chart-duration">{snap.chartDuration}</span>
    </>
  );
}

function mountWiring(backend: MemoryProjectBackend) {
  const capture: { current: Wiring } = { current: { ctx: null, session: null, audioRealigns: 0 } };
  renderWithProviders(<WiringProbe capture={capture} />, { store: new ChartProjectStore(backend) });
  return capture;
}

/** 直接把记录写进"盘"（模拟音频页那条按作用域直接写工程记录的路径）。 */
function overwriteRecord(backend: MemoryProjectBackend, id: string, patch: Partial<ChartProject>) {
  backend.disk.set(id, { ...(backend.disk.get(id) as ChartProject), ...patch });
}

beforeEach(() => {
  // 当前工程指针落在 localStorage（issue 20）：不清会让上一个用例的工程被下一个用例"恢复"。
  window.localStorage.clear();
});

describe('票 15 症状 a · 切工程与音频隔离', () => {
  it('切到无音频的工程时，会话里不许留着上一个工程的音频（目录版本同时涨也一样）', async () => {
    const backend = makeMemoryProjectBackend([withAudio('pA', 'a.mp3', 90), withoutAudio('pB')]);
    const capture = mountWiring(backend);

    await act(async () => { await capture.current.ctx!.open('pA'); });
    expect(screen.getByTestId('audio-name')).toHaveTextContent('a.mp3');

    await act(async () => {
      await capture.current.ctx!.open('pB');
      // 切工程与目录版本同批（新建工程 / 写记录都会走到这条）——旧判定
      // `projectChanged && !epochChanged` 在这一批里是假，音频就不跟着换了。
      capture.current.ctx!.notifyCatalogChanged();
    });

    expect(screen.getByTestId('audio-name')).toHaveTextContent('无音频');
    expect(capture.current.session!.getAudioBlob()).toBeNull();
  });

  it('音频页按作用域改了当前工程记录的音频 → 会话跟随记录对齐（不切工程、不动谱面编辑态）', async () => {
    const backend = makeMemoryProjectBackend([withAudio('pA', 'a.mp3', 90)]);
    const capture = mountWiring(backend);

    await act(async () => { await capture.current.ctx!.open('pA'); });
    expect(screen.getByTestId('audio-name')).toHaveTextContent('a.mp3');
    const realignsAfterOpen = capture.current.audioRealigns;

    await act(async () => {
      overwriteRecord(backend, 'pA', { audioName: 'b.mp3', audioBlob: new Blob([new Uint8Array([9])]) });
      capture.current.ctx!.notifyCatalogChanged();
    });

    expect(screen.getByTestId('audio-name')).toHaveTextContent('b.mp3');
    expect(capture.current.audioRealigns).toBe(realignsAfterOpen + 1);
  });

  it('记录侧音频被清除 → 会话音频必清空（无音频工程 → 引擎必清空这半条）', async () => {
    const backend = makeMemoryProjectBackend([withAudio('pA', 'a.mp3', 90)]);
    const capture = mountWiring(backend);

    await act(async () => { await capture.current.ctx!.open('pA'); });
    await act(async () => {
      overwriteRecord(backend, 'pA', { audioName: null, audioBlob: undefined });
      capture.current.ctx!.notifyCatalogChanged();
    });

    expect(screen.getByTestId('audio-name')).toHaveTextContent('无音频');
    expect(capture.current.session!.getAudioBlob()).toBeNull();
  });

  it('目录版本涨、但记录里的音频没变 → 不重新对齐（避免白重解码一次音频）', async () => {
    const backend = makeMemoryProjectBackend([withAudio('pA', 'a.mp3', 90)]);
    const capture = mountWiring(backend);

    await act(async () => { await capture.current.ctx!.open('pA'); });
    const realignsAfterOpen = capture.current.audioRealigns;

    await act(async () => {
      overwriteRecord(backend, 'pA', { name: '改了个工程名' });
      capture.current.ctx!.notifyCatalogChanged();
    });

    expect(capture.current.audioRealigns).toBe(realignsAfterOpen);
    expect(screen.getByTestId('audio-name')).toHaveTextContent('a.mp3');
  });

  it('无音频工程：音频页改了谱面时长 → 会话的时长跟随记录（工作台几何才跟着变）', async () => {
    const backend = makeMemoryProjectBackend([withoutAudio('pB')]);
    const capture = mountWiring(backend);

    await act(async () => { await capture.current.ctx!.open('pB'); });
    expect(screen.getByTestId('chart-duration')).toHaveTextContent('30');

    await act(async () => {
      overwriteRecord(backend, 'pB', { durationSeconds: 96 });
      capture.current.ctx!.notifyCatalogChanged();
    });

    expect(screen.getByTestId('chart-duration')).toHaveTextContent('96');
  });

  it('无音频工程：时长一致时不重新对齐（0.5s 容差，别让每次刷新都停一次播放）', async () => {
    const backend = makeMemoryProjectBackend([{ ...withoutAudio('pB'), durationSeconds: 96 }]);
    const capture = mountWiring(backend);

    await act(async () => { await capture.current.ctx!.open('pB'); });
    const realignsAfterOpen = capture.current.audioRealigns;

    await act(async () => {
      overwriteRecord(backend, 'pB', { durationSeconds: 96.2 });
      capture.current.ctx!.notifyCatalogChanged();
    });

    expect(capture.current.audioRealigns).toBe(realignsAfterOpen);
  });
});
