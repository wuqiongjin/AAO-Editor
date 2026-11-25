// 谱面工程持久化（ADR-0005 §6 / ADR-0015 §1、§5）：
// 谱面工程 = 工程信息 + 音频 + 封面 + 谱面时长 + 1..n 张谱面 + 可选自定义表演背景。
// 后端按环境自动切换：Electron 走数据根文件，浏览器走 IndexedDB。
// 未发布：schemaVersion 保持 1。旧 default（顶层 notes、无 charts）不读、不删；无 IndexedDB→文件迁移。
// 文件布局（<数据根>/projects/<id>/）：
//   project.json = { schemaVersion, 工程信息, durationSeconds, lastOpened, charts, audioName, coverName,
//                    audioPresent, coverPresent, liveBgPresent, liveBgName, liveBgMime, liveBgUseCustom, liveBgFit }
//   audio.bin / cover.bin / liveBg.bin = 与 JSON 分离的字节（仅在 set 时重写）
//   liveBg.bin 只在预览 / 导出读；get() / list() 不带像素（票 42 / ADR-0018 §4）
// 记录形状、映射（工程 ↔ wire / stored）与唯一写入口在 ChartProjectRecord.ts（架构评审候选 2）。
import type { ChartNote } from '../chart/types';
import { countChartNotes } from '../chart/editing/NoteEditing';
import { getElectronAPI } from '../app/electronBridge';
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
  type ProjectSummaryWire,
  type ProjectUploadRefs,
  type StoredProjectRecord,
} from './ChartProjectRecord';
import { projectHasLiveBg, type LiveBgFit } from './liveBgImport';

export type ChartDifficulty = 0 | 1 | 2 | 3 | 4;

export type SongSource =
  | { type: 'custom' }
  | { type: 'bandori'; id: number };

export interface ChartUploadRecord {
  postId: number;
  at: number;
  /** 上传者账号名（铺路：多账号与所有权判断用，可选以兼容历史记录） */
  username?: string;
}

/** 社区帖标签（票 51）：自由文本芯片，wire 形态 `{type:"text", data}` */
export interface ChartTag {
  type: 'text';
  data: string;
}

/** 发帖前保存，直到确认未建帖或补写上传记录。 */
export interface PendingChartPublish {
  attemptId: string;
  at: number;
  username: string;
  song: import('../community/bestdori/publish').PostSongBody;
  chartDigest: string;
  tags: ChartTag[];
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
  pendingPublish?: PendingChartPublish;
  lastModified: number;
  appliedChartCodeText: string | null;
  chartCodePristine: boolean;
  /** 发布描述草稿（票 42 Q3 / 票 51 Q13）：随谱面持久化，复制带上，发布成功后保留 */
  publishDraft?: string | null;
  /** 社区帖标签（票 51 Q3/Q8）：空数组合法；复制带走，发布后不清 */
  tags?: ChartTag[];
  /**
   * 谱师署名（票 79 / ADR-0024 §2）：谱面级、只服务导出画面，可含多位作者（自由文本）。
   * 新建谱面时取当前登录账号的 `nickname ?? username` 落值；老谱面缺字段 = 空，只能手填。
   * **不是** Bestdori 社区帖作者（那是「谱师」），也不会从导入帖的 charter 带入。
   */
  charterCredit?: string | null;
}

export interface ChartProject {
  id: string;
  name: string | null;
  artist: string | null;
  /** 曲目署名（票 79）：工程级、只服务导出画面；空值不画 */
  lyricist?: string | null;
  composer?: string | null;
  arranger?: string | null;
  source: SongSource;
  durationSeconds: number;
  lastOpened: number;
  charts: ProjectChart[];
  audioName: string | null;
  audioBlob?: Blob;
  coverName: string | null;
  coverBlob?: Blob;
  /**
   * 自定义表演背景（票 42 / ADR-0018 §4）：工程级 sidecar。
   * `get()` / `list()` **不带** `liveBgBlob`；像素走 `getLiveBg`。
   * `liveBgBlob` 只在刚上传、尚未落盘时作为写缓冲。
   */
  liveBgName?: string | null;
  liveBgMime?: string | null;
  liveBgUseCustom?: boolean;
  liveBgFit?: LiveBgFit;
  liveBgBlob?: Blob;
}

