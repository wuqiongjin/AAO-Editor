// issue 134：布局轴 ChartGeometry 的唯一生命周期（Editor 侧 useChartSpace）。
// obtainChartGeometry = 与 issue 35 F2 同款的复用规则；滚动模型与画布只 bind 同一引用。
import { useMemo, useRef } from 'react';
import { getBpmEvents, type BpmEvent } from '../../audio/AudioTiming';
import { ChartGeometry, type SurfaceSize } from './ChartGeometry';
import type { ChartNote } from '../types';

/** 与 useScrollModel / FinalVirtualCanvas 历史 fallback 同尺寸（RO 尚未回调时） */
export const PLACEHOLDER_SURFACE: SurfaceSize = { w: 200, h: 240 };

export function bpmEventsContentEqual(a: readonly BpmEvent[], b: readonly BpmEvent[]): boolean {
  return a === b || (a.length === b.length && a.every((e, i) => e.beat === b[i].beat && e.bpm === b[i].bpm));
}

export function obtainChartGeometry(
  prev: ChartGeometry | null,
  bpmEvents: readonly BpmEvent[],
  chartLengthSeconds: number,
  surface: SurfaceSize,
  verticalRatio: number,
): ChartGeometry {
  if (
    prev &&
    prev.chartLengthSeconds === chartLengthSeconds &&
    prev.surface.w === surface.w &&
    prev.surface.h === surface.h &&
    prev.verticalRatio === verticalRatio &&
    bpmEventsContentEqual(prev.bpmEvents, bpmEvents)
  ) {
    return prev;
  }
  return new ChartGeometry(bpmEvents, { seconds: chartLengthSeconds }, surface, verticalRatio);
}

export interface UseChartSpaceOptions {
  notes: ChartNote[];
  ctxDuration: number;
  surface: SurfaceSize | null;
  verticalRatio: number;
}

export interface UseChartSpaceReturn {
  geometry: ChartGeometry;
  /** 谱面末端变化源 key（时长 / BPM 内容 / 渲染面）；普通放音符不触发重锚 */
  chartEndKey: string;
}

export function useChartSpace(opts: UseChartSpaceOptions): UseChartSpaceReturn {
  const { notes, ctxDuration, surface, verticalRatio } = opts;
  const geometryHolder = useRef<ChartGeometry | null>(null);

  const geometry = useMemo(() => {
    const bpmEvents = getBpmEvents(notes);
    const surf = surface ?? PLACEHOLDER_SURFACE;
    const next = obtainChartGeometry(
      geometryHolder.current,
      bpmEvents,
      ctxDuration,
      surf,
      verticalRatio,
    );
    geometryHolder.current = next;
    return next;
  }, [notes, ctxDuration, surface, verticalRatio]);

  const chartEndKey = useMemo(() => {
    const bpm = getBpmEvents(notes).map(e => `${e.beat}:${e.bpm}`).join(',');
    const surfaceKey = surface ? `${surface.w}x${surface.h}` : '?x?';
    return `${ctxDuration}|${bpm}|${surfaceKey}`;
  }, [notes, ctxDuration, surface]);

  return { geometry, chartEndKey };
}
