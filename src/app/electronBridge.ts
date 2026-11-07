/**
 * 渲染侧唯一的 `electronAPI` 桥声明（票 13）。
 *
 * `electron/preload.js` 是主进程侧的另一份形状：渲染进程走 Vite / tsc、主进程走
 * `require('.cjs')`，跨进程没有共享构建通道，所以两边各留一份、靠锁测守漂移
 * （见 `tests/platform/electron/ProjectRecordCrossProcess.test.ts`）。
 * 这里只做两件事：持有渲染侧的全部桥形状，以及全仓唯一的一次 window cast。
 * 各域消费方一律经 `getElectronAPI()` 取桥，不再各自 inline cast。
 *
 * 载荷形状仍由各域自己拥有（业务契约），这里只 import type 引用，不复制第二份。
 */
import type { AppSettings } from '../settings/AppSettings';
import type { Pattern } from '../patterns/types';
import type { AssetCachePolicyPayload } from '../community/assetCachePolicy';
import type { CommunityRequest, CommunityWireResult } from '../community/transport';
import type { DiagnosticsExportPayload } from '../diagnostics/exportDiagnostics';
import type { LogWritePayload } from '../diagnostics/logger';
import type { UiLanguage } from '../i18n';
import type { SaveBinaryRequest } from '../preview/static/saveBinary';
import type {
  ProjectGetWire,
  ProjectListItem,
  ProjectPutWire,
  ProjectUploadRefs,
} from '../project/ChartProjectRecord';
import type { AppUpdateState, UpdateSource } from './appUpdate';

/* 谱面工程文件后端 */
export interface ElectronProjectBridge {
  get(id: string): Promise<ProjectGetWire | null>;
  put(payload: ProjectPutWire): Promise<unknown>;
  list(): Promise<ProjectListItem[]>;
  delete(id: string): Promise<unknown>;
  uploadRefs(id: string): Promise<ProjectUploadRefs | null>;
}

/* 谱面代码 / 二进制另存 */
export interface ChartCodeExportBridge {
  saveAs(payload: { json: string; suggestedName: string }): Promise<{ cancelled: boolean }>;
}

export interface PreviewSaveBridge {
  saveBinary(payload: SaveBinaryRequest): Promise<{ cancelled: boolean }>;
}

/* 数据根（不进设置对象） */
export interface DataRootBridge {
  get(): Promise<{ path: string }>;
  open(): Promise<{ ok: boolean; path: string; message?: string }>;
  change(): Promise<{ ok: boolean; cancelled?: boolean; path: string; message?: string }>;
  claim(): Promise<{ ok: boolean; cancelled?: boolean; path: string; message?: string }>;
}

/* 背景皮肤文件桥 */
export interface BackgroundSkinFileBridge {
  get(): Promise<Uint8Array | null>;
  put(bytes: Uint8Array): Promise<unknown>;
  clear(): Promise<unknown>;
}

/* 片段库：整库读写 + 另存（ADR-0023 §3 的第三条数据根桥） */
export interface ElectronPatternLibraryBridge {
  load(): Promise<unknown>;
  saveAll(patterns: readonly Pattern[]): Promise<unknown>;
}

export interface PatternFileSaveBridge {
  saveAs(payload: { json: string; suggestedName: string }): Promise<{ cancelled: boolean }>;
}

/* 窗体标题栏 / 语言 */
export interface WindowChromeBridge {
  sync(payload: { theme: AppSettings['theme'] }): void;
}

export interface I18nBridge {
  setLanguage(locale: UiLanguage): void;
}

/* 社区平台唯一网络出口（ADR-0011 §2） */
export interface CommunityNetBridge {
  request(payload: CommunityRequest): Promise<CommunityWireResult>;
}

export interface CommunitySessionBridge {
  restore(): Promise<{ restored: boolean }>;
  persist(): Promise<{ persisted: boolean }>;
  clear(): Promise<boolean>;
}

/* 站外链接 */
export interface ExternalLinkBridge {
  openExternal(url: string): Promise<boolean>;
}

/* 素材缓存 */
export interface AssetCacheStats {
  totalBytes: number;
  count: number;
  byKind: Record<string, { bytes: number; count: number }>;
}

export interface AssetCacheBridge {
  stats(): Promise<AssetCacheStats>;
  clear(): Promise<{ freedBytes: number }>;
  configure(payload: AssetCachePolicyPayload): Promise<unknown>;
}

/* 日志 / 诊断包 */
export interface LogBridge {
  write(payload: LogWritePayload): unknown;
  trail(event: unknown): unknown;
}

export interface DiagnosticsExportBridge {
  export(payload: DiagnosticsExportPayload): Promise<{ cancelled: boolean }>;
}

/* 应用更新（ADR-0021） */
export interface AppUpdateBridge {
  getState(): Promise<AppUpdateState>;
  check(): Promise<AppUpdateState>;
  download?(): Promise<AppUpdateState>;
  install(): Promise<AppUpdateState>;
  setUpdateSource?(source: UpdateSource): Promise<AppUpdateState & { ok?: boolean }>;
  onEvent(cb: (state: AppUpdateState) => void): () => void;
}

/**
 * preload 暴露的完整形状。每个命名空间都是可选的：DOM 测试只打桩用到的那几
 * 条能力，主进程也可能按打包形态少挂几条；运行时一律由消费方自己判空。
 */
export interface ElectronAPI {
  platform?: string;
  versions?: Record<string, string | undefined>;
  projectStore?: ElectronProjectBridge;
  chartCodeExport?: ChartCodeExportBridge;
  preview?: PreviewSaveBridge;
  dataRoot?: DataRootBridge;
  backgroundSkin?: BackgroundSkinFileBridge;
  patternLibrary?: ElectronPatternLibraryBridge & Partial<PatternFileSaveBridge>;
  windowChrome?: WindowChromeBridge;
  i18n?: I18nBridge;
  communityNet?: CommunityNetBridge;
  communitySession?: CommunitySessionBridge;
  shell?: ExternalLinkBridge;
  assetCache?: AssetCacheBridge;
  log?: LogBridge;
  diagnostics?: DiagnosticsExportBridge;
  appUpdate?: AppUpdateBridge;
}

/** 全仓唯一的取桥点；浏览器 / SSR（没有 window 或没注入桥）返回 null。 */
export function getElectronAPI(): ElectronAPI | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { electronAPI?: ElectronAPI }).electronAPI ?? null;
}
