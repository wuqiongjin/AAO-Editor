// 音频页：**工程音频的唯一管理入口**（票 15 定案 2）。
// 作用对象 = 页面作用域 ?? 当前工程（票 22 / ADR-0015 §6）——区块头右侧的作用域条说清"我在管谁"，
// 改的永远是作用对象那条工程记录，当前工程不会被切走。
//
// 写路径不直连 AudioSession（票 15 定案 8）：session 手里握着全站唯一那个共享 AudioEngine
// （工作台解码后的那份），借它 load 别的工程会顶掉工作台那份。四个动作都走 projectAudio 接缝。
import { useCallback, useRef, useState } from 'react';
import { AlertTriangle, Check, Clock3, FileAudio, FolderOpen, Lock, Music2, Play, SlidersHorizontal, Upload, Volume2 } from 'lucide-react';
import AppPageShell from '../../layouts/AppPageShell';
import EmptyState from '../../ui/EmptyState';
import ScopePicker from '../../ui/ScopePicker';
import { useAppNav } from '../../layouts/AppNav';
import { useAudioSession } from '../../app/providers/AudioSessionProvider';
import { MAX_DURATION_SECONDS, defaultSettings } from '../../chart/config/AppSettings';
import { clampChartDuration } from '../../audio/chartDuration';
import { KEY_SOUND_SETS, type KeySoundKind } from '../../audio/KeySound';
import { KEY_SOUND_KINDS } from '../../audio/KeySoundMeta';
import { useAudioScope } from '../../audio/useAudioScope';
import {
  clearProjectAudio, importProjectAudio, setProjectAudioDuration, type ProjectAudioWriteResult,
} from '../../audio/projectAudio';
import { lockedChartLabels } from '../../project/ui/projectUi';
import { t, type MessageKey } from '../../i18n';

type AudioSection = 'audio' | 'keysound' | 'se';

const AUDIO_SECTIONS: { id: AudioSection; labelKey: MessageKey; icon: typeof Music2 }[] = [
  { id: 'audio', labelKey: 'audio.section.audio', icon: Music2 },
  { id: 'keysound', labelKey: 'audio.section.keysound', icon: Volume2 },
  { id: 'se', labelKey: 'audio.section.se', icon: SlidersHorizontal },
];

