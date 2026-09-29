// 谱面工程持久化（ADR-0005 §6 / ADR-0015 §1、§5）：
// 谱面工程 = 工程信息 + 音频 + 封面 + 谱面时长 + 1..n 张谱面。
// 后端按环境自动切换：Electron 走数据根文件，浏览器走 IndexedDB。
// 未发布：schemaVersion 保持 1。旧 default（顶层 notes、无 charts）不读、不删；无 IndexedDB→文件迁移。
// 文件布局（<数据根>/projects/<id>/）：
//   project.json = { schemaVersion, 工程信息, durationSeconds, lastOpened, charts, audioName, coverName, audioPresent, coverPresent }
//   audio.bin / cover.bin = 与 JSON 分离的字节（仅在 set 时重写）
import type { ChartNote } from '../chart/types';

export const PROJECT_SCHEMA_VERSION = 1 as const;

export type ChartDifficulty = 0 | 1 | 2 | 3 | 4;

export type SongSource =
  | { type: 'custom' }
  | { type: 'bandori'; id: number }
  | { type: 'llsif'; id: number };

export interface ChartUploadRecord {
  postId: number;
  at: number;
}

export interface ProjectChart {
  id: string;
  /** 谱面代码源数据（ADR-0014 保真：未知字段随 JSON 往返保留） */
  notes: ChartNote[];
  title: string | null;
  diff: ChartDifficulty;
  level: number | null;
  completed: boolean;
  upload: ChartUploadRecord | null;
  lastModified: number;
  appliedChartCodeText: string | null;
  chartCodePristine: boolean;
}

export interface ChartProject {
  id: string;
  name: string | null;
  artist: string | null;
  source: SongSource;
  durationSeconds: number;
  lastOpened: number;
  charts: ProjectChart[];
  audioName: string | null;
  audioBlob?: Blob;
  coverName: string | null;
  coverBlob?: Blob;
}

export interface ProjectRecordDoc {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  name: string | null;
  artist: string | null;
  source: SongSource;
  durationSeconds: number;
  lastOpened: number;
  charts: ProjectChart[];
  audioName: string | null;
  coverName: string | null;
  audioPresent: boolean;
  coverPresent: boolean;
}

export type BinaryIntent = 'set' | 'keep' | 'cleared';

/** 渲染进程 → 主进程 put 载荷 */
export interface ProjectPutWire {
  id: string;
  doc: Omit<ProjectRecordDoc, 'audioPresent' | 'coverPresent'> & {
    audioIntent: BinaryIntent;
    coverIntent: BinaryIntent;
  };
  audio?: Uint8Array;
  cover?: Uint8Array;
}

/** 主进程 → 渲染进程 get 返回（null = 无数据 / 旧 schema） */
export interface ProjectGetWire {
  doc: ProjectRecordDoc;
  audio: Uint8Array | null;
  cover: Uint8Array | null;
}

export interface ProjectListItem {
  id: string;
  doc: ProjectRecordDoc;
  /** 封面墙用；音频不进 list */
  cover?: Uint8Array | null;
}

/** preload 注入的桥（electronAPI.projectStore） */
export interface ElectronProjectBridge {
  get(id: string): Promise<ProjectGetWire | null>;
  put(payload: ProjectPutWire): Promise<unknown>;
  list(): Promise<ProjectListItem[]>;
  delete(id: string): Promise<unknown>;
}

export interface ChartProjectBackend {
  get(id: string): Promise<ChartProject | null>;
  save(project: ChartProject): Promise<void>;
  list(): Promise<ChartProject[]>;
  delete(id: string): Promise<void>;
}

export function newChartId(): string {
  return `c${crypto.randomUUID().replace(/-/g, '')}`;
}

export function newProjectId(): string {
  return `p${crypto.randomUUID().replace(/-/g, '')}`;
}

export function isCurrentProjectSchema(record: unknown): boolean {
  if (typeof record !== 'object' || record === null) return false;
  const doc = record as { schemaVersion?: unknown; charts?: unknown };
  // 未发布所以不 bump 版本；靠 charts[] 把旧「一份 notes」记录挡在外面。
  return doc.schemaVersion === PROJECT_SCHEMA_VERSION && Array.isArray(doc.charts);
}

