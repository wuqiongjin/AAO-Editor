// 设置持久化相关的测试替身。
//
// AppSettings 的读写只依赖 `Storage` 的两个方法，且固定使用
// `bangdream.settings.v1` 这一个 key，因此这里给一个最小内存实现即可覆盖。

export const SETTINGS_KEY = 'bangdream.settings.v1';

export interface SettingsMemStorage {
  raw: () => string | null;
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
}

/** 内存版 Storage：只认 SETTINGS_KEY，`raw()` 可直读未解析的落盘字符串 */
export function settingsMemStorage(seed?: string): SettingsMemStorage {
  let data: string | null = seed ?? null;
  return {
    raw: () => data,
    getItem: (k: string) => (k === SETTINGS_KEY ? data : null),
    setItem: (k: string, v: string) => { if (k === SETTINGS_KEY) data = v; },
  };
}

/** 只读内存版 Storage：把一份 settings 对象序列化后喂给 loadSettings */
export function settingsStorageOf(settings: unknown): Pick<Storage, 'getItem'> {
  return {
    getItem: (k: string) => (k === SETTINGS_KEY ? JSON.stringify(settings) : null),
  };
}
