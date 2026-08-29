// 谱面工程持久化（ADR-0005 §2/§6，issue 25 存储后端 Electron 改造）：
// 谱面工程 = { 代码(notes) + 谱面时长(durationSeconds) + 音频(Blob 引用) }。
// 后端策略（issue 25 grill 定案）：**按环境自动切换**——Electron 环境（存在 window.electronAPI.projectStore）
// 用 userData 文件后端（主进程读写磁盘文件），浏览器环境用 IndexedDB；不新增设置项。
// 旧数据迁移（grill 定案）：Electron 下首次读取若文件后端无数据，自动把 IndexedDB 里的谱面工程
// 静默迁入文件后端；IndexedDB 原数据保留作备份，不删除。
// 文件布局（userData/projects/<id>/）：
//   project.json = { schemaVersion, durationSeconds, notes, audioName?, audioPresent }
//   audio.bin    = 音频原始字节（与 JSON 分离，仅在字节变化时重写，避免每次防抖保存重写大音频）
// 本模块接口抽象化；未来多谱面（issue 26）只是加条目 + 列表 UI，不改存储结构。
import type { ChartNote } from '../types';

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

/** project.json 的持久化文档结构（不含音频字节本体） */
export interface ProjectRecordDoc {
  schemaVersion: 1;
  durationSeconds: number;
  notes: ChartNote[];
  audioName: string | null;
  /** 磁盘上是否存在 audio.bin（get 据此决定是否读音频字节） */
  audioPresent: boolean;
}

/** 渲染进程 → 主进程 put 载荷 */
export interface ProjectPutWire {
  id: string;
  doc: Omit<ProjectRecordDoc, 'audioPresent'> & {
    /**
     * 本次保存对音频的意图：
     * - 'set'     音频有变化，audio 字段携带完整字节，主进程写入/替换 audio.bin；
     * - 'keep'    音频未变（Blob 对象同一实例），主进程不动磁盘上的 audio.bin；
     * - 'cleared' 用户清除了音频，主进程删除 audio.bin。
     */
    audioIntent: 'set' | 'keep' | 'cleared';
  };
  /** audioIntent='set' 时的音频原始字节 */
  audio?: Uint8Array;
}

/** 主进程 → 渲染进程 get 返回（null = 无数据） */
export interface ProjectGetWire {
  doc: ProjectRecordDoc;
  /** audio.bin 字节（Buffer 经结构化克隆到渲染侧为 Uint8Array）；doc.audioPresent=false 时为 null */
  audio: Uint8Array | null;
}

/** preload 注入的桥（electronAPI.projectStore） */
export interface ElectronProjectBridge {
  get(id: string): Promise<ProjectGetWire | null>;
  put(payload: ProjectPutWire): Promise<unknown>;
}

/** 存储后端统一接口（IndexedDB 与 Electron userData 文件后端皆实现之） */
export interface ChartProjectBackend {
  get(id: string): Promise<ChartProject | null>;
  save(project: ChartProject): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* IndexedDB 后端（原 issue 23 实现整体平移，行为不变）                  */
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

  async get(id: string = DEFAULT_PROJECT_ID): Promise<ChartProject | null> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve((req.result as ChartProject | undefined) ?? null);
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

/* ------------------------------------------------------------------ */
/* Electron userData 文件后端（issue 25）                               */
/* ------------------------------------------------------------------ */

function getElectronProjectBridge(): ElectronProjectBridge | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as { electronAPI?: { projectStore?: ElectronProjectBridge } }).electronAPI;
  return api?.projectStore ?? null;
}

/** 工程 id 合法性（与主进程安全校验同口径的双保险）：字母开头，仅字母数字 . _ -，≤64 位 */
function assertValidProjectId(id: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) {
    throw new Error(`非法的谱面工程 id: ${JSON.stringify(id)}`);
  }
}

/**
 * Electron userData 文件后端。
 *
 * 音频重写规避：编辑防抖保存每次都会带全量工程记录（含音频引用）；这里按「Blob 对象同一实例」
 * 判定音频未变（音频只在 importAudio/clearAudio 时产生新对象），未变时向主进程声明 'keep'，
 * 避免 ~40MB 音频每 800ms 重写一次。首启迁移/重启后首次保存会各自补发一次音频字节，属预期一次性成本。
 */
export class ElectronFileProjectBackend implements ChartProjectBackend {
  /** 最近一次确认落盘的音频实例；身份相同 ⇒ 下次保存走 'keep' */
  private lastWrittenAudio: Blob | null = null;
  private migrated = false;

  /** 桥接与旧数据来源（显式字段：erasableSyntaxOnly 禁用参数属性写法） */
  private bridge: ElectronProjectBridge;
  /** 首启迁移的旧数据来源；默认读 IndexedDB（Electron 内同样可用）。测试可注入假实现 */
  private legacyRead: (id: string) => Promise<ChartProject | null>;