/** 空位可写；当前文档可覆盖；旧「一份 notes」记录必须原样留下。 */
export function canReplaceStoredProject(existing: unknown): boolean {
  if (existing == null) return true;
  return isCurrentProjectSchema(existing);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function blobFromBytes(bytes: Uint8Array | null | undefined): Blob | undefined {
  if (!bytes || bytes.byteLength === 0) return undefined;
  return new Blob([new Uint8Array(bytes)]);
}

export function projectFromDoc(
  id: string,
  doc: ProjectRecordDoc,
  audio: Uint8Array | null,
  cover: Uint8Array | null,
): ChartProject {
  const audioBlob = blobFromBytes(audio);
  const coverBlob = blobFromBytes(cover);
  return {
    id,
    name: doc.name ?? null,
    artist: doc.artist ?? null,
    source: doc.source ?? { type: 'custom' },
    durationSeconds: doc.durationSeconds,
    lastOpened: doc.lastOpened,
    charts: doc.charts ?? [],
    audioName: doc.audioName ?? null,
    coverName: doc.coverName ?? null,
    ...(audioBlob ? { audioBlob } : {}),
    ...(coverBlob ? { coverBlob } : {}),
  };
}

function toPutDoc(project: ChartProject, audioIntent: BinaryIntent, coverIntent: BinaryIntent): ProjectPutWire['doc'] {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name: project.name,
    artist: project.artist,
    source: project.source,
    durationSeconds: project.durationSeconds,
    lastOpened: project.lastOpened,
    charts: cloneJson(project.charts),
    audioName: project.audioName,
    coverName: project.coverName,
    audioIntent,
    coverIntent,
  };
}

async function blobIntent(
  blob: Blob | undefined,
  lastWritten: Blob | null,
): Promise<{ intent: BinaryIntent; bytes?: Uint8Array; next: Blob | null }> {
  if (blob == null) return { intent: 'cleared', next: null };
  if (blob === lastWritten) return { intent: 'keep', next: lastWritten };
  return { intent: 'set', bytes: new Uint8Array(await blob.arrayBuffer()), next: blob };
}

/** 工程 id 合法性（与主进程安全校验同口径的双保险）：字母开头，仅字母数字 . _ -，≤64 位 */
function assertValidProjectId(id: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) {
    throw new Error(`非法的谱面工程 id: ${JSON.stringify(id)}`);
  }
}

/* ------------------------------------------------------------------ */
/* IndexedDB 后端                                                       */
/* ------------------------------------------------------------------ */

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

type StoredProject = ChartProject & { schemaVersion: typeof PROJECT_SCHEMA_VERSION };

function fromStored(record: unknown): ChartProject | null {
  if (!isCurrentProjectSchema(record)) return null;
  const stored = record as StoredProject;
  return {
    id: stored.id,
    name: stored.name,
    artist: stored.artist,
    source: stored.source,
    durationSeconds: stored.durationSeconds,
    lastOpened: stored.lastOpened,
    charts: stored.charts,
    audioName: stored.audioName,
    coverName: stored.coverName,
    ...(stored.audioBlob ? { audioBlob: stored.audioBlob } : {}),
    ...(stored.coverBlob ? { coverBlob: stored.coverBlob } : {}),
  };
}

export class IndexedDbProjectBackend implements ChartProjectBackend {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) this.dbPromise = openDb();
    return this.dbPromise;
  }

  async get(id: string): Promise<ChartProject | null> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(fromStored(req.result));
      req.onerror = () => reject(req.error);
    });
  }

  async save(project: ChartProject): Promise<void> {
    const db = await this.db();
    const existing = await this.rawGet(db, project.id);
    if (!canReplaceStoredProject(existing)) {
      throw new Error(`拒绝覆盖旧 schema 工程: ${JSON.stringify(project.id)}`);
    }
    const record: StoredProject = { ...project, schemaVersion: PROJECT_SCHEMA_VERSION };
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async list(): Promise<ChartProject[]> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        const rows = (req.result as unknown[]).map(fromStored).filter((p): p is ChartProject => p != null);
        resolve(rows.map((p) => {
          const { audioBlob: _audio, ...rest } = p;
          return rest;
        }));
      };
      req.onerror = () => reject(req.error);
    });
  }

  async delete(id: string): Promise<void> {
    const db = await this.db();
    const existing = await this.rawGet(db, id);
    if (!canReplaceStoredProject(existing)) {
      throw new Error(`拒绝删除旧 schema 工程: ${JSON.stringify(id)}`);
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private rawGet(db: IDBDatabase, id: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }
}

/* ------------------------------------------------------------------ */
/* Electron 文件后端                                                    */
/* ------------------------------------------------------------------ */

function getElectronProjectBridge(): ElectronProjectBridge | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as { electronAPI?: { projectStore?: ElectronProjectBridge } }).electronAPI;
  return api?.projectStore ?? null;
}

export class ElectronFileProjectBackend implements ChartProjectBackend {
  /** 按工程记住上次落盘的 Blob 身份；相同 ⇒ keep，避免防抖保存重传大文件 */
  private lastWrittenAudio = new Map<string, Blob | null>();
  private lastWrittenCover = new Map<string, Blob | null>();
  private bridge: ElectronProjectBridge;

  constructor(bridge: ElectronProjectBridge) {
    this.bridge = bridge;
  }

