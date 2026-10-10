// 视频导出的**编排**（chart-preview 07）：把 05 的出帧、离线音轨、编码封装与 03 的落盘串起来。
//
//   素材就绪 → 解算规格 → 探编码器（含兜底）→ 渲染离线音轨 → 逐帧出帧 + 编码 → 封装 → 另存
//
// 页面只调这一个入口（`runVideoExport`）；进度 / 取消 / 失败态都从回调与返回值里出，
// 页面不做第二份编排（`tests/static/VideoExportWiring.test.ts` 锁"画面只经 drawSimFrameAt"）。
import type { AppSettings } from '../../../chart/config/AppSettings';
import { getBpmEvents, buildKeyEvents } from '../../../audio/AudioTiming';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '../../../rendering/skin/noteSkin';
import CanvasSpriteIcon from '../../../ui/CanvasSpriteIcon';
import { saveBinaryAs } from '../../static/saveBinary';
import { buildSimChart, loadSimAssets, type SimFrameInput, type SimPlaybackAudio, type SimScene } from '../sim';
import { driveExportFrames } from './frameDriver';
import {
  CONTAINER_SPECS,
  DEFAULT_AUDIO_TRACK,
  createVideoSink,
  probeContainer,
  type ContainerSupport,
} from './muxer';
import { decodeBgmBytes, renderAudioTrack } from './renderAudioTrack';
import {
  AAC_AUDIO_CODECS,
  DEFAULT_VIDEO_CONTAINER,
  EXPORT_FPS,
  buildExportTimeline,
  candidateOrder,
  resolveExportGeometry,
  tierOf,
  videoExportBasename,
  type ExportTimeline,
  type VideoContainer,
  type VideoContainerChoice,
  type VideoTierId,
} from './exportSpec';

/** 导出阶段（进度卡的文案按它分档） */
export type VideoExportPhase = 'assets' | 'audio' | 'frames' | 'muxing';

export interface VideoExportProgress {
  phase: VideoExportPhase;
  /** 已出帧数（`phase === 'frames'` 时递增） */
  frame: number;
  /** 总帧数 */
  totalFrames: number;
}

export interface VideoExportRequest {
  /** 谱面 + 作者设置（与实时回放同一份） */
  scene: SimScene;
  /** 作用域工程的音频（null = 无 BGM，只出键音） */
  audio: SimPlaybackAudio | null;
  /** 谱面长度（秒，ADR-0005 第一性） */
  durationSeconds: number;
  keySetId: string;
  seVolume: number;
  volume: number;
  noteSkin: AppSettings['visual']['noteSkin'];
  tier: VideoTierId;
  /** 首选容器（`'auto'` = 按本机编码能力挑；手选则尊重选择） */
  container: VideoContainerChoice;
  /** 静音导出：不出音轨（不是出一条静音轨） */
  muted: boolean;
  /** 文件名基础名（不含扩展名；扩展名按当选容器补） */
  suggestedBaseName: string;
  onProgress?: (progress: VideoExportProgress) => void;
  isCancelled?: () => boolean;
}

/**
 * 失败档：`'assets'` = 仿真场素材没就绪（用户有得照做）；`'unknown'` = 其余（原始错误只进 console）。
 * 域层只回档位、不产出用户可见文字 —— 文案由 UI 走 i18n（域不引 i18n，也不漏中文进英文界面）。
 */
export type VideoExportFailure = 'assets' | 'unknown';

export interface VideoExportOutcome {
  ok: boolean;
  /** 用户中途取消（不是失败） */
  cancelled: boolean;
  /** 编码器不可用（UI 给明确文案，不静默失败） */
  unsupported: boolean;
  /** 失败档（UI 据此给 i18n 文案） */
  failure?: VideoExportFailure;
  /** 落盘字节数（未落盘 = 0） */
  bytes: number;
  /** 最终当选的容器（失败时是探测过的最后一家） */
  container: VideoContainer | null;
  /** 实际当选的视频 / 音频 codec（UI 说清"落的是什么"，不是写死一句 AAC 不可用） */
  videoCodec?: string;
  audioCodec?: string | null;
  elapsedMs: number;
}

