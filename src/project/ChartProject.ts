// 谱面工程持久化（ADR-0005 §6 / ADR-0015 §1、§5）：
// 谱面工程 = 工程信息 + 音频 + 封面 + 谱面时长 + 1..n 张谱面。
// 后端按环境自动切换：Electron 走数据根文件，浏览器走 IndexedDB。
// 未发布：schemaVersion 保持 1。旧 default（顶层 notes、无 charts）不读、不删；无 IndexedDB→文件迁移。
// 文件布局（<数据根>/projects/<id>/）：
//   project.json = { schemaVersion, 工程信息, durationSeconds, lastOpened, charts, audioName, coverName, audioPresent, coverPresent }
//   audio.bin / cover.bin = 与 JSON 分离的字节（仅在 set 时重写）
// 记录形状、映射（工程 ↔ wire / stored）与唯一写入口在 ChartProjectRecord.ts（架构评审候选 2）。
import type { ChartNote } from '../chart/types';
import {
  assertValidProjectId,
  canReplaceStoredProject,
  isCurrentProjectSchema,
  projectFromRecord,
  projectFromStored,
  recordFromProject,
  storedFromProject,
  type BinaryIntent,
  type ElectronProjectBridge,
} from './ChartProjectRecord';

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

/**
 * 一次落盘里「这份二进制从素材缓存来」的声明：值是主进程网关给的缓存文件路径
 * （`<数据根>/cache/community/` 里的那一个；票 07 只回路径不回字节，票 14 起落点是素材缓存）。
 *
 * 名字不在这里：`audioName` / `coverName` 是**工程记录**的字段，由工程对象自己带
 * （见 `OfficialProjectInput`）——缓存只是字节的来路。
 *
 * 命名对账（票 14 记）：字段名仍带 `Staged`（07 时代的叫法），收口留给后续 chore，先不动线形状。
 */
export interface ProjectBinarySources {
  audioStagedPath?: string;
  coverStagedPath?: string;
}

export interface ChartProjectBackend {
  get(id: string): Promise<ChartProject | null>;
  /** `staged`：这份二进制来自素材缓存，由主进程从缓存拷进工程（字节不过 IPC） */
  save(project: ChartProject, staged?: ProjectBinarySources): Promise<void>;
  list(): Promise<ChartProject[]>;
  delete(id: string): Promise<void>;
}

export function newChartId(): string {
  return `c${crypto.randomUUID().replace(/-/g, '')}`;
}

export function newProjectId(): string {
  return `p${crypto.randomUUID().replace(/-/g, '')}`;
}

/**
 * 「盘上那份二进制现在是什么」的记忆：真实 Blob / 没有 / **有但手里没字节**。
 * 第三种是缓存导入留下的——主进程已经把缓存文件拷进工程，本会话没有它的 Blob；
 * 这时再来一次「不带 blob 的 save」（比如改了工程名）语义是 keep 而不是 clear，
 * 否则会在下一次保存时把刚导入的音频 / 封面抹掉。
 */
const STAGED_ON_DISK = Symbol('staged-binary-on-disk');
type RememberedBinary = Blob | null | typeof STAGED_ON_DISK;

