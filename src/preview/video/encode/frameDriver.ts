// 离线逐帧出帧（chart-preview 07；ADR-0016 §5）：
//
//   `drawSimFrameAt`（05 的**同一份**任意秒出帧）→ 离屏画布 → `VideoFrame` → 交给编码 / 封装。
//
// 三条口径：
//   - **不开第二份渲染真相**：画面走 `drawSimFrameAt`；票 76 的跨段 HUD 独立层走同文件的
//     `drawSimHudLayer`（同一个 `drawTopBar`），结尾段走 `drawEndingFrameAt`
//     （`tests/static/VideoExportWiring.test.ts` 锁）。
//     导出只换画布与场地尺寸（固定档，**不读窗口、不读 devicePixelRatio**，ADR-0016 §7）。
//   - **进度按帧数走**（06 §5.4：软光栅下 1080p 端到端约 0.26× 实时，"≈ 歌曲时长"这个估法会
//     差到 4 倍）；进度与取消都在本模块的循环里。
//   - **分片让出主线程**（与宽图导出同一份 `yieldToMainThread`）：长谱导出期间页面不掉响应。
//     worker 那条路（06 §4 末）要给 `CanvasSpriteIcon` 补 ImageBitmap 通路，本票不走。
import { drawSimFrameAt, drawSimHudLayer, SIM_FALLBACK_BG, type SimFrameInput } from '../sim/simField';
import { fieldMetrics, type SimFieldMetrics } from '../sim';
import { yieldToMainThread } from '../../static/exportPanels';
import {
  OPENING_SECONDS,
  drawOpeningFieldBackground,
  drawOpeningFrameAt,
  drawOpeningTrack,
  openingAlphaAt,
  openingSegmentAt,
  openingCoverIntroAt,
  openingTrackAlphaAt,
  type OpeningFrameInput,
} from '../opening';
import {
  drawEndingFrameAt,
  ENDING_SPEC,
  type EndingContentInput,
  type EndingFrameInput,
} from '../ending';
import {
  frameDurationUs,
  frameSecondsAt,
  frameTimestampUs,
  leadInNoteAlphaAt,
  videoHudAlphaAt,
  type ExportGeometry,
  type ExportTimeline,
  type VideoHudTimeline,
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
   * 视频开场（chart-preview 30）：`null` = 关掉开场（第 0 帧仍是前导负秒、总长 = 前导 + 谱面时长 + 末击尾段）。
   * 非 null 时时间轴最前面 `OPENING_SECONDS` 秒走开场四段，其后是前导补偿与谱面。
   */
  opening?: OpeningFrameInput | null;
  /** 开场段长度（秒）：仅用于旧调用方回落；票 74 起谱面秒由 `simStartSeconds` 定 */
  openingSeconds?: number;
  /**
   * 谱面 0 秒在整条视频里的绝对秒（票 74）= 开场段 + 前导补偿。
   * 音轨的 BGM / 键音也按它后移；关掉开场时它就是 lead-in 本身。
   */
  simStartSeconds?: number;
  /**
   * 结尾画面（chart-preview 52）：`null` = 关掉（时间轴到谱面 + 末击尾段结束为止）。
   * 非 null 时其后那段（`endingSeconds`）由它画，**场地用谱面末帧**（`drawSimFrameAt` 同一份）。
   * 票 75：舞台固定秒 = `D + tail`，所有音符 / 特效 / 按住环已过寿命窗口 ⇒ 结算下零残留。
   */
  ending?: EndingContentInput | null;
  /** 结尾段长度（秒）：与 `ending` 成对给（关掉时是 0） */
  endingSeconds?: number;
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
  // 票 66：导出离线逐帧、无实时时钟 ⇒ 显式固定 100% 光栅（成片最锐）；
  // 实时侧不带这个字段，固定 50% 留出实时绘制余量。
  const input: SimFrameInput = { ...frame, metrics, bandRasterScale: 1 };
  const duration = frameDurationUs(timeline.fps);
  let rendered = 0;

  // 谱面 0 秒的绝对位置（票 74）= 开场 + 前导。③④ 开场段仍按 `openingSegmentAt(t)` 画干净场地，
  // 之后到 `simStartSeconds` 之前是负秒前导帧，画面由 `drawSimFrameAt` 自己按可见窗口剔除。
  const openingSeconds = Math.max(0, req.openingSeconds ?? 0);
  const simStartSeconds = Math.max(0, req.simStartSeconds ?? req.openingSeconds ?? 0);
  // 票 74 回修：封顶生效（慢速档）时，前导头 15 帧（0.25s @60fps）给音符层一层极短淡入，收掉 A≈0.22 直现的突变。
  // 只在帧循环里算 alpha，总长 / 音轨 / 实时回放都不动。
  const leadIn = Math.max(0, simStartSeconds - openingSeconds);
  const approachS = input.chart.approachS;
  // 结尾段的起点 = 谱面 0 秒 + 谱面长度 + 末击尾段（票 75：总长已含 tail，故这里自然得出
  // `chartSeconds = D + tail`；关掉结尾时 `endingAt` 落在总长之外，永不命中）。
  // 尾段沿用同一条 `seconds = t − simStartSeconds`，帧循环不新增分支。
  const endingSeconds = req.ending ? Math.max(0, req.endingSeconds ?? 0) : 0;
  const chartSeconds = Math.max(
    0,
    timeline.durationSeconds - simStartSeconds - endingSeconds,
  );
  const endingAt = simStartSeconds + chartSeconds;

  // 票 76：跨段 HUD 的入 / 出锚点按生产常量拼成绝对秒。关开场时开场锚点归 0（入场从第 0 帧起）；
  // 关结尾时 `endingAt` 落在总长之外，`stampEnd` 自然超尾 ⇒ 末帧仍常驻、不淡出。
  const hudTimeline: VideoHudTimeline = {
    // 开场四段由 `openingSegmentAt(t)` 按 `OPENING_TIMING` 常量切，锚点也取同一份常量：
    // 旧调用方可能只给 `simStartSeconds` 而省掉 `openingSeconds`，那时不能用 0 当转场终点。
    openEnd: req.opening ? OPENING_SECONDS : 0,
    endingAt,
    stampDur: ENDING_SPEC.stampDur,
  };

  /** HUD 按场地原点画（与 `drawSimFrameAt` / 结尾舞台同一套坐标），进出都收好变换与 alpha。
   *  内容秒钳到 `[-leadIn, chartSeconds]`：开场别拿负秒算分数，结尾停在末帧分数。
   *  `flowSeconds` 不能跟着钳位 —— 结尾段要传未钳的 `t - simStartSeconds`，SS+ 星点才会
   *  一直流到分数条淡没；缺省回落内容秒（票 76 回修）。 */
  const drawHudLayer = (
    hudCtx: CanvasRenderingContext2D,
    seconds: number,
    alpha: number,
    flowSeconds?: number,
  ): void => {
    if (alpha <= 0) return;
    const hudSeconds = Math.max(-leadIn, Math.min(chartSeconds, seconds));
    hudCtx.save();
    hudCtx.setTransform(1, 0, 0, 1, geometry.field.x, geometry.field.y);
    drawSimHudLayer(hudCtx, input, hudSeconds, alpha, flowSeconds ?? hudSeconds);
    hudCtx.restore();
  };

  // 舞台按**同一个固定秒**逐帧重画（没有整帧缓存位图）：票 75 起 `chartSeconds = D + tail`
  // 越过末击 + 特效 / 判定字寿命，各层按既有窗口自然判空，舞台只剩背景 + 轨道
  // （轨道按 `trackFadeDur: 1` 淡出）；不给 `SimFrameLayers` 加 notes / effects alpha。
  const ending: EndingFrameInput | null = req.ending
    ? {
        ...req.ending,
        stage: {
          frame: input,
          seconds: chartSeconds,
          x: geometry.field.x,
          y: geometry.field.y,
        },
      }
    : null;

  for (let k = 0; k < timeline.frameCount; k++) {
    if (req.isCancelled?.()) return { rendered, cancelled: true };

    const t = frameSecondsAt(timeline, k);
    // 票 76：整片只算一次 HUD alpha，三段共用；开场 ③ / ④ 的淡入窗也落在这一条上
    const hudAlpha = videoHudAlphaAt(t, hudTimeline);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = SIM_FALLBACK_BG;
    ctx.fillRect(0, 0, geometry.width, geometry.height);

    const seg = req.opening ? openingSegmentAt(t) : 'sim';
    if (ending && t >= endingAt) {
      // 结尾段：章铺**谱面末帧**作舞台，UI 按整帧 1920×1080 画（不嵌进场地矩形）。
      // HUD 交给 drawEndingFrameAt 插在舞台与烟花之间 ⇒ 爆炸压在分数条 / 生命条上面。
      drawEndingFrameAt(ctx, geometry.width, geometry.height, ending, t - endingAt,
        undefined,
        (hudCtx) => drawHudLayer(hudCtx, chartSeconds, hudAlpha, t - simStartSeconds));
    } else if (seg === 'sim') {
      // 谱面段：场地按导出档画在留边中间（transform 是「场地原点」，绘制里一律用场地 CSS 坐标）
      ctx.setTransform(1, 0, 0, 1, geometry.field.x, geometry.field.y);
      // 谱面 0 秒落在 `simStartSeconds`；之前的帧是负秒，让第 0 beat 的音符走完接近窗口。
      // 封顶生效的慢速档：头 15 帧（0.25s @60fps）给音符层 alpha 1/15 → 1，收掉「从无到 A≈0.22」的突变。
      const noteAlpha = t < simStartSeconds
        ? leadInNoteAlphaAt(t - openingSeconds, leadIn, approachS, timeline.fps)
        : 1;
      drawSimFrameAt(ctx, input, t - simStartSeconds, { noteAlpha, hudAlpha });
    } else if (seg === 'fadeIn' || seg === 'hold') {
      // ① 开场淡入 / ② 停留：整块画布画开场画面（一个 alpha 管整屏；`t` 只喂堆叠缓出）
      drawOpeningFrameAt(ctx, geometry.width, geometry.height, req.opening!, openingAlphaAt(t), t);
      drawHudLayer(ctx, t - simStartSeconds, hudAlpha);
    } else {
      // ③ 入场过渡 / ④ 轨道淡入：只画场地的分层（背景 → 轨道），**不进 drawSimFrameAt**
      // （负秒下它会画出正在接近的音符 / 带体，不是干净的场地）
      ctx.setTransform(1, 0, 0, 1, geometry.field.x, geometry.field.y);
      // 背景亮度（票 43）与正片同一份 scene：开场③段也压暗，导出物才与预览一致。
      // 相框封面跟轨道同一个淡入窗（票 84 回修）：③ 只留空相框，④ 封面与车道线一起浮现
      // —— 否则它会在开场画面退场的同一瞬间整块出现（用户 2026-11-23 反馈"没有淡入"）。
      const trackAlpha = openingTrackAlphaAt(t);
      drawOpeningFieldBackground(
        ctx, metrics, frame.assets, frame.scene.bgBrightness, trackAlpha, openingCoverIntroAt(t),
      );
      drawOpeningTrack(ctx, metrics, frame.assets, trackAlpha);
      if (seg === 'fadeOut') {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        drawOpeningFrameAt(ctx, geometry.width, geometry.height, req.opening!, openingAlphaAt(t), t);
      }
      drawHudLayer(ctx, t - simStartSeconds, hudAlpha);
    }

    const vf = new VideoFrame(canvas, {
      timestamp: frameTimestampUs(timeline, k),
      duration,
    });
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
