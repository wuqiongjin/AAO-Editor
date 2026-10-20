// 工程文件后端真 fs 往返：list/get/put/delete、封面分离、旧 schema 不读不删。
import { createHash } from 'crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { cacheDir, ensureDataRootLayoutSync, legacyDownloadsDir } from '@/electron/dataRoot.cjs';
import {
  SCHEMA_VERSION,
  deleteProject,
  getProject,
  listProjects,
  putProject,
  setAppLog,
  uploadRefs,
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
  afterEach(() => setAppLog(null));

  it('put/get/list/delete 多工程，封面与音频写成独立 bin', async () => {
    const root = tmpDir('aao-proj-fs-');
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
      const listedA = listed.find((p: { id: string }) => p.id === 'pA') as {
        id: string;
        doc: { audioPresent: boolean; coverPresent: boolean };
        cover?: Uint8Array | null;
      };
      expect(listedA?.doc.audioPresent).toBe(true);
      expect(listedA?.doc.coverPresent).toBe(true);
      expect(Buffer.from(listedA.cover ?? [])).toEqual(Buffer.from([9, 9, 9]));

      const got = await getProject(root, 'pA');
      if (!got) throw new Error('expected pA');
      expect(got.doc.name).toBe('A');
      expect(Buffer.from(got.audio ?? [])).toEqual(Buffer.from([1, 2]));
      expect(Buffer.from(got.cover ?? [])).toEqual(Buffer.from([9, 9, 9]));
      expect(existsSync(join(root, 'projects', 'pA', 'audio.bin'))).toBe(true);
      expect(existsSync(join(root, 'projects', 'pA', 'cover.bin'))).toBe(true);

      await deleteProject(root, 'pA');
      expect(existsSync(join(root, 'projects', 'pA'))).toBe(false);
      expect(existsSync(join(root, 'projects', 'pA', 'audio.bin'))).toBe(false);
      expect(existsSync(join(root, 'projects', 'pA', 'cover.bin'))).toBe(false);
      expect((await listProjects(root)).map((p: { id: string }) => p.id)).toEqual(['pB']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('票 08 / 14 · 从素材缓存拷素材进工程：字节不过 IPC，present 照常算', async () => {
    const root = tmpDir('aao-proj-cached-');
    try {
      ensureDataRootLayoutSync(root);
      const binDir = cacheDir(root);
      writeFileSync(join(binDir, 'abc-bgm001.mp3'), Buffer.from([5, 6, 7]));
      writeFileSync(join(binDir, 'abc-jacket.png'), Buffer.from([8, 8]));

      await putProject(root, {
        id: 'pCached',
        doc: doc({
          audioIntent: 'set',
          coverIntent: 'set',
          audioName: 'bgm001.mp3',
          coverName: 'yes_bang_dream.png',
        }),
        audioStagedPath: join(binDir, 'abc-bgm001.mp3'),
        coverStagedPath: join(binDir, 'abc-jacket.png'),
      });

      const got = await getProject(root, 'pCached');
      if (!got) throw new Error('expected pCached');
      expect(Buffer.from(got.audio ?? [])).toEqual(Buffer.from([5, 6, 7]));
      expect(Buffer.from(got.cover ?? [])).toEqual(Buffer.from([8, 8]));
      expect(got.doc.audioPresent).toBe(true);
      expect(got.doc.coverPresent).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('票 08 / 14 · 缓存之外的路径一律拒（路径来自渲染进程，必须卡在 cache/community/ 内）', async () => {
    const root = tmpDir('aao-proj-cached-');
    try {
      ensureDataRootLayoutSync(root);
      writeFileSync(join(root, 'secret.bin'), Buffer.from([1]));
      const stagedDoc = doc({ audioIntent: 'set' as const, audioName: 'a.mp3' });

      // 数据根里的普通文件
      await expect(putProject(root, {
        id: 'pOut1',
        doc: stagedDoc,
        audioStagedPath: join(root, 'secret.bin'),
      })).rejects.toThrow('拒绝从素材缓存之外拷贝素材');

      // 目录穿越写法（resolve 之后落在缓存外）
      await expect(putProject(root, {
        id: 'pOut2',
        doc: stagedDoc,
        audioStagedPath: join(cacheDir(root), '..', '..', 'secret.bin'),
      })).rejects.toThrow('拒绝从素材缓存之外拷贝素材');

      // 07 时代的 downloads/ 不再算数（暂存退役，票 14）
      await expect(putProject(root, {
        id: 'pOut3',
        doc: stagedDoc,
        audioStagedPath: join(legacyDownloadsDir(root), 'old.mp3'),
      })).rejects.toThrow('拒绝从素材缓存之外拷贝素材');

      for (const id of ['pOut1', 'pOut2', 'pOut3']) {
        expect(existsSync(join(root, 'projects', id, 'project.json'))).toBe(false);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('票 08 · 缓存文件不见了就整笔失败：不写一个「说有音频却没有」的工程', async () => {
    const root = tmpDir('aao-proj-cached-');
    try {
      ensureDataRootLayoutSync(root);
      await expect(putProject(root, {
        id: 'pGone',
        doc: doc({ audioIntent: 'set' as const, audioName: 'a.mp3' }),
        audioStagedPath: join(cacheDir(root), 'never-downloaded.mp3'),
      })).rejects.toThrow();
      expect(existsSync(join(root, 'projects', 'pGone', 'project.json'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('票 05 · project.json 解析失败 → sink warn，按空数据处理', async () => {
    const root = tmpDir('aao-proj-fs-');
    const writes: Array<{ level: string; module: string; message: string }> = [];
    setAppLog({
      write(payload: { level: string; module: string; message: string }) {
        writes.push(payload);
      },
    });
    try {
      const dir = join(root, 'projects', 'pBad');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'project.json'), '{not json');

      await expect(getProject(root, 'pBad')).resolves.toBeNull();
      expect(writes).toEqual([
        expect.objectContaining({
          level: 'warn',
          module: 'project-store',
          message: 'project.json 解析失败，按空数据处理:',
        }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('audioPresent:true 但 audio.bin 缺失 → getProject 降级不炸、doc 原地不动（33 票：半态记录的来源）', async () => {
    const root = tmpDir('aao-proj-fs-');
    try {
      // 手工摆出「用户偷偷删了 audio.bin」的磁盘形状：doc 说有音频，字节不在
      const dir = join(root, 'projects', 'pMissing');
      mkdirSync(dir, { recursive: true });
      const durableDoc = doc({ name: 'M', audioName: '没了的歌.mp3', audioIntent: 'set' });
      delete (durableDoc as Record<string, unknown>).audioIntent;
      delete (durableDoc as Record<string, unknown>).coverIntent;
      writeFileSync(join(dir, 'project.json'), JSON.stringify({
        ...durableDoc,
        audioPresent: true,
        coverPresent: false,
      }));

      const got = await getProject(root, 'pMissing');
      if (!got) throw new Error('expected pMissing');
      // doc 原地不动：audioName 旧名、audioPresent 仍 true（半态由渲染层 projectFromRecord 制造，
      // 工作台据此判「音频文件丢失」——33 票的丢失信号）
      expect(got.doc.audioName).toBe('没了的歌.mp3');
      expect(got.doc.audioPresent).toBe(true);
      // 字节按无数据返回（readBinIfPresent 的降级），不抛
      expect(got.audio).toBeNull();

      // list 同口径：不读音频字节，doc 原样列出
      const listed = await listProjects(root);
      expect(listed.map((p: { id: string }) => p.id)).toEqual(['pMissing']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('票 11 · uploadRefs：音频 / 封面的路径 + 字节数 + SHA-1（字节不过 IPC）', async () => {
    const root = tmpDir('aao-proj-uploadrefs-');
    try {
      ensureDataRootLayoutSync(root);
      await putProject(root, {
        id: 'pUp',
        doc: doc({ audioIntent: 'set', coverIntent: 'set', audioName: 'a.mp3', coverName: 'c.png' }),
        audio: new Uint8Array([1, 2, 3, 4]),
        cover: new Uint8Array([9, 9]),
      });
      await putProject(root, { id: 'pBare', doc: doc({ name: 'Bare' }) });

      const refs = await uploadRefs(root, 'pUp');
      if (!refs) throw new Error('expected pUp');
      expect(refs.audio).toEqual({
        path: join(root, 'projects', 'pUp', 'audio.bin'),
        size: 4,
        hash: createHash('sha1').update(Buffer.from([1, 2, 3, 4])).digest('hex'),
      });
      expect(refs.cover).toEqual({
        path: join(root, 'projects', 'pUp', 'cover.bin'),
        size: 2,
        hash: createHash('sha1').update(Buffer.from([9, 9])).digest('hex'),
      });

      // 没有的素材是 null（不是「有路径没字节」）
      const bare = await uploadRefs(root, 'pBare');
      expect(bare).toEqual({ audio: null, cover: null });

      // 工程不存在 / 旧 schema → 整个 null
      expect(await uploadRefs(root, 'nope')).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('票 11 · uploadRefs：present 但盘上没有 → 该素材按没有处理（不返回假路径）', async () => {
    const root = tmpDir('aao-proj-uploadrefs-gone-');
    try {
      const dir = join(root, 'projects', 'pGone');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'project.json'), JSON.stringify(doc({ audioPresent: true, audioName: 'a.mp3' })));

      const refs = await uploadRefs(root, 'pGone');
      expect(refs).toEqual({ audio: null, cover: null });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('旧「一份 notes」记录读回为不存在，磁盘文件不被删除', async () => {
    const root = tmpDir('aao-proj-v1-');
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
