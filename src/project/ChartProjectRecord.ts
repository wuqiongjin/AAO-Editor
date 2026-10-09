// 工程记录：形状、映射与写入口的唯一拥有者（架构评审候选 2 / ADR-0015 §1、§5）。
//
// 一份工程在存储里有三种表示，映射只在**本文件**：
//   - wire doc：Electron 文件后端（<数据根>/projects/<id>/project.json，带 audioPresent / coverPresent）；
//   - put 载荷：渲染进程 → 主进程（doc + audioIntent / coverIntent，见 ProjectPutWire）；
//   - stored record：IndexedDB 记录（ChartProject 原样 + schemaVersion，Blob 与记录内联）。
// 加字段 = 实体接口 + 本文件 RECORD_FIELDS 一张表；任写少一个方向都过不了 `satisfies`。
//
// 写入口：mutateProject 是记录侧「整记录读-改-写」的唯一一处（flush → get → fn → save → notify），
// 五处调用点 + 当前工程会话的 open 都走它。次序约束从各调用点的注解搬进这里；
// 调用点自己的下一步（reload / setState / open）留在原地。
import type { ChartProject, ProjectChart, SongSource } from './ChartProject';

export const PROJECT_SCHEMA_VERSION = 1 as const;

export type BinaryIntent = 'set' | 'keep' | 'cleared';

/** 落盘的工程文档（project.json 去掉 intent / 补上 present 后的形状）。 */
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

/** 渲染进程 → 主进程 put 载荷 */
export interface ProjectPutWire {
  id: string;
  doc: Omit<ProjectRecordDoc, 'audioPresent' | 'coverPresent'> & {
    audioIntent: BinaryIntent;
    coverIntent: BinaryIntent;
  };
  audio?: Uint8Array;
  cover?: Uint8Array;
  /**
   * intent=set 时也可以给「下载暂存里的路径」代替字节（票 08：官方 / 社区导入的音频与封面
   * 由主进程从 `<数据根>/downloads/` 拷进工程目录，字节不过 IPC）。给了它就优先于上面的字节。
   */
  audioStagedPath?: string;
  coverStagedPath?: string;
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

/** IndexedDB 记录形状：工程实体原样 + schemaVersion（Blob 内联），未发布，不做数据迁移。 */
export type StoredProjectRecord = ChartProject & { schemaVersion: typeof PROJECT_SCHEMA_VERSION };

/* ------------------------------------------------------------------ */
/* 一份映射：字段表 + 两个方向                                          */
/* ------------------------------------------------------------------ */

/**
 * wire / stored 记录承载的工程字段 = 工程实体减去「不进文档」的三样：
 * id（在路径 / 记录主键里）、两个 Blob（在 bin 文件 / 记录内联字段里）。
 * 故意**从 ChartProject 派生**而不是手写 Pick：实体加字段而这里没跟，`satisfies` 立刻红。
 */
type RecordFields = Omit<ChartProject, 'id' | 'audioBlob' | 'coverBlob'>;

type RecordFieldKey = keyof RecordFields;

/**
 * 一份字段表，两个方向写在同一行：
 * - `read`：存储 → 工程（对旧记录里可能缺失的**可空字段**兜底）；
 * - `write`：工程 → 存储（写盘规范化，如 charts 深拷贝）。
 * 加字段只动这张表；漏字段或漏写任一方向，`satisfies` 编译期报错。
 */
const RECORD_FIELDS = {
  name: {
    read: (raw: unknown): string | null => (raw as string | null | undefined) ?? null,
    write: (src: RecordFields): string | null => src.name,
  },
  artist: {
    read: (raw: unknown): string | null => (raw as string | null | undefined) ?? null,
    write: (src: RecordFields): string | null => src.artist,
  },
  source: {
    read: (raw: unknown): SongSource => (raw as SongSource | undefined) ?? { type: 'custom' },
    write: (src: RecordFields): SongSource => src.source,
  },
  // 两个数值字段不做兜底：读闸门已把它们当必填（畸形记录过不了闸门，与改前逐条一致）。
  durationSeconds: {
    read: (raw: unknown): number => raw as number,
    write: (src: RecordFields): number => src.durationSeconds,
  },
  lastOpened: {
    read: (raw: unknown): number => raw as number,
    write: (src: RecordFields): number => src.lastOpened,
  },
  charts: {
    read: (raw: unknown): ProjectChart[] => (raw as ProjectChart[] | undefined) ?? [],
    write: (src: RecordFields): ProjectChart[] => cloneJson(src.charts),
  },
  audioName: {
    read: (raw: unknown): string | null => (raw as string | null | undefined) ?? null,
    write: (src: RecordFields): string | null => src.audioName,
  },
  coverName: {
    read: (raw: unknown): string | null => (raw as string | null | undefined) ?? null,
    write: (src: RecordFields): string | null => src.coverName,
  },
} satisfies {
  [K in RecordFieldKey]: {
    read: (raw: unknown) => RecordFields[K];
    write: (src: RecordFields) => RecordFields[K];
  };
};

/** 按字段表走一个方向（read / write），产出完整字段集；加字段只改 RECORD_FIELDS。 */
function mapRecordFields(
  pick: (field: (typeof RECORD_FIELDS)[RecordFieldKey], key: RecordFieldKey) => unknown,
): RecordFields {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(RECORD_FIELDS) as RecordFieldKey[]) {
    out[key] = pick(RECORD_FIELDS[key], key);
  }
  return out as unknown as RecordFields;
}

