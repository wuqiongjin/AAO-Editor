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
import { getBpmEvents } from '../audio/AudioTiming';
import type { ChartNote } from '../chart/types';
import type { SurfaceSize } from '../chart/geometry/ChartGeometry';

export interface UseScrollModelOptions {
  notes: ChartNote[];
  ctxDuration: number;
  /** 渲染面尺寸（CSS 像素，ADR-0006 §1）；issue 50：RO 尚未回调时为 null */
  surface: SurfaceSize | null;
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
  const { notes, ctxDuration, surface, scale, verticalRatio } = opts;

  // 单例：与 Editor 同生命周期
  const scrollModelRef = useRef<PlaybackScrollModel | null>(null);
  if (scrollModelRef.current == null) {
    // issue 50：占位 ChartGeometry，surface 用 200×240 fallback（与下方 scrollGeometry fallback 对齐）；
    // 立即被下方 useMemo 出的 scrollGeometry 覆盖。
    scrollModelRef.current = new PlaybackScrollModel(new ChartGeometry([], { seconds: 0 }, { w: 200, h: 240 }), scale);
  }
  const scrollModel = scrollModelRef.current;

  // 几何：notes/duration/surface/verticalRatio 任一变化都重建并 configure
  // issue 50（Q26 b）：surface null 时用 200×240 fallback，保证 ChartGeometry 必传有效 surface
  // issue 104（Q2 归一）：端点一律由**谱面长度（秒）**直出（ADR-0005 §1），
  // 不再在调用点各自反查末端拍（画布与滚动模型两处同式重复计算已收敛进构造函数）。
  const scrollGeometry = useMemo(
    () => new ChartGeometry(
      getBpmEvents(notes),
      { seconds: ctxDuration },
      surface ?? { w: 200, h: 240 },
      verticalRatio,
    ),
    [notes, ctxDuration, surface, verticalRatio],
  );
  scrollModel.configure(scrollGeometry, scale);

  // 谱面末端变化源 key：仅时长/BPM/surface 变化时触发；普通放音符/缩放不触发
  const chartEndKey = useMemo(() => {
    const bpm = getBpmEvents(notes).map(e => `${e.beat}:${e.bpm}`).join(',');
    // issue 50（Q27 b）：surface null 时占位 '?x?'——保持 key 唯一性
    const surfaceKey = surface ? `${surface.w}x${surface.h}` : '?x?';
    return `${ctxDuration}|${bpm}|${surfaceKey}`;
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
