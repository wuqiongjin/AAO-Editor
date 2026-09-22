// issue 148：播放 / 高倍 perf 锁测用合成谱面（ADR-0010 附录 A 时间轴 + 倒流窗内多臂 SP），不依赖外部 JSON。
import type { ChartNote } from '@/src/chart/types';
import { convertChartCodeToNotes, type ChartCodeNote } from '@/src/chart/editing/ChartConverter';
import { getBpmEvents, maxNoteEndSeconds } from '@/src/audio/AudioTiming';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';

/** ADR-0010 附录 A：`beat:bpm` 紧凑编码（49 条、23 条负 BPM） */
const ADR_0010_APPENDIX_A =
  '0:225,48:-225,78:225,108:-225,138:225,168:-225,198:225,228:-225,258:225,433:-225,439:225,' +
  '458:-225,461:225,564.5:225,569.5:-225,574.5:225,582:225,692:-225,724:225,756:-225,788:225,' +
  '820:-225,852:225,927:-225,929:225,931:-225,933:225,1104:-225,1106:225,1108:-225,1110:225,' +
  '1112:-225,1114:225,1120:-225,1122:225,1124:-225,1126:225,1128:-225,1130:225,1136:-225,' +
  '1138:225,1140:-225,1142:225,1144:-225,1146:225,1152:-225,1154:225,1156:-225,1158:225';

export const PERF_PLAYBACK_SURFACE = { w: 750, h: 900 };
export const PERF_PLAYBACK_BEAT_DISPLAY = 4;
export const PERF_PLAYBACK_DPR = 2.5;

/** issue 138 诊断环：8 臂 fold、Y 跨 ~5462 CSS px */
export const BACKFLOW_RASTER_PROFILE =
  [0.38, 0.38, 0.39, 0.40, 0.41, 0.43, 0.45, 0.48, 0.52, 0.56, 0.61, 0.67, 0.74, 0.82, 0.89, 0.62, 0.25];
export const BACKFLOW_RASTER_RGB = [0x4b, 0xe3, 0x71] as const;

export function backflowFoldCanvasPoints(): { x: number; y: number }[] {
  const y0 = 0;
  const y1 = 5462;
  const xs = [180, 140, 100, 60];
  const pts: { x: number; y: number }[] = [];
  for (const x of xs) {
    if (pts.length) pts.push({ x, y: y0 });
    pts.push({ x, y: y0 }, { x, y: y1 }, { x, y: y0 });
  }
  return pts;
}

function parseCompactBpm(encoded: string): ChartCodeNote[] {
  return encoded.split(',').map((seg) => {
    const [beat, bpm] = seg.split(':');
    return { beat: Number(beat), type: 'BPM' as const, bpm: Number(bpm) };
  });
}

/**
 * 折返窗内长 SP 带：首尾可见 + 中间全 hidden（`isSpRegion` 需 span 内 hidden）。
 * 布局折返由 ADR 附录 A 负 BPM 造成，与 issue 106 一致。
 */
function backflowMegaSpSlide(): Extract<ChartCodeNote, { type: 'Slide' }> {
  const connections: Extract<ChartCodeNote, { type: 'Slide' }>['connections'] = [
    { beat: 48, lane: 6 },
  ];
  const lanes = [6, 6, 4, 4, 2, 2, 0, 0];
  for (let beat = 60; beat <= 276; beat += 6) {
    connections.push({ beat, lane: lanes[(beat / 6) % lanes.length]!, hidden: true });
  }
  connections.push({ beat: 284, lane: 5 }, { beat: 290, lane: 5 });
  return { type: 'Slide', connections };
}

function backflowSpSlides(): Extract<ChartCodeNote, { type: 'Slide' }>[] {
  return [backflowMegaSpSlide()];
}

function densitySingles(maxBeat: number): ChartCodeNote[] {
  const out: ChartCodeNote[] = [];
  for (let beat = 8; beat <= maxBeat; beat += 3) {
    out.push({ type: 'Single', lane: beat % 7, beat, subBeat: 0 });
  }
  return out;
}

/** 播放 perf / 高倍倒流 SP 锁测共用：~170s 轴 + 折返区 SP + 足够单键密度 */
export function buildBackflowPlaybackNotes(): ChartNote[] {
  const code: ChartCodeNote[] = [
    ...parseCompactBpm(ADR_0010_APPENDIX_A),
    ...backflowSpSlides(),
    ...densitySingles(1150),
  ];
  return convertChartCodeToNotes(code);
}

export function geometryForBackflowPlayback(notes: ChartNote[], userScale: number): ChartGeometry {
  const bpm = getBpmEvents(notes);
  const duration = maxNoteEndSeconds(notes, PERF_PLAYBACK_BEAT_DISPLAY, bpm);
  return new ChartGeometry(bpm, { seconds: duration }, PERF_PLAYBACK_SURFACE, userScale);
}
