import { useRef, useState } from 'react';
import { AlertTriangle, Check, Clock3, FileAudio, Music2, Play, SlidersHorizontal, Upload, Volume2 } from 'lucide-react';
import AppPageShell from '../layouts/AppPageShell';
import EmptyState from '../ui/EmptyState';
import { useAudioSession } from '../app/providers/AudioSessionProvider';
import { MAX_DURATION_SECONDS, defaultSettings } from '../chart/config/AppSettings';
import { KEY_SOUND_SETS, type KeySoundKind } from './KeySound';
import { KEY_SOUND_KINDS } from './KeySoundMeta';
import { t, type MessageKey } from '../i18n';

// 音频页：直接调音频会话深模块（useAudioSession），3 个 section（音频素材/键音素材包/SE 音量）。

type AudioSection = 'audio' | 'keysound' | 'se';

const AUDIO_SECTIONS: { id: AudioSection; labelKey: MessageKey; icon: typeof Music2 }[] = [
  { id: 'audio', labelKey: 'audio.section.audio', icon: Music2 },
  { id: 'keysound', labelKey: 'audio.section.keysound', icon: Volume2 },
  { id: 'se', labelKey: 'audio.section.se', icon: SlidersHorizontal },
];

export default function AudioPage() {
  const [section, setSection] = useState<AudioSection>('audio');
  return (
    <AppPageShell>
      <AppPageShell.Header
        eyebrow={t('audio.header.eyebrow')}
        title={t('audio.header.title')}
        description={t('audio.header.description')}
      />

      <AppPageShell.Sidebar ariaLabel={t('audio.sidebar.aria')}>
        {AUDIO_SECTIONS.map((s) => (
          <AppPageShell.SidebarItem
            key={s.id}
            icon={s.icon}
            label={t(s.labelKey)}
            active={section === s.id}
            onClick={() => setSection(s.id)}
          />
        ))}
      </AppPageShell.Sidebar>

      <AppPageShell.Body mode="default">
        {/* 3 段独立 surface-section 卡片（app-stagger 阶梯进入动画） */}
        {section === 'audio' && (
          <section className="surface-section audio-detail app-stagger">
            <AudioSection />
          </section>
        )}
        {section === 'keysound' && (
          <section className="surface-section audio-detail app-stagger">
            <KeySoundSection />
          </section>
        )}
        {section === 'se' && (
          <section className="surface-section audio-detail app-stagger">
            <SeVolumeSection />
          </section>
        )}
      </AppPageShell.Body>
    </AppPageShell>
  );
}

// ---------------- 音频素材（含谱面时长） ----------------