/** 一次 save 的二进制意图：缓存路径 > 手里的 Blob > 沿用盘上那份（见 STAGED_ON_DISK） */
async function binaryIntent(
  blob: Blob | undefined,
  stagedPath: string | undefined,
  lastWritten: RememberedBinary,
): Promise<{ intent: BinaryIntent; bytes?: Uint8Array; stagedPath?: string; next: RememberedBinary }> {
  if (stagedPath != null && stagedPath !== '') return { intent: 'set', stagedPath, next: STAGED_ON_DISK };
  if (blob == null) {
    return lastWritten === STAGED_ON_DISK
      ? { intent: 'keep', next: STAGED_ON_DISK }
      : { intent: 'cleared', next: null };
  }
  if (blob === lastWritten) return { intent: 'keep', next: lastWritten };
  return { intent: 'set', bytes: new Uint8Array(await blob.arrayBuffer()), next: blob };
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
      req.onsuccess = () => resolve(projectFromStored(req.result));
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * 浏览器后端**不支持**素材缓存导入：缓存文件在主进程的数据根里，渲染进程读不到字节
   * （官方 / 社区导入这两支在静态演示版本就被隐藏，走到这里说明接线错了，宁可炸也不静默丢素材）。
   */
  async save(project: ChartProject, staged: ProjectBinarySources = {}): Promise<void> {
    if (staged.audioStagedPath || staged.coverStagedPath) {
      throw new Error('浏览器后端不支持从素材缓存导入素材');
    }
    const db = await this.db();
    const existing = await this.rawGet(db, project.id);
    if (!canReplaceStoredProject(existing)) {
      throw new Error(`拒绝覆盖旧 schema 工程: ${JSON.stringify(project.id)}`);
    }
    const record = storedFromProject(project);
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
        const rows = (req.result as unknown[]).map(projectFromStored).filter((p): p is ChartProject => p != null);
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
  /** 按工程记住上次落盘的 Blob 身份；相同 ⇒ keep，避免防抖保存重传大文件（暂存写进来的见 STAGED_ON_DISK） */
  private lastWrittenAudio = new Map<string, RememberedBinary>();
  private lastWrittenCover = new Map<string, RememberedBinary>();
  private bridge: ElectronProjectBridge;

  constructor(bridge: ElectronProjectBridge) {
    this.bridge = bridge;
  }

  async get(id: string): Promise<ChartProject | null> {
    assertValidProjectId(id);
    const wire = await this.bridge.get(id);
    if (!wire?.doc || !isCurrentProjectSchema(wire.doc)) return null;
    const project = projectFromRecord(id, wire.doc, wire.audio, wire.cover);
    this.lastWrittenAudio.set(id, project.audioBlob ?? null);
    this.lastWrittenCover.set(id, project.coverBlob ?? null);
    return project;
  }

  async save(project: ChartProject, staged: ProjectBinarySources = {}): Promise<void> {
    assertValidProjectId(project.id);
    const prevAudio = this.lastWrittenAudio.get(project.id) ?? null;
    const prevCover = this.lastWrittenCover.get(project.id) ?? null;
    const audio = await binaryIntent(project.audioBlob, staged.audioStagedPath, prevAudio);
    const cover = await binaryIntent(project.coverBlob, staged.coverStagedPath, prevCover);
    this.lastWrittenAudio.set(project.id, audio.next);
    this.lastWrittenCover.set(project.id, cover.next);
    try {
      await this.bridge.put({
        id: project.id,
        doc: recordFromProject(project, audio.intent, cover.intent),
        ...(audio.bytes != null ? { audio: audio.bytes } : {}),
        ...(audio.stagedPath != null ? { audioStagedPath: audio.stagedPath } : {}),
        ...(cover.bytes != null ? { cover: cover.bytes } : {}),
        ...(cover.stagedPath != null ? { coverStagedPath: cover.stagedPath } : {}),
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
      .map((item) => projectFromRecord(item.id, item.doc, null, item.cover ?? null));
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
  /**
   * 进行中的 list()（issue 29）：启动预载与工程页挂载常在同一窗口里各发起一次，合并成一次读盘 --
   * 慢盘时页面直接共享预载那次的结果，不必等自己再读一遍。
   *
   * **只在"进行中"合并**（settle 后即清空，不留结果缓存）：编辑后的 reload 仍读到新数据，
   * 也躲开了"另一个窗口改了工程、本会话看不见"的陈旧风险。
   */
  private listInFlight: Promise<ChartProject[]> | null = null;

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

  save(project: ChartProject, staged?: ProjectBinarySources): Promise<void> {
    const floor = this.lastOpenedFloor.get(project.id) ?? 0;
    const lastOpened = Math.max(floor, project.lastOpened);
    this.lastOpenedFloor.set(project.id, lastOpened);
    const stable = this.stabilizeCover(project);
    return this.backend.save(lastOpened === stable.lastOpened ? stable : { ...stable, lastOpened }, staged);
  }

  list(): Promise<ChartProject[]> {
    if (this.listInFlight) return this.listInFlight;
    const pending = this.backend
      .list()
      .then((listed) => listed.map((project) => this.stabilizeCover(project)));
    this.listInFlight = pending;
    return pending.finally(() => {
      if (this.listInFlight === pending) this.listInFlight = null;
    });
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
