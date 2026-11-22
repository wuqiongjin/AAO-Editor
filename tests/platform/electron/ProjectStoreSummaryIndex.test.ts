// chart-projects 44：index.json 单索引命中/自愈、删工程清缩略图、JSON 文本跨桥、noteCount 口径互锁。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ensureDataRootLayoutSync,
  projectCacheIndexPath,
  projectThumbPath,
  projectThumbsDir,
} from '@/electron/storage/dataRoot.cjs';
import {
  SCHEMA_VERSION,
  countChartNotes,
  deleteProject,
  getProjectSummary,
  listProjects,
  putProject,
  registerProjectStoreIpc,
  touchLastOpened,
} from '@/electron/storage/projectStore.cjs';
import { countChartNotes as rendererCountChartNotes } from '@/src/chart/editing/NoteEditing';
import type { ChartNote } from '@/src/chart/types';
import { tmpDir } from '@/tests/support/fs';

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    name: 'Song A',
    artist: 'Band',
    source: { type: 'custom' },
    durationSeconds: 95,
    lastOpened: 1000,
    charts: [
      {
        id: 'c1',
        notes: [
          { beat: 0, type: 'BPM', bpm: 120 },
          { beat: 1, type: 'Single', lane: 2 },
          { beat: 2, type: 'Slide', connections: [{ beat: 2, lane: 1 }, { beat: 2.5, lane: 2, hidden: true }, { beat: 3, lane: 3 }] },
        ],
        title: 'EX',
        diff: 3,
        level: 26,
        completed: false,
        upload: null,
        lastModified: 1000,
        appliedChartCodeText: '[{"type":"BPM","beat":0,"bpm":120}]',
        chartCodePristine: true,
        publishDraft: 'draft',
        tags: [{ type: 'text', data: 'tag1' }],
      },
    ],
    audioName: 'a.mp3',
    coverName: 'c.png',
    audioIntent: 'cleared' as const,
    coverIntent: 'cleared' as const,
    ...overrides,
  };
}

describe('chart-projects 44 · countChartNotes 主进程与渲染侧口径互锁', () => {
  it('BPM / System / Opaque / hidden / 负 beat 非 hidden / Slide / Long / Directional 全量同口径', () => {
    const notes: ChartNote[] = [
      { beat: 0, type: 'BPM', bpm: 120 },
      { type: 'System', raw: { type: 'System', data: 'cmd_fever_ready.wav' } } as unknown as ChartNote,
      { type: 'Opaque', raw: { type: 'Unknown' } } as unknown as ChartNote,
      { beat: -1, type: 'Single', lane: 0 },
      { beat: 1, type: 'Single', lane: 1, flick: true },
      { beat: 2, type: 'Single', lane: 2, skill: true },
      { beat: 3, type: 'LDirectional', lane: 3, width: 2 },
      { beat: 4, type: 'RDirectional', lane: 4, width: 1 },
      {
        beat: 5,
        type: 'Slide',
        connections: [
          { beat: -0.5, lane: 0 },
          { beat: 5, lane: 1, hidden: true },
          { beat: 5.5, lane: 2 },
          { beat: 6, lane: 3, hidden: true },
          { beat: 7, lane: 4 },
        ],
      },
      {
        beat: 8,
        type: 'Long',
        connections: [
          { beat: 8, lane: 5 },
          { beat: 8.5, lane: 5, hidden: true },
          { beat: 9, lane: 5 },
        ],
      },
    ];
    const expected = rendererCountChartNotes(notes);
    expect(expected).toBe(10);
    expect(countChartNotes(notes)).toBe(expected);
  });
});

