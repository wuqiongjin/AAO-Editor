// 33 票：音频资源异常的检测与对齐（工作台 hydrate 路径）。
//
// 两个信号都不上哈希：
//   - 丢失 = 半态判定 `audioName != null && audioBlob == null`（加载即可判，零解码）；
//   - 替换 = hydrate 解码后 `engine.duration` 与记录 `durationSeconds` 差 > 0.5s。
//
// 检测落在**工作台 hydrate 路径**：丢失挂在 `restoreAudio` 为真的恢复上（切谱面不重判），
// 替换等解码落地后才判。对齐口径与「更换音频」一致（时长 ← 实际、source ← custom），
// 两条修复写路径不走锁闸，收口在 projectAudio 接缝
// （realignProjectAudio / clearProjectAudio force）——本文件只做检测与编排，不碰记录形状。
//
// 「暂不处理」仅本会话不再提示（不落盘）；动作成功即清横幅。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChartProject } from '../../project/ChartProject';
import {
  audioBytesLost,
  audioDurationMismatch,
  clearProjectAudio,
  realignProjectAudio,
  type ProjectAudioDeps,
} from '../../audio/projectAudio';
import type { AudioAnomaly } from './AudioAnomalyBanner';

export interface UseAudioAnomalyOptions {
  /** 当前工程 id；null = 没有当前工程（不检测） */
  projectId: string | null;
  /** 写路径依赖（store / 当前工程 / 落盘 / 目录通知），与音频页同口径 */
  deps: ProjectAudioDeps;
  /** 会话快照里的音频实际时长（null = 还没解码 / 无音频）——替换信号的入参 */
  audioDuration: number | null;
  /**
   * 会话快照里的音频负载落定代数（ AudioSession.audioLoadGeneration）：解码落地时 +1。
   * 它是「解码已完成」的信号——时长**值**担不起这个信号：切工程时新旧音频时长相同的话，
   * audioDuration 不变、快照浅比较不重渲染，替换会整条漏掉（锁定工程没有防抖自愈兜底）。
   */
  audioLoadGeneration: number;
  /** 「去音频页重新导入」：带作用域跳音频页（票 22 既有机制） */
  goToAudioPage: () => void;
}

export interface AudioAnomalyController {
  /** 当前横幅信号；null = 没有异常 */
  anomaly: AudioAnomaly | null;
  /** 写路径在飞（禁用动作钮） */
  busy: boolean;
  /**
   * hydrate 路径的检测入口：工作台每次带 `restoreAudio` 恢复时调用（切谱面不调）。
   * 丢失在这里判（半态，加载即可判）；替换等解码落地后由 effect 判。
   */
  noteRestoredProject: (project: ChartProject, opts: { restoreAudio: boolean }) => void;
  /** 暂不处理（仅本会话不再提示，不落盘） */
  dismiss: () => void;
  /** 去音频页重新导入（丢失横幅的动作：清横幅 + 带作用域跳音频页） */
  reimport: () => void;
  /** 清除音频记录（丢失横幅的动作；清理走 clearProjectAudio force，绕过锁闸） */
  clearRecordAudio: () => Promise<void>;
  /** 按音频重新对齐（替换横幅的动作） */
  realign: () => Promise<void>;
}

export function useAudioAnomaly(opts: UseAudioAnomalyOptions): AudioAnomalyController {
  const { projectId, deps, audioDuration, audioLoadGeneration, goToAudioPage } = opts;
  const [anomaly, setAnomaly] = useState<AudioAnomaly | null>(null);
  const [busy, setBusy] = useState(false);

  // 最近一次恢复的记录（供替换信号比对 + 动作写入后刷新记忆）；只认 restoreAudio 为真的恢复
  const recordRef = useRef<ChartProject | null>(null);
  // 已处理过（对齐 / 清除成功）的记录身份：同一记录不重复出横幅
  const handledRef = useRef<ChartProject | null>(null);
  // 暂不处理：仅本会话不再提示
  const dismissedRef = useRef(false);

  // 切工程 = 新记录的检测起点：会话级 dismiss / handled 记忆留给"同一工程反复恢复"用，
  // 但换到别的工程必须重新获得提示机会（否则 A 工程 dismiss 掉 B 工程的横幅）。
  useEffect(() => {
    dismissedRef.current = false;
    handledRef.current = null;
    recordRef.current = null;
    setAnomaly(null);
  }, [projectId]);

  const noteRestoredProject = useCallback((project: ChartProject, restoreOpts: { restoreAudio: boolean }) => {
    if (!restoreOpts.restoreAudio) return; // 切谱面不重判
    recordRef.current = project;
    if (audioBytesLost(project)) {
      setAnomaly({ kind: 'lost', audioName: project.audioName as string });
    }
  }, []);

  // 替换信号：**解码落地后**才判（audioLoadGeneration 每次负载落定 +1，见它的字段注解）。
  // 落定时刻的 audioDuration 就是本工程这份音频的时长——不存在拿旧工程残留时长比新记录
  // 的问题（hydrate 中途不发代数；被新恢复打断的旧解码也不发，token 闸在 session 里）。
  // 丢失 banner 优先：没字节就走清除路径，同样落定但不触发这里（audioBlob == null 早退）。
  useEffect(() => {
    if (anomaly != null || dismissedRef.current) return;
    const record = recordRef.current;
    if (record == null || record === handledRef.current) return;
    if (record.audioName == null || record.audioBlob == null) return;
    if (audioDuration == null) return;
    if (audioDurationMismatch(record.durationSeconds, audioDuration)) {
      setAnomaly({
        kind: 'replaced',
        recordSeconds: record.durationSeconds,
        actualSeconds: audioDuration,
      });
    }
  }, [audioLoadGeneration, audioDuration, anomaly]);

  /** 一条修复写路径的共同形状：在飞标记 → 写 → 成功即清横幅（失败留着让用户重试） */
  const runRepair = useCallback(async (
    write: () => Promise<{ ok: boolean }>,
    onWritten?: () => void,
  ) => {
    setBusy(true);
    try {
      const result = await write();
      if (result.ok) {
        onWritten?.();
        setAnomaly(null);
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const clearRecordAudio = useCallback(async () => {
    if (projectId == null) return;
    await runRepair(
      () => clearProjectAudio(deps, projectId, true),
      () => { handledRef.current = recordRef.current; },
    );
  }, [projectId, deps, runRepair]);

  const realign = useCallback(async () => {
    if (projectId == null) return;
    const record = recordRef.current;
    if (record == null || audioDuration == null) return;
    await runRepair(
      () => realignProjectAudio(deps, projectId, audioDuration),
      () => {
        // 刷新记忆：记录此刻已与音频对齐（时长 / source），同一记录不再出横幅
        handledRef.current = record;
        recordRef.current = { ...record, durationSeconds: audioDuration, source: { type: 'custom' } };
      },
    );
  }, [projectId, deps, audioDuration, runRepair]);

  const dismiss = useCallback(() => {
    dismissedRef.current = true;
    setAnomaly(null);
  }, []);

  const reimport = useCallback(() => {
    // 清横幅即"本次不再碍事"；不置 dismissed——重新导入后若文件仍缺失，下次恢复会重新报警
    setAnomaly(null);
    goToAudioPage();
  }, [goToAudioPage]);

  return { anomaly, busy, noteRestoredProject, dismiss, reimport, clearRecordAudio, realign };
}
