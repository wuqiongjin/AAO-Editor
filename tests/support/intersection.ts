// IntersectionObserver 替身（票 15）：jsdom 没有它，而选曲目录的封面缩略图靠它懒加载。
//
// 装配后**什么都不自动发生** —— 「滚到可见」在测试里是一个显式动作（`scrollIntoView()`），
// 于是「没滚到的行不请求封面」这条才锁得住（真环境里由浏览器替我们决定何时可见）。
import { act, waitFor } from '@testing-library/react';

type IOCallback = (entries: { isIntersecting: boolean; target: Element }[]) => void;

export interface IntersectionObserverStub {
  /**
   * 把当前所有被观察的元素都当作「滚到了」。
   * 包在 async act 里：交给 React 的微任务（如组件的取数 promise）在同一段里跑完，
   * 断言看不到「刚滚到、还在半路」的中间态。
   */
  scrollIntoView(): Promise<void>;
  /** 卸掉替身（afterEach 用；卸掉后组件按「环境没有观察器」直出） */
  restore(): void;
  /** 当前还在被观察的元素数 */
  readonly observed: number;
}

export function installIntersectionObserverStub(): IntersectionObserverStub {
  const observers: { callback: IOCallback; targets: Element[] }[] = [];

  class StubIntersectionObserver {
    private readonly entry: { callback: IOCallback; targets: Element[] };

    constructor(callback: IOCallback) {
      this.entry = { callback, targets: [] };
      observers.push(this.entry);
    }

    observe(target: Element): void {
      this.entry.targets.push(target);
    }

    unobserve(target: Element): void {
      this.entry.targets = this.entry.targets.filter((item) => item !== target);
    }

    disconnect(): void {
      this.entry.targets = [];
    }
  }

  const scope = globalThis as unknown as { IntersectionObserver?: unknown };
  scope.IntersectionObserver = StubIntersectionObserver;

  return {
    async scrollIntoView() {
      // 先等「有东西在被观察」再滚：列表是取数之后才渲染的，它的 effect（挂观察）是异步 flush 的，
      // 直接滚会在机器忙的时候落空 —— 那不是被测行为，是测试自己的竞态。
      await waitFor(() => {
        if (this.observed === 0) throw new Error('还没有元素进入观察（列表还没挂上？）');
      });
      await act(async () => {
        for (const observer of observers) {
          for (const target of [...observer.targets]) {
            observer.callback([{ isIntersecting: true, target }]);
          }
        }
      });
    },
    restore() {
      delete scope.IntersectionObserver;
    },
    get observed() {
      return observers.reduce((sum, observer) => sum + observer.targets.length, 0);
    },
  };
}
