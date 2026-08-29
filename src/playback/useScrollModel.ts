// useScrollModel（候选 2 / 架构深化评审候选 2 / 候选 1 基础）：
// 播放滚动模型生命周期 + 几何/缩放注入 + 谱面末端变化置位待重锚。
// 拆出 Editor.tsx 内 PlaybackScrollModel ref + configure/scrollGeometry/chartEndKey 三处代码。
//
// 行为保持：
//   - scrollModel ref 单例（与 Editor 同生命周期；状态机状态在实例上）
//   - 每次渲染：configure(geometry, scale) 注入最新值
//   - 谱面末端变化源 key（duration|bpm|surface）变化时 noteChartEndChange
//   - virtualHeight 就绪后调用 takePendingReAnchor(maxScroll) 消费待重锚项；如有目标则返回
//   - 初始滚动（置底=beat0）由调用方在第一次 virtualHeight 就绪时触发
import { useEffect, useMemo, useRef } from 'react';
import { PlaybackScrollModel, type ReAnchorTarget } from './PlaybackScrollModel';
import { ChartGeometry } from '../chart/geometry/ChartGeometry';
import { getBpmEvents, chartLengthToEndBeat } from '../audio/AudioTiming';
import type { ChartNote } from '../chart/types';
import type { SurfaceSize } from '../chart/geometry/ChartGeometry';

export interface UseScrollModelOptions {
  notes: ChartNote[];
  ctxDuration: number;
  surface: SurfaceSize;
  scale: number;
  verticalRatio: number;
}

export interface UseScrollModelReturn {
  /** 模型单例（外部 RAF/滚动条 onScroll 直接读 .scrollYForSeconds 等） */
  scrollModel: PlaybackScrollModel;
  /** 谱面末端变化 key（外部用于触发 virtualHeight 链 + 渲染时 track） */
  chartEndKey: string;
  /** 在 virtualHeight 就绪时调用：消费待重锚项；无 pending 时返回 null */
  consumePendingReAnchor: (maxScroll: number) => ReAnchorTarget | null;
}

export function useScrollModel(opts: UseScrollModelOptions): UseScrollModelReturn {
  const { notes, ctxDuration, surface, scale, verticalRatio } = opts;

  // 单例：与 Editor 同生命周期
  const scrollModelRef = useRef<PlaybackScrollModel | null>(null);
  if (scrollModelRef.current == null) {
    scrollModelRef.current = new PlaybackScrollModel(new ChartGeometry([], 0), scale);
  }
  const scrollModel = scrollModelRef.current;

  // 几何：notes/duration/surface/verticalRatio 任一变化都重建并 configure
  const scrollGeometry = useMemo(
    () => new ChartGeometry(getBpmEvents(notes), chartLengthToEndBeat(getBpmEvents(notes), ctxDuration), surface, verticalRatio),
    [notes, ctxDuration, surface, verticalRatio],
  );
  scrollModel.configure(scrollGeometry, scale);

  // 谱面末端变化源 key：仅时长/BPM/surface 变化时触发；普通放音符/缩放不触发
  const chartEndKey = useMemo(() => {
    const bpm = getBpmEvents(notes).map(e => `${e.beat}:${e.bpm}`).join(',');
    return `${ctxDuration}|${bpm}|${surface.w}x${surface.h}`;
  }, [notes, ctxDuration, surface]);

  // 谱面末端变化 → 模型置位待重锚（未初始化/播放中跳过由模型内部处理）
  useEffect(() => {
    scrollModel.noteChartEndChange(chartEndKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartEndKey]);

  return {
    scrollModel,
    chartEndKey,
    consumePendingReAnchor: (maxScroll: number) => scrollModel.takePendingReAnchor(maxScroll),
  };
}
