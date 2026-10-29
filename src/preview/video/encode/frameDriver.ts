// 离线逐帧出帧（chart-preview 07；ADR-0016 §5）：
//
//   `drawSimFrameAt`（05 的**同一份**任意秒出帧）→ 离屏画布 → `VideoFrame` → 交给编码 / 封装。
//
// 三条口径：
//   - **不开第二份渲染真相**：画面完全由 `drawSimFrameAt` 画（`tests/static/VideoExportWiring.test.ts` 锁）。
//     导出只换画布与场地尺寸（固定档，**不读窗口、不读 devicePixelRatio**，ADR-0016 §7）。
//   - **进度按帧数走**（06 §5.4：软光栅下 1080p 端到端约 0.26× 实时，"≈ 歌曲时长"这个估法会
//     差到 4 倍）；进度与取消都在本模块的循环里。
//   - **分片让出主线程**（与宽图导出同一份 `yieldToMainThread`）：长谱导出期间页面不掉响应。
//     worker 那条路（06 §4 末）要给 `CanvasSpriteIcon` 补 ImageBitmap 通路，本票不走。
import { drawSimFrameAt, SIM_FALLBACK_BG, type SimFrameInput } from '../sim/simField';
import { fieldMetrics, type SimFieldMetrics } from '../sim';
import { yieldToMainThread } from '../../static/exportPanels';
import {
  drawOpeningFieldBackground,
  drawOpeningFrameAt,
  drawOpeningTrack,
  openingAlphaAt,
  openingSegmentAt,
  openingTrackAlphaAt,
  type OpeningFrameInput,
} from '../opening';
import {
  frameSecondsAt,
  frameTimestampUs,
  type ExportGeometry,
  type ExportTimeline,
} from './exportSpec';

/**
 * 每满这么多帧让出一拍主线程。
 * 取 2：1080p 一帧约 62 ms（06 §5.4 软光栅实测），两块一让 = 单次任务 ~120 ms，
 * 既撑得住"页面不掉响应"，又不至于让出开销吃掉太多总时长。
 */
const YIELD_EVERY_FRAMES = 2;

export interface FrameDriverRequest {
  /** 实时那一帧的输入（谱面派生表 / 场景 / 素材 / 精灵）；**场地尺寸由本模块按导出档给**，故这里不带 `metrics` */
  frame: Omit<SimFrameInput, 'metrics'>;
  geometry: ExportGeometry;
  timeline: ExportTimeline;
  /**
   * 视频开场（chart-preview 30）：`null` = 关掉开场（第 0 帧即谱面 0 秒、总长 = 谱面时长）。
   * 非 null 时时间轴最前面 `OPENING_SECONDS` 秒走开场四段，其后是谱面。
   */
  opening?: OpeningFrameInput | null;
  /** 开场段长度（秒）：谱面秒 = 视频秒 − 它。与 `opening` 成对给（关掉开场时是 0） */
  openingSeconds?: number;
  /**
   * 每画出一帧就调（画布已就绪，`VideoFrame` 由本模块建好并在回调后 `close()`）。
   * 返回 Promise 会被 await —— 编码入队有背压时靠它把帧节奏压下来。
   */
  onFrame: (frame: VideoFrame, index: number) => Promise<void> | void;
  /** 取消判定（UI 的取消钮置位）；每帧开头查一次 */
  isCancelled?: () => boolean;
  /** 进度（帧数口径） */
  onProgress?: (progress: { frame: number; total: number }) => void;
  /** 让出间隔（帧；测试可给大值少让出） */
  yieldEvery?: number;
}

export interface FrameDriverResult {
  /** 实际画出的帧数 */
  rendered: number;
  /** 被取消（未画满） */
  cancelled: boolean;
}

/**
 * 逐帧出帧。返回画了多少帧 / 是不是被取消 —— **不负责**编码与落盘（那是 `muxer` 与编排层的事）。
 *
 * 留边那一圈（画布比场地大出的 ≤1px）先用场地自身的兜底底色铺满再画场地：
 * `drawSimFrameAt` 只填场地矩形，留白不铺就是透明，而 H.264 没有 alpha 通道。
 */
export async function driveExportFrames(req: FrameDriverRequest): Promise<FrameDriverResult> {
  const { frame, geometry, timeline, onFrame } = req;
  const yieldEvery = Math.max(1, Math.floor(req.yieldEvery ?? YIELD_EVERY_FRAMES));
  const canvas = document.createElement('canvas');
  canvas.width = geometry.width;
  canvas.height = geometry.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('导出失败：离屏画布不可用（无法创建 2d 上下文）');

  const metrics: SimFieldMetrics = fieldMetrics(geometry.field.w, geometry.field.h);
  const input: SimFrameInput = { ...frame, metrics };
  let rendered = 0;

  for (let k = 0; k < timeline.frameCount; k++) {
    if (req.isCancelled?.()) return { rendered, cancelled: true };

    const t = frameSecondsAt(timeline, k);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = SIM_FALLBACK_BG;
    ctx.fillRect(0, 0, geometry.width, geometry.height);

    const seg = req.opening ? openingSegmentAt(t) : 'sim';
    if (seg === 'sim') {
      // 谱面段：场地按导出档画在留边中间（transform 是「场地原点」，绘制里一律用场地 CSS 坐标）
      ctx.setTransform(1, 0, 0, 1, geometry.field.x, geometry.field.y);
      // 开场段占掉了时间轴最前面那段 ⇒ 谱面秒 = 视频秒 − 开场长度（见 exportVideo 传进来的 timeline）
      drawSimFrameAt(ctx, input, t - (req.openingSeconds ?? 0));
    } else if (seg === 'fadeIn' || seg === 'hold') {
      // ① 开场淡入 / ② 停留：整块画布画开场画面（一个 alpha 管整屏）
      drawOpeningFrameAt(ctx, geometry.width, geometry.height, req.opening!, openingAlphaAt(t));
    } else {
      // ③ 入场过渡 / ④ 轨道淡入：只画场地的分层（背景 → 轨道），**不进 drawSimFrameAt**
      // （负秒下它会画出正在接近的音符 / 带体，不是干净的场地）
      ctx.setTransform(1, 0, 0, 1, geometry.field.x, geometry.field.y);
      // 背景亮度（票 43）与正片同一份 scene：开场③段也压暗，导出物才与预览一致
      drawOpeningFieldBackground(ctx, metrics, frame.assets, frame.scene.bgBrightness);
      drawOpeningTrack(ctx, metrics, frame.assets, openingTrackAlphaAt(t));
      if (seg === 'fadeOut') {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        drawOpeningFrameAt(ctx, geometry.width, geometry.height, req.opening!, openingAlphaAt(t));
      }
    }

    const vf = new VideoFrame(canvas, { timestamp: frameTimestampUs(timeline, k) });
    try {
      await onFrame(vf, k);
    } finally {
      vf.close();
    }
    rendered = k + 1;
    req.onProgress?.({ frame: rendered, total: timeline.frameCount });
    if (rendered % yieldEvery === 0) await yieldToMainThread();
  }

  return { rendered, cancelled: false };
}
