// 架构评审候选 2（06 票）：记录闸门与 id 正则**跨进程同口径**锁。
//
// 双保险是**有意**保留的（渲染侧先拦、主进程再拦），跨进程也没有共享模块的构建通道
// （渲染侧走 Vite/tsc，主进程走 require .cjs）。本测试不做合并，只让漂移必红：
// 同一语料在渲染侧与主进程的判决必须一致，schemaVersion 常量必须相等。
import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { safeProjectId } from '@/electron/dataRoot.cjs';
import { SCHEMA_VERSION, getProject, putProject } from '@/electron/projectStore.cjs';
import {
  PROJECT_SCHEMA_VERSION,
  assertValidProjectId,
  canReplaceStoredProject,
  isCurrentProjectSchema,
} from '@/src/project/ChartProjectRecord';
import { tmpDir } from '@/tests/support/fs';

const ID_CORPUS: unknown[] = [
  'p1',
  'P',
  'pSong-1.2_3',
  'p'.repeat(64),
  'p'.repeat(65), // 超长
  '', // 空
  '.hidden', // 首字符是点
  '..', // 目录穿越
  '../evil',
  'p/1', // 路径分隔
  'p 1', // 空格
  'p#1',
  '工程中文', // 非 ASCII
  123, // 非字符串：正则会把数字强制转串，两侧都必须拒
  null,
];

const DOC_CORPUS: { name: string; doc: unknown }[] = [
  { name: '当前文档', doc: { schemaVersion: PROJECT_SCHEMA_VERSION, charts: [] } },
  { name: '当前文档（多谱面）', doc: { schemaVersion: PROJECT_SCHEMA_VERSION, charts: [{ id: 'c1' }] } },
  { name: '旧「一份 notes」', doc: { schemaVersion: 1, durationSeconds: 30, notes: [] } },
  { name: '无 schemaVersion', doc: { charts: [] } },
  { name: '未来版本', doc: { schemaVersion: 2, charts: [] } },
  { name: 'charts 非数组', doc: { schemaVersion: 1, charts: {} } },
  { name: '数组根', doc: [] },
  { name: '字符串根', doc: 'default' },
  { name: 'null', doc: null },
];

const throws = (fn: () => unknown): boolean => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

/** 写入 <数据根>/projects/<id>/project.json（主进程文件布局） */
function writeDocFile(root: string, id: string, doc: unknown): void {
  const file = join(root, 'projects', id, 'project.json');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(doc), 'utf8');
}

describe('06 · 跨进程同口径：id 白名单与 schema 闸门', () => {
  it('schemaVersion 常量一致', () => {
    expect(SCHEMA_VERSION).toBe(PROJECT_SCHEMA_VERSION);
  });

  it('同一 id 语料：渲染侧 assertValidProjectId 与主进程 safeProjectId 判决一致', () => {
    for (const id of ID_CORPUS) {
      const label = JSON.stringify(id);
      expect(throws(() => assertValidProjectId(id as string)), `渲染侧判决（${label}）`)
        .toBe(throws(() => safeProjectId(id as string)));
    }
  });

  it('同一 doc 语料：渲染侧读闸门与主进程 isCurrentDoc（经 getProject 实读）判决一致', async () => {
    const root = tmpDir('tsugu-record-gate-');
    try {
      for (const [index, { name, doc }] of DOC_CORPUS.entries()) {
        const id = `pGate${index}`;
        writeDocFile(root, id, doc);

        const cjsAccepts = (await getProject(root, id)) !== null;
        expect(cjsAccepts, `主进程判决（${name}）`).toBe(isCurrentProjectSchema(doc));
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('写侧闸门同口径：空位两侧都判可写，旧「一份 notes」两侧都拒绝覆盖', async () => {
    const root = tmpDir('tsugu-record-gate-');
    const payload = (id: string) => ({
      id,
      doc: {
        schemaVersion: PROJECT_SCHEMA_VERSION,
        charts: [],
        audioIntent: 'cleared' as const,
        coverIntent: 'cleared' as const,
      },
    });
    try {
      expect(canReplaceStoredProject(null)).toBe(true);
      await expect(putProject(root, payload('pEmpty1'))).resolves.toBe(true);

      // 当前文档：两侧都可覆盖
      const currentDoc = { schemaVersion: PROJECT_SCHEMA_VERSION, charts: [] };
      expect(canReplaceStoredProject(currentDoc)).toBe(true);
      writeDocFile(root, 'pCurrent1', currentDoc);
      await expect(putProject(root, payload('pCurrent1'))).resolves.toBe(true);

      const legacy = { schemaVersion: 1, durationSeconds: 30, notes: [] };
      expect(canReplaceStoredProject(legacy)).toBe(false);
      writeDocFile(root, 'pLegacy1', legacy);
      await expect(putProject(root, payload('pLegacy1'))).rejects.toThrow('拒绝覆盖旧 schema 工程');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