export default function AudioPage({ active = true }: { active?: boolean }) {
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
            <AudioSection active={active} />
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

function AudioSection({ active }: { active: boolean }) {
  const { setActivePage } = useAppNav();
  const { scopeId, currentId, view, options, loading, deps } = useAudioScope(active);
  const fileRef = useRef<HTMLInputElement>(null);
  // 解码失败时留住那个文件，好让"重新选择"能直接重试同一份
  const [failed, setFailed] = useState<File | null>(null);

  // 选作用域 = 带作用域重新激活本页（票 22 定案 2）。选中的就是当前工程时写 null 而不是
  // { projectId: currentId }：语义上"没有显式作用域"，两者解析出的作用对象相同但更干净。
  const pickScope = useCallback((projectId: string) => {
    setActivePage('audio', { scope: projectId === currentId ? null : { projectId } });
  }, [setActivePage, currentId]);

  const pickFile = () => { fileRef.current?.click(); };

  /**
   * 写失败的后半段：解码失败 → 错误横幅；记录已经没了 → 交回壳层那条失效检查
   * （它负责清作用域 + 提示，别在这里再写一份）。'locked' 正常操作到不了（按钮已禁用），
   * 真到了也不提示——锁定横幅就在旁边，用户看得见原因。
   */
  const settle = useCallback((result: ProjectAudioWriteResult, file?: File) => {
    if (result.ok) { setFailed(null); return; }
    if (result.reason === 'decode') setFailed(file ?? null);
    if (result.reason === 'missing') deps.notifyCatalogChanged();
  }, [deps]);

  const importFile = useCallback((file: File) => {
    if (scopeId == null) return;
    void importProjectAudio(deps, scopeId, file)
      .then((result) => settle(result, file))
      .catch(() => settle({ ok: false, reason: 'decode' }, file));
  }, [deps, scopeId, settle]);

  const changeDuration = (seconds: number) => {
    if (scopeId == null) return;
    void setProjectAudioDuration(deps, scopeId, seconds).catch(() => { /* 静默：值没变 */ });
  };

  // 作用域在选项里的那一条：有它才说得出"我在管谁"。名字取**选项**（与作用域无关的那份
  // 全量列表）而不是 `view.name`——换作用域时视图还在路上，靠 view 会让作用域条断档一个
  // tick，而"此刻作用于谁"正是这条要一直说的事。作用域指向的工程已被删时这里自然是 null，
  // 于是走到下面的空态（票 22 定案 9：收敛成"无作用域"同一个态）。
  const scopeOption = scopeId == null ? null : options.find((o) => o.id === scopeId) ?? null;

  const heading = (
    <div className={`settings-heading${scopeOption ? ' settings-heading--scoped' : ''}`}>
      <div className="settings-heading__text">
        <h2>{t('audio.section.audio')}</h2>
        <p>{t('audio.formats')}</p>
      </div>
      {scopeOption && scopeId != null && (
        <ScopePicker
          scopeId={scopeId}
          currentId={currentId}
          scopeName={scopeOption.name}
          options={options}
          onPick={pickScope}
          align="right"
        />
      )}
    </div>
  );

  // 没有作用对象（没有当前工程，或作用域失效后当前工程也没有）→ 空态。
  // 不在这里 ensure：进音频页不该顺手新建/打开工程（票 15 定案 4，旧行为是个 foot-gun）。
  if (scopeId == null || (!loading && view == null)) {
    return (
      <>
        {heading}
        <EmptyState
          icon={FolderOpen}
          title={t('audio.noProjectTitle')}
          description={t('audio.noProjectDescription')}
          primaryAction={{
            label: t('audio.goProjects'),
            onClick: () => setActivePage('projects'),
            icon: FolderOpen,
          }}
        />
      </>
    );
  }

  // 视图还在路上：只出区块头（作用域条照旧在），正文等读回来。宁可变空一个 tick，
  // 也不把上一个作用对象的数据（音频名 / 时长 / 锁）配到新作用对象的名字底下。
  if (view == null) return heading;

  const locked = view.locked;
  const hasAudio = view.hasAudio;

  return (
    <>
      {heading}

      {locked && (
        <div className="audio-locked-banner" role="alert">
          <Lock size={15} />
          <span>{t('projects.audioLockedNamed', { charts: lockedChartLabels(view.name, view.lockedBy) })}</span>
        </div>
      )}

      {/* file input 无条件挂载（两分支共用一个 ref，避免各挂一份） */}
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        className="visually-hidden-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!locked && file) importFile(file);
          e.target.value = '';
        }}
      />

      {/* 空态：未导入音频时用 EmptyState 引导 */}
      {hasAudio ? (
        <div className="audio-file">
          <span className="audio-file-icon"><Music2 size={22} /></span>
          <div className="audio-file-info">
            <strong>{view.audioName}</strong>
            <span>{t('audio.loaded')}</span>
          </div>
          <div className="audio-file-actions">
            {/* 更换/清除按钮（primary / danger variant） */}
            <button
              type="button"
              className="action-btn action-btn--primary"
              disabled={locked}
              title={locked ? t('audio.lockedPrompt') : undefined}
              onClick={pickFile}
            >
              <Upload size={16} />{t('audio.replace')}
            </button>
            <button
              type="button"
              className="action-btn action-btn--danger"
              disabled={locked}
              title={locked ? t('audio.lockedPrompt') : t('audio.clearTitle')}
              onClick={() => { if (!locked && scopeId != null) void clearProjectAudio(deps, scopeId).then(settle); }}
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
          primaryAction={locked ? undefined : {
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
            <span>{locked ? t('audio.duration.projectLocked') : (hasAudio ? t('audio.duration.locked') : t('audio.duration.manual'))}</span>
          </div>
        </div>
        <div className="duration-field">
          <input
            type="number"
            min={1}
            max={MAX_DURATION_SECONDS}
            value={Math.round(view.durationSeconds)}
            readOnly={locked || hasAudio}
            onChange={(e) => {
              if (locked) return;
              const v = parseFloat(e.target.value);
              if (!isNaN(v) && v > 0) changeDuration(clampChartDuration(v));
            }}
          />
          <span>{t('audio.seconds')}</span>
        </div>
      </div>

      {hasAudio && (
        <div className="flow-note"><Check size={15} />{t('audio.clearNote')}</div>
      )}

      {failed && (
        <div className="error-banner" role="alert">
          <AlertTriangle size={18} />
          <div>
            <strong>{t('audio.decodeFail')}</strong>
            <p style={{ margin: 0 }}>{failed.name}</p>
            <div className="error-actions">
              <button type="button" onClick={pickFile}>{t('audio.retry')}</button>
              <button type="button" onClick={() => setFailed(null)}>{t('audio.dismiss')}</button>
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
                    <span className="skin-pill is-active" aria-label={t('pack.inUseAria')}>
                      <Check size={12} />{t('pack.inUse')}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="skin-pill"
                      onClick={() => session.setKeySetId(set.id)}
                    >
                      {t('pack.useThis')}
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
