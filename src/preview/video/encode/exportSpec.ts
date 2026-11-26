// 视频导出的**规格**（chart-preview 07）：档位 / 容器 / 时间线 / 尺寸解算 / 文件名。
//
// 这里**只有纯函数、不碰 DOM**（锁测在 node 环境跑），DOM 侧的出帧 / 编码 / 封装在
// `frameDriver.ts` / `muxer.ts`。
//
// 口径来源（06 实测回填，`docs/research/chart-preview-export-limits.md` §5）：
//   - **AAC 的可用性是运行时的事，不是本仓能写死的常量**。06 那台（Chromium 153 / Linux /
//     软光栅 / headless shell）测出 `mp4a.40.2` / `40.5` 全 false，只有 `opus` true —— 但
//     Electron 38（Chromium 140）在 Windows / macOS 上走的是平台音频编码器（MediaFoundation /
//     AudioToolbox），**很可能**是 true（research §9 第 3 条把它列为"待真机复验"）。
//     ⇒ 因此本文件只给**候选表**：mp4 先试 AAC、不行再 Opus；容器默认取 mp4，探测时若拿不到
//       AAC 就自动退到 webm（见 `candidateOrder`）。**不在代码里断言"AAC 不可用"**。
//   - 顺带一条组合学：mp4 + Opus 的兼容面**比 webm 还窄**（QuickTime / Safari 与多数剪辑软件
//     认的是 mp4 壳里的 AAC，换成 Opus 一样放不出），所以它是"用户手选 mp4 且本机无 AAC"时的
//     产物，**不**当默认、**不**当兜底。
//   - **H.264 的边长必须偶数**：`fitDesignSurface(1920, 1080)` 给的是 1920×1079 →
//     `isConfigSupported` = false；场地尺寸要自己向下取偶（不是画布尺寸 —— 画布按档位走）。
//   - 帧率 60；码率按档位给（编码不是瓶颈，别指望降码率提速）。
import { fitDesignSurface, type SimChart } from '../sim';
import { SIM_SPRITE_EFFECT_DURATION } from '../sim/simGeometry';
import { SIM_JUDGE } from '../sim/simHud';

/** 导出帧率（票面规格默认 60fps） */
export const EXPORT_FPS = 60;

/**
 * 离线音轨的采样率：Opus 的原生率（48 kHz）。
 * 全仓此前唯一硬编码的 44100 在 `probeAudioDuration`（只为 decode），本票不复用它 ——
 * 导出要的是"喂得进 AudioEncoder"的那一份，48 kHz 免去一次重采样。
 */
export const EXPORT_AUDIO_SAMPLE_RATE = 48000;
/** 离线音轨声道数（BGM 与键音都是立体声位；单声道源文件由 Web Audio 上混） */
export const EXPORT_AUDIO_CHANNELS = 2;

/** 容器（封装格式） */
export type VideoContainer = 'webm' | 'mp4';

/**
 * 容器**选择**（比 `VideoContainer` 多一个 `auto`）：
 * `auto` = 按本机编码能力挑最通用的一格（默认）；另两个 = 用户手选，尊重选择。
 */
export type VideoContainerChoice = VideoContainer | 'auto';

/** 分辨率档 id */
export type VideoTierId = '1080p' | '720p';

export interface VideoTier {
  id: VideoTierId;
  /** 画布宽（CSS px = 位图 px，导出不做超采样） */
  width: number;
  /** 画布高 */
  height: number;
  /** 视频码率（bps） */
  bitrate: number;
}

/**
 * 分辨率档（06 §5.4：软光栅机器上 1080p 只有 0.26× 实时、720p 0.71×）。
 * 给档不给"硬钉 1080p"：长谱在低端机上跑不完时有一条退路。
 * 两档都是偶数（H.264 的 4:2:0 要求；见 `resolveExportGeometry`）。
 */
export const VIDEO_EXPORT_TIERS: readonly VideoTier[] = [
  { id: '1080p', width: 1920, height: 1080, bitrate: 12_000_000 },
  { id: '720p', width: 1280, height: 720, bitrate: 6_000_000 },
];

