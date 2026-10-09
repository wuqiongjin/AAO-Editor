// 谱面工程 IPC 桥的内存替身：按 id 存 doc + 音频/封面字节，供渲染侧后端单测往返。
import { vi } from 'vitest';
import type {
  ElectronProjectBridge,
  ProjectGetWire,
  ProjectPutWire,
} from '@/src/project/ChartProjectRecord';

export type MemoryDiskRecord = {
  doc: Record<string, unknown>;
  audio: Uint8Array | null;
  cover: Uint8Array | null;
};

export function makeMemoryProjectBridge(initial: Iterable<[string, MemoryDiskRecord]> = []) {
  const disk = new Map<string, MemoryDiskRecord>(initial);
  const puts: ProjectPutWire[] = [];
  /** 「这份素材是从下载暂存拷进来的」：真实主进程会读文件，内存桥没有 fs，只记路径 */
  const staged = new Map<string, { audio?: string; cover?: string }>();
  /** 「盘上现在有没有这份 bin」：主进程 put 的第三步（fileExists）就是它 */
  const present = new Map<string, { audio: boolean; cover: boolean }>();

  const get = vi.fn(async (id: string): Promise<ProjectGetWire | null> => {
    const row = disk.get(id);
    if (!row) return null;
    return {
      doc: row.doc,
      audio: row.audio,
      cover: row.cover,
    } as unknown as ProjectGetWire;
  });

  const put = vi.fn(async (payload: ProjectPutWire) => {
    puts.push(payload);
    const prev = disk.get(payload.id);
    const seen = staged.get(payload.id) ?? {};
    if (payload.audioStagedPath) seen.audio = payload.audioStagedPath;
    if (payload.coverStagedPath) seen.cover = payload.coverStagedPath;
    staged.set(payload.id, seen);
    const audio =
      payload.doc.audioIntent === 'set'
        ? (payload.audio ?? null)
        : payload.doc.audioIntent === 'keep'
          ? (prev?.audio ?? null)
          : null;
    const cover =
      payload.doc.coverIntent === 'set'
        ? (payload.cover ?? null)
        : payload.doc.coverIntent === 'keep'
          ? (prev?.cover ?? null)
          : null;
    const { audioIntent: _a, coverIntent: _c, ...docRest } = payload.doc;
    // 暂存拷进来的也算「盘上有」：字节不在这条桥上（主进程从 downloads/ 拷文件），present 只认声明
    const hadStaged = (intent: string, stagedPath?: string) =>
      intent === 'set' && typeof stagedPath === 'string' && stagedPath !== '';
    const before = present.get(payload.id) ?? { audio: false, cover: false };
    const next = {
      audio: payload.doc.audioIntent === 'set'
        ? (audio != null && audio.byteLength > 0) || hadStaged(payload.doc.audioIntent, payload.audioStagedPath)
        : payload.doc.audioIntent === 'keep' ? before.audio : false,
      cover: payload.doc.coverIntent === 'set'
        ? (cover != null && cover.byteLength > 0) || hadStaged(payload.doc.coverIntent, payload.coverStagedPath)
        : payload.doc.coverIntent === 'keep' ? before.cover : false,
    };
    present.set(payload.id, next);
    disk.set(payload.id, {
      doc: { ...docRest, audioPresent: next.audio, coverPresent: next.cover },
      audio,
      cover,
    });
  });

  const list = vi.fn(async () =>
    [...disk.entries()].map(([id, row]) => ({
      id,
      doc: row.doc as unknown as ProjectGetWire['doc'],
      cover: row.cover,
    })),
  );

  const deleteProject = vi.fn(async (id: string) => {
    disk.delete(id);
  });

  const bridge: ElectronProjectBridge = { get, put, list, delete: deleteProject };
  return { bridge, disk, puts, get, put };
}
