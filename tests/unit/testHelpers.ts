// 渲染层单测共享工具：记录型假 2d context 与调用检索 helpers。
// 供 BoundLines / GridStyle / GutterLabels / HoverLine 等 render* 纯函数测试复用。

export type RecordedCall = [string, unknown[]];

/** 记录型假 2d context：属性赋值与方法调用都录进 calls（只读 canvas 尺寸返回 0） */
export function makeRecordingCtx() {
  const calls: RecordedCall[] = [];
  const proxy = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'canvas') return { width: 0, height: 0 };
      return (...args: unknown[]) => { calls.push([String(prop), args]); };
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