/** 默认档（票面规格默认 1920×1080） */
export const DEFAULT_VIDEO_TIER: VideoTierId = '1080p';
/**
 * 默认容器 = **`auto`**：不写死某一格，把选择交给运行时探测。
 *
 * `auto` 的含义（见 `candidateOrder`）：本机有 AAC ⇒ **mp4（H.264 + AAC）**，通用性最好；
 * 本机没有 ⇒ **webm（VP9 + Opus）**，而不是产出 mp4 + Opus 那个兼容面更窄的混合体。
 * 用户手选 `mp4` / `webm` 则**尊重选择**（mp4 在无 AAC 时仍会出 mp4 + Opus，代价由 UI 说清）。
 * 出货环境一变，行为自己跟着变，不用改代码。
 */
export const DEFAULT_VIDEO_CONTAINER: VideoContainerChoice = 'auto';

/** AAC 的 codec 字符串（探测"能不能出真 mp4"时用） */
export const AAC_AUDIO_CODECS: readonly string[] = ['mp4a.40.2'];
/** Opus（全平台都试过的那个） */
export const OPUS_AUDIO_CODEC = 'opus';

/** 一家的编码组合 */
export interface ContainerSpec {
  id: VideoContainer;
  /**
   * 候选视频 codec（按序试 `isConfigSupported`，第一个通过的当选）。
   * H.264 用 High 5.1（`avc1.640033`）：Level 4.0 的 `640028` 吃不下 1080p60。
   */
  videoCodecs: readonly string[];
  /**
   * 候选音频 codec（按序试，第一个通过的当选）。
   * AAC 在前：**有平台 AAC 编码器时白拿一个真 mp4**；没有才退到 Opus。
   */
  audioCodecs: readonly string[];
  /** 封装库要的 codec 标识（`webm-muxer` 是 EBML 字符串，`mp4-muxer` 是短名） */
  muxerCodec: { video: string; audio: string };
  /** 落盘 MIME（浏览器降级 `Blob` 类型 + Electron 保存对话框过滤器） */
  mime: string;
  /** 文件扩展名（不带点） */
  extension: string;
}

export const CONTAINER_SPECS: Record<VideoContainer, ContainerSpec> = {
  webm: {
    id: 'webm',
    videoCodecs: ['vp09.00.10.08'],
    audioCodecs: ['opus'],
    muxerCodec: { video: 'V_VP9', audio: 'A_OPUS' },
    mime: 'video/webm',
    extension: 'webm',
  },
  mp4: {
    id: 'mp4',
    videoCodecs: ['avc1.640033', 'avc1.640028'],
    audioCodecs: [...AAC_AUDIO_CODECS, OPUS_AUDIO_CODEC],
    muxerCodec: { video: 'avc', audio: OPUS_AUDIO_CODEC },
    mime: 'video/mp4',
    extension: 'mp4',
  },
};

/** 兜底顺序：默认在前，另一个在后（两个都不行 = 导不出，UI 给明确文案） */
export const CONTAINER_FALLBACK_ORDER: readonly VideoContainer[] = ['mp4', 'webm'];

export function tierOf(id: VideoTierId): VideoTier {
  return VIDEO_EXPORT_TIERS.find((t) => t.id === id) ?? VIDEO_EXPORT_TIERS[0]!;
}

/** 该容器的音频 codec 里，哪些是 AAC（用来判断"能不能出真 mp4"） */
export function isAacCodec(codec: string): boolean {
  return codec.startsWith('mp4a.');
}

/**
 * 封装库要的音频 codec 标识：mp4-muxer 只认 `'aac' | 'opus'`，而 WebCodecs 的 codec 字符串是
 * `mp4a.40.2` ⇒ 这里做一次归一（`webm` 侧恒 `A_OPUS`）。
 */
export function muxerAudioCodecFor(spec: ContainerSpec, audioCodec: string): string {
  if (spec.id === 'mp4') return isAacCodec(audioCodec) ? 'aac' : 'opus';
  return spec.muxerCodec.audio;
}