/** 探过若干组合之后的结论：当选的那一家（含实际 codec）+ 全不可用时的原因 */
interface ResolvedTarget {
  support: ContainerSupport;
  container: VideoContainer;
  /** 实际当选的音频 codec（null = 无音轨 / 没探） */
  audioCodec: string | null;
  reason?: ContainerSupport['reason'];
}

/**
 * 按 `candidateOrder` 逐个试：每格限不限定 AAC 由候选自己给。
 *
 * **为什么不"容器优先"**：mp4 + Opus 的兼容面比 webm 还窄（见 `exportSpec` 文件头），
 * 让它抢在 webm 前面就是拿一个更差的组合当兜底。
 */
async function resolveTarget(
  preferred: VideoContainerChoice,
  video: { width: number; height: number; fps: number },
  audio: { sampleRate: number; numberOfChannels: number } | null,
): Promise<ResolvedTarget> {
  let last: ContainerSupport | null = null;
  for (const cand of candidateOrder(preferred)) {
    const spec = CONTAINER_SPECS[cand.container];
    const support = await probeContainer(spec, {
      ...video,
      audio: audio ? { ...audio, codecs: cand.aacOnly ? AAC_AUDIO_CODECS : undefined } : null,
    });
    if (support.ok) {
      return { support, container: cand.container, audioCodec: support.audioCodec ?? null };
    }
    last = support;
  }
  return {
    support: last!,
    container: preferred === 'auto' ? 'mp4' : preferred,
    audioCodec: null,
    reason: last?.reason ?? 'video',
  };
}

/**
 * 本机到底会导出哪一种组合（UI 说清"实际会拿到什么"，别写死一句"AAC 不可用"）。
 *
 * 与真正导出时走**同一个** `resolveTarget`，所以面板里显示的就是待会儿会落盘的那一格。
 */
export interface VideoExportSupport {
  ok: boolean;
  /** 实际会用上的容器（null = 全都不可用） */
  container: VideoContainer | null;
  videoCodec?: string;
  audioCodec?: string | null;
  reason?: ContainerSupport['reason'];
}

export async function probeVideoExportSupport(opts: {
  tier: VideoTierId;
  muted: boolean;
  preferred?: VideoContainerChoice;
}): Promise<VideoExportSupport> {
  const geometry = resolveExportGeometry(tierOf(opts.tier));
  const resolved = await resolveTarget(
    opts.preferred ?? DEFAULT_VIDEO_CONTAINER,
    { width: geometry.width, height: geometry.height, fps: EXPORT_FPS },
    opts.muted ? null : DEFAULT_AUDIO_TRACK,
  );
  if (!resolved.support.ok) {
    return { ok: false, container: null, reason: resolved.reason };
  }
  return {
    ok: true,
    container: resolved.container,
    videoCodec: resolved.support.videoCodec,
    audioCodec: resolved.audioCodec,
  };
}

/**
 * 跑一次视频导出。**不抛**（失败与取消都从返回值出）—— 页面据此给 toast / 进度卡文案。
 */
