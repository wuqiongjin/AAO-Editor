import { waitForPaint, yieldToMainThread } from '../../static/exportPanels';
import {
  drawSimFrameAt,
  prepareSimComboSprites,
  prepareSimLifeGauge,
  type SimFrameInput,
  type SimFrameLayers,
} from './simField';
import { SCORE_MAX, SCORE_TIER_THRESHOLDS } from './simHud';

/** 分数条跨档前后的采样秒表：用于覆盖缩小与放大两种纹理采样组合。 */
function scoreTierSeconds(input: SimFrameInput): number[] {
  const hits = input.chart.hitTimes;
  if (input.scene.showGameUi === false || !input.assets.hud?.scoreFill || hits.length === 0) {
    return [];
  }
  const times = new Set<number>();
  for (const threshold of SCORE_TIER_THRESHOLDS) {
    const tierScore = Math.round(threshold * SCORE_MAX);
    const index = Math.ceil(hits.length * tierScore / SCORE_MAX) - 1;
    const transition = hits[index];
    if (transition === undefined) continue;
    // 同拍的音符同时加分。前一档最满的一帧取前一个不同的命中时点。
    let previous = index - 1;
    while (previous >= 0 && hits[previous] === transition) previous--;
    if (previous >= 0) times.add(hits[previous]!);
    times.add(transition);
  }
  const lastHit = hits.at(-1);
  if (lastHit != null) times.add(lastHit + 0.03);
  return [...times];
}

/** 按真实谱面的绘制种类选准备帧，不 seek 播放器、不改变用户的播放位置。 */
function preparationSeconds(input: SimFrameInput): number[] {
  const times = new Set<number>([0]);
  const kinds = new Set<string>();
  for (const el of input.chart.elements) {
    if (kinds.has(el.kind)) continue;
    kinds.add(el.kind);
    times.add(el.time + 0.03);
    times.add(el.time + 0.16);
  }
  const bands = new Set<boolean>();
  for (const band of input.chart.bands) {
    if (bands.has(band.sp) || band.t0 === band.t1) continue;
    bands.add(band.sp);
    times.add((band.t0 + band.t1) / 2);
  }
  for (const t of scoreTierSeconds(input)) times.add(t);
  return [...times];
}

/** 目标全屏物理宽：保证窗口首进时也能预热全屏下的 `scoreFill` 放大采样着色器。 */
function fullscreenScoreWarmupWidth(bw: number, density: number): number {
  const screenW = typeof window !== 'undefined' && window.screen?.width > 0
    ? Math.round(window.screen.width * density)
    : 1920;
  return Math.max(bw, Math.min(2560, Math.max(1920, screenW)));
}

/**
 * 冷路径身份（票 85）：density / 素材 / GPU 变了才重跑预热。
 * scene 身份、亮度、HUD、全屏/窗口尺寸不在此列 —— 那些走 `setFrame`（可留一帧拉伸）。
 * 画布像素随 density 变；跟场地 CSS 尺寸走会在播放中 `getImageData`，全屏往返会卡一下。
 */
export interface SimRenderingWarmupKey {
  density: number;
  assets: unknown;
  gpu: unknown;
}

export function simRenderingWarmupKey(
  density: number,
  assets: unknown,
  gpu: unknown,
): SimRenderingWarmupKey {
  return { density, assets, gpu };
}

export function simRenderingNeedsWarmup(
  prepared: SimRenderingWarmupKey | null,
  next: SimRenderingWarmupKey,
): boolean {
  if (prepared == null) return true;
  return prepared.density !== next.density
    || prepared.assets !== next.assets
    || prepared.gpu !== next.gpu;
}

/**
 * 当前素材 / 场地尺寸的完整绘制准备（issue 80）。
 * 1px touch 只会排队，不能证明 GPU 冷路径已完成：用独立的 CPU 回读画布接收完整结果，
 * 播放主画布保持原来的 GPU 后端。逐帧让出；输入变化或卸载时丢弃旧任务。
 * 不参与离线导出，也不在每次 play / seek 时重跑。
 */
export async function prepareSimRendering(
  input: SimFrameInput,
  density: number,
  opts: {
    isCancelled?: () => boolean;
    yieldNow?: () => Promise<void>;
    bandRenderer?: SimFrameLayers['bandRenderer'];
  } = {},
): Promise<boolean> {
  const cancelled = opts.isCancelled ?? (() => false);
  const yieldNow = opts.yieldNow ?? yieldToMainThread;
  await (opts.yieldNow ? yieldNow() : waitForPaint()); // 加载文案先画出，再跑 GPU 冷路径。
  if (cancelled()) return false;
  const canvas = document.createElement('canvas');
  const readback = document.createElement('canvas');
  const { w, h } = input.metrics;
  const bw = Math.max(1, Math.round(w * density));
  const bh = Math.max(1, Math.round(h * density));
  canvas.width = readback.width = bw;
  canvas.height = readback.height = bh;
  try {
    const ctx = canvas.getContext('2d');
    const cpu = readback.getContext('2d', { willReadFrequently: true });
    if (!ctx || !cpu) return true; // 与既有缺上下文降级一致，不永久卡在加载态。
    const comboShadows = prepareSimComboSprites(input.metrics, input.assets.sprites, density);
    const lifeGauge = prepareSimLifeGauge(
      input.metrics,
      density,
      input.assets.hud,
      input.scene.autoMode ?? false,
      input.chart.hitTimes.length,
    );
    const probe = { ...input, scene: { ...input.scene, apCombo: true, showGameUi: true } };
    const layers = { bandRenderer: opts.bandRenderer, comboShadows, lifeGauge };
    const times = preparationSeconds(probe);
    for (let i = 0; i < times.length; i++) {
      if (cancelled()) return false;
      ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
      drawSimFrameAt(ctx, probe, times[i]!, layers);
      cpu.drawImage(canvas, 0, 0);
      cpu.getImageData(0, 0, 1, 1);
      await yieldNow();
    }
    // 票 85 移除尺寸入 warmup key 后，窗口态（如 1410x793）预热时 scoreFill 从未触发放大采样；
    // 额外在全屏目标像素尺寸下跑完分数跨档秒点（不拉大实时 WebGL 带体缓冲），消灭进全屏后的中途编译停顿。
    const warmW = fullscreenScoreWarmupWidth(bw, density);
    const scoreTimes = scoreTierSeconds(probe);
    if (warmW > bw && scoreTimes.length > 0) {
      const warmH = Math.max(1, Math.round((warmW * h) / Math.max(1, w)));
      canvas.width = readback.width = warmW;
      canvas.height = readback.height = warmH;
      const warmLifeGauge = prepareSimLifeGauge(
        input.metrics,
        warmW / Math.max(1, w),
        input.assets.hud,
        input.scene.autoMode ?? false,
        input.chart.hitTimes.length,
      );
      const scoreLayers: SimFrameLayers = { comboShadows, lifeGauge: warmLifeGauge };
      for (let i = 0; i < scoreTimes.length; i++) {
        if (cancelled()) return false;
        ctx.setTransform(warmW / w, 0, 0, warmH / h, 0, 0);
        drawSimFrameAt(ctx, probe, scoreTimes[i]!, scoreLayers);
        cpu.drawImage(canvas, 0, 0);
        cpu.getImageData(0, 0, 1, 1);
        await yieldNow();
      }
    }
    return !cancelled();
  } finally {
    canvas.width = canvas.height = readback.width = readback.height = 1;
  }
}
