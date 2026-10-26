// 架构评审候选 2（06 票）：工程记录「一份映射」的行为锁。
//
// 记录有两种存储表示，映射只在 ChartProjectRecord.ts 一份：
//   - wire doc：Electron 文件后端（project.json，带 audioPresent / coverPresent）；
//   - stored record：IndexedDB（ChartProject + schemaVersion，Blob 内联）。
// 同一套断言跑两条表示（两个 adapter 一套测试）；字段集合必须对称——加字段只改一处时，
// 漏掉任一侧都会被「键集合相等」这条锁顶红。
import { describe, expect, it } from 'vitest';
import { ElectronFileProjectBackend } from '@/src/project/ChartProject';
import type { ChartProject, ProjectChart } from '@/src/project/ChartProject';
import {
  PROJECT_SCHEMA_VERSION,
  projectFromStored,
  recordFromProject,
  storedFromProject,
} from '@/src/project/ChartProjectRecord';
import type { ChartNote } from '@/src/chart/types';
import { makeMemoryProjectBridge } from '@/tests/support/memoryProjectBridge';

const bpm = { beat: 0, type: 'BPM', bpm: 120 } as ChartNote;
const single = { beat: 4, lane: 3, type: 'Single', charge: true, foo: 'bar' } as ChartNote;

function blobOf(bytes: number[]): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' });
}

async function bytesOf(blob: Blob | undefined): Promise<Uint8Array | null> {
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

function chart(overrides: Partial<ProjectChart> = {}): ProjectChart {
  return {
    id: 'c1',
    notes: [bpm, single],
    title: '练习版',
    diff: 3,
    level: 27,
    completed: true,
    upload: { postId: 42, at: 1_700_000_002_000 },
    lastModified: 1_700_000_000_000,
    appliedChartCodeText: '[{"type":"BPM","beat":0,"bpm":120}]',
    chartCodePristine: true,
    tags: [{ type: 'text', data: '結束バンド' }],
    ...overrides,
  };
}

/** 每个字段都设成非默认值——漏映射任何一个都会在往返里现形。 */
function richProject(patch: Partial<ChartProject> = {}): ChartProject {
  return {
    id: 'pSong1',
    name: 'FIRE BIRD',
    artist: 'Roselia',
    source: { type: 'bandori', id: 243 },
    durationSeconds: 236.5,
    lastOpened: 1_700_000_001_000,
    charts: [chart(), chart({ id: 'c2', diff: 4, level: null, upload: null, title: null })],
    audioName: 'fire_bird.mp3',
    audioBlob: blobOf([1, 2, 3, 4]),
    coverName: 'cover.png',
    coverBlob: blobOf([9, 8, 7]),
    ...patch,
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
    audioBytes: p.audioBlob ? Array.from(await bytesOf(p.audioBlob)!) : null,
    coverBytes: p.coverBlob ? Array.from(await bytesOf(p.coverBlob)!) : null,
  };
}

/** 两条表示走同一套往返断言：一份映射的等价性由行为锁住，不靠源码文本。 */
const representations = [
  {
    // 真 adapter 层往返：save 的 intent / keep 判定 + get 的重建都算在内
    name: 'wire doc（文件后端·真 adapter）',
    roundtrip: async (p: ChartProject) => {
      const t = makeMemoryProjectBridge();
      const backend = new ElectronFileProjectBackend(t.bridge);
      await backend.save(p);
      const restored = await backend.get(p.id);
      expect(restored).not.toBeNull();
      return restored!;
    },
  },
  {
    // 仓库没有 fake-indexeddb 依赖：IndexedDB 表示用它的两个转换函数锁（形状即 storedFromProject/projectFromStored 的产物）
    name: 'stored record（IndexedDB 表示）',
    roundtrip: async (p: ChartProject) => {
      const restored = projectFromStored(storedFromProject(p));
      expect(restored).not.toBeNull();
      return restored!;
    },
  },
];

describe('06 · 一份映射：同一套断言跑两条存储表示', () => {
  for (const { name, roundtrip } of representations) {
    it(`${name}：全字段工程往返逐字段相等（含字节）`, async () => {
      const saved = richProject();
      expect(await snapshot(await roundtrip(saved))).toEqual(await snapshot(saved));
    });

    it(`${name}：未知字段按 ADR-0014 保留（charge / 额外键不因保存丢失）`, async () => {
      const got = await roundtrip(richProject());
      expect(got.charts[0].notes[1]).toMatchObject({ type: 'Single', charge: true, foo: 'bar' });
    });

    it(`${name}：无音频无封面读回仍无字节`, async () => {
      const got = await roundtrip(richProject({ audioName: null, coverName: null, audioBlob: undefined, coverBlob: undefined }));
      expect(got.audioBlob).toBeUndefined();
      expect(got.coverBlob).toBeUndefined();
      expect(got.audioName).toBeNull();
      expect(got.coverName).toBeNull();
    });

    it(`${name}：dirty notes 的 undefined 属性经写盘规范化后消失`, async () => {
      const dirty = [{ ...single, subBeat: undefined }] as unknown as ChartNote[];
      const got = await roundtrip(richProject({ charts: [chart({ notes: dirty })] }));
      expect('subBeat' in got.charts[0].notes[0]).toBe(false);
    });
  }

  it('两条表示的字段集合对称（加字段只改一处时，漏掉任一侧就红）', () => {
    const p = richProject();
    const wire = recordFromProject(p, 'keep', 'cleared') as unknown as Record<string, unknown>;
    const stored = storedFromProject(p) as unknown as Record<string, unknown>;

    const WIRE_META = new Set(['schemaVersion', 'audioIntent', 'coverIntent']);
    const STORED_META = new Set(['id', 'schemaVersion', 'audioBlob', 'coverBlob']);
    const wireFields = Object.keys(wire).filter((k) => !WIRE_META.has(k)).sort();
    const storedFields = Object.keys(stored).filter((k) => !STORED_META.has(k)).sort();

    expect(wireFields).toEqual(storedFields);
  });

  it('wire doc 带 schemaVersion、不带 id；stored record 带 id + schemaVersion（存储形状不变）', () => {
    const p = richProject();
    const wire = recordFromProject(p, 'set', 'cleared');
    const stored = storedFromProject(p);

    expect(wire.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect('id' in wire).toBe(false);
    expect(stored.id).toBe('pSong1');
    expect(stored.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  });

  it('旧「一份 notes」记录与畸形记录读回为 null（不读不删，映射闸门原样）', () => {
    expect(projectFromStored({ schemaVersion: 1, durationSeconds: 30, notes: [bpm] })).toBeNull();
    expect(projectFromStored({ id: 'default', durationSeconds: 30, notes: [] })).toBeNull();
    expect(projectFromStored({})).toBeNull();
    expect(projectFromStored(null)).toBeNull();
    expect(projectFromStored('p1')).toBeNull();
  });
});
