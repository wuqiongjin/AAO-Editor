// 谱面工程 IPC 桥的内存替身：按 id 存 doc + 音频/封面字节，供渲染侧后端单测往返。
import { vi } from 'vitest';
import type {
  ElectronProjectBridge,
  ProjectGetWire,
  ProjectPutWire,
} from '@/src/project/ChartProject';

export type MemoryDiskRecord = {
  doc: Record<string, unknown>;
  audio: Uint8Array | null;
  cover: Uint8Array | null;
};

export function makeMemoryProjectBridge(initial: Iterable<[string, MemoryDiskRecord]> = []) {
  const disk = new Map<string, MemoryDiskRecord>(initial);
  const puts: ProjectPutWire[] = [];

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
    disk.set(payload.id, {
      doc: {
        ...docRest,
        audioPresent: audio != null && audio.byteLength > 0,
        coverPresent: cover != null && cover.byteLength > 0,
      },
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