/** 目录 / 列表用轻量谱面摘要（chart-projects 44）：剥离 notes / 源码文本 / 草稿 / 标签 */
export interface ChartSummary {
  id: string;
  title: string | null;
  diff: ChartDifficulty;
  level: number | null;
  completed: boolean;
  upload: ChartUploadRecord | null;
  pendingPublish?: true;
  lastModified: number;
  noteCount: number;
}

/** 目录 / 列表用轻量工程摘要（chart-projects 44）：Electron 走封面协议，Web 保留 coverBlob 降级 */
export interface ProjectSummary {
  id: string;
  name: string | null;
  artist: string | null;
  source: SongSource;
  durationSeconds: number;
  lastOpened: number;
  charts: ChartSummary[];
  audioName: string | null;
  coverName: string | null;
  audioPresent: boolean;
  coverPresent: boolean;
  coverVersion?: string | null;
  coverBlob?: Blob;
}

export function summarizeChart(chart: ProjectChart): ChartSummary {
  return {
    id: chart.id,
    title: chart.title,
    diff: chart.diff,
    level: chart.level,
    completed: chart.completed,
    upload: chart.upload,
    ...(chart.pendingPublish ? { pendingPublish: true } : {}),
    lastModified: chart.lastModified,
    noteCount: countChartNotes(chart.notes),
  };
}

export function summarizeProject(project: ChartProject): ProjectSummary {
  const coverBlob = project.coverBlob && project.coverBlob.size > 0 ? project.coverBlob : undefined;
  return {
    id: project.id,
    name: project.name,
    artist: project.artist,
    source: project.source,
    durationSeconds: project.durationSeconds,
    lastOpened: project.lastOpened,
    charts: project.charts.map(summarizeChart),
    audioName: project.audioName,
    coverName: project.coverName,
    audioPresent: Boolean(project.audioBlob && project.audioBlob.size > 0) || project.audioName != null,
    coverPresent: Boolean(coverBlob),
    coverVersion: null,
    ...(coverBlob ? { coverBlob } : {}),
  };
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
  /** 复制工程：从这份工程 id 拷 `liveBg.bin` / IDB sidecar（字节不过 IPC） */
  liveBgCopyFrom?: string;
}

