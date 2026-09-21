// useScrollModel（候选 2 / 架构深化评审候选 2 / 候选 1 基础）：
// 播放滚动模型生命周期 + 几何/缩放注入 + 谱面末端变化置位待重锚。
// issue 134：几何由 useChartSpace 拥有；此处只 configure 注入的引用。
//
// 行为保持：
//   - scrollModel ref 单例（与 Editor 同生命周期；状态机状态在实例上）
//   - 每次渲染：configure(geometry, scale) 注入最新值
//   - 谱面末端变化源 key（duration|bpm|surface）变化时 noteChartEndChange
//   - virtualHeight 就绪后调用 takePendingReAnchor(maxScroll) 消费待重锚项；如有目标则返回
//   - 初始滚动（置底=beat0）由调用方在第一次 virtualHeight 就绪时触发
import { useEffect, useRef } from 'react';
import { PlaybackScrollModel, type ReAnchorTarget } from './PlaybackScrollModel';
import type { ChartGeometry } from '../chart/geometry/ChartGeometry';
import { obtainChartGeometry, PLACEHOLDER_SURFACE } from '../chart/geometry/ChartSpace';

export interface UseScrollModelOptions {
  geometry: ChartGeometry;
  scale: number;
  chartEndKey: string;
}

export interface UseScrollModelReturn {
  /** 模型单例（外部 RAF/滚动条 onScroll 直接读 .scrollYForSeconds 等） */
  scrollModel: PlaybackScrollModel;
  /** 在 virtualHeight 就绪时调用：消费待重锚项；无 pending 时返回 null */
  consumePendingReAnchor: (maxScroll: number) => ReAnchorTarget | null;
}

/**
 * issue 98：程序化 scrollTop 写入的回声识别。浏览器按设备像素取整滚动偏移，程序化写入
 * （缩放/重锚的比例位回写）产生的 scroll 事件携带值与写入值最多差 ±0.5px——这类回声若反算回
 * scrollY，缩放期 scrollY 每档被重掷 ±0.5 virtual px，破坏「缩放期 scrollY 恒定」不变量
 * （判定线处秒数随之跳变）。容差 ±1px；无登记（null）= 非程序化写入，照常处理。
 */
export function isProgrammaticScrollEcho(scrollTop: number, expected: number | null): boolean {
  return expected !== null && Math.abs(scrollTop - expected) <= 1;
}

export function useScrollModel(opts: UseScrollModelOptions): UseScrollModelReturn {
  const { geometry, scale, chartEndKey } = opts;

  const scrollModelRef = useRef<PlaybackScrollModel | null>(null);
  if (scrollModelRef.current == null) {
    scrollModelRef.current = new PlaybackScrollModel(
      obtainChartGeometry(null, [], 0, PLACEHOLDER_SURFACE, 1),
      scale,
    );
  }
  const scrollModel = scrollModelRef.current;

  scrollModel.configure(geometry, scale);

  useEffect(() => {
    scrollModel.noteChartEndChange(chartEndKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartEndKey]);

  return {
    scrollModel,
    consumePendingReAnchor: (maxScroll: number) => scrollModel.takePendingReAnchor(maxScroll),
  };
}
