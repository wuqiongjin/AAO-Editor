// 谱面背景皮肤数据层（issue 29 Q4 最小模型，2026-08-27 grill 定案）：
//   最小模型 = 1 张图（本地单张上传）+ 启用开关（settings.visual.backgroundSkin.enabled，ConfigContext 写）
//   + 清除。图片本体：浏览器 IndexedDB；Electron 为数据根下固定文件（issue 117），
//     本模块负责 存取 / 解码 / 订阅通知；
//   settings 只存开关位，图丢失时静默降级为无背景。
//
// 渲染接线：FinalVirtualCanvas 经 useBackgroundSkin 订阅快照，
// 在 settings 开启且解码就绪时把 { source, width, height, revision } 注入 RenderCtx.background；
// staticLayerCache 以 revision + 生效标志做静态层失效依据（换图/开关键即触发重建）。
//
// 可测性：持久化 / 解码 / URL 工厂三个端口可注入（默认 IndexedDB + createImageBitmap + objectURL），
// 纯逻辑（修订号推进、快照引用稳定、异常传播）可在 node 测试环境覆盖。

/** 背景皮肤快照：渲染器与素材页共读；引用仅在真实变化时更替（useSyncExternalStore 兼容） */
export interface BackgroundSkinSnapshot {
  /** 初始从 IndexedDB 装载中 */
  status: 'loading' | 'ready';
  /** 已解码背景图；null = 未上传或已清除 */
  image: {
    /** 缩略图用（UI）；运行时才可用（node 测试注入假工厂） */
    url: string;
    /** 画布绘制源（ImageBitmap 或等价 CanvasImageSource） */
    source: unknown;
    width: number;
    height: number;
  } | null;
  /** 图片实例版本：装载出图 / 换图 / 清除 各 +1；静态层缓存失效依据之一 */
  revision: number;
}

interface BackgroundSkinPorts {
  persist: {
    load(): Promise<Blob | null>;
    save(blob: Blob): Promise<void>;
    clear(): Promise<void>;
  };
  decode(blob: Blob): Promise<{ source: unknown; width: number; height: number }>;
  createUrl(blob: Blob): string;
  revokeUrl(url: string): void;
}

const DEFAULT_IDB_KEY = 'backgroundSkin';

function defaultPersist() {
  const DB_NAME = 'aao.assets';
  const DB_VERSION = 1;
  const STORE = 'kv';
  let dbPromise: Promise<IDBDatabase> | null = null;
  const openDb = () => {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        // 与 ChartProject.ts 同范式：独立库避免工程表 schemaVersion 牵连
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  };
  return {
    async load(): Promise<Blob | null> {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(DEFAULT_IDB_KEY);
        req.onsuccess = () => resolve((req.result as { blob: Blob } | undefined)?.blob ?? null);
        req.onerror = () => reject(req.error);
      });
    },
    async save(blob: Blob): Promise<void> {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ blob }, DEFAULT_IDB_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
    async clear(): Promise<void> {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(DEFAULT_IDB_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
  };
}

async function defaultDecode(blob: Blob) {
  if (typeof createImageBitmap !== 'function') throw new Error('backgroundSkin: 当前环境不支持 createImageBitmap');
  const bmp = await createImageBitmap(blob);
  return { source: bmp as unknown, width: bmp.width, height: bmp.height };
}

/** preload 注入的背景图文件桥（electronAPI.backgroundSkin） */
export interface BackgroundSkinFileBridge {
  get(): Promise<Uint8Array | null>;
  put(bytes: Uint8Array): Promise<unknown>;
  clear(): Promise<unknown>;
}

function getElectronBackgroundBridge(): BackgroundSkinFileBridge | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as { electronAPI?: { backgroundSkin?: BackgroundSkinFileBridge } }).electronAPI;
  return api?.backgroundSkin ?? null;
}

/** Electron：文件优先；文件空时从 IndexedDB 静默迁入一次（原库保留作备份） */
export function createElectronBackgroundPersist(
  bridge: BackgroundSkinFileBridge,
  legacy: { load(): Promise<Blob | null> } = defaultPersist(),
): BackgroundSkinPorts['persist'] {
  let migrated = false;
  return {
    async load(): Promise<Blob | null> {
      const bytes = await bridge.get();
      if (bytes && bytes.byteLength > 0) return new Blob([bytes]);
      if (migrated) return null;
      migrated = true;
      try {
        const old = await legacy.load();
        if (old) {
          await bridge.put(new Uint8Array(await old.arrayBuffer()));
          return old;
        }
      } catch {
        // 迁移来源异常：按无图
      }
      return null;
    },
    async save(blob: Blob): Promise<void> {
      await bridge.put(new Uint8Array(await blob.arrayBuffer()));
    },
    async clear(): Promise<void> {
      await bridge.clear();
    },
  };
}

