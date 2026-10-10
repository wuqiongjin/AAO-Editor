// 视频导出的时间线 / 尺寸 / 容器（chart-preview 07 的锁测①）。
//
// 锁的是票面那几条**能算出来的**口径（编码与音画同步只能端到端人工验收）：
//   ① 帧数 = `ceil(duration × fps)`、帧时间戳与 pts 单调、不早停 / 不重复末帧；
//   ② 音轨长度与视频对齐（同一终点，不早停）；
//   ③ 场地边长取偶（H.264 的硬门槛，06 §5.2）；
//   ④ 容器口径：AAC 不可用 ⇒ 音轨只可能是 opus，mp4 只能配 H.264；
//   ⑤ `isConfigSupported` 为 false 时给的是**明确原因**，不是静默失败；
//   ⑥ 倒流区与 `beat < 0` 的口径与画布播放一致（元素 / 键音不含负时刻，combo 含）。
import { afterEach, describe, expect, it } from 'vitest';
import type { ChartNote, SingleNote } from '@/src/chart/types';
import { buildKeyEvents, getBpmEvents } from '@/src/audio/AudioTiming';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '@/src/rendering/skin/noteSkin';
import { buildSimChart } from '@/src/preview/video/sim/simField';
import type { SimScene } from '@/src/preview/video/sim/simField';
import { probeContainer } from '@/src/preview/video/encode/muxer';
import { probeVideoExportSupport } from '@/src/preview/video/encode/exportVideo';
import {
  AAC_AUDIO_CODECS,
  CONTAINER_FALLBACK_ORDER,
  CONTAINER_SPECS,
  DEFAULT_VIDEO_CONTAINER,
  DEFAULT_VIDEO_TIER,
  EXPORT_AUDIO_SAMPLE_RATE,
  EXPORT_FPS,
  VIDEO_EXPORT_TIERS,
  audioFramesFor,
  buildExportTimeline,
  candidateOrder,
  frameSecondsAt,
  frameTimestampUs,
  isAacCodec,
  muxerAudioCodecFor,
  resolveExportGeometry,
  tierOf,
  videoExportBasename,
} from '@/src/preview/video/encode/exportSpec';

const icons = buildActiveNoteIcons(normalizeNoteSkinSelection({}));
const single = (beat: number, lane: number): SingleNote => ({ type: 'Single', beat, lane });

const sceneOf = (notes: ChartNote[]): SimScene => ({
  notes,
  beatDisplay: 4,
  noteSpeed: 9.5,
  noteSize: 1,
  slideOpacity: 0.8,
  simultaneousClickLines: true,
  colorAssist: false,
  mirror: false,
});

describe('导出时间线 · 帧数与时间戳', () => {
  it('帧数 = ceil(duration × fps)（30s@60 = 1800）', () => {
    expect(buildExportTimeline(30).frameCount).toBe(1800);
    expect(buildExportTimeline(30, 30).frameCount).toBe(900);
    expect(buildExportTimeline(0.5).frameCount).toBe(30);
  });

  it('浮点噪声不把整帧数顶成 +1（1/3 秒 @60 = 20，不是 21）', () => {
    expect(buildExportTimeline(1 / 3).frameCount).toBe(20);
    expect(buildExportTimeline(0.1).frameCount).toBe(6);
  });

  it('不早停：末帧的秒仍在 duration 之内（最后一帧是"还没到终点"的那一拍）', () => {
    const tl = buildExportTimeline(30);
    const last = frameSecondsAt(tl, tl.frameCount - 1);
    expect(last).toBeLessThan(tl.durationSeconds);
    expect(last).toBeCloseTo(30 - 1 / 60, 10);
  });

  it('不重复末帧：帧数不 +1（+1 那一帧会与末帧同一秒）', () => {
    const tl = buildExportTimeline(1);
    expect(tl.frameCount).toBe(60);
    expect(frameSecondsAt(tl, 59)).toBeCloseTo(59 / 60, 10);
    expect(frameSecondsAt(tl, 60)).toBe(1); // 不存在这一帧：它已经超出谱面长度
  });

  it('pts 严格单调递增（微秒取整，不重复）', () => {
    const tl = buildExportTimeline(30, 60);
    let prev = -1;
    for (let k = 0; k < tl.frameCount; k++) {
      const us = frameTimestampUs(tl, k);
      expect(us).toBeGreaterThan(prev);
      prev = us;
    }
    expect(frameTimestampUs(tl, 0)).toBe(0);
    expect(frameTimestampUs(tl, 1)).toBe(16_667);
  });

  it('空谱 / 非法时长也至少 1 帧（出得来一个可播文件）', () => {
    expect(buildExportTimeline(0).frameCount).toBe(1);
    expect(buildExportTimeline(-5).frameCount).toBe(1);
    expect(buildExportTimeline(Number.NaN).frameCount).toBe(1);
  });
});