/**
 * 候选顺序（**组合**优先，不是容器优先）。
 *
 * `auto`（默认）：
 *   ① mp4 + AAC —— 通用性最好的一格（Apple 生态与剪辑软件都认）
 *   ② webm + Opus —— AAC 没有时的正确兜底（凡是认 webm 的播放器必然认 VP9+Opus）
 *   ③④ mp4 + Opus / webm + Opus —— 前两格全灭才轮到的产物
 *
 * 手选 `mp4`：把它自己的候选表整条放最前（有 AAC 就是 mp4+AAC，没有也尊重选择出 mp4+Opus），
 * 后面接 `auto` 那条链。手选 `webm` 同理。
 *
 * 这么排的理由：mp4 + Opus 不该抢在 webm 前面当"兜底"（它的兼容面比 webm 还窄 ——
 * QuickTime / Safari 认的是 mp4 壳里的**AAC**，换成 Opus 一样放不出）。
 */
export interface TargetCandidate {
  container: VideoContainer;
  /** true = 只许 AAC（探"能不能出真 mp4"）；false = 候选表全给 */
  aacOnly: boolean;
}

export function candidateOrder(preferred: VideoContainerChoice): readonly TargetCandidate[] {
  const full = (container: VideoContainer): TargetCandidate => ({ container, aacOnly: false });
  // auto 只认这两格：① mp4 + AAC（最通用）② webm + Opus（AAC 没有时的正确兜底）。
  // 两格都不行就报"编码器不可用"——不再往下够 mp4 + Opus（它兼容面比 webm 还窄，而 webm 已经不行了）。
  const auto: TargetCandidate[] = [{ container: 'mp4', aacOnly: true }, full('webm')];
  if (preferred === 'auto') return auto;
  // 手选：把它自己的候选表整条提到最前（AAC 有就拿 AAC，没有也尊重选择出 mp4 + Opus），后面接 auto 那条链
  return dedupeCandidates([full(preferred), ...auto]);
}

/**
 * 去掉**探了等于没探**的那些格子：
 *   - 完全重复（容器 × codec 过滤相同）只留第一格；
 *   - 「只许 AAC」若排在同容器的「候选表全给」**之后**，它更严 ⇒ 必然也是 false，删掉。
 *     （反过来「只许 AAC」在前、「全给」在后是**必要**的：那正是 auto 的两道闸。）
 */
