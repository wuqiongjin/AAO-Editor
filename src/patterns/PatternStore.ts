// 片段库存储（issue 184 / ADR-0023 §3）。
//
// 后端按环境自动切换（照 `src/project/ChartProject.ts` 的 `autoDetectBackend` 先例）：
//   Electron → 数据根下 `patterns/patterns.json`（主进程文件后端，preload 桥 `electronAPI.patternLibrary`）
//   浏览器   → IndexedDB 独立库（单 record 存整份）
//
// 与设置对象的关系：**不进 settings、不随设置 JSON 导入导出**——片段是用户素材，不是习惯。
// v1 单文件全量；将来分片只换实现，不动语义。
import type { ChartNote, SelectionItem } from '../chart/types';
import { getElectronAPI, type ElectronPatternLibraryBridge } from '../app/electronBridge';
import { capturePattern } from './capture';
import { appendNewPattern } from './library';
import { libraryDocFromPatterns, patternsFromLibraryDoc } from './record';
import {
  PATTERN_LIBRARY_BACKUP_THRESHOLD_BYTES,
  type Pattern,
  type PatternPayload,
} from './types';

export interface PatternLibraryBackend {
  /** 文件 / record 不存在 → 空库（**不写盘**：用户没收藏过就不该先造一个文件） */
  load(): Promise<Pattern[]>;
  /** v1 全量落盘 */
  saveAll(patterns: readonly Pattern[]): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* IndexedDB 后端（浏览器 / 在线版）                                    */
/* ------------------------------------------------------------------ */

const DB_NAME = 'aao.patterns';
const DB_VERSION = 1;
const STORE = 'library';
const RECORD_KEY = 'library';

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 当前环境的 IndexedDB；没有（node / 老浏览器）时抛在**调用时**，构造后端本身不挑环境。 */
function browserIndexedDb(): IDBFactory {
  if (typeof indexedDB === 'undefined') throw new Error('当前环境没有 IndexedDB');
  return indexedDB;
}

export class IndexedDbPatternLibraryBackend implements PatternLibraryBackend {
  /** 测试可注入假工厂；默认取全局 `indexedDB` */
  private factory: IDBFactory | null;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(factory?: IDBFactory) {
    this.factory = factory ?? null;
  }

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) this.dbPromise = openDb(this.factory ?? browserIndexedDb());
    return this.dbPromise;
  }

  async load(): Promise<Pattern[]> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(RECORD_KEY);
      req.onsuccess = () => resolve(patternsFromLibraryDoc(req.result));
      req.onerror = () => reject(req.error);
    });
  }

  async saveAll(patterns: readonly Pattern[]): Promise<void> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(libraryDocFromPatterns(patterns), RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

/* ------------------------------------------------------------------ */
/* Electron 文件后端（桌面版）                                          */
/* ------------------------------------------------------------------ */

export type { ElectronPatternLibraryBridge } from '../app/electronBridge';

export class ElectronFilePatternLibraryBackend implements PatternLibraryBackend {
  private bridge: ElectronPatternLibraryBridge;

  constructor(bridge: ElectronPatternLibraryBridge) {
    this.bridge = bridge;
  }

  async load(): Promise<Pattern[]> {
    return patternsFromLibraryDoc(await this.bridge.load());
  }

  async saveAll(patterns: readonly Pattern[]): Promise<void> {
    await this.bridge.saveAll(patterns);
  }
}

function getElectronPatternBridge(): ElectronPatternLibraryBridge | null {
  return getElectronAPI()?.patternLibrary ?? null;
}

/**
 * 按环境选后端：有 preload 桥 → 数据根文件；否则 IndexedDB。
 * （静态演示版没有桥，落到浏览器后端 —— 在线版与桌面版同功能。）
 */
export function autoDetectPatternBackend(): PatternLibraryBackend {
  const bridge = getElectronPatternBridge();
  return bridge ? new ElectronFilePatternLibraryBackend(bridge) : new IndexedDbPatternLibraryBackend();
}

/* ------------------------------------------------------------------ */
/* 门面                                                                 */
/* ------------------------------------------------------------------ */

export class PatternStore {
  private backend: PatternLibraryBackend;

  constructor(backend: PatternLibraryBackend = autoDetectPatternBackend()) {
    this.backend = backend;
  }

  load(): Promise<Pattern[]> {
    return this.backend.load();
  }

  saveAll(patterns: readonly Pattern[]): Promise<void> {
    return this.backend.saveAll(patterns);
  }

  /** 采集产物 → 领 id / 起名 → 追加整库落盘（追加口径唯一实现在 `appendNewPattern`）。 */
  async add(existing: readonly Pattern[], payload: PatternPayload, now?: number): Promise<Pattern> {
    const { patterns, pattern } = appendNewPattern(existing, payload, now);
    await this.backend.saveAll(patterns);
    return pattern;
  }

  /** 选区 → 片段。空选区返回 null，且**不写盘**。 */
  async capture(
    existing: readonly Pattern[],
    notes: ChartNote[],
    selection: SelectionItem[],
    now?: number,
  ): Promise<Pattern | null> {
    const payload = capturePattern(notes, selection);
    if (!payload) return null;
    return this.add(existing, payload, now);
  }
}

/** 整库序列化后的字节数（与主进程写盘的 JSON 同形）。 */
export function patternLibraryBytes(patterns: readonly Pattern[]): number {
  return new TextEncoder().encode(JSON.stringify(libraryDocFromPatterns(patterns))).byteLength;
}

/** 是否该提示用户导出备份（ADR-0023 §3「容量」；阈值初值 5 MB）。 */
export function exceedsPatternBackupThreshold(patterns: readonly Pattern[]): boolean {
  return patternLibraryBytes(patterns) > PATTERN_LIBRARY_BACKUP_THRESHOLD_BYTES;
}