export async function runVideoExport(req: VideoExportRequest): Promise<VideoExportOutcome> {
  const t0 = performance.now();
  const cancelled = (): boolean => req.isCancelled?.() === true;
  const done = (patch: Partial<VideoExportOutcome> & Pick<VideoExportOutcome, 'ok'>): VideoExportOutcome => ({
    cancelled: false,
    unsupported: false,
    bytes: 0,
    container: null,
    elapsedMs: performance.now() - t0,
    ...patch,
  });

  // ---------------- 素材（一次性出帧没有"下一帧补上"的机会，只能等齐） ----------------
  req.onProgress?.({ phase: 'assets', frame: 0, totalFrames: 0 });
  const noteIcons = buildActiveNoteIcons(normalizeNoteSkinSelection(req.noteSkin));
  const [assets] = await Promise.all([
    loadSimAssets({ bandSrc: noteIcons.slideBand.src, bandSpSrc: noteIcons.slideBandSp.src }),
    CanvasSpriteIcon.ensureImagesLoaded(noteIcons.preloadSrcs()).catch(() => undefined),
  ]);
  if (assets.missing) {
    return done({ ok: false, failure: 'assets' });
  }
  if (cancelled()) return done({ ok: true, cancelled: true });

  // ---------------- 规格 ----------------
  const tier = tierOf(req.tier);
  const timeline: ExportTimeline = buildExportTimeline(req.durationSeconds);
  const geometry = resolveExportGeometry(tier);
  const audioTrackParams = req.muted ? null : DEFAULT_AUDIO_TRACK;
  const target = await resolveTarget(
    req.container,
    { width: geometry.width, height: geometry.height, fps: timeline.fps },
    audioTrackParams,
  );
  if (!target.support.ok) {
    return done({ ok: false, unsupported: true, container: target.container });
  }

  // ---------------- 离线音轨 ----------------
  req.onProgress?.({ phase: 'audio', frame: 0, totalFrames: timeline.frameCount });
  const chart = buildSimChart(req.scene, noteIcons);
  const keyEvents = buildKeyEvents(req.scene.notes, req.scene.beatDisplay, getBpmEvents(req.scene.notes));
  let bgm: AudioBuffer | null = null;
  if (req.audio && !req.muted) {
    try {
      bgm = await decodeBgmBytes(await req.audio.blob.arrayBuffer());
    } catch {
      // 解码失败 = 按无 BGM 导（键音还在），不整票失败（与实时回放"解码失败按无音频"同口径）
      bgm = null;
    }
  }
  const track = await renderAudioTrack({
    durationSeconds: req.durationSeconds,
    keyEvents,
    keySetId: req.keySetId,
    bgm,
    volume: req.volume,
    seVolume: req.seVolume,
    muted: req.muted,
  });
  if (cancelled()) return done({ ok: true, cancelled: true });

  // ---------------- 编码 + 逐帧出帧 ----------------
  const sink = await createVideoSink({
    spec: CONTAINER_SPECS[target.container],
    videoCodec: target.support.videoCodec!,
    audioCodec: track ? target.support.audioCodec ?? null : null,
    width: geometry.width,
    height: geometry.height,
    fps: timeline.fps,
    bitrate: tier.bitrate,
    audio: track ? { sampleRate: track.sampleRate, numberOfChannels: track.numberOfChannels } : null,
  });

  try {
    const frame: Omit<SimFrameInput, 'metrics'> = {
      chart,
      scene: req.scene,
      assets,
      noteIcons,
      spriteIcon: new CanvasSpriteIcon(),
    };
    const driven = await driveExportFrames({
      frame,
      geometry,
      timeline,
      isCancelled: req.isCancelled,
      onProgress: (p) => req.onProgress?.({ phase: 'frames', frame: p.frame, totalFrames: p.total }),
      onFrame: (vf) => sink.addFrame(vf),
    });
    if (driven.cancelled) {
      sink.abort();
      return done({ ok: true, cancelled: true, container: target.container });
    }
    if (track) await sink.addAudio(track.buffer);

    req.onProgress?.({ phase: 'muxing', frame: timeline.frameCount, totalFrames: timeline.frameCount });
    const bytes = await sink.finish();
    const spec = CONTAINER_SPECS[target.container];
    const saved = await saveBinaryAs({
      bytes,
      suggestedName: videoExportBasename(req.suggestedBaseName, spec.extension),
      mime: spec.mime,
    });
    // 系统保存对话框里取消 = 用户取消（不是失败）
    return done({
      ok: true,
      cancelled: saved.cancelled,
      bytes: saved.cancelled ? 0 : bytes.byteLength,
      container: target.container,
      videoCodec: target.support.videoCodec,
      audioCodec: track ? target.audioCodec : null,
    });
  } catch (err) {
    sink.abort();
    console.error('[preview] 导出视频失败', err);
    return done({ ok: false, failure: 'unknown', container: target.container });
  }
}
