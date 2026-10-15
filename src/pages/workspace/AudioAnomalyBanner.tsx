// 33 票：工作台音频资源异常横幅（丢失 / 被替换）——同一枚壳（样式族照音频页的
// .audio-locked-banner，warning 左饰边 + soft 底），按当前信号出文案与动作：
//   - 丢失：「音频文件丢失（原文件：{{name}}）」+「去音频页重新导入」/「清除音频记录」；
//   - 替换：「音频文件与工程记录不一致」+「按音频重新对齐（时长与曲目归属将更新）」/「暂不处理」。
//
// 检测与动作编排在 useAudioAnomaly（hydrate 路径），本组件只负责渲染与回吐点击——
// 工作台里它是纯展示件，DOM 测试照 ChartSwitcherAudioEntry 注入假 store/引擎即可挂。
import { AlertTriangle } from 'lucide-react';
import { t } from '../../i18n';

/** 当前横幅在说哪件事（useAudioAnomaly 的裁决结果） */
export type AudioAnomaly =
  | { kind: 'lost'; audioName: string }
  | { kind: 'replaced'; recordSeconds: number; actualSeconds: number };

export interface AudioAnomalyBannerProps {
  anomaly: AudioAnomaly;
  /** 写路径在飞（禁用动作钮，防重复点击） */
  busy: boolean;
  /** 丢失：去音频页重新导入（带作用域跳转，票 22 既有机制） */
  onReimport: () => void;
  /** 丢失：清除音频记录（clearProjectAudio force，绕过锁闸） */
  onClearRecord: () => void;
  /** 替换：按音频重新对齐（realignProjectAudio：时长 ← 实际、source ← custom） */
  onRealign: () => void;
  /** 替换：暂不处理（仅本会话不再提示，不落盘） */
  onDismiss: () => void;
}

export default function AudioAnomalyBanner({
  anomaly, busy, onReimport, onClearRecord, onRealign, onDismiss,
}: AudioAnomalyBannerProps) {
  const lost = anomaly.kind === 'lost';
  return (
    <div className="audio-locked-banner audio-anomaly-banner" role="alert">
      <AlertTriangle size={15} />
      <div className="audio-anomaly-banner__text">
        <span>
          {lost
            ? t('workspace.audioAnomaly.lost', { name: anomaly.audioName })
            : t('workspace.audioAnomaly.replaced')}
        </span>
        <span className="audio-anomaly-banner__hint">
          {lost
            ? t('workspace.audioAnomaly.lostHint')
            : t('workspace.audioAnomaly.replacedHint', {
              delta: Math.max(1, Math.round(Math.abs(anomaly.actualSeconds - anomaly.recordSeconds))),
            })}
        </span>
      </div>
      <div className="audio-anomaly-banner__actions">
        {lost ? (
          <>
            <button type="button" onClick={onReimport}>{t('workspace.audioAnomaly.reimport')}</button>
            <button type="button" disabled={busy} onClick={onClearRecord}>{t('workspace.audioAnomaly.clearRecord')}</button>
          </>
        ) : (
          <>
            <button type="button" disabled={busy} onClick={onRealign}>{t('workspace.audioAnomaly.realign')}</button>
            <button type="button" onClick={onDismiss}>{t('workspace.audioAnomaly.dismiss')}</button>
          </>
        )}
      </div>
    </div>
  );
}
