// chart-projects 06：音频与谱面时长锁单测。
// 注入上传记录后，换音频、清除音频、改时长均被拒、工程记录不变；
// 去掉上传记录（换一张未上传谱面的工程）则放行。
import { describe, expect, it, vi } from 'vitest';
import { createAudioSession, type AudioEngineFactory } from '@/src/audio/AudioSession';
import { AudioEngine } from '@/src/audio/AudioEngine';
import { isProjectAudioLocked } from '@/src/project/workspaceProject';
import type { ChartProject, ProjectChart } from '@/src/project/ChartProject';
import type { ChartNote } from '@/src/chart/types';

function makeMockEngine(): AudioEngine {
  const engine = new AudioEngine();
  vi.spyOn(engine, 'load').mockResolvedValue();
  vi.spyOn(engine, 'clear').mockImplementation(() => {});
  return engine;
}

const mockFactory: AudioEngineFactory = () => makeMockEngine();

function makeChart(overrides: Partial<ProjectChart> = {}): ProjectChart {
  return {
    id: 'c1',
    notes: [{ beat: 0, type: 'BPM', bpm: 120 } as ChartNote],
    title: null,
    diff: 3,
    level: 25,
    completed: false,
    upload: null,
    lastModified: 1_700_000_000_000,
    appliedChartCodeText: null,
    chartCodePristine: false,
    ...overrides,
  };
}

function makeProject(overrides: Partial<ChartProject> = {}): ChartProject {
  return {
    id: 'p1',
    name: 'Song',
    artist: 'Artist',
    source: { type: 'custom' },
    durationSeconds: 120,
    lastOpened: 1_700_000_000_000,
    charts: [makeChart()],
    audioName: 'original.mp3',
    audioBlob: new Blob(['audio']),
    coverName: null,
    ...overrides,
  };
}

describe('AudioSession · 音频与时长锁闸门', () => {
  it('未锁定时：换音频、清除音频、改时长均正常生效', async () => {
    const session = createAudioSession({
      keySetId: 'default',
      seVolume: 1,
      chartDuration: 120,
      engineFactory: mockFactory,
    });
    expect(session.isAudioLocked).toBe(false);

    // 改时长
    session.setChartDuration(150);
    expect(session.getSnapshot().chartDuration).toBe(150);

    // 清除音频
    session.clearAudio();
    expect(session.getSnapshot().audioName).toBeNull();

    // 导入/更换音频
    const fakeFile = new File(['123'], 'test.mp3', { type: 'audio/mp3' });
    session.importAudio(fakeFile);
    await Promise.resolve();
    expect(session.getSnapshot().audioName).toBe('test.mp3');
  });

  it('注入上传记录锁定后：换音频、清除音频、改时长均被拒', async () => {
    const session = createAudioSession({
      keySetId: 'default',
      seVolume: 1,
      chartDuration: 120,
      engineFactory: mockFactory,
    });
    const fakeFile = new File(['123'], 'initial.mp3', { type: 'audio/mp3' });
    session.importAudio(fakeFile);
    await Promise.resolve();
    expect(session.getSnapshot().audioName).toBe('initial.mp3');

    // 注入锁定（工程含已上传谱面）
    session.setAudioLocked(true);
    expect(session.isAudioLocked).toBe(true);
    expect(session.getSnapshot().audioLocked).toBe(true);

    // 尝试改时长 → 被拒，仍为 120
    session.setChartDuration(200);
    expect(session.getSnapshot().chartDuration).toBe(120);

    // 尝试清除音频 → 被拒，仍保留 initial.mp3
    session.clearAudio();
    expect(session.getSnapshot().audioName).toBe('initial.mp3');

    // 尝试换音频 → 被拒，仍为 initial.mp3
    const anotherFile = new File(['456'], 'another.mp3', { type: 'audio/mp3' });
    session.importAudio(anotherFile);
    await Promise.resolve();
    expect(session.getSnapshot().audioName).toBe('initial.mp3');
  });

  it('去掉上传记录（换一张未上传谱面的工程）后放行', async () => {
    const session = createAudioSession({
      keySetId: 'default',
      seVolume: 1,
      chartDuration: 120,
      engineFactory: mockFactory,
    });
    session.setAudioLocked(true);
    expect(session.isAudioLocked).toBe(true);

    // 尝试修改被拒
    session.setChartDuration(180);
    expect(session.getSnapshot().chartDuration).toBe(120);

    // 解除锁定（切到未上传工程）
    session.setAudioLocked(false);
    expect(session.isAudioLocked).toBe(false);
    expect(session.getSnapshot().audioLocked).toBe(false);

    // 放行改时长
    session.setChartDuration(180);
    expect(session.getSnapshot().chartDuration).toBe(180);

    // 放行换音频
    const nextFile = new File(['abc'], 'new_song.mp3', { type: 'audio/mp3' });
    session.importAudio(nextFile);
    await Promise.resolve();
    expect(session.getSnapshot().audioName).toBe('new_song.mp3');
  });

  it('hydrateFromProject 在工程锁定时仍能正常注入工程时长与锁状态', () => {
    const session = createAudioSession({
      keySetId: 'default',
      seVolume: 1,
      chartDuration: 30,
      engineFactory: mockFactory,
    });

    session.hydrateFromProject({
      audioName: 'locked_song.mp3',
      audioBlob: new Blob(['audio']),
      durationSeconds: 145,
      audioLocked: true,
    });

    expect(session.isAudioLocked).toBe(true);
    expect(session.getSnapshot().audioLocked).toBe(true);
    expect(session.getSnapshot().chartDuration).toBe(145);
    expect(session.getSnapshot().audioName).toBe('locked_song.mp3');

    // 随后尝试二次修改时长被拦截
    session.setChartDuration(200);
    expect(session.getSnapshot().chartDuration).toBe(145);
  });
});

describe('工程记录持久化锁 · isProjectAudioLocked 聚合与防篡改', () => {
  it('工程内只要有一张已上传谱面，isProjectAudioLocked 即为 true', () => {
    const projectWithoutUpload = makeProject({
      charts: [makeChart({ id: 'c1' }), makeChart({ id: 'c2', completed: true })],
    });
    expect(isProjectAudioLocked(projectWithoutUpload)).toBe(false);

    const projectWithUpload = makeProject({
      charts: [
        makeChart({ id: 'c1', upload: { postId: 100, at: 1_700_000_000 } }),
        makeChart({ id: 'c2', completed: false }),
      ],
    });
    expect(isProjectAudioLocked(projectWithUpload)).toBe(true);
  });
});
