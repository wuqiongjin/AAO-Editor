// 谱面工程持久化（ADR-0005 §2/§6）：
// 谱面工程 = { 代码(notes) + 谱面时长(durationSeconds) + 音频(Blob 引用) }。
// 用 IndexedDB 键值表「工程 id → 记录」存储，本期单份工程（id='default'）也走键值表，
// 未来多谱面（issue 26）只是加条目 + 列表 UI，不改存储结构。
// 音频存 Blob（浏览器可跨会话恢复）；编辑自动防抖保存由调用方触发。
// 本模块接口抽象化，未来 Electron 后端（issue 25）可替换实现。
import type { ChartNote } from '../notes/Charts';

export const DEFAULT_PROJECT_ID = 'default';

export interface ChartProject {
  id: string;
  /** 谱面时长（秒）：ADR-0005 §4 显式字段，有音频=音频时长，无音频=持久化值(默认30s) */
  durationSeconds: number;
  /** 谱面代码（notes 数组，经 convertNotesToChartCode 可还原为代码文本） */
  notes: ChartNote[];
  audioName?: string;
  audioBlob?: Blob;
}

const DB_NAME = 'bangdream.chartproject';
const DB_VERSION = 1;
const STORE = 'projects';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 谱面工程 IndexedDB 存储（键值表，按 id 隔离）。接口抽象化，便于未来换后端。 */
export class ChartProjectStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) this.dbPromise = openDb();
    return this.dbPromise;
  }

  async get(id: string = DEFAULT_PROJECT_ID): Promise<ChartProject | null> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve((req.result as ChartProject) ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async save(project: ChartProject): Promise<void> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(project);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}