describe('chart-projects 44 · index.json 单索引缓存、自愈与缩略图清理', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('冷扫建索引，二次 listProjects 命中索引不重读 project.json，外部修改/损坏自动自愈', async () => {
    const root = tmpDir('aao-idx-');
    try {
      ensureDataRootLayoutSync(root);
      await putProject(root, {
        id: 'p1',
        doc: makeDoc({ coverIntent: 'set' }),
        cover: new Uint8Array([1, 2, 3, 4]),
      });

      const indexPath = projectCacheIndexPath(root);
      expect(existsSync(indexPath)).toBe(true);

      // 删掉 index.json，模拟首次升级或缓存被清空 → listProjects 自动重建
      rmSync(indexPath, { force: true });
      const rebuilt = await listProjects(root);
      expect(rebuilt).toHaveLength(1);
      expect(rebuilt[0].charts[0]).toEqual({
        id: 'c1',
        title: 'EX',
        diff: 3,
        level: 26,
        completed: false,
        upload: null,
        lastModified: 1000,
        noteCount: 3,
      });
      expect(rebuilt[0].charts[0]).not.toHaveProperty('notes');
      expect(rebuilt[0].charts[0]).not.toHaveProperty('appliedChartCodeText');
      expect(rebuilt[0].charts[0]).not.toHaveProperty('publishDraft');
      expect(rebuilt[0].charts[0]).not.toHaveProperty('tags');
      expect(existsSync(indexPath)).toBe(true);

      // 篡改 index.json 里的 name 验证二次 listProjects 确实命中索引而非重读 project.json
      const idx = JSON.parse(readFileSync(indexPath, 'utf8'));
      idx.entries.p1.summary.name = 'Cached Marker';
      writeFileSync(indexPath, JSON.stringify(idx), 'utf8');
      const hit = await listProjects(root);
      expect(hit[0].name).toBe('Cached Marker');

      // 破坏 index.json → 自动自愈回真源
      writeFileSync(indexPath, '{broken json', 'utf8');
      const healed = await listProjects(root);
      expect(healed[0].name).toBe('Song A');

      // 外部篡改 project.json（改变内容长度与 mtime）→ 自动失效重解析
      const jsonPath = join(root, 'projects', 'p1', 'project.json');
      const diskDoc = JSON.parse(readFileSync(jsonPath, 'utf8'));
      diskDoc.name = 'Externally Edited';
      writeFileSync(jsonPath, JSON.stringify(diskDoc), 'utf8');
      const later = new Date(Date.now() + 5000);
      utimesSync(jsonPath, later, later);
      const refreshed = await listProjects(root);
      expect(refreshed[0].name).toBe('Externally Edited');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('putProject 替换/清除封面与 deleteProject 主动删除缩略图；孤儿缩略图在扫描时清理', async () => {
    const root = tmpDir('aao-thumb-clean-');
    try {
      ensureDataRootLayoutSync(root);
      await putProject(root, {
        id: 'p1',
        doc: makeDoc({ coverIntent: 'set' }),
        cover: new Uint8Array([9, 9, 9]),
      });

      mkdirSync(projectThumbsDir(root), { recursive: true });
      const thumb1 = projectThumbPath(root, 'p1');
      const orphan = projectThumbPath(root, 'pOrphan');
      writeFileSync(thumb1, Buffer.from([1]));
      writeFileSync(orphan, Buffer.from([2]));

      // 替换封面 → 主动删除旧缩略图
      await putProject(root, {
        id: 'p1',
        doc: makeDoc({ coverIntent: 'set' }),
        cover: new Uint8Array([8, 8, 8, 8]),
      });
      expect(existsSync(thumb1)).toBe(false);

      // 扫描清理孤儿缩略图
      await listProjects(root);
      expect(existsSync(orphan)).toBe(false);

      // 重建缩略图后 deleteProject 一并清掉索引条目与缩略图
      writeFileSync(thumb1, Buffer.from([1]));
      await deleteProject(root, 'p1');
      expect(existsSync(thumb1)).toBe(false);
      const idx = JSON.parse(readFileSync(projectCacheIndexPath(root), 'utf8'));
      expect(idx.entries).not.toHaveProperty('p1');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('project:list 与 project:getSummary IPC 返回单条 JSON 字符串', async () => {
    const root = tmpDir('aao-ipc-sum-');
    try {
      ensureDataRootLayoutSync(root);
      await putProject(root, {
        id: 'p1',
        doc: makeDoc({ audioIntent: 'set', coverIntent: 'set' }),
        audio: new Uint8Array([1, 2, 3]),
        cover: new Uint8Array([4, 5, 6]),
      });

      const handlers = new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>();
      registerProjectStoreIpc(
        { handle: (name: string, fn: (event: unknown, payload?: unknown) => Promise<unknown>) => handlers.set(name, fn) },
        { currentDataRoot: () => root },
      );

      const listRaw = await handlers.get('project:list')!(null);
      expect(typeof listRaw).toBe('string');
      const listParsed = JSON.parse(listRaw as string);
      expect(listParsed).toHaveLength(1);
      expect(listParsed[0].coverPresent).toBe(true);
      expect(listParsed[0].charts[0].noteCount).toBe(3);

      const summaryRaw = await handlers.get('project:getSummary')!(null, 'p1');
      expect(typeof summaryRaw).toBe('string');
      expect(JSON.parse(summaryRaw as string)).toEqual(listParsed[0]);
      expect(await getProjectSummary(root, 'pMissing')).toBeNull();

      const gotWire = await handlers.get('project:get')!(null, 'p1') as { doc: unknown; audio: unknown; cover: unknown };
      expect(typeof gotWire.doc).toBe('string');
      expect(JSON.parse(gotWire.doc as string).name).toBe('Song A');
      expect(await handlers.get('project:touchLastOpened')!(null, 'p1', 9999)).toBe(true);
      expect(await handlers.get('project:touchLastOpened')!(null, 'pMissing', 9999)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('chart-projects 45 · touchLastOpened 仅更新 project.json 与 index.json，不读 audio.bin/cover.bin 并拦截旧 schema', async () => {
    const root = tmpDir('aao-touch-last-');
    try {
      ensureDataRootLayoutSync(root);
      await putProject(root, {
        id: 'p1',
        doc: makeDoc({ audioIntent: 'set', coverIntent: 'set', lastOpened: 1000 }),
        audio: new Uint8Array([1, 2, 3]),
        cover: new Uint8Array([4, 5, 6]),
      });
      const legacyJson = join(root, 'projects', 'pLegacy', 'project.json');
      mkdirSync(join(root, 'projects', 'pLegacy'), { recursive: true });
      writeFileSync(legacyJson, JSON.stringify({ schemaVersion: 1, notes: [] }), 'utf8');

      const { promises: fsp } = await import('node:fs');
      const readSpy = vi.spyOn(fsp, 'readFile');

      expect(await touchLastOpened(root, 'p1', 5678)).toBe(true);
      const readTargets = readSpy.mock.calls.map(([p]) => String(p));
      expect(readTargets.some((p) => p.endsWith('audio.bin'))).toBe(false);
      expect(readTargets.some((p) => p.endsWith('cover.bin'))).toBe(false);

      const diskDoc = JSON.parse(readFileSync(join(root, 'projects', 'p1', 'project.json'), 'utf8'));
      expect(diskDoc.lastOpened).toBe(5678);
      const listed = await listProjects(root);
      expect(listed.find((p: { id: string }) => p.id === 'p1')?.lastOpened).toBe(5678);

      // 不存在与旧 schema 返回 false，且不覆写旧 schema
      expect(await touchLastOpened(root, 'pMissing', 9999)).toBe(false);
      expect(await touchLastOpened(root, 'pLegacy', 9999)).toBe(false);
      expect(JSON.parse(readFileSync(legacyJson, 'utf8'))).toEqual({ schemaVersion: 1, notes: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
