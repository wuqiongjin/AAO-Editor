// issue 02：工程记录往返。多谱面 / 同难度两张 / 谱面名称为空 / 有无封面音频；
// 未知字段按 ADR-0014 保留；旧「一份 notes」记录读回当不存在且不删磁盘记录。
import { describe, expect, it } from 'vitest';
import {
  ElectronFileProjectBackend,
  PROJECT_SCHEMA_VERSION,
  canReplaceStoredProject,
} from '@/src/chart/project/ChartProject';
import type { ChartProject, ProjectChart } from '@/src/chart/project/ChartProject';
import type { ChartNote } from '@/src/chart/types';
import { makeMemoryProjectBridge } from '@/tests/support/memoryProjectBridge';

const bpm = { beat: 0, type: 'BPM', bpm: 120 } as ChartNote;
const single = { beat: 4, lane: 3, type: 'Single', charge: true, foo: 'bar' } as ChartNote;

function blobOf(bytes: number[]): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' });
}

function chart(overrides: Partial<ProjectChart> = {}): ProjectChart {
  return {
    id: 'c1',
    notes: [bpm],
    title: null,
    diff: 3,
    level: 26,
    completed: false,
    upload: null,
    lastModified: 1_700_000_000_000,
    appliedChartCodeText: null,
    chartCodePristine: false,
    ...overrides,
  };
}

function project(overrides: Partial<ChartProject> = {}): ChartProject {
  return {
    id: 'pSong1',
    name: 'FIRE BIRD',
    artist: 'Roselia',
    source: { type: 'bandori', id: 243 },
    durationSeconds: 236,
    lastOpened: 1_700_000_001_000,
    charts: [chart()],
    audioName: null,
    coverName: null,
    ...overrides,
  };
}

async function snapshot(p: ChartProject) {
  return {
    id: p.id,
    name: p.name,
    artist: p.artist,
    source: p.source,
    durationSeconds: p.durationSeconds,
    lastOpened: p.lastOpened,
    charts: p.charts,
    audioName: p.audioName,
    coverName: p.coverName,
    audioBytes: p.audioBlob ? Array.from(new Uint8Array(await p.audioBlob.arrayBuffer())) : null,
    coverBytes: p.coverBlob ? Array.from(new Uint8Array(await p.coverBlob.arrayBuffer())) : null,
  };
}

async function roundtrip(saved: ChartProject): Promise<ChartProject> {
  const t = makeMemoryProjectBridge();
  const b = new ElectronFileProjectBackend(t.bridge);
  await b.save(saved);
  const got = await b.get(saved.id);
  expect(got).not.toBeNull();
  return got!;
}

describe('谱面工程记录往返', () => {
  it('多谱面、同难度两张、谱面名称为空：保存再读回逐字段相等', async () => {
    const saved = project({
      charts: [
        chart({ id: 'cEx1', title: null, diff: 3, level: 27, notes: [bpm, single] }),
        chart({ id: 'cEx2', title: '练习版', diff: 3, level: 26, notes: [bpm] }),
      ],
    });
    expect(saved.charts[0].title).toBeNull();
    expect(saved.charts.map((c) => c.diff)).toEqual([3, 3]);
    expect(await snapshot(await roundtrip(saved))).toEqual(await snapshot(saved));
  });

  it('有封面与音频：字节与文件名一起读回', async () => {
    const saved = project({
      audioName: 'fire_bird.mp3',
      audioBlob: blobOf([1, 2, 3, 4]),
      coverName: 'cover.png',
      coverBlob: blobOf([9, 8, 7]),
    });
    expect(await snapshot(await roundtrip(saved))).toEqual(await snapshot(saved));
  });

  it('无封面无音频：读回仍无字节', async () => {
    const got = await roundtrip(project());
    expect(got.audioBlob).toBeUndefined();
    expect(got.coverBlob).toBeUndefined();
    expect(got.audioName).toBeNull();
    expect(got.coverName).toBeNull();
  });

  it('未知字段按 ADR-0014 保留（charge / 额外键不因保存丢失）', async () => {
    const got = await roundtrip(project({
      charts: [chart({ notes: [bpm, single] })],
    }));
    expect(got.charts[0].notes[1]).toMatchObject({ type: 'Single', charge: true, foo: 'bar' });
  });

  it(`schemaVersion ${PROJECT_SCHEMA_VERSION} 写入文档`, async () => {
    const t = makeMemoryProjectBridge();
    await new ElectronFileProjectBackend(t.bridge).save(project());
    expect(t.puts[0].doc.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  });
});

describe('旧「一份 notes」记录', () => {
  it('空位与带 charts 的文档可写，旧记录不可覆盖', () => {
    expect(canReplaceStoredProject(null)).toBe(true);
    expect(canReplaceStoredProject({ schemaVersion: PROJECT_SCHEMA_VERSION, charts: [] })).toBe(true);
    expect(canReplaceStoredProject({ schemaVersion: 1, notes: [] })).toBe(false);
    expect(canReplaceStoredProject({ id: 'default', durationSeconds: 30, notes: [] })).toBe(false);
  });

  it('读回为不存在，磁盘记录不被删除', async () => {
    const t = makeMemoryProjectBridge([
      ['default', {
        doc: {
          schemaVersion: 1,
          durationSeconds: 30,
          notes: [bpm],
          audioName: 'old.wav',
          audioPresent: true,
        },
        audio: new Uint8Array([5, 5]),
        cover: null,
      }],
    ]);
    const b = new ElectronFileProjectBackend(t.bridge);
    await expect(b.get('default')).resolves.toBeNull();
    await expect(b.list()).resolves.toEqual([]);
    expect(t.disk.has('default')).toBe(true);
    expect(t.disk.get('default')!.doc.schemaVersion).toBe(1);
    expect(Array.from(t.disk.get('default')!.audio!)).toEqual([5, 5]);
    expect(t.puts).toHaveLength(0);
  });
});
