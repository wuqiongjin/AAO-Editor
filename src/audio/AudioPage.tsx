import { useRef, useState } from 'react';
import { AlertTriangle, Check, Clock3, FileAudio, Music2, Play, SlidersHorizontal, Upload, Volume2 } from 'lucide-react';
import AppPageShell from '../layouts/AppPageShell';
import EmptyState from '../ui/EmptyState';
import { useAudioSession } from '../app/providers/AudioSessionProvider';
import { MAX_DURATION_SECONDS, defaultSettings } from '../chart/config/AppSettings';
import { KEY_SOUND_SETS, type KeySoundKind } from './KeySound';
import { KEY_SOUND_KINDS, KEY_SOUND_KIND_META } from './KeySoundMeta';

// 音频页：直接调音频会话深模块（useAudioSession），3 个 section（音频素材/键音素材包/SE 音量）。

type AudioSection = 'audio' | 'keysound' | 'se';

const AUDIO_SECTIONS: { id: AudioSection; label: string; icon: typeof Music2 }[] = [
  { id: 'audio', label: '音频素材', icon: Music2 },
  { id: 'keysound', label: '键音素材包', icon: Volume2 },
  { id: 'se', label: '节奏图示 SE 音量', icon: SlidersHorizontal },
];

export default function AudioPage() {
  const [section, setSection] = useState<AudioSection>('audio');
  return (
    <AppPageShell>
      <AppPageShell.Header
        eyebrow="当前谱面工程"
        title="音频与键音"
        description="管理工程音频、键音素材包与节奏图示 SE 音量。"
      />

      <AppPageShell.Sidebar ariaLabel="音频域次级索引">
        {AUDIO_SECTIONS.map((s) => (
          <AppPageShell.SidebarItem
            key={s.id}
            icon={s.icon}
            label={s.label}
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
        <h2>音频素材</h2>
        <p>支持常见浏览器可解码格式。</p>
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
            <span>已加载 · 谱面时长锁定为音频时长</span>
          </div>
          <div className="audio-file-actions">
            {/* 更换/清除按钮（primary / danger variant） */}
            <button type="button" className="action-btn action-btn--primary" onClick={pickFile}>
              <Upload size={16} />更换音频
            </button>
            <button
              type="button"
              className="action-btn action-btn--danger"
              onClick={() => session.clearAudio()}
              title="清除后需重新导入"
            >
              清除
            </button>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={FileAudio}
          title="尚未导入音频"
          description="无音频也可编辑预览；导入后谱面时长跟随音频。"
          primaryAction={{
            label: '导入音频',
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
            <strong>谱面时长</strong>
            <span>{canPlay ? '由当前音频锁定' : '无音频时可手动修改'}</span>
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
          <span>秒</span>
        </div>
      </div>

      {canPlay && (
        <div className="flow-note"><Check size={15} />清除音频后需重新导入。</div>
      )}

      {error && (
        <div className="error-banner" role="alert">
          <AlertTriangle size={18} />
          <div>
            <strong>音频解码失败</strong>
            <p style={{ margin: 0 }}>{error}</p>
            <div className="error-actions">
              <button type="button" onClick={pickFile}>重新选择音频</button>
              <button type="button" onClick={() => session.dismissError()}>知道了</button>
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
        <h2>键音素材包</h2>
        <p>按击打样式播放键音；▶ 试听各包，切换立即保存。</p>
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
                  <strong>{set.label}</strong>
                  {/* 使用中 = is-active pill，未使用 = 可点击 pill */}
                  {active ? (
                    <span className="skin-pill is-active" aria-label="正在使用">
                      <Check size={12} />使用中
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="skin-pill"
                      onClick={() => session.setKeySetId(set.id)}
                    >
                      使用此包
                    </button>
                  )}
                </div>
                <ul className="asset-samples">
                  {KEY_SOUND_KINDS.map((kind) => {
                    const meta = KEY_SOUND_KIND_META[kind];
                    return (
                      <li key={kind} title={meta.hint}>
                        <span className="asset-sample-dot" />
                        <span>{meta.label}</span>
                        {kind === 'directional' ? (
                          // 方向键按组合长度 1..3 分档：逐档试听
                          <span className="asset-sample-tiers" aria-label="方向键分档试听">
                            {[1, 2, 3].map((tier) => (
                              <button
                                key={tier}
                                type="button"
                                className="asset-sample-play"
                                disabled={previewing !== null}
                                aria-label={`试听方向键 ${tier} 连`}
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
                            aria-label={`试听${meta.label}`}
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

      <div className="flow-note"><Check size={15} />切换后立即对后续播放生效；当前播放中的按键音将在暂停/重播后使用新素材。试听音量跟随 SE 音量设置。</div>
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
        <h2>节奏图示 SE 音量</h2>
        <p>键音音量，不影响 BGM。</p>
      </div>

      <div className="settings-row">
        <div className="settings-row__text">
          <strong>SE 音量</strong>
          <span>0%（静音）— 100%（默认）</span>
        </div>
        <div className="slider-control">
          <input
            type="range" min={0} max={100} step={5} value={seVolumePercent}
            onChange={(e) => session.setSeVolume(Number(e.target.value) / 100)}
            aria-label="节奏图示 SE 音量"
          />
          <span className="slider-value">{seVolumePercent}%</span>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row__text">
          <strong>恢复默认</strong>
          <span>将 SE 音量恢复为出厂默认（100%），不影响键音素材包选择</span>
        </div>
        <button
          className="button-secondary" type="button"
          onClick={() => session.setSeVolume(defaultSettings().audio.seVolume)}
        >
          恢复默认
        </button>
      </div>
    </>
  );
}