export interface ChartProjectBackend {
  get(id: string): Promise<ChartProject | null>;
  /** `staged`：这份二进制来自素材缓存，由主进程从缓存拷进工程（字节不过 IPC） */
  save(project: ChartProject, staged?: ProjectBinarySources): Promise<void>;
  list(): Promise<ProjectSummary[]>;
  getSummary?(id: string): Promise<ProjectSummary | null>;
  touchLastOpened?(id: string, now: number): Promise<boolean>;
  delete(id: string): Promise<void>;
  /** 自定义表演背景 sidecar（票 42）；get/list 不带。缺实现 = 没有这份图。 */
  getLiveBg?(id: string): Promise<Blob | null>;
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

const DB_NAME = 'aao.chartproject';
/** v2：独立 `liveBg` object store（票 42：像素不进工程记录，list 的 getAll 碰不到） */
const DB_VERSION = 2;
const STORE = 'projects';
const LIVE_BG_STORE = 'liveBg';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(LIVE_BG_STORE)) {
        db.createObjectStore(LIVE_BG_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGetLiveBg(db: IDBDatabase, id: string): Promise<Blob | null> {
  if (!db.objectStoreNames.contains(LIVE_BG_STORE)) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LIVE_BG_STORE, 'readonly');
    const req = tx.objectStore(LIVE_BG_STORE).get(id);
    req.onsuccess = () => {
      const row = req.result as { blob?: Blob } | undefined;
      resolve(row?.blob instanceof Blob ? row.blob : null);
    };
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
    const copyFrom = staged.liveBgCopyFrom;
    const copied = copyFrom ? await idbGetLiveBg(db, copyFrom) : null;
    const nextBlob = project.liveBgBlob ?? copied ?? null;
    const clearSidecar = !projectHasLiveBg(project) && !nextBlob;
    return new Promise((resolve, reject) => {
      const names = db.objectStoreNames.contains(LIVE_BG_STORE) ? [STORE, LIVE_BG_STORE] : [STORE];
      const tx = db.transaction(names, 'readwrite');
      tx.objectStore(STORE).put(record);
      if (names.includes(LIVE_BG_STORE)) {
        const live = tx.objectStore(LIVE_BG_STORE);
        if (nextBlob) live.put({ id: project.id, blob: nextBlob });
        else if (clearSidecar) live.delete(project.id);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async list(): Promise<ProjectSummary[]> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        const rows = (req.result as unknown[]).map(projectFromStored).filter((p): p is ChartProject => p != null);
        resolve(rows.map((p) => summarizeProject(p)));
      };
      req.onerror = () => reject(req.error);
    });
  }

  async getSummary(id: string): Promise<ProjectSummary | null> {
    const project = await this.get(id);
    return project ? summarizeProject(project) : null;
  }

  async touchLastOpened(id: string, now: number): Promise<boolean> {
    const db = await this.db();
    const existing = await this.rawGet(db, id);
    if (!isCurrentProjectSchema(existing)) return false;
    const record = { ...(existing as StoredProjectRecord), lastOpened: now };
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async delete(id: string): Promise<void> {
    const db = await this.db();
    const existing = await this.rawGet(db, id);
    if (!canReplaceStoredProject(existing)) {
      throw new Error(`拒绝删除旧 schema 工程: ${JSON.stringify(id)}`);
    }
    return new Promise((resolve, reject) => {
      const names = db.objectStoreNames.contains(LIVE_BG_STORE) ? [STORE, LIVE_BG_STORE] : [STORE];
      const tx = db.transaction(names, 'readwrite');
      tx.objectStore(STORE).delete(id);
      if (names.includes(LIVE_BG_STORE)) tx.objectStore(LIVE_BG_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getLiveBg(id: string): Promise<Blob | null> {
    const db = await this.db();
    return idbGetLiveBg(db, id);
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
  return getElectronAPI()?.projectStore ?? null;
}

/** get/list 出口剥掉写缓冲：自定义背景像素只走 getLiveBg */
function stripLiveBgBlob(project: ChartProject): ChartProject {
  if (!('liveBgBlob' in project) || project.liveBgBlob == null) return project;
  const { liveBgBlob: _drop, ...rest } = project;
  return rest;
}

/**
 * 工程音频 / 封面的上传引用（票 11：发布时的三步二进制上传用）。
 * 没有桥（浏览器 / 静态演示版）回 null —— 发布链路在那边整体不可用，调用方按
 * 「没有出口」处理，不在这里分叉。字节不过 IPC：回的是路径 + 字节数 + SHA-1。
 */
export function getProjectUploadRefs(projectId: string): Promise<ProjectUploadRefs | null> {
  const bridge = getElectronProjectBridge();
  return bridge ? bridge.uploadRefs(projectId) : Promise.resolve(null);
}

function summaryFromWire(wire: ProjectSummaryWire): ProjectSummary {
  const source: SongSource = wire.source && typeof wire.source === 'object' && wire.source.type === 'bandori'
    && typeof (wire.source as { id?: unknown }).id === 'number'
    ? { type: 'bandori', id: (wire.source as { id: number }).id }
    : { type: 'custom' };
  return {
    id: wire.id,
    name: wire.name ?? null,
    artist: wire.artist ?? null,
    source,
    durationSeconds: wire.durationSeconds,
    lastOpened: wire.lastOpened,
    audioName: wire.audioName ?? null,
    coverName: wire.coverName ?? null,
    audioPresent: Boolean(wire.audioPresent),
    coverPresent: Boolean(wire.coverPresent),
    coverVersion: wire.coverVersion ?? null,
    charts: (wire.charts ?? []).map((c) => ({
      id: c.id,
      title: c.title ?? null,
      diff: c.diff,
      level: c.level ?? null,
      completed: Boolean(c.completed),
      upload: c.upload ?? null,
      ...(c.pendingPublish ? { pendingPublish: true as const } : {}),
      lastModified: c.lastModified,
      noteCount: c.noteCount,
    })),
  };
}

async function liveBgWriteIntent(
  project: ChartProject,
  stagedPath: string | undefined,
  lastWritten: RememberedBinary,
): Promise<{ intent: BinaryIntent; bytes?: Uint8Array; copyFrom?: string; next: RememberedBinary }> {
  if (stagedPath != null && stagedPath !== '') {
    return { intent: 'set', copyFrom: stagedPath, next: STAGED_ON_DISK };
  }
  if (project.liveBgBlob) {
    if (project.liveBgBlob === lastWritten) return { intent: 'keep', next: lastWritten };
    return { intent: 'set', bytes: new Uint8Array(await project.liveBgBlob.arrayBuffer()), next: project.liveBgBlob };
  }
  if (!projectHasLiveBg(project)) return { intent: 'cleared', next: null };
  return { intent: 'keep', next: lastWritten === STAGED_ON_DISK ? STAGED_ON_DISK : lastWritten };
}

export class ElectronFileProjectBackend implements ChartProjectBackend {
  /** 按工程记住上次落盘的 Blob 身份；相同 ⇒ keep，避免防抖保存重传大文件（暂存写进来的见 STAGED_ON_DISK） */
  private lastWrittenAudio = new Map<string, RememberedBinary>();
  private lastWrittenCover = new Map<string, RememberedBinary>();
  private lastWrittenLiveBg = new Map<string, RememberedBinary>();
  private bridge: ElectronProjectBridge;

  constructor(bridge: ElectronProjectBridge) {
    this.bridge = bridge;
  }

  async get(id: string): Promise<ChartProject | null> {
    assertValidProjectId(id);
    const wire = await this.bridge.get(id);
    if (!wire?.doc) return null;
    const doc = typeof wire.doc === 'string'
      ? (JSON.parse(wire.doc) as import('./ChartProjectRecord').ProjectRecordDoc)
      : wire.doc;
    if (!isCurrentProjectSchema(doc)) return null;
    const project = projectFromRecord(id, doc, wire.audio, wire.cover);
    this.lastWrittenAudio.set(id, project.audioBlob ?? null);
    this.lastWrittenCover.set(id, project.coverBlob ?? null);
    this.lastWrittenLiveBg.set(id, wire.doc.liveBgPresent ? STAGED_ON_DISK : null);
    return project;
  }

  async getSummary(id: string): Promise<ProjectSummary | null> {
    assertValidProjectId(id);
    if (this.bridge.getSummary) {
      const raw = await this.bridge.getSummary(id);
      if (raw == null) return null;
      return summaryFromWire(JSON.parse(raw) as ProjectSummaryWire);
    }
    const project = await this.get(id);
    return project ? summarizeProject(project) : null;
  }

  async touchLastOpened(id: string, now: number): Promise<boolean> {
    assertValidProjectId(id);
    if (this.bridge.touchLastOpened) {
      return this.bridge.touchLastOpened(id, now);
    }
    const project = await this.get(id);
    if (!project) return false;
    await this.save({ ...project, lastOpened: now });
    return true;
  }

  async save(project: ChartProject, staged: ProjectBinarySources = {}): Promise<void> {
    assertValidProjectId(project.id);
    const prevAudio = this.lastWrittenAudio.get(project.id) ?? null;
    const prevCover = this.lastWrittenCover.get(project.id) ?? null;
    const prevLive = this.lastWrittenLiveBg.get(project.id) ?? null;
    const audio = await binaryIntent(project.audioBlob, staged.audioStagedPath, prevAudio);
    const cover = await binaryIntent(project.coverBlob, staged.coverStagedPath, prevCover);
    const liveBg = await liveBgWriteIntent(project, staged.liveBgCopyFrom, prevLive);
    this.lastWrittenAudio.set(project.id, audio.next);
    this.lastWrittenCover.set(project.id, cover.next);
    this.lastWrittenLiveBg.set(project.id, liveBg.next);
    try {
      await this.bridge.put({
        id: project.id,
        doc: recordFromProject(project, audio.intent, cover.intent, liveBg.intent),
        ...(audio.bytes != null ? { audio: audio.bytes } : {}),
        ...(audio.stagedPath != null ? { audioStagedPath: audio.stagedPath } : {}),
        ...(cover.bytes != null ? { cover: cover.bytes } : {}),
        ...(cover.stagedPath != null ? { coverStagedPath: cover.stagedPath } : {}),
        ...(liveBg.bytes != null ? { liveBg: liveBg.bytes } : {}),
        ...(liveBg.copyFrom != null ? { liveBgCopyFrom: liveBg.copyFrom } : {}),
      });
    } catch (err) {
      this.lastWrittenAudio.set(project.id, prevAudio);
      this.lastWrittenCover.set(project.id, prevCover);
      this.lastWrittenLiveBg.set(project.id, prevLive);
      throw err;
    }
  }

  async list(): Promise<ProjectSummary[]> {
    const raw = await this.bridge.list();
    if (typeof raw === 'string') {
      const wires = JSON.parse(raw) as ProjectSummaryWire[];
      return wires.map(summaryFromWire);
    }
    return raw
      .filter((item) => isCurrentProjectSchema(item.doc))
      .map((item) => summarizeProject(projectFromRecord(item.id, item.doc, null, item.cover ?? null)));
  }

  async delete(id: string): Promise<void> {
    assertValidProjectId(id);
    await this.bridge.delete(id);
    this.lastWrittenAudio.delete(id);
    this.lastWrittenCover.delete(id);
    this.lastWrittenLiveBg.delete(id);
  }

  async getLiveBg(id: string): Promise<Blob | null> {
    assertValidProjectId(id);
    const bytes = await this.bridge.getLiveBg(id);
    if (!bytes || bytes.byteLength === 0) return null;
    return new Blob([new Uint8Array(bytes)]);
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
  private listInFlight: Promise<ProjectSummary[]> | null = null;

  constructor(backend: ChartProjectBackend = autoDetectBackend()) {
    this.backend = backend;
  }

  async get(id: string): Promise<ChartProject | null> {
    const project = await this.backend.get(id);
    if (project) {
      this.lastOpenedFloor.set(id, Math.max(this.lastOpenedFloor.get(id) ?? 0, project.lastOpened));
      return this.stabilizeCover(stripLiveBgBlob(project));
    }
    return project;
  }

  async getSummary(id: string): Promise<ProjectSummary | null> {
    const summary = this.backend.getSummary
      ? await this.backend.getSummary(id)
      : await this.backend.get(id).then((p) => (p ? summarizeProject(p) : null));
    if (summary) {
      this.lastOpenedFloor.set(id, Math.max(this.lastOpenedFloor.get(id) ?? 0, summary.lastOpened));
      return this.stabilizeCover(summary);
    }
    return null;
  }

  async touchLastOpened(id: string, now: number): Promise<boolean> {
    let ok: boolean;
    if (this.backend.touchLastOpened) {
      ok = await this.backend.touchLastOpened(id, now);
    } else {
      const existing = await this.backend.get(id);
      if (!existing) return false;
      const floor = this.lastOpenedFloor.get(id) ?? 0;
      await this.backend.save({ ...existing, lastOpened: Math.max(floor, existing.lastOpened, now) });
      ok = true;
    }
    if (ok) {
      this.lastOpenedFloor.set(id, Math.max(this.lastOpenedFloor.get(id) ?? 0, now));
    }
    return ok;
  }

  getLiveBg(id: string): Promise<Blob | null> {
    return this.backend.getLiveBg?.(id) ?? Promise.resolve(null);
  }

  save(project: ChartProject, staged?: ProjectBinarySources): Promise<void> {
    const floor = this.lastOpenedFloor.get(project.id) ?? 0;
    const lastOpened = Math.max(floor, project.lastOpened);
    this.lastOpenedFloor.set(project.id, lastOpened);
    const stable = this.stabilizeCover(project);
    return this.backend.save(lastOpened === stable.lastOpened ? stable : { ...stable, lastOpened }, staged);
  }

  list(): Promise<ProjectSummary[]> {
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

  /**
   * 作废按工程 id 记的会话内派生值（chart-projects 39，切换数据根时调）。
   *
   * `lastOpenedFloor`（save 的时间戳下限）与 `coverInstances`（封面 Blob 稳定器）都按 id 记、
   * 且只在 delete 时清理。切换数据根后，新旧目录可能出现**同 id 工程**（拷贝 / 备份出来的目录）——
   * 不丢的话：封面稳定器把旧根的 Blob 实例漏给新盘（同名同尺寸即漏，issue 21 的盲区在这里显形），
   * lastOpenedFloor 把旧根的时间戳盖回新盘记录（污染排序键与 hero 选中锚）。
   * 根变换 = 整个目录的身份作废，必须显式清（与"别的进程改了封面"那种盲区不同）。
   */
  resetCatalogCaches(): void {
    this.lastOpenedFloor.clear();
    this.coverInstances.clear();
  }

  /** 读/写路径共用的封面实例稳定化：返回的工程一定带着"本会话认得的那个"封面 Blob 实例。 */
  private stabilizeCover<T extends { id: string; coverBlob?: Blob }>(project: T): T {
    const fresh = project.coverBlob;
    if (!fresh || fresh.size === 0) {
      // Electron 摘要不携带 coverBlob（由协议 URL 寻址），不能误删 get() 记下的实例；
      // 只在明确无封面时才清理（coverPresent === false 或完整 ChartProject 无 coverBlob）。
      const isElectronSummaryWithoutBlob = 'coverPresent' in project && (project as { coverPresent?: boolean }).coverPresent;
      if (!isElectronSummaryWithoutBlob) this.coverInstances.delete(project.id);
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