function resolveDefaultPersist(): BackgroundSkinPorts['persist'] {
  const bridge = getElectronBackgroundBridge();
  return bridge ? createElectronBackgroundPersist(bridge) : defaultPersist();
}

const defaultPorts = (): BackgroundSkinPorts => ({
  persist: resolveDefaultPersist(),
  decode: defaultDecode,
  createUrl: (blob) => {
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') return URL.createObjectURL(blob);
    return '';
  },
  revokeUrl: (url) => {
    if (url && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
  },
});

export class BackgroundSkinStore {
  private ports: BackgroundSkinPorts;
  private listeners = new Set<() => void>();
  private snapshot: BackgroundSkinSnapshot = { status: 'loading', image: null, revision: 0 };
  private loadedOnce = false;
  /** 操作串行链：装载/换图/清除互斥推进，避免并发写与乱序快照 */
  private queue: Promise<void> = Promise.resolve();

  constructor(ports?: Partial<Pick<BackgroundSkinPorts, 'persist' | 'decode' | 'createUrl' | 'revokeUrl'>>) {
    this.ports = { ...defaultPorts(), ...ports };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): BackgroundSkinSnapshot => this.snapshot;

  private emit(next: BackgroundSkinSnapshot) {
    this.snapshot = next;
    for (const l of this.listeners) l();
  }

  private emitWithImage(image: BackgroundSkinSnapshot['image']) {
    this.emit({
      status: 'ready',
      image,
      revision: this.snapshot.revision + 1,
    });
  }

  /** 懒装载：首个消费者（画布/素材页）挂载时调用；幂等，重复调用只排队一次 */
  ensureLoaded(): Promise<void> {
    if (this.loadedOnce) return this.queue;
    this.loadedOnce = true;
    this.queue = this.queue.then(async () => {
      try {
        const blob = await this.ports.persist.load();
        if (!blob) {
          this.emit({ status: 'ready', image: null, revision: this.snapshot.revision });
          return;
        }
        const dec = await this.ports.decode(blob);
        this.emitWithImage({ url: this.ports.createUrl(blob), source: dec.source, width: dec.width, height: dec.height });
      } catch (e) {
        // 图损坏/解码失败：静默降级为无背景（定案：读取侧失败不阻断编辑器），但保留 ready 态供重新上传
        console.warn('[backgroundSkin] 装载失败（按无背景渲染）:', e);
        this.emit({ status: 'ready', image: null, revision: this.snapshot.revision });
      }
    });
    return this.queue;
  }

  /** 上传并替换（Q4=1 张图）：保存 → 解码 → 快照换新。失败时抛错且不污染内存态。 */
  async setImage(blob: Blob): Promise<void> {
    await this.ensureLoaded();
    const run = this.queue.then(async () => {
      // 先落盘再解码：保证下次会话必有图；解码成功后一次性替换快照并回收旧 URL
      await this.ports.persist.save(blob);
      const dec = await this.ports.decode(blob);
      this.revokeCurrent();
      this.emitWithImage({ url: this.ports.createUrl(blob), source: dec.source, width: dec.width, height: dec.height });
    });
    this.queue = run.catch(() => { /* 由调用方处理错误；链条不断 */ });
    await run;
  }

  /** 清除（Q4 三原语之三）：删库存档 + 快照去图（enabled 位由 ConfigContext 另行置 false） */
  async clear(): Promise<void> {
    await this.ensureLoaded();
    const run = this.queue.then(async () => {
      await this.ports.persist.clear();
      this.revokeCurrent();
      this.emitWithImage(null);
    });
    this.queue = run.catch(() => { /* 同上 */ });
    await run;
  }

  private revokeCurrent() {
    const cur = this.snapshot.image;
    if (cur?.url) this.ports.revokeUrl(cur.url);
  }
}

/** 默认单例（浏览器 IndexedDB 接线）；测试用 BackgroundSkinStore(ports) 自建实例 */
export const backgroundSkinStore = new BackgroundSkinStore();