  async get(id: string): Promise<ChartProject | null> {
    assertValidProjectId(id);
    const wire = await this.bridge.get(id);
    if (!wire?.doc || !isCurrentProjectSchema(wire.doc)) return null;
    const project = projectFromDoc(id, wire.doc, wire.audio, wire.cover);
    this.lastWrittenAudio.set(id, project.audioBlob ?? null);
    this.lastWrittenCover.set(id, project.coverBlob ?? null);
    return project;
  }

  async save(project: ChartProject): Promise<void> {
    assertValidProjectId(project.id);
    const prevAudio = this.lastWrittenAudio.get(project.id) ?? null;
    const prevCover = this.lastWrittenCover.get(project.id) ?? null;
    const audio = await blobIntent(project.audioBlob, prevAudio);
    const cover = await blobIntent(project.coverBlob, prevCover);
    this.lastWrittenAudio.set(project.id, audio.next);
    this.lastWrittenCover.set(project.id, cover.next);
    try {
      await this.bridge.put({
        id: project.id,
        doc: toPutDoc(project, audio.intent, cover.intent),
        ...(audio.bytes != null ? { audio: audio.bytes } : {}),
        ...(cover.bytes != null ? { cover: cover.bytes } : {}),
      });
    } catch (err) {
      this.lastWrittenAudio.set(project.id, prevAudio);
      this.lastWrittenCover.set(project.id, prevCover);
      throw err;
    }
  }

  async list(): Promise<ChartProject[]> {
    const items = await this.bridge.list();
    return items
      .filter((item) => isCurrentProjectSchema(item.doc))
      .map((item) => projectFromDoc(item.id, item.doc, null, item.cover ?? null));
  }

  async delete(id: string): Promise<void> {
    assertValidProjectId(id);
    await this.bridge.delete(id);
    this.lastWrittenAudio.delete(id);
    this.lastWrittenCover.delete(id);
  }
}

/* ------------------------------------------------------------------ */
/* 门面                                                                 */
/* ------------------------------------------------------------------ */

function autoDetectBackend(): ChartProjectBackend {
  const bridge = getElectronProjectBridge();
  return bridge ? new ElectronFileProjectBackend(bridge) : new IndexedDbProjectBackend();
}

export class ChartProjectStore {
  private backend: ChartProjectBackend;
  private lastOpenedFloor = new Map<string, number>();
  /**
   * 本会话内每个工程"当前生效"的封面 Blob 实例（chart-projects 21）。
   *
   * 封面 objectURL 缓存按 **Blob 身份** 命中（issue 19 #3：进详情不闪），但两个后端每次读回都会
   * 给出**新的 Blob 对象**（IndexedDB `getAll()` 反序列化 / Electron `blobFromBytes`）——
   * 不顶回来的话，每次 mutate → reload → `list()` 后所有封面缓存全部未命中：重新 createObjectURL
   * 再重新解码，表现为"一编辑所有封面闪一下"。
   *
   * 尺寸不变即认为字节没变、沿用同一实例；尺寸变了（用户换了封面）以新读到的为准并更新记忆。
   * 已知盲区：别的进程/窗口把封面换成"同名同尺寸的另一张图"时本会话察觉不到（要等重启）；
   * 本应用自己换封面走 `save()`，会即时更新记忆，不影响。
   */
  private coverInstances = new Map<string, Blob>();

  constructor(backend: ChartProjectBackend = autoDetectBackend()) {
    this.backend = backend;
  }

  async get(id: string): Promise<ChartProject | null> {
    const project = await this.backend.get(id);
    if (project) {
      this.lastOpenedFloor.set(id, Math.max(this.lastOpenedFloor.get(id) ?? 0, project.lastOpened));
      return this.stabilizeCover(project);
    }
    return project;
  }

  save(project: ChartProject): Promise<void> {
    const floor = this.lastOpenedFloor.get(project.id) ?? 0;
    const lastOpened = Math.max(floor, project.lastOpened);
    this.lastOpenedFloor.set(project.id, lastOpened);
    const stable = this.stabilizeCover(project);
    return this.backend.save(lastOpened === stable.lastOpened ? stable : { ...stable, lastOpened });
  }

  async list(): Promise<ChartProject[]> {
    const listed = await this.backend.list();
    return listed.map((project) => this.stabilizeCover(project));
  }

  delete(id: string): Promise<void> {
    this.lastOpenedFloor.delete(id);
    this.coverInstances.delete(id);
    return this.backend.delete(id);
  }

  /** 读/写路径共用的封面实例稳定化：返回的工程一定带着"本会话认得的那个"封面 Blob 实例。 */
  private stabilizeCover(project: ChartProject): ChartProject {
    const fresh = project.coverBlob;
    if (!fresh || fresh.size === 0) {
      this.coverInstances.delete(project.id);
      return project;
    }
    const known = this.coverInstances.get(project.id);
    if (!known || known.size !== fresh.size) {
      this.coverInstances.set(project.id, fresh);
      return project;
    }
    return known === fresh ? project : { ...project, coverBlob: known };
  }
}