  constructor(
    bridge: ElectronProjectBridge,
    legacyRead: (id: string) => Promise<ChartProject | null> = () =>
      new IndexedDbProjectBackend().get(),
  ) {
    this.bridge = bridge;
    this.legacyRead = legacyRead;
  }

  async get(id: string = DEFAULT_PROJECT_ID): Promise<ChartProject | null> {
    assertValidProjectId(id);
    await this.ensureMigratedOnce(id);
    const wire = await this.bridge.get(id);
    if (!wire || !wire.doc) return null;
    const doc = wire.doc;
    let audioBlob: Blob | undefined;
    if (wire.audio && wire.audio.byteLength > 0) {
      audioBlob = new Blob([new Uint8Array(wire.audio)]);
    }
    const project: ChartProject = {
      id,
      durationSeconds: doc.durationSeconds,
      notes: doc.notes ?? [],
      ...(doc.audioName != null ? { audioName: doc.audioName } : {}),
      ...(audioBlob ? { audioBlob } : {}),
    };
    // 记住重建出的音频实例：恢复后的自动保存将命中 'keep'，不会重复传字节
    this.lastWrittenAudio = audioBlob ?? null;
    return project;
  }

  async save(project: ChartProject): Promise<void> {
    assertValidProjectId(project.id);
    // 文档化快照以便失败回滚时恢复状态
    const prevAudioRef = this.lastWrittenAudio;
    let audioIntent: 'set' | 'keep' | 'cleared';
    let audioBytes: Uint8Array | undefined;
    const blob = project.audioBlob ?? null;
    if (blob == null) {
      audioIntent = 'cleared';
      this.lastWrittenAudio = null;
    } else if (blob === prevAudioRef) {
      audioIntent = 'keep';
    } else {
      audioBytes = new Uint8Array(await blob.arrayBuffer());
      audioIntent = 'set';
      this.lastWrittenAudio = blob;
    }
    try {
      await this.bridge.put({
        id: project.id,
        doc: {
          schemaVersion: 1,
          durationSeconds: project.durationSeconds,
          // IPC 结构化克隆不接受含函数/符号的对象；JSON 往返保证纯数据（与导出语义一致）
          notes: JSON.parse(JSON.stringify(project.notes)) as ChartNote[],
          audioName: project.audioName ?? null,
          audioIntent,
        },
        ...(audioBytes != null ? { audio: audioBytes } : {}),
      });
    } catch (err) {
      // 写入失败：还原缓存，让下次重试重新判定并补发音频字节
      this.lastWrittenAudio = prevAudioRef;
      throw err;
    }
  }

  /**
   * 首启静默迁移（grill 定案）：文件后端为空且 IndexedDB 有旧工程时迁入。
   * IndexedDB 原数据永久保留作备份；先查文件再决定是否迁，天然幂等、绝不覆盖已有文件数据。
   */
  private async ensureMigratedOnce(id: string): Promise<void> {
    if (this.migrated) return;
    this.migrated = true; // 无论结果如何本进程内只尝试一次，失败随下次保存自愈
    let existing: ProjectGetWire | null = null;
    try {
      existing = await this.bridge.get(id);
    } catch {
      return; // 文件后端不可用：交给本次 get 正常报错，不做迁移
    }
    if (existing && existing.doc) return; // 已有文件数据：不迁移
    let legacy: ChartProject | null = null;
    try {
      legacy = await this.legacyRead(id);
    } catch {
      return; // 无旧数据或 IDB 异常：静默跳过（全新安装的正常路径）
    }
    if (legacy && (legacy.notes.length > 0 || legacy.audioBlob || legacy.durationSeconds > 0)) {
      await this.save({ ...legacy, id }); // 走完整 set 流程携带音频字节
      this.lastWrittenAudio = legacy.audioBlob ?? null; // 紧接着的常规保存应命中 'keep'
    }
  }
}

/* ------------------------------------------------------------------ */
/* 门面：保持既有 API（Editor 无需改动），内部委托所选后端               */
/* ------------------------------------------------------------------ */

function autoDetectBackend(): ChartProjectBackend {
  const bridge = getElectronProjectBridge();
  return bridge ? new ElectronFileProjectBackend(bridge) : new IndexedDbProjectBackend();
}

/** 谱面工程存储门面。默认按环境自动选择后端；测试可显式注入 backend。 */
export class ChartProjectStore {
  private backend: ChartProjectBackend;

  constructor(backend: ChartProjectBackend = autoDetectBackend()) {
    this.backend = backend;
  }

  get(id: string = DEFAULT_PROJECT_ID): Promise<ChartProject | null> {
    return this.backend.get(id);
  }

  save(project: ChartProject): Promise<void> {
    return this.backend.save(project);
  }
}