function AudioSection() {
  const [snap, session] = useAudioSession();
  const fileRef = useRef<HTMLInputElement>(null);

  const audioName = snap.audioName;
  const canPlay = audioName !== null;
  const error = snap.audioError;
  const pickFile = () => fileRef.current?.click();

  return (
    <>
      <div className="settings-heading">
        <h2>{t('audio.section.audio')}</h2>
        <p>{t('audio.formats')}</p>
      </div>

      {/* file input 无条件挂载（两分支共用一个 ref，避免各挂一份） */}
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        className="visually-hidden-input"
        onChange={(e) => { if (e.target.files && e.target.files[0]) session.importAudio(e.target.files[0]); e.target.value = ''; }}
      />

      {/* 空态：未导入音频时用 EmptyState 引导 */}
      {canPlay ? (
        <div className="audio-file">
          <span className="audio-file-icon"><Music2 size={22} /></span>
          <div className="audio-file-info">
            <strong>{audioName}</strong>
            <span>{t('audio.loaded')}</span>
          </div>
          <div className="audio-file-actions">
            {/* 更换/清除按钮（primary / danger variant） */}
            <button type="button" className="action-btn action-btn--primary" onClick={pickFile}>
              <Upload size={16} />{t('audio.replace')}
            </button>
            <button
              type="button"
              className="action-btn action-btn--danger"
              onClick={() => session.clearAudio()}
              title={t('audio.clearTitle')}
            >
              {t('audio.clear')}
            </button>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={FileAudio}
          title={t('audio.emptyTitle')}
          description={t('audio.emptyDescription')}
          primaryAction={{
            label: t('audio.import'),
            onClick: pickFile,
            icon: Upload,
          }}
        />
      )}

      {/* 谱面时长 */}
      <div className="audio-duration-row">
        <div className="audio-duration-head">
          <Clock3 size={18} />
          <div>
            <strong>{t('audio.duration')}</strong>
            <span>{canPlay ? t('audio.duration.locked') : t('audio.duration.manual')}</span>
          </div>
        </div>
        <div className="duration-field">
          <input
            type="number"
            min={1}
            max={MAX_DURATION_SECONDS}
            value={Math.round(snap.chartDuration)}
            readOnly={canPlay}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!isNaN(v) && v > 0) session.setChartDuration(Math.min(v, MAX_DURATION_SECONDS));
            }}
          />
          <span>{t('audio.seconds')}</span>
        </div>
      </div>

      {canPlay && (
        <div className="flow-note"><Check size={15} />{t('audio.clearNote')}</div>
      )}

      {error && (
        <div className="error-banner" role="alert">
          <AlertTriangle size={18} />
          <div>
            <strong>{t('audio.decodeFail')}</strong>
            <p style={{ margin: 0 }}>{error}</p>
            <div className="error-actions">
              <button type="button" onClick={pickFile}>{t('audio.retry')}</button>
              <button type="button" onClick={() => session.dismissError()}>{t('audio.dismiss')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------- 键音素材包 ----------------

function KeySoundSection() {
  const [snap, session] = useAudioSession();
  const activeId = snap.keySetId;
  // 试听进行中的行标识（'kind' 或 'kind:tier'）：包 chunk 首次点击需懒下载，期间禁用按钮
  const [previewing, setPreviewing] = useState<string | null>(null);

  const preview = (setId: string, kind: KeySoundKind, tier?: number) => {
    const rowKey = tier ? `${kind}:${tier}` : kind;
    setPreviewing(rowKey);
    void session.previewKeySample(setId, kind, tier).finally(() => {
      setPreviewing((p) => (p === rowKey ? null : p));
    });
  };

  return (
    <>
      <div className="settings-heading">
        <h2>{t('audio.section.keysound')}</h2>
        <p>{t('audio.keysound.intro')}</p>
      </div>

      <div className="asset-set-grid asset-set-grid-3">
        {KEY_SOUND_SETS.map((set) => {
          const active = set.id === activeId;
          return (
            <div key={set.id} className={`asset-set${active ? ' is-active' : ''}`}>
              <div className="asset-set-visual" aria-hidden="true">
                <span className="eq">
                  <i /><i /><i /><i /><i />
                </span>
              </div>
              <div className="asset-set-body">
                <div className="asset-set-head">
                  <strong>{t(`keysound.pack.${set.id}` as MessageKey)}</strong>
                  {/* 使用中 = is-active pill，未使用 = 可点击 pill */}
                  {active ? (
                    <span className="skin-pill is-active" aria-label={t('audio.inUseAria')}>
                      <Check size={12} />{t('audio.inUse')}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="skin-pill"
                      onClick={() => session.setKeySetId(set.id)}
                    >
                      {t('audio.usePack')}
                    </button>
                  )}
                </div>
                <ul className="asset-samples">
                  {KEY_SOUND_KINDS.map((kind) => {
                    const kindLabel = t(`keysound.${kind}` as MessageKey);
                    const kindHint = t(`keysound.${kind}.hint` as MessageKey);
                    return (
                      <li key={kind} title={kindHint}>
                        <span className="asset-sample-dot" />
                        <span>{kindLabel}</span>
                        {kind === 'directional' ? (
                          // 方向键按组合长度 1..3 分档：逐档试听
                          <span className="asset-sample-tiers" aria-label={t('audio.dirPreviewAria')}>
                            {[1, 2, 3].map((tier) => (
                              <button
                                key={tier}
                                type="button"
                                className="asset-sample-play"
                                disabled={previewing !== null}
                                aria-label={t('audio.dirPreviewBtn', { tier })}
                                onClick={() => preview(set.id, 'directional', tier)}
                              >
                                <Play size={11} />{tier}
                              </button>
                            ))}
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="asset-sample-play"
                            disabled={previewing !== null}
                            aria-label={t('audio.previewKind', { label: kindLabel })}
                            onClick={() => preview(set.id, kind)}
                          >
                            <Play size={11} />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flow-note"><Check size={15} />{t('audio.keysound.note')}</div>
    </>
  );
}

// ---------------- 节奏图示 SE 音量 ----------------

function SeVolumeSection() {
  const [snap, session] = useAudioSession();
  const seVolumePercent = Math.round(snap.seVolume * 100);

  return (
    <>
      <div className="settings-heading">
        <h2>{t('audio.section.se')}</h2>
        <p>{t('audio.se.intro')}</p>
      </div>

      <div className="settings-row">
        <div className="settings-row__text">
          <strong>{t('audio.seVolume')}</strong>
          <span>{t('audio.seVolume.hint')}</span>
        </div>
        <div className="slider-control">
          <input
            type="range" min={0} max={100} step={5} value={seVolumePercent}
            onChange={(e) => session.setSeVolume(Number(e.target.value) / 100)}
            aria-label={t('audio.section.se')}
          />
          <span className="slider-value">{seVolumePercent}%</span>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row__text">
          <strong>{t('audio.seReset')}</strong>
          <span>{t('audio.seReset.hint')}</span>
        </div>
        <button
          className="button-secondary" type="button"
          onClick={() => session.setSeVolume(defaultSettings().audio.seVolume)}
        >
          {t('audio.seReset')}
        </button>
      </div>
    </>
  );
}
