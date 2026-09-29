// 画布相关测试替身：记录型 / 计数型假 2d context，以及假离屏位图。
//
// 为什么需要：vitest 跑在 `environment: 'node'`，没有真实 DOM / Canvas。
// 渲染层与瓦片缓存的单测全部靠"形状兼容的假对象"驱动，
// 这里统一收口，避免每个测试文件各写一份 Proxy。

export type RecordedCall = [string, unknown[]];

/**
 * 记录型假 2d context：属性赋值与方法调用都录进 calls（只读 canvas 尺寸返回 0）。
 * `overrides` 可钉住个别方法的返回值（如 `measureText` 恒返回超宽，造"文字溢出不绘制"的边界）。
 * 被 override 的方法**不**进 calls——它返回的不是绘制动作。
 */
export function makeRecordingCtx(
  overrides: Record<string, (...args: unknown[]) => unknown> = {},
) {
  const calls: RecordedCall[] = [];
  const proxy = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'canvas') return { width: 0, height: 0 };
      const key = String(prop);
      if (key in overrides) return overrides[key];
      return (...args: unknown[]) => { calls.push([key, args]); };
    },
    set(_t, prop, value) { calls.push([String(prop), [value]]); return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { proxy, calls };
}

/** 某属性的全部赋值序列（如 textBaseline / strokeStyle / lineWidth） */
export const propValues = (calls: RecordedCall[], key: string) =>
  calls.filter(([k]) => k === key).map(([, v]) => v[0]);

/** 全部 fillText 调用：[text, x, y] */
export const fillTexts = (calls: RecordedCall[]) =>
  calls.filter(([k]) => k === 'fillText') as [string, [string, number, number]][];

/**
 * 计数型假 2d context：只统计 `watched` 里点名的调用次数，其余一律空实现。
 * 用于性能回归测试——关心"画了多少次"，不关心画了什么。
 */
export function makeCountingCtx(
  counters: Record<string, number>,
  watched: string[] = ['drawImage'],
): CanvasRenderingContext2D {
  return new Proxy({}, {
    get(_t, prop) {
      const key = String(prop);
      if (watched.includes(key)) return () => { counters[key] = (counters[key] ?? 0) + 1; };
      return () => undefined;
    },
    set() { return true; },
  }) as unknown as CanvasRenderingContext2D;
}

/** 假离屏位图：喂给两层缓存的 `__setCanvasFactoryForTests`（`createNoteLayerCache` / `createStaticLayerCache` 实例上） */
export function makeCanvasStub(
  counters: Record<string, number>,
  watched: string[] = ['drawImage'],
) {
  return { width: 0, height: 0, getContext: () => makeCountingCtx(counters, watched) };
}

/** 空实现假 2d context：任何方法调用都是 no-op，属性赋值照收。用于"只关心有没有崩"的场景 */
export function makeNoopCtx(): CanvasRenderingContext2D {
  return new Proxy({}, {
    get: () => () => undefined,
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
}

/**
 * 计数型假 ctx 的变体：不按方法名分桶，命中 `watched` 就回调一次。
 * 用于"总绘制次数"这类不分方法的口径（如静态位图重建了多少笔）。
 */
export function makeTallyingCtx(onCall: () => void, watched: string[]): CanvasRenderingContext2D {
  return new Proxy({}, {
    get(_t, prop) {
      if (watched.includes(String(prop))) return () => { onCall(); };
      return () => undefined;
    },
    set() { return true; },
  }) as unknown as CanvasRenderingContext2D;
}

export function makeTallyingCanvasStub(onCall: () => void, watched: string[]) {
  return { width: 0, height: 0, getContext: () => makeTallyingCtx(onCall, watched) };
}

/**
 * 假瓦片位图 + 记录 `setTransform` 的 ctx：拿到每次变换的缩放与**当时的位图尺寸**。
 * 用于锁定位图尺寸 / dpr 量化（宽高必须在 setTransform 那一刻读，之后才会被改写）。
 */
export function makeTransformRecordingTile(
  onTransform: (t: { sx: number; sy: number; bw: number; bh: number }) => void,
) {
  const bitmap = { width: 0, height: 0 };
  const ctx = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'setTransform') {
        return (sx: number, _skx: number, _sky: number, sy: number) => {
          onTransform({ sx, sy, bw: bitmap.width, bh: bitmap.height });
        };
      }
      return () => undefined;
    },
    set() { return true; },
  });
  return {
    get width() { return bitmap.width; },
    set width(v: number) { bitmap.width = v; },
    get height() { return bitmap.height; },
    set height(v: number) { bitmap.height = v; },
    getContext: () => ctx,
  };
}
