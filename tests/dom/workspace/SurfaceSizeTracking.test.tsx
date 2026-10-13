// @vitest-environment jsdom
// issue 169 锁测：
// 1. ChartCodeEditorProvider 在 projectId 切换时不卸载 children，并重置 modal 状态；
// 2. useSurfaceSize 在 DOM 节点更替时自动解绑旧节点并监听新节点；
// 3. useSurfaceSize 在 window resize 时主动触发尺寸同步；
// 4. useSurfaceSize 在 active 由 false 翻转为 true 时主动校准最新尺寸。
import '@testing-library/jest-dom/vitest';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useRef, useState } from 'react';
import { ProviderTree } from '@/src/app/ProviderTree';
import { ChartCodeEditorProvider, useChartCodeEditor } from '@/src/chart/components/code-editor/ChartCodeEditorProvider';
import { useSurfaceSize } from '@/src/chart/layout/useSurfaceSize';

type ROCallback = (entries: { contentRect: { width: number; height: number } }[]) => void;

class MockResizeObserver {
  callback: ROCallback;
  observed: Element[] = [];
  static instances: MockResizeObserver[] = [];

  constructor(cb: ROCallback) {
    this.callback = cb;
    MockResizeObserver.instances.push(this);
  }

  observe(el: Element) {
    this.observed.push(el);
  }

  unobserve(el: Element) {
    this.observed = this.observed.filter((e) => e !== el);
  }

  disconnect() {
    this.observed = [];
  }

  trigger(entries: { contentRect: { width: number; height: number } }[]) {
    this.callback(entries);
  }
}

describe('issue 169 · ChartCodeEditorProvider 工程切换与 children 稳定性', () => {
  it('projectId 变化时重置 target/trail 状态，但保持 children 不被销毁', () => {
    let unmountCount = 0;
    let editorApi: ReturnType<typeof useChartCodeEditor> | null = null;

    function Child() {
      editorApi = useChartCodeEditor();
      const mountRef = useRef(0);
      mountRef.current++;
      return <div data-testid="child">Child Node</div>;
    }

    function Harness({ projectId }: { projectId: string | null }) {
      return (
        <ProviderTree>
          <ChartCodeEditorProvider projectId={projectId}>
            <Child />
          </ChartCodeEditorProvider>
        </ProviderTree>
      );
    }

    const { rerender, getByTestId } = render(<Harness projectId={null} />);
    const initialDom = getByTestId('child');
    expect(editorApi?.target).toBeNull();

    // 打开代码弹窗
    act(() => {
      editorApi?.openChartCode();
    });
    expect(editorApi?.target).toEqual({ kind: 'chart' });

    // 切换工程：projectId 由 null 变为 'proj-1'
    rerender(<Harness projectId="proj-1" />);

    // DOM 元素保持同一实例（未被销毁重建）
    const currentDom = getByTestId('child');
    expect(currentDom).toBe(initialDom);

    // 弹窗状态已自动重置关闭
    expect(editorApi?.target).toBeNull();
  });
});

describe('issue 169 · useSurfaceSize DOM 跟踪与兜底同步', () => {
  beforeEach(() => {
    MockResizeObserver.instances = [];
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = MockResizeObserver;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('DOM 节点更替时，useSurfaceSize 自动解绑旧节点并监听新节点', () => {
    let currentSurface: { w: number; h: number } | null = null;

    function Harness({ remountKey }: { remountKey: number }) {
      const containerRef = useRef<HTMLDivElement>(null);
      const surface = useSurfaceSize(containerRef);
      currentSurface = surface;

      return (
        <div key={remountKey} ref={containerRef} data-testid="container" style={{ width: 800, height: 600 }}>
          Container
        </div>
      );
    }

    const { rerender, getByTestId } = render(<Harness remountKey={1} />);
    const el1 = getByTestId('container');

    // 初始 RO 实例监听 el1
    const ro1 = MockResizeObserver.instances[0];
    expect(ro1.observed).toContain(el1);

    // 模拟首次 RO 回调汇报 800x600
    act(() => {
      ro1.trigger([{ contentRect: { width: 800, height: 600 } }]);
    });
    expect(currentSurface).toEqual({ w: 800, h: 600 });

    // 触发父级 key remount，使 containerRef 指向新 DOM 节点 el2
    rerender(<Harness remountKey={2} />);
    const el2 = getByTestId('container');
    expect(el2).not.toBe(el1);

    // ro1 已解绑 el1，新 RO 或同一 RO 正在监听 el2
    expect(ro1.observed).not.toContain(el1);
    const activeRo = MockResizeObserver.instances[MockResizeObserver.instances.length - 1];
    expect(activeRo.observed).toContain(el2);

    // 新节点发生 resize 回调汇报 1400x900
    act(() => {
      activeRo.trigger([{ contentRect: { width: 1400, height: 900 } }]);
    });
    expect(currentSurface).toEqual({ w: 1400, h: 900 });
  });

  it('window resize 时主动触发 getBoundingClientRect 尺寸同步', () => {
    let currentSurface: { w: number; h: number } | null = null;

    function Harness() {
      const containerRef = useRef<HTMLDivElement>(null);
      currentSurface = useSurfaceSize(containerRef);
      return <div ref={containerRef} data-testid="container">Container</div>;
    }

    const { getByTestId } = render(<Harness />);
    const el = getByTestId('container');

    // Mock getBoundingClientRect
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      width: 1200,
      height: 800,
      top: 0,
      left: 0,
      bottom: 800,
      right: 1200,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(currentSurface).toEqual({ w: 1200, h: 800 });
  });

  it('active 由 false 翻转为 true 时主动校准最新尺寸', () => {
    let currentSurface: { w: number; h: number } | null = null;

    function Harness({ active }: { active: boolean }) {
      const containerRef = useRef<HTMLDivElement>(null);
      currentSurface = useSurfaceSize(containerRef, { active });
      return <div ref={containerRef} data-testid="container">Container</div>;
    }

    const { rerender, getByTestId } = render(<Harness active={false} />);
    const el = getByTestId('container');

    // 在后台时模拟尺寸变更为 1600x1000（如后台最大化）
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      width: 1600,
      height: 1000,
      top: 0,
      left: 0,
      bottom: 1000,
      right: 1600,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // 切回前台激活（active: false -> true）
    act(() => {
      rerender(<Harness active={true} />);
    });

    expect(currentSurface).toEqual({ w: 1600, h: 1000 });
  });
});
