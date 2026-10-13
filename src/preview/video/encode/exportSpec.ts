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
import { fitDesignSurface } from '../sim';

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
  /** 谱面长度（秒，ADR-0005 第一性：有音频 = 音频时长） */
  durationSeconds: number;
  /** 总帧数 = `ceil(duration × fps)` */
  frameCount: number;
}

/** 浮点收味：`duration × fps` 正好落在整数上时（30 × 60）不该被尾数顶到 +1 帧 */
const FRAME_EPS = 1e-9;

/**
 * 建导出时间线。
 *
 * - **帧数 = `ceil(duration × fps)`**：不早停（末帧的秒仍 < duration，故最后一帧是"还没到终点"
 *   的那一拍），也不重复末帧（帧数不 +1 —— 多出来那一帧会与末帧同一秒）。
 * - `duration <= 0` → 至少 1 帧（空谱也要出一个可播的文件，不是 0 帧）。
 */
export function buildExportTimeline(durationSeconds: number, fps: number = EXPORT_FPS): ExportTimeline {
  const safeDuration = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : EXPORT_FPS;
  const raw = safeDuration * safeFps;
  const frameCount = Math.max(1, Math.ceil(raw - FRAME_EPS));
  return { fps: safeFps, durationSeconds: safeDuration, frameCount };
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

/** 导出文件的基础名（扩展名按当选容器补；`t()` 的插值在调用侧做） */
export function videoExportBasename(base: string, extension: string): string {
  const ext = extension.replace(/^\./, '');
  return `${base}.${ext}`;
}
