import { waitForPaint, yieldToMainThread } from '../../static/exportPanels';
import { drawSimFrameAt, prepareSimComboSprites, type SimFrameInput, type SimFrameLayers } from './simField';

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
  // 顶栏高分态（含发光粒子）也要在音频开始前走一次。
  const lastHit = input.chart.hitTimes.at(-1);
  if (lastHit != null) times.add(lastHit + 0.03);
  return [...times];
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
  canvas.width = readback.width = Math.max(1, Math.round(w * density));
  canvas.height = readback.height = Math.max(1, Math.round(h * density));
  try {
    const ctx = canvas.getContext('2d');
    const cpu = readback.getContext('2d', { willReadFrequently: true });
    if (!ctx || !cpu) return true; // 与既有缺上下文降级一致，不永久卡在加载态。
    const comboShadows = prepareSimComboSprites(input.metrics, input.assets.sprites, density);
    const probe = { ...input, scene: { ...input.scene, apCombo: true, showGameUi: true } };
    const layers = { bandRenderer: opts.bandRenderer, comboShadows };
    const times = preparationSeconds(input);
    for (let i = 0; i < times.length; i++) {
      if (cancelled()) return false;
      ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
      drawSimFrameAt(ctx, probe, times[i]!, layers);
      cpu.drawImage(canvas, 0, 0);
      cpu.getImageData(0, 0, 1, 1);
      await yieldNow();
    }
    return !cancelled();
  } finally {
    canvas.width = canvas.height = readback.width = readback.height = 1;
  }
}