const readRecordFields = (node: Record<string, unknown>): RecordFields =>
  mapRecordFields((field, key) => field.read(node[key]));

const writeRecordFields = (src: RecordFields): RecordFields =>
  mapRecordFields((field) => field.write(src));

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function blobFromBytes(bytes: Uint8Array | null | undefined): Blob | undefined {
  if (!bytes || bytes.byteLength === 0) return undefined;
  return new Blob([new Uint8Array(bytes)]);
}

/* ------------------------------------------------------------------ */
/* 闸门与 id 白名单（渲染侧；主进程另有同口径一份，见 06 票锁测）          */
/* ------------------------------------------------------------------ */

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

/** 工程 id 白名单：字母数字开头，仅字母数字 . _ -，≤64 位 */
const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * 工程 id 合法性（与主进程安全校验同口径的双保险）。
 * `typeof` 兜底与 `dataRoot.cjs:safeProjectId` 逐条对齐：正则会把非字符串强制转串
 * （如 `123`），主进程会拒——渲染侧必须同样拒，双保险的判决不能有差。
 */
export function assertValidProjectId(id: string): void {
  if (typeof id !== 'string' || !PROJECT_ID_PATTERN.test(id)) {
    throw new Error(`非法的谱面工程 id: ${JSON.stringify(id)}`);
  }
}

/* ------------------------------------------------------------------ */
/* 两个方向：工程 ↔ wire doc / stored record                            */
/* ------------------------------------------------------------------ */

export function projectFromRecord(
  id: string,
  doc: ProjectRecordDoc,
  audio: Uint8Array | null,
  cover: Uint8Array | null,
): ChartProject {
  const audioBlob = blobFromBytes(audio);
  const coverBlob = blobFromBytes(cover);
  return {
    id,
    ...readRecordFields(doc as unknown as Record<string, unknown>),
    ...(audioBlob ? { audioBlob } : {}),
    ...(coverBlob ? { coverBlob } : {}),
  };
}

export function recordFromProject(
  project: ChartProject,
  audioIntent: BinaryIntent,
  coverIntent: BinaryIntent,
): ProjectPutWire['doc'] {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    ...writeRecordFields(project),
    audioIntent,
    coverIntent,
  };
}

export function projectFromStored(record: unknown): ChartProject | null {
  if (!isCurrentProjectSchema(record)) return null;
  const stored = record as StoredProjectRecord;
  return {
    id: stored.id,
    ...readRecordFields(stored as unknown as Record<string, unknown>),
    ...(stored.audioBlob ? { audioBlob: stored.audioBlob } : {}),
    ...(stored.coverBlob ? { coverBlob: stored.coverBlob } : {}),
  };
}

export function storedFromProject(project: ChartProject): StoredProjectRecord {
  return {
    id: project.id,
    ...writeRecordFields(project),
    ...(project.audioBlob ? { audioBlob: project.audioBlob } : {}),
    ...(project.coverBlob ? { coverBlob: project.coverBlob } : {}),
    schemaVersion: PROJECT_SCHEMA_VERSION,
  };
}

/* ------------------------------------------------------------------ */
/* 唯一写入口                                                           */
/* ------------------------------------------------------------------ */

/** mutateProject 只依赖存储的读 / 写两面（ChartProjectStore 天然满足）。 */
export interface ProjectMutationStore {
  get(id: string): Promise<ChartProject | null>;
  save(project: ChartProject): Promise<void>;
}

export interface ProjectMutationDeps {
  store: ProjectMutationStore;
  /**
   * 目标可能是「当前工程」时必须先落盘在飞编辑：下面的读-改-写会整条记录覆写，
   * 不先落盘就盖掉在飞内容（原次序约束只写在 projectAudio 的注解里）。
   */
  flush?: () => Promise<void>;
  /** 落盘成功后通知工程目录 / 详情刷新 */
  notify?: () => void;
}

export type ProjectMutationResult =
  | { status: 'saved'; project: ChartProject }
  | { status: 'missing' }
  | { status: 'cancelled' };

/**
 * 整记录读-改-写**唯一**入口：`flush → get → fn → save → notify`。
 *
 * - `fn` 返回 `null` = 调用方取消（不写、不通知）——取消原因（锁 / 解码失败 / 无需改动）
 *   留在调用点，记录模块不解释业务语义；
 * - `fn` 可以是 async：解码、上传等慢步骤在 `fn` 里做，仍在这条次序内；
 * - `save` 失败不通知、错误上抛（调用方的重试语义各自保留）。
 */
export async function mutateProject(
  deps: ProjectMutationDeps,
  projectId: string,
  fn: (project: ChartProject) => ChartProject | null | Promise<ChartProject | null>,
): Promise<ProjectMutationResult> {
  await deps.flush?.();
  const loaded = await deps.store.get(projectId);
  if (!loaded) return { status: 'missing' };
  const next = await fn(loaded);
  if (!next) return { status: 'cancelled' };
  await deps.store.save(next);
  deps.notify?.();
  return { status: 'saved', project: next };
}
