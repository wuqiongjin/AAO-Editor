// 渲染**真实页面壳**（AppPageShell）时 jsdom 缺的两个浏览器 API。
//
// AppPageShell 的根在 useLayoutEffect 里量宽重排：ResizeObserver + window.matchMedia，
// 两个 jsdom 都没实现（缺任一个整个壳直接抛错，页面测不起来）。桩只求"不炸"——
// jsdom 没有布局引擎，几何结论一律走真渲染自查（headless Edge），不在 DOM 测试里断言。
//
// 约定：本目录只放测试基建，文件名不含 `.test.` —— 不参与 vitest 收集。
export function stubPageShellEnv(): void {
  const g = globalThis as unknown as Record<string, unknown>;

  if (typeof g.ResizeObserver !== 'function') {
    g.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }

  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
}