function dedupeCandidates(list: readonly TargetCandidate[]): TargetCandidate[] {
  const seen = new Set<string>();
  const seenFull = new Set<VideoContainer>();
  const out: TargetCandidate[] = [];
  for (const c of list) {
    const key = `${c.container}|${c.aacOnly}`;
    if (seen.has(key)) continue;
    if (c.aacOnly && seenFull.has(c.container)) continue;
    seen.add(key);
    if (!c.aacOnly) seenFull.add(c.container);
    out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------- 时间线

/** 一次导出的帧时间线（纯数据；`secondsAt` / `timestampUsAt` 是它上面的自由函数） */
export interface ExportTimeline {
  fps: number;
  /**
   * 成片总长（秒）= 开场 + 前导 + 谱面 + 末击尾段 + 结尾。
   * 生产路径由 `buildExportTimeline(segments)` 一次加出；不要在消费方再加一遍。
   */
  durationSeconds: number;
  /** 总帧数 = `ceil(duration × fps)` */
  frameCount: number;
  /** 谱面 0 秒在成片里的绝对秒 = 开场 + 前导 */
  simStartSeconds: number;
  /**
   * 结尾切点与结尾 SE 的绝对秒 = simStart + 谱面 + 末击尾段。
   * 画面 `t >= endingAt` 与 `endingSfxCues.at` 必须读这一份，禁止从总长倒推。
   * 关掉结尾时等于总长（切点落在成片之外，永不命中）。
   */
  endingAt: number;
}

/**
 * 五段输入（票 89）：公式仍是 `leadInSeconds` / `endingTailSeconds`，
 * **组合只在 `buildExportTimeline` 这一处**。`chartDurationSeconds` = 谱面长度 D（音频时长）。
 */
export interface ExportTimelineSegments {
  openingSeconds: number;
  leadIn: number;
  chartDurationSeconds: number;
  chartTailSeconds: number;
  endingSeconds: number;
}

/** 浮点收味：`duration × fps` 正好落在整数上时（30 × 60）不该被尾数顶到 +1 帧 */
const FRAME_EPS = 1e-9;

/**
 * 谱面前导补偿的封顶（秒，票 74 定案）。
 *
 * 单独留一个常量 = 成片验收后调参只改这一处：帧循环 / `drawSimFrameAt` / 开场四段 / 素材都不动。
 * 不取满 `T` 的原因：`approachA` 是指数曲线，T 的前 ~80% 里 A < 0.14 几乎贴在渐近位置，
 * 慢速档（T = 5.5s）补满只会多出约 4s 近乎静态的画面。
 */
export const LEAD_IN_CAP_SECONDS = 2;

/**
 * 一次导出要在谱面 0 秒之前补多少秒（票 74）。
 *
 * `T = chart.approachS`（与 `buildSimChart` / 实时回放同源），取 `min(T, 2s)` 后**向上取整到
 * `1/fps` 的整数倍**，保证 `simStartSeconds` 与首帧都恰好落在帧边界上。
 * 关掉开场时这段同样存在：第 0 帧就是 `seconds = -leadIn`。
 */
export function leadInSeconds(
  chart: Pick<SimChart, 'approachS'>,
  fps: number = EXPORT_FPS,
): number {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : EXPORT_FPS;
  const approach = Number.isFinite(chart.approachS) ? Math.max(0, chart.approachS) : 0;
  const wanted = Math.min(approach, LEAD_IN_CAP_SECONDS);
  return Math.max(0, Math.ceil(wanted * safeFps - FRAME_EPS) / safeFps);
}

/**
 * 前导首帧收味（票 74 成片验收回修）：封顶生效时给音符层一段肉眼可见的淡入。
 *
 * 只在 `leadIn < T`（慢速档）时启用 —— `leadIn == T` 时首音符本来就从 `A≈0.058` 起步，
 * 不需要淡入。帧数常量单独留口，成片若还嫌突兀只改这里，不动帧循环 / 渲染纯函数。
 * 初版 2 帧（33ms）用户反馈「肉眼基本不可见」⇒ 2026-11-15 加长到 15 帧（0.25s @60fps）。
 */
export const LEAD_IN_NOTE_FADE_FRAMES = 15;

/**
 * 前导段第 N 帧的音符层 alpha（`1/N → 1` 线性，只走头 `LEAD_IN_NOTE_FADE_FRAMES` 帧）。
 * **整层** alpha：这 0.25s 里所有已进入可见窗口的音符 / 带体 / 双押线一起渐显；
 * 谱面正片（`t ≥ simStart`）、前导段其余帧与实时回放恒为 1，不受影响。
 */
export function leadInNoteAlphaAt(
  elapsedSeconds: number,
  leadIn: number,
  approachS: number,
  fps: number = EXPORT_FPS,
): number {
  if (!(leadIn > 0) || !(approachS > leadIn + FRAME_EPS)) return 1;
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : EXPORT_FPS;
  const frame = Math.max(0, Math.floor(elapsedSeconds * safeFps + FRAME_EPS));
  if (frame >= LEAD_IN_NOTE_FADE_FRAMES) return 1;
  return Math.max(0, Math.min(1, (frame + 1) / LEAD_IN_NOTE_FADE_FRAMES));
}

// ---------------------------------------------------------------- 末击收尾补偿（票 75）
//
// 谱面段末尾按「最后一个可击打物的绝对秒 + 特效 / 判定字寿命」补一段真实时长，让末击
// 自然播完再切结算。与开头的 lead-in 不同：tail 是连续量且可能为 0（谱面比音频短就不补），
// BGM 已结束所以尾段静音，但画面继续推进（特效在衰减）。
// **公式与 life 只在这里定义一次**：`endingAt` 与成片总长由 `buildExportTimeline(segments)`
// 一次加出（票 89：画面切点与结尾 SE 读同一 `endingAt`，禁止从总长倒推）；
// 舞台秒 = `endingAt − simStart`。轨长仍按段相加（硬化成读总长不是本票必做项）。
// 成片验收后若仍有残留或尾段偏长，只改 life 或公式，不动帧循环 / 结算三段 / 素材。

/** 末击之后要留的寿命（秒）：打击特效 0.6 与判定字 1.0 取长者 */
export const ENDING_HIT_LIFE_SECONDS = Math.max(SIM_SPRITE_EFFECT_DURATION, SIM_JUDGE.life);

/** 尾段只需要谱面派生表的这三张表（与 `buildSimChart` 同源，不另折一遍 beat→秒） */
type TailChart = Pick<SimChart, 'elements' | 'bands' | 'simultaneous'>;

/**
 * 最后一个可击打物的**绝对秒**：元素表末尾（已按 time 升序）、带体两端点、双押线时刻取最大。
 * 空谱 / 无有限时刻 ⇒ `null`（没有末击，自然没有要收的尾）。
 */
export function lastHitSeconds(chart: TailChart): number | null {
  let last: number | null = null;
  const take = (time: number): void => {
    if (!Number.isFinite(time)) return;
    if (last === null || time > last) last = time;
  };
  const elements = chart.elements;
  if (elements.length > 0) take(elements[elements.length - 1]!.time);
  for (const band of chart.bands) {
    take(band.t0);
    take(band.t1);
  }
  const simultaneous = chart.simultaneous;
  if (simultaneous.length > 0) take(simultaneous[simultaneous.length - 1]!.time);
  return last;
}

/**
 * 末击收尾补偿 `tail = ceilToFrame(max(0, lastHit + life − D))`（`D` = 谱面长度 = 音频时长）。
 *
 * 向上取整到 `1/fps` 整数倍，保证 `endingAt` 与结算第一帧都落在帧边界上；
 * `lastHit ≤ D − life` 时返回 0（不无条件补时长）。`life` 取 `ENDING_HIT_LIFE_SECONDS`。
 */
export function endingTailSeconds(
  chart: TailChart,
  durationSeconds: number,
  fps: number = EXPORT_FPS,
): number {
  if (!Number.isFinite(durationSeconds)) return 0;
  const lastHit = lastHitSeconds(chart);
  if (lastHit === null) return 0;
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : EXPORT_FPS;
  const wanted = Math.max(0, lastHit + ENDING_HIT_LIFE_SECONDS - Math.max(0, durationSeconds));
  if (wanted <= 0) return 0;
  return Math.max(0, Math.ceil(wanted * safeFps - FRAME_EPS) / safeFps);
}

// ---------------------------------------------------------------- 跨段 HUD 时序
//
// 票 76（原型第四版默认档 2026-11-15）：分数条 / 生命条不再是「谱面段内部的一个布尔开关」，
// 而是**跨段独立层**。入 / 出锚点挂在两个转场上，与谱面 0 秒 / `endingAt` 解耦：
// 开场四段恒 0 → 转场后淡入 → 穿过前导 / 正片 / 中央章恒 1 → 黑幕转场淡出 → 结算 0。
// 生产只落 `fixed`（修正后）这一条口径；原型里的 `legacy` / `aboveFx` 只供对比，不进生产。

/** 一次导出里 HUD 要挂靠的绝对秒（由 `frameDriver` 按生产常量拼好喂进来） */
export interface VideoHudTimeline {
  /** 开场四段结束（`OPENING_SECONDS`）；关开场 = 0 */
  openEnd: number;
  /** 结尾段起点（谱面 + 末击尾段之后）；关结尾时落在总长之外 */
  endingAt: number;
  /** 中央章时长（`ENDING_SPEC.stampDur`） */
  stampDur: number;
}

/** 原型第四版默认档：入场锚 = 开场转场终点前 2s、淡入 1s；退场锚 = 中央章结束、淡出 0.34s。
 *  锚点可换的滑杆只属于原型调参 UI，生产只落定案这两个。 */
export const VIDEO_HUD_TIMING = {
  inOffset: -2,
  inDur: 1,
  outOffset: 0,
  /** = 黑幕涨满 0.22 × transDur(1.55)，在结算组件入场前彻底归零 */
  outDur: 0.34,
} as const;

export interface VideoHudWindows {
  inAt: number;
  inEnd: number;
  outAt: number;
  outEnd: number;
}

const hudClamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const hudSmooth = (x: number): number => x * x * (3 - 2 * x);

/** 淡入 / 淡出两个窗口（绝对秒）：`openEnd` 与 `endingAt + stampDur` 就是两个锚点 */
export function videoHudWindows(tl: VideoHudTimeline): VideoHudWindows {
  const inAt = Math.max(0, tl.openEnd + VIDEO_HUD_TIMING.inOffset);
  const outAt = Math.max(inAt, tl.endingAt + tl.stampDur + VIDEO_HUD_TIMING.outOffset);
  return {
    inAt,
    inEnd: inAt + VIDEO_HUD_TIMING.inDur,
    outAt,
    outEnd: outAt + VIDEO_HUD_TIMING.outDur,
  };
}

/** 整层 alpha：开场 0 → 淡入 → 常驻（含前导 / 正片 / 中央章）→ 淡出 → 结算 0 */
export function videoHudAlphaAt(t: number, tl: VideoHudTimeline): number {
  const w = videoHudWindows(tl);
  if (t <= w.inAt || t >= w.outEnd) return 0;
  const rise = w.inEnd > w.inAt
    ? hudSmooth(hudClamp01((t - w.inAt) / (w.inEnd - w.inAt))) : 1;
  const fall = w.outEnd > w.outAt
    ? 1 - hudSmooth(hudClamp01((t - w.outAt) / (w.outEnd - w.outAt))) : 0;
  return hudClamp01(Math.min(rise, fall));
}

function finiteNonNeg(n: number): number {
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function timelineFromDuration(durationSeconds: number, fps: number): ExportTimeline {
  const safeDuration = finiteNonNeg(durationSeconds);
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : EXPORT_FPS;
  const raw = safeDuration * safeFps;
  const frameCount = Math.max(1, Math.ceil(raw - FRAME_EPS));
  return {
    fps: safeFps,
    durationSeconds: safeDuration,
    frameCount,
    simStartSeconds: 0,
    endingAt: safeDuration,
  };
}

/**
 * 建导出时间线。
 *
 * - **帧数 = `ceil(duration × fps)`**：不早停（末帧的秒仍 < duration，故最后一帧是"还没到终点"
 *   的那一拍），也不重复末帧（帧数不 +1 —— 多出来那一帧会与末帧同一秒）。
 * - `duration <= 0` → 至少 1 帧（空谱也要出一个可播的文件，不是 0 帧）。
 * - 传入五段时一次加出 `simStartSeconds` / `endingAt` / 总长（票 89）；只传秒数时
 *   `endingAt` = 总长（给帧数单测 / 无分段的旧调用）。
 */
export function buildExportTimeline(segments: ExportTimelineSegments, fps?: number): ExportTimeline;
export function buildExportTimeline(durationSeconds: number, fps?: number): ExportTimeline;
export function buildExportTimeline(
  durationOrSegments: number | ExportTimelineSegments,
  fps: number = EXPORT_FPS,
): ExportTimeline {
  if (typeof durationOrSegments === 'object' && durationOrSegments) {
    const openingSeconds = finiteNonNeg(durationOrSegments.openingSeconds);
    const leadIn = finiteNonNeg(durationOrSegments.leadIn);
    const chartDurationSeconds = finiteNonNeg(durationOrSegments.chartDurationSeconds);
    const chartTailSeconds = finiteNonNeg(durationOrSegments.chartTailSeconds);
    const endingSeconds = finiteNonNeg(durationOrSegments.endingSeconds);
    const simStartSeconds = openingSeconds + leadIn;
    const endingAt = simStartSeconds + chartDurationSeconds + chartTailSeconds;
    return { ...timelineFromDuration(endingAt + endingSeconds, fps), simStartSeconds, endingAt };
  }
  return timelineFromDuration(durationOrSegments, fps);
}

/** 第 k 帧的**秒**（喂 `drawSimFrameAt`） */
export function frameSecondsAt(timeline: ExportTimeline, k: number): number {
  return k / timeline.fps;
}

/** 第 k 帧的 **pts（微秒）**：`k × 10^6 / fps` 取整 —— 严格单调递增，不重复 */
export function frameTimestampUs(timeline: ExportTimeline, k: number): number {
  return Math.round((k * 1_000_000) / timeline.fps);
}

/**
 * 一帧的时长（微秒，票 64）：喂 `VideoFrame.duration`，也是 `chunk.duration` 缺省时的回退值。
 *
 * `EncodedVideoChunk.duration` 在 WebCodecs 里是可选属性：Chromium 在输入帧不给 duration 时
 * 输出 0，Edge 会输出非有限数 —— 后者会被 `mp4-muxer` 的 `addVideoChunkRaw` 直接判非法。
 * 统一从这里取，别在出帧 / 封装两侧各写一份。
 */
export function frameDurationUs(fps: number): number {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : EXPORT_FPS;
  return Math.max(1, Math.round(1_000_000 / safeFps));
}

/**
 * 离线音轨的帧数（喂 `OfflineAudioContext` 的长度）。
 * 与视频对齐：同样按 `durationSeconds` 向上取整，**不早停**（末尾那半帧留着），
 * 也不因帧数取整而多出来（音频按秒算，不按帧算）。
 */
export function audioFramesFor(
  durationSeconds: number,
  sampleRate: number = EXPORT_AUDIO_SAMPLE_RATE,
): number {
  const safeDuration = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
  return Math.max(1, Math.ceil(safeDuration * sampleRate - FRAME_EPS));
}

// ---------------------------------------------------------------- 尺寸

/** 一帧的画布与场地几何 */
export interface ExportGeometry {
  /** 画布（= 档位尺寸，偶数） */
  width: number;
  height: number;
  /** 场地（设计面 contain 进画布后**向下取偶**），画布内左上角偏移 */
  field: { w: number; h: number; x: number; y: number };
}

/** 向下取偶（最小 2） */
function evenDown(v: number): number {
  return Math.max(2, Math.floor(v / 2) * 2);
}

/**
 * 解算导出几何：设计面 1334×750 **contain** 进档位尺寸（与实时舞台同一份 `fitDesignSurface`），
 * 再把场地边长**向下取偶**、居中放进画布。
 *
 * 为什么不是"画布 = 场地"：档位是标准尺寸（1920×1080 / 1280×720），播放器与分享场景认它；
 * 取偶只动场地（16:9 与设计面 1.7787:1 差出来的 ≤1px 由上下留边吃掉，左右恒无留边）。
 */
export function resolveExportGeometry(tier: VideoTier): ExportGeometry {
  const width = evenDown(tier.width);
  const height = evenDown(tier.height);
  const fitted = fitDesignSurface(width, height);
  const fw = evenDown(Math.min(width, fitted.w));
  const fh = evenDown(Math.min(height, fitted.h));
  return {
    width,
    height,
    field: {
      w: fw,
      h: fh,
      x: Math.round((width - fw) / 2),
      y: Math.round((height - fh) / 2),
    },
  };
}

/** 各平台文件名的非法字符（票 62）。控制字符按码点判，不进正则 */
const ILLEGAL_FILENAME_CHARS: ReadonlySet<string> = new Set(['\\', '/', ':', '*', '?', '"', '<', '>', '|']);

/** Windows 保留设备名（大小写不敏感，按第一个点之前那段判） */
const WINDOWS_RESERVED_NAMES: ReadonlySet<string> = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

/**
 * 曲名 → 可落盘的导出文件名 stem（票 62，就地实现，不抽共享模块）。
 * 与片段分享 / 主进程落盘入口同口径，由 `ExportFileName.test.ts` /
 * `PatternFileName.test.ts` / `SaveDialogFileName.test.ts` 三处行为测锁一致。
 */
function sanitizeFileNameStem(name: string, fallback: string): string {
  let out = '';
  for (const ch of name.trim()) {
    const code = ch.codePointAt(0) ?? 0;
    out += ILLEGAL_FILENAME_CHARS.has(ch) || code <= 0x1f || code === 0x7f ? '_' : ch;
  }
  out = out.replace(/[. ]+$/, '');
  if (!out) return fallback;
  const head = out.split('.')[0]!.trim().toUpperCase();
  return WINDOWS_RESERVED_NAMES.has(head) ? `_${out}` : out;
}

/** 清洗后为空时回落的基础名（域层不引 i18n，给一个语言无关的常量） */
const VIDEO_EXPORT_FALLBACK_STEM = 'video';

/**
 * 导出文件的基础名（扩展名按当选容器补；`t()` 的插值在调用侧做）。
 * stem 先过就地清洗（票 62）：非法字符不再留到写盘那一刻才被 `writeFile` 判 EINVAL。
 */
export function videoExportBasename(base: string, extension: string): string {
  const ext = extension.replace(/^\./, '');
  const stem = sanitizeFileNameStem(base, VIDEO_EXPORT_FALLBACK_STEM);
  return `${stem}.${ext}`;
}