describe('音轨长度与视频对齐', () => {
  it('轨长 = duration × 采样率（向上取整，不早停）', () => {
    expect(audioFramesFor(30)).toBe(1_440_000);
    expect(audioFramesFor(30, EXPORT_AUDIO_SAMPLE_RATE)).toBe(30 * EXPORT_AUDIO_SAMPLE_RATE);
    expect(audioFramesFor(0)).toBe(1);
  });

  it('音轨与视频同一终点：末帧秒 < 轨长秒 ≤ duration（音轨不比视频短）', () => {
    const tl = buildExportTimeline(30, EXPORT_FPS);
    const videoLastSecond = frameSecondsAt(tl, tl.frameCount - 1);
    const trackSeconds = audioFramesFor(30) / EXPORT_AUDIO_SAMPLE_RATE;
    expect(videoLastSecond).toBeLessThanOrEqual(trackSeconds);
    expect(trackSeconds).toBeCloseTo(30, 9);
  });
});

describe('导出尺寸 · 偶数与居中', () => {
  it('画布 = 档位尺寸；场地两边都是偶数（H.264 的 4:2:0 硬门槛，06 §5.2）', () => {
    for (const tier of VIDEO_EXPORT_TIERS) {
      const g = resolveExportGeometry(tier);
      expect(g.width).toBe(tier.width);
      expect(g.height).toBe(tier.height);
      expect(g.width % 2).toBe(0);
      expect(g.height % 2).toBe(0);
      expect(g.field.w % 2).toBe(0);
      expect(g.field.h % 2).toBe(0);
      // 场地不能超过画布（设计面 1.7787:1 比 16:9 高一点 ⇒ 高向下取偶后留下 ≤1px 留边）
      expect(g.field.w).toBeLessThanOrEqual(g.width);
      expect(g.field.h).toBeLessThanOrEqual(g.height);
    }
  });

  it('1080p：场地 1920 × 1078（1079 会判不支持），上下各留 1px', () => {
    const g = resolveExportGeometry(tierOf('1080p'));
    expect(g.field).toEqual({ w: 1920, h: 1078, x: 0, y: 1 });
  });

  it('720p：场地铺满画布（719.6 取偶后正好 720）', () => {
    const g = resolveExportGeometry(tierOf('720p'));
    expect(g.field).toEqual({ w: 1280, h: 720, x: 0, y: 0 });
  });

  it('文件名：扩展名按当选容器补（不写死在 i18n 里）', () => {
    expect(videoExportBasename('曲-EZ-回放', 'webm')).toBe('曲-EZ-回放.webm');
    expect(videoExportBasename('曲-EZ-回放', 'mp4')).toBe('曲-EZ-回放.mp4');
  });
});

describe('容器口径 · 运行时探测，不在代码里断言"AAC 不可用"', () => {
  it('默认 mp4：有 AAC 时拿到最通用的一格，没 AAC 时自动退 webm', () => {
    expect(DEFAULT_VIDEO_CONTAINER).toBe('auto');
    expect(DEFAULT_VIDEO_TIER).toBe('1080p');
    expect(CONTAINER_FALLBACK_ORDER).toEqual(['mp4', 'webm']);
  });

  it('mp4 的音频候选表 AAC 在前（平台有编码器就白拿真 mp4），webm 只有 opus', () => {
    expect(CONTAINER_SPECS.mp4.audioCodecs).toEqual(['mp4a.40.2', 'opus']);
    expect(CONTAINER_SPECS.webm.audioCodecs).toEqual(['opus']);
    expect(AAC_AUDIO_CODECS).toEqual(['mp4a.40.2']);
  });

  it('封装库要的音频 codec 要归一（`mp4a.40.2` → `aac`）', () => {
    expect(muxerAudioCodecFor(CONTAINER_SPECS.mp4, 'mp4a.40.2')).toBe('aac');
    expect(muxerAudioCodecFor(CONTAINER_SPECS.mp4, 'opus')).toBe('opus');
    expect(muxerAudioCodecFor(CONTAINER_SPECS.webm, 'opus')).toBe('A_OPUS');
    expect(isAacCodec('mp4a.40.2')).toBe(true);
    expect(isAacCodec('opus')).toBe(false);
  });

  it('候选顺序：auto 下 mp4 + Opus 不抢在 webm 前面（它兼容面更窄）', () => {
    expect(candidateOrder('auto')).toEqual([
      { container: 'mp4', aacOnly: true },
      { container: 'webm', aacOnly: false },
    ]);
    // 手选 mp4：它自己的候选表整条提到最前（AAC 有就拿 AAC，没有也尊重选择出 mp4 + Opus）
    expect(candidateOrder('mp4')).toEqual([
      { container: 'mp4', aacOnly: false },
      { container: 'webm', aacOnly: false },
    ]);
    expect(candidateOrder('webm')).toEqual([
      { container: 'webm', aacOnly: false },
      { container: 'mp4', aacOnly: true },
    ]);
  });

  it('mp4 只配 H.264 且不是 Baseline（`avc1.42001f` 实测 false）', () => {
    const mp4 = CONTAINER_SPECS.mp4;
    expect(mp4.videoCodecs.every((c) => c.startsWith('avc1.'))).toBe(true);
    expect(mp4.videoCodecs).not.toContain('avc1.42001f');
    expect(mp4.extension).toBe('mp4');
    expect(mp4.mime).toBe('video/mp4');
  });

  it('webm 走 VP9 + Opus（EBML 的 codec 字符串）', () => {
    expect(CONTAINER_SPECS.webm.muxerCodec).toEqual({ video: 'V_VP9', audio: 'A_OPUS' });
    expect(CONTAINER_SPECS.webm.extension).toBe('webm');
    expect(CONTAINER_SPECS.webm.mime).toBe('video/webm');
  });
});

