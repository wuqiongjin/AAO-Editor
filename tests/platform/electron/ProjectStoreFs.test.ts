// 工程文件后端真 fs 往返：list/get/put/delete、封面分离、旧 schema 不读不删。
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ensureDataRootLayoutSync } from '@/electron/dataRoot.cjs';
import {
  SCHEMA_VERSION,
  deleteProject,
  getProject,
  listProjects,
  putProject,
} from '@/electron/projectStore.cjs';
import { tmpDir } from '@/tests/support/fs';

const chart = {
  id: 'c1',
  notes: [{ beat: 0, type: 'BPM', bpm: 120 }],
  title: null,
  diff: 3,
  level: null,
  completed: false,
  upload: null,
  lastModified: 1,
  appliedChartCodeText: null,
  chartCodePristine: false,
};

function doc(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    name: 'A',
    artist: null,
    source: { type: 'custom' },
    durationSeconds: 30,
    lastOpened: 1,
    charts: [chart],
    audioName: null,
    coverName: null,
    audioIntent: 'cleared' as const,
    coverIntent: 'cleared' as const,
    ...overrides,
  };
}

describe('electron/projectStore · 真文件往返', () => {
  it('put/get/list/delete 多工程，封面与音频写成独立 bin', async () => {
    const root = tmpDir('tsugu-proj-fs-');
    try {
      ensureDataRootLayoutSync(root);
      await putProject(root, {
        id: 'pA',
        doc: doc({
          name: 'A',
          audioIntent: 'set',
          coverIntent: 'set',
          audioName: 'a.wav',
          coverName: 'c.png',
        }),
        audio: new Uint8Array([1, 2]),
        cover: new Uint8Array([9, 9, 9]),
      });
      await putProject(root, { id: 'pB', doc: doc({ name: 'B', lastOpened: 2 }) });

      const listed = await listProjects(root);
      expect(listed.map((p: { id: string }) => p.id).sort()).toEqual(['pA', 'pB']);
      const listedA = listed.find((p: { id: string }) => p.id === 'pA');
      expect(listedA?.doc.audioPresent).toBe(true);
      expect(listedA?.doc.coverPresent).toBe(true);

      const got = await getProject(root, 'pA');
      if (!got) throw new Error('expected pA');
      expect(got.doc.name).toBe('A');
      expect(Buffer.from(got.audio ?? [])).toEqual(Buffer.from([1, 2]));
      expect(Buffer.from(got.cover ?? [])).toEqual(Buffer.from([9, 9, 9]));
      expect(existsSync(join(root, 'projects', 'pA', 'audio.bin'))).toBe(true);
      expect(existsSync(join(root, 'projects', 'pA', 'cover.bin'))).toBe(true);

      await deleteProject(root, 'pA');
      expect(existsSync(join(root, 'projects', 'pA'))).toBe(false);
      expect((await listProjects(root)).map((p: { id: string }) => p.id)).toEqual(['pB']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('旧「一份 notes」记录读回为不存在，磁盘文件不被删除', async () => {
    const root = tmpDir('tsugu-proj-v1-');
    try {
      const dir = join(root, 'projects', 'default');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'project.json'), JSON.stringify({
        schemaVersion: 1,
        durationSeconds: 30,
        notes: [{ beat: 0, type: 'BPM', bpm: 120 }],
        audioName: 'old.wav',
        audioPresent: true,
      }));
      writeFileSync(join(dir, 'audio.bin'), Buffer.from([7, 7]));

      await expect(getProject(root, 'default')).resolves.toBeNull();
      await expect(listProjects(root)).resolves.toEqual([]);
      expect(readFileSync(join(dir, 'project.json'), 'utf8')).toContain('"schemaVersion":1');
      expect(readFileSync(join(dir, 'audio.bin')).equals(Buffer.from([7, 7]))).toBe(true);

      await expect(putProject(root, { id: 'default', doc: doc({ name: 'nope' }) })).rejects.toThrow('拒绝覆盖旧 schema 工程');
      await expect(deleteProject(root, 'default')).rejects.toThrow('拒绝删除旧 schema 工程');
      expect(readFileSync(join(dir, 'project.json'), 'utf8')).toContain('"schemaVersion":1');
      expect(existsSync(join(dir, 'audio.bin'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
