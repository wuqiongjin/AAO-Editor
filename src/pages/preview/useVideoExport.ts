// 视频导出的页面侧状态机（chart-preview 07）：规格（分辨率 / 容器 / 音轨）+ 进度 + 取消 + 失败态。
//
// 域那一层（`preview.video.encode.exportVideo.runVideoExport`）只管"跑一次导出"；
// 这里是"这一屏怎么跟它打交道"：导出中按钮变文案、进度卡按帧数走、取消置一个标志位。
//
// **非模态**（票面：长谱导出不得阻塞页面交互）：没有 scrim，页面其余部分照样能点。
// 取消不是 AbortController —— 域那一层是逐帧循环，靠 `isCancelled` 轮询在帧边界上退出来。
import { useCallback, useRef, useState } from 'react';
import type { AppSettings } from '../../chart/config/AppSettings';
import { t } from '../../i18n';
import {
  DEFAULT_VIDEO_CONTAINER,
  DEFAULT_VIDEO_TIER,
  probeVideoExportSupport,
  runVideoExport,
  waitForPaint,
  type SimPlaybackAudio,
  type SimScene,
  type VideoContainerChoice,
  type VideoExportOutcome,
  type VideoExportProgress,
  type VideoExportRequest,
  type VideoExportSupport,
  type VideoTierId,
} from '../../preview';

/** 导出规格（"这一屏挑的那一档"，不落设置 —— 与倍速同性质，是当次的事） */
export interface VideoExportSpec {
  tier: VideoTierId;
  /** `'auto'` = 按本机编码能力挑最通用的一格；手选 mp4 / webm 则尊重选择 */
  container: VideoContainerChoice;
  /** true = 静音导出（不出音轨） */
  muted: boolean;
}

export interface VideoExportNotice {
  text: string;
  tone: 'danger' | 'warn';
}

export interface UseVideoExportArgs {
  scene: SimScene | null;
  audio: SimPlaybackAudio | null;
  durationSeconds: number;
  keySetId: string;
  seVolume: number;
  volume: number;
  noteSkin: AppSettings['visual']['noteSkin'];
  /** 文件名基础名（不含扩展名） */
  suggestedBaseName: string;
}

export interface VideoExportController {
  spec: VideoExportSpec;
  setSpec: (patch: Partial<VideoExportSpec>) => void;
  /** null = 空闲（不显示进度卡） */
  progress: VideoExportProgress | null;
  /** 结果文案（失败 / 编码器不可用 / 已取消）；null = 没有 */
  notice: VideoExportNotice | null;
  busy: boolean;
  /** 本机实际会用的编码组合（null = 还没探）；**按需**探，不在挂载时白跑一次 isConfigSupported */
  support: VideoExportSupport | null;
  probing: boolean;
  /** 探一次（面板打开时调）；与真正导出走同一个判定，说的是同一件事 */
  probe: () => void;
  /** 跑一次导出；返回域那一层的结论（页面据此给成功 toast） */
  start: () => Promise<VideoExportOutcome | undefined>;
  cancel: () => void;
  /** 清掉结果文案（改规格 / 再导一次时） */
  dismissNotice: () => void;
}

/** 成功 toast 的文案：把**实际落盘的格式**说出来（MP4 / WebM 就够；codec 名是内部实现，用户看不懂） */
export function exportDoneText(outcome: VideoExportOutcome): string {
  return outcome.container
    ? t('preview.video.export.doneWith', { container: t(`preview.video.export.format.${outcome.container}`) })
    : t('preview.video.export.done');
}

/**
 * 导出结果的文案映射：失败与不可用**必须说出口**，不静默。
 *
 * 文案全走 i18n（域层只回失败档）：原始错误不拼进界面 —— 它已在域层 `console.error`，
 * 拼上去只会把英文界面漏成中文、把普通用户看不懂的技术话漏进来。
 */
export function noticeFor(outcome: VideoExportOutcome): VideoExportNotice | null {
  if (!outcome.ok) {
    if (outcome.unsupported) return { text: t('preview.video.export.unsupported'), tone: 'danger' };
    return {
      text: t(outcome.failure === 'assets' ? 'preview.video.export.failedAssets' : 'preview.video.export.failed'),
      tone: 'danger',
    };
  }
  if (outcome.cancelled) return { text: t('preview.video.export.cancelled'), tone: 'warn' };
  return null;
}

export function useVideoExport(
  args: UseVideoExportArgs,
  run: (req: VideoExportRequest) => Promise<VideoExportOutcome> = runVideoExport,
): VideoExportController {
  const [spec, setSpecState] = useState<VideoExportSpec>({
    tier: DEFAULT_VIDEO_TIER,
    container: DEFAULT_VIDEO_CONTAINER,
    muted: false,
  });
  const [progress, setProgress] = useState<VideoExportProgress | null>(null);
  const [notice, setNotice] = useState<VideoExportNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const [support, setSupport] = useState<VideoExportSupport | null>(null);
  const [probing, setProbing] = useState(false);
  const cancelledRef = useRef(false);

  /**
   * 探本机可用的编码组合。
   *
   * **按需**（面板打开时才探），不在挂载时白跑：WebCodecs 的可用性要真问浏览器，
   * 而这玩意儿的答案随平台变（06 那台 Linux 软光栅没有 AAC，Windows / macOS 的 Electron 很可能有）。
   * 探测结论只用来**说清"会导出什么"**，不改导出决策本身 —— 决策由域那一层同一次判定做出。
   */
  const probe = useCallback(() => {
    setProbing(true);
    void probeVideoExportSupport({ tier: spec.tier, muted: spec.muted, preferred: spec.container })
      .then(setSupport)
      .catch(() => setSupport(null))
      .finally(() => setProbing(false));
  }, [spec.tier, spec.muted, spec.container]);

  const setSpec = useCallback((patch: Partial<VideoExportSpec>) => {
    setSpecState((prev) => ({ ...prev, ...patch }));
    setNotice(null); // 改规格 = 上一次的失败文案不再适用
    setSupport(null); // 探测结论跟着规格走，改了就得重探（面板会再开一次）
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
  }, []);

  const start = useCallback(async () => {
    if (busy || args.scene == null) return;
    cancelledRef.current = false;
    setBusy(true);
    setNotice(null);
    setProgress({ phase: 'assets', frame: 0, totalFrames: 0 });
    // 探过的结论顺带作废：规格可能刚改过，重新导出的组合要重新问一遍浏览器
    setSupport(null);
    try {
      // 先让「导出中」这一帧真正画出来再开干（issue 16）：同一段微任务链里直接开干会把它压在首帧前
      await waitForPaint();
      const outcome = await run({
        scene: args.scene,
        audio: args.audio,
        durationSeconds: args.durationSeconds,
        keySetId: args.keySetId,
        seVolume: args.seVolume,
        volume: args.volume,
        noteSkin: args.noteSkin,
        tier: spec.tier,
        container: spec.container,
        muted: spec.muted,
        suggestedBaseName: args.suggestedBaseName,
        onProgress: setProgress,
        isCancelled: () => cancelledRef.current,
      });
      setNotice(noticeFor(outcome));
      return outcome;
    } catch (err) {
      console.error('[preview] 导出视频异常', err);
      setNotice({ text: t('preview.video.export.failed'), tone: 'danger' });
      return undefined;
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [args, busy, run, spec]);

  return { spec, setSpec, progress, notice, busy, support, probing, probe, start, cancel, dismissNotice };
}
