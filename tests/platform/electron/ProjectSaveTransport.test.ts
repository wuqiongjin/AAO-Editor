// issue 232：真正的文件后端 → IPC handler → 磁盘；普通 Node 不模拟 contextBridge 耗时。
// 文本传输约束由此锁住；手工帧时间验收见仓库外 ../issue-232/reproduce.cjs。
import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ElectronFileProjectBackend, type ChartProject } from '@/src/project/ChartProject';
import { registerProjectStoreIpc } from '@/electron/storage/projectStore.cjs';
import type { ElectronProjectBridge } from '@/src/app/electronBridge';
import { tmpDir } from '@/tests/support/fs';

function fixture(): ChartProject {
  return {
    id: 'pTransport', name: '保存往返', artist: null, source: { type: 'custom' },
    durationSeconds: 120, lastOpened: 1, audioName: 'bgm.mp3', coverName: 'cover.png',
    audioBlob: new Blob([new Uint8Array([1, 2, 3])]),
    coverBlob: new Blob([new Uint8Array([9, 8])]),
    charts: [{
      id: 'c1', title: null, diff: 3, level: null, completed: false, upload: null,
      lastModified: 1, chartCodePristine: true,
      appliedChartCodeText: '[ {"type":"System","data":"未知字段保真"} ]',
      notes: [
        { type: 'BPM', beat: 0, bpm: 120 },
        { type: 'Single', beat: 2, lane: 8.5, subBeat: undefined,
          source: { type: 'Single', beat: 2, lane: 8.5, charge: true,
            extra: { unicode: '結束バンド', array: [false, null, 1.25] } } },
      ],
    }],
  };
}

function transport(root: string) {
  const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>();
  registerProjectStoreIpc({ handle: (name: string, fn: (event: unknown, payload?: unknown) => unknown) => {
    handlers.set(name, fn);
  } }, { currentDataRoot: () => root });
  const invoke = (name: string, payload?: unknown) => Promise.resolve(handlers.get(name)!(null, payload));
  const put = vi.fn((payload: Parameters<ElectronProjectBridge['put']>[0]) => invoke('project:put', payload));
  const bridge: ElectronProjectBridge = {
    put,
    get: (id) => invoke('project:get', id) as ReturnType<ElectronProjectBridge['get']>,
    list: () => invoke('project:list') as ReturnType<ElectronProjectBridge['list']>,
    delete: (id) => invoke('project:delete', id),
    uploadRefs: (id) => invoke('project:uploadRefs', id) as ReturnType<ElectronProjectBridge['uploadRefs']>,
  };
  return { backend: new ElectronFileProjectBackend(bridge), put, invoke };
}

describe('issue 232 · 工程保存文本传输', () => {
  it('跨桥只传 JSON 文本；未知字段、源文本、JSON 规范化和素材字节往返保真', async () => {
    const root = tmpDir('aao-save-transport-');
    try {
      const { backend, put } = transport(root);
      const project = fixture();
      await backend.save(project);
      expect(typeof put.mock.calls[0][0].doc).toBe('string');
      const restored = await backend.get(project.id);
      expect(restored!.charts).toEqual(JSON.parse(JSON.stringify(project.charts)));
      expect(restored!.charts[0].appliedChartCodeText).toBe(project.charts[0].appliedChartCodeText);
      expect('subBeat' in restored!.charts[0].notes[1]).toBe(false);
      expect('subBeat' in project.charts[0].notes[1]).toBe(true);
      expect(new Uint8Array(await restored!.audioBlob!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
      expect(new Uint8Array(await restored!.coverBlob!.arrayBuffer())).toEqual(new Uint8Array([9, 8]));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it.each([
    ['对象载荷', { schemaVersion: 1, charts: [] }],
    ['非法 JSON', '{bad'],
    ['旧 schema', JSON.stringify({ schemaVersion: 1, notes: [] })],
    ['非法 intent', JSON.stringify({ schemaVersion: 1, charts: [], audioIntent: 'oops', coverIntent: 'cleared' })],
  ])('%s 在文件副作用前拒绝', async (_name, doc) => {
    const root = tmpDir('aao-save-transport-');
    try {
      const { invoke } = transport(root);
      await expect(async () => invoke('project:put', { id: 'pInvalid', doc })).rejects.toThrow();
      expect(existsSync(join(root, 'projects', 'pInvalid'))).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('编辑与撤销确实落盘，素材 keep 不重传，cleared 仍清除', async () => {
    const root = tmpDir('aao-save-transport-');
    try {
      const { backend, put } = transport(root);
      const project = fixture();
      await backend.save(project);
      const edited = { ...project, charts: [{ ...project.charts[0], notes: project.charts[0].notes.slice(0, 1) }] };
      await backend.save(edited);
      expect((await backend.get(project.id))!.charts[0].notes).toEqual(edited.charts[0].notes);
      expect(put.mock.calls[1][0].audio).toBeUndefined();
      expect(put.mock.calls[1][0].cover).toBeUndefined();
      await backend.save(project);
      expect((await backend.get(project.id))!.charts[0].notes).toHaveLength(2);
      const durable = JSON.parse(readFileSync(join(root, 'projects', project.id, 'project.json'), 'utf8'));
      expect(durable.audioPresent).toBe(true);
      expect(durable.coverPresent).toBe(true);
      expect(durable).not.toHaveProperty('audioIntent');
      expect(durable).not.toHaveProperty('coverIntent');
      await backend.save({ ...project, audioBlob: undefined, coverBlob: undefined, audioName: null, coverName: null });
      const cleared = await backend.get(project.id);
      expect(cleared!.audioBlob).toBeUndefined();
      expect(cleared!.coverBlob).toBeUndefined();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