/** 视频一律支持；音频由 `audio(codec)` 决定支不支持哪个 codec（AAC 有无就是从这里变出来的） */
function stubEncoders(opts: { audio: (codec: string) => boolean; video?: (codec: string) => boolean }): void {
  (globalThis as Record<string, unknown>).VideoEncoder = class {
    static isConfigSupported(cfg: { codec: string }): Promise<{ supported: boolean }> {
      return Promise.resolve({ supported: opts.video ? opts.video(cfg.codec) : true });
    }
  };
  (globalThis as Record<string, unknown>).AudioEncoder = class {
    static isConfigSupported(cfg: { codec: string }): Promise<{ supported: boolean }> {
      return Promise.resolve({ supported: opts.audio(cfg.codec) });
    }
  };
}

function clearEncoders(): void {
  delete (globalThis as Record<string, unknown>).VideoEncoder;
  delete (globalThis as Record<string, unknown>).AudioEncoder;
}

describe('编码器可用性 · 不可用要给明确原因（不静默失败）', () => {
  afterEach(clearEncoders);

  it('没有 WebCodecs（老浏览器 / 非安全上下文）→ reason = missing', async () => {
    const res = await probeContainer(CONTAINER_SPECS.webm, {
      width: 1920, height: 1080, fps: 60, audio: { sampleRate: 48_000, numberOfChannels: 2 },
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('missing');
  });

  it('isConfigSupported 全 false → reason = video（两个容器都试过才认输）', async () => {
    (globalThis as Record<string, unknown>).VideoEncoder = class {
      static isConfigSupported(): Promise<{ supported: boolean }> {
        return Promise.resolve({ supported: false });
      }
    };
    (globalThis as Record<string, unknown>).AudioEncoder = class {
      static isConfigSupported(): Promise<{ supported: boolean }> {
        return Promise.resolve({ supported: true });
      }
    };
    const res = await probeContainer(CONTAINER_SPECS.webm, {
      width: 1920, height: 1079, fps: 60, audio: null,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('video');
    expect(res.videoCodec).toBeUndefined();
  });

  it('音频 codec 不支持 → reason = audio', async () => {
    (globalThis as Record<string, unknown>).VideoEncoder = class {
      static isConfigSupported(): Promise<{ supported: boolean }> {
        return Promise.resolve({ supported: true });
      }
    };
    (globalThis as Record<string, unknown>).AudioEncoder = class {
      static isConfigSupported(): Promise<{ supported: boolean }> {
        return Promise.resolve({ supported: false });
      }
    };
    const res = await probeContainer(CONTAINER_SPECS.mp4, {
      width: 1920, height: 1080, fps: 60, audio: { sampleRate: 48_000, numberOfChannels: 2 },
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('audio');
  });

  it('静音导出不探音频编码器（没有音轨就没得判）', async () => {
    let audioProbes = 0;
    (globalThis as Record<string, unknown>).VideoEncoder = class {
      static isConfigSupported(): Promise<{ supported: boolean }> {
        return Promise.resolve({ supported: true });
      }
    };
    (globalThis as Record<string, unknown>).AudioEncoder = class {
      static isConfigSupported(): Promise<{ supported: boolean }> {
        audioProbes++;
        return Promise.resolve({ supported: false });
      }
    };
    const res = await probeContainer(CONTAINER_SPECS.webm, {
      width: 1920, height: 1080, fps: 60, audio: null,
    });
    expect(res.ok).toBe(true);
    expect(audioProbes).toBe(0);
  });

  it('平台有 AAC 时，mp4 直接选中它（这一格就是"真 mp4"）', async () => {
    stubEncoders({ audio: () => true });
    const res = await probeContainer(CONTAINER_SPECS.mp4, {
      width: 1920, height: 1080, fps: 60, audio: { sampleRate: 48_000, numberOfChannels: 2 },
    });
    expect(res.ok).toBe(true);
    expect(res.audioCodec).toBe('mp4a.40.2');
  });

  it('平台没有 AAC 时：只探 AAC 那一格会判不支持（编排层据此退到 webm）', async () => {
    stubEncoders({ audio: (codec) => codec !== 'mp4a.40.2' });
    const gated = await probeContainer(CONTAINER_SPECS.mp4, {
      width: 1920, height: 1080, fps: 60,
      audio: { sampleRate: 48_000, numberOfChannels: 2, codecs: AAC_AUDIO_CODECS },
    });
    expect(gated.ok).toBe(false);
    expect(gated.reason).toBe('audio');
    // 不限定 codec 时仍能出 mp4 + Opus（用户手选 mp4 且本机无 AAC 时的产物）
    const loose = await probeContainer(CONTAINER_SPECS.mp4, {
      width: 1920, height: 1080, fps: 60, audio: { sampleRate: 48_000, numberOfChannels: 2 },
    });
    expect(loose.ok).toBe(true);
    expect(loose.audioCodec).toBe('opus');
  });
});

describe('容器解析 · 组合优先（mp4 + Opus 不当兜底）', () => {
  afterEach(clearEncoders);

  it('有 AAC：默认档落到 mp4（H.264 + AAC）', async () => {
    stubEncoders({ audio: () => true });
    const res = await probeVideoExportSupport({ tier: '1080p', muted: false });
    expect(res.ok).toBe(true);
    expect(res.container).toBe('mp4');
    expect(res.audioCodec).toBe('mp4a.40.2');
  });

  it('无 AAC：默认档**自动退到 webm**，而不是产出 mp4 + Opus', async () => {
    stubEncoders({ audio: (codec) => codec !== 'mp4a.40.2' });
    const res = await probeVideoExportSupport({ tier: '1080p', muted: false });
    expect(res.ok).toBe(true);
    expect(res.container).toBe('webm');
    expect(res.audioCodec).toBe('opus');
  });

  it('用户手选 mp4 且本机无 AAC：尊重选择，落到 mp4 + Opus（并由 UI 说明代价）', async () => {
    stubEncoders({ audio: (codec) => codec !== 'mp4a.40.2' });
    const res = await probeVideoExportSupport({ tier: '1080p', muted: false, preferred: 'mp4' });
    expect(res.container).toBe('mp4');
    expect(res.audioCodec).toBe('opus');
  });

  it('静音导出：没有音轨要选，容器只看视频 codec', async () => {
    stubEncoders({ audio: () => true });
    const res = await probeVideoExportSupport({ tier: '720p', muted: true });
    expect(res.ok).toBe(true);
    expect(res.audioCodec).toBeNull();
  });
});

describe('倒流区与 beat < 0 · 与画布播放同一口径', () => {
  // 倒流区：beat 4 起 BPM 转负，之后的时间轴往回走
  const notes: ChartNote[] = [
    { type: 'BPM', beat: 0, bpm: 120 },
    single(-1, 0),
    single(1, 1),
    single(2, 2),
    { type: 'BPM', beat: 4, bpm: -120 },
    single(5, 3),
  ];

  it('画面：负 beat 的击打物不渲染（元素表不含负时刻）', () => {
    const chart = buildSimChart(sceneOf(notes), icons);
    expect(chart.elements.length).toBeGreaterThan(0);
    expect(chart.elements.every((e) => e.time >= 0)).toBe(true);
  });

  it('键音：负 beat 的击打物不发声（事件表不含负时刻）', () => {
    const events = buildKeyEvents(notes, 4, getBpmEvents(notes));
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.time >= 0)).toBe(true);
  });

  it('combo：负 beat 的击打物**计**（开播即已过线）⇒ hitTimes 里有负秒', () => {
    const chart = buildSimChart(sceneOf(notes), icons);
    expect(chart.hitTimes.some((t) => t < 0)).toBe(true);
  });

  it('倒流区：事件表按播放时钟升序（拍序与秒序不一致时按秒排）', () => {
    const chart = buildSimChart(sceneOf(notes), icons);
    for (let i = 1; i < chart.hitTimes.length; i++) {
      expect(chart.hitTimes[i]!).toBeGreaterThanOrEqual(chart.hitTimes[i - 1]!);
    }
  });
});
