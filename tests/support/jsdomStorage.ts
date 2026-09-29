// jsdom 测试的存储地基：把被 Node 全局盖掉的 `localStorage` 补回来。
//
// **症状**：`tests/dom/**` 整片红，同一句 `TypeError: storage.setItem is not a function`。
//
// **根因**（Node v25.6.0 + vitest 4.1.10 + jsdom 30 实测）：
//   ① Node 25 自带 Web Storage 全局 `localStorage`。它只在给了 `--localstorage-file` 时才是
//      真存储，否则是个**空壳**——`getItem/setItem/clear` 这些方法根本不存在（不是抛错，是
//      `undefined`）。所以 `typeof localStorage === 'undefined'` 这类守卫也拦不住它。
//   ② vitest 的 jsdom 环境在 `getWindowKeys` 里**跳过已经存在于 globalThis 的键**
//      （`k in global` 时只保留 vitest 白名单里的），`localStorage` 不在白名单 → jsdom 自己的
//      Storage 压根没被搬上 globalThis。
//   ③ 而 `populateGlobal` 最后有一句 `global.window = global` → `window` 就是 globalThis，
//      于是 `window.localStorage` 和裸 `localStorage` 是**同一个**空壳（jsdom 那个真身不可达）。
//
// 判别法：`localStorage.setItem` 是 function 就什么都不做（Node < 25、或将来 vitest 修好了）。
//
// **修法**：只补 `localStorage`，给一个最小内存实现 —— 语义对齐 `tests/support/storage.ts`
// 里既有的内存替身（本目录惯例：jsdom 缺口用显式桩补，见 `domEnv.ts`）。`sessionStorage`
// 在 Node 25 下是真实现（内存版），能用，不动。
//
// **为什么不手写"更真"的 Storage**：node 环境（`tests/unit/**`）不该长出浏览器存储 ——
// 那里的存储一律显式注入替身；所以本 setup 只认"有 `window` 的 jsdom 测试"。
const MEMORY_METHODS = ['getItem', 'setItem', 'removeItem', 'clear', 'key'] as const;

/** 最小内存版 Storage：键值强制转字符串、缺键回 `null`（与浏览器语义一致的那部分） */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length(): number { return map.size; },
    clear: (): void => { map.clear(); },
    getItem: (k: string): string | null => map.get(String(k)) ?? null,
    key: (i: number): string | null => [...map.keys()][i] ?? null,
    removeItem: (k: string): void => { map.delete(String(k)); },
    setItem: (k: string, v: string): void => { map.set(String(k), String(v)); },
  } as unknown as Storage;
}

function installLocalStorage(): void {
  const current = (globalThis as unknown as Record<string, unknown>).localStorage as Storage | undefined;
  const usable = !!current && MEMORY_METHODS.every((m) => typeof current[m] === 'function');
  if (usable) return;
  const real = memoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { get: () => real, configurable: true });
}

// 只在 jsdom 测试里动手：node 环境（`tests/unit/**`）没有 `window`，那里的存储走显式注入。
if (typeof window !== 'undefined') installLocalStorage();