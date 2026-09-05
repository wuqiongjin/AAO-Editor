import { useRef, useState } from 'react';
import { AlertTriangle, Check, Clock3, FileAudio, Music2, SlidersHorizontal, Upload, Volume2 } from 'lucide-react';
import AppPageShell from '../layouts/AppPageShell';
import EmptyState from '../ui/EmptyState';
import { useAudioSession } from '../app/providers/AudioSessionProvider';
import { MAX_DURATION_SECONDS, defaultSettings } from '../chart/config/AppSettings';
import { KEY_SOUND_SETS, type KeySoundSample } from './KeySound';
import { KEY_SOUND_KINDS, KEY_SOUND_KIND_META } from './KeySoundMeta';

// 音频页（架构深化评审候选 3 收口后 + 2026-08-30 阶段 2 决策收口）：
//   - 不再走 AudioPageContext 桥接——直接调音频会话深模块（useAudioSession）；
//   - 3 个 section：音频素材（含谱面时长）/ 键音素材包 / SE 音量，sidebar 切换；
//   - 3 段各自独立 <section className="surface-section audio-detail"> card 基底
//     （不再共用外层包装），切页时显示对应那张 card；
//   - 卡片本身是轻量视觉分组（去 border，仅 bg 区分 + 细 radius），不堆 box-shadow；
//   - 导入/解码失败用内联错误横幅就地反馈（文字醒目、可即时重试）；
//   - 成功仅更新状态，不加 toast；
//   - 清除音频不需二次确认（低风险、可重新导入），旁加说明"清除后需重新导入"。

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
        description="管理谱面工程使用的音频素材、键音素材包与节奏图示 SE 音量。键音与音源同域（设置对象 audio 段）。"
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
        {/* 阶段 2 决策（2026-08-30 用户拍板）：3 段各自独立 surface-section card 基底，
            不再共用外层 .audio-detail 包装；每段自带卡片做视觉分组。
            卡片本身用 .surface-section（已轻量化：去 border，仅 bg + radius）。
            任务 1 方案 A/B/C 注释见 AudioPage.css 顶部。
            阶段 4（2026-09-01）：app-stagger 让卡片内的 settings-heading / audio-file /
            audio-duration-row / flow-note / error-banner 按 40ms 阶梯式进入。
            切 section 时 React 重挂载 body 子元素，动画自然重跑。 */}
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
        <p>支持浏览器可解码的常见音频格式；导入后谱面时长将跟随音频长度。</p>
      </div>

      {/* file input 无条件挂载（两分支共用一个 ref，避免各挂一份） */}
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        className="visually-hidden-input"
        onChange={(e) => { if (e.target.files && e.target.files[0]) session.importAudio(e.target.files[0]); e.target.value = ''; }}
      />

      {/* 阶段 2 空态（2026-08-30 用户拍板）：
          未导入音频时用三段式 EmptyState（图 + 标题 + 描述 + 主按钮"导入音频"）
          替代原"尚未导入音频"灰色提示文字。已导入时回落到 .audio-file 卡 + 谱面时长行。 */}
      {canPlay ? (
        <div className="audio-file">
          <span className="audio-file-icon"><Music2 size={22} /></span>
          <div className="audio-file-info">
            <strong>{audioName}</strong>
            <span>已加载 · 谱面时长锁定为音频时长</span>
          </div>
          <div className="audio-file-actions">
            {/* 任务 2 v4（2026-08-30）：两个按钮统一用 .action-btn。
                - 更换音频 = .action-btn--primary（蓝实色，提示"主操作"）；
                - 清除 = .action-btn--danger（红软底，提示"破坏性"，但不像 primary 那么重）。 */}
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
          description="无音频模式可正常编辑和预览谱面；导入后谱面时长将自动跟随音频长度。"
          primaryAction={{
            label: '导入音频',
            onClick: pickFile,
            icon: Upload,
          }}
        />
      )}

      {/* 谱面时长：嵌入音频素材 section 内（grill 2026-08-26 拍板 3-section 方案） */}
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

  return (
    <>
      <div className="settings-heading">
        <h2>键音素材包</h2>
        <p>播放时按击打样式（单键 / 滑键 / 技能键 / 滑条 / 方向键）触发对应音效。激活项写 <code>settings.audio.keySet</code>，立即生效并持久化。</p>
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
                  {/* 任务 4 v4（2026-08-30）："使用此包" / "使用中" 统一为同一组件 .skin-pill。
                      之前 v3 用 button + state-pill success（两个 class、两种观感，用户报"仍有差异"）。
                      现在两边都是 .skin-pill：
                        - 默认 = bg-inset + 灰字 + 1px border（点击态）
                        - is-active = accent-soft + 深档文字 + accent border + Check 图标 */}
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
                    const sample = set.samples[kind];
                    const synth = !sample.src && !sample.tierSrcs;
                    return (
                      <li key={kind} title={meta.hint}>
                        <span className={`asset-sample-dot${synth ? ' is-synth' : ''}`} />
                        <span>{meta.label}</span>
                        <span className="asset-sample-tag">{sampleTag(sample)}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flow-note"><Check size={15} />切换后立即对后续播放生效；当前播放中的按键音将在暂停/重播后使用新素材。</div>
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
        <p>键音（音符击打音效）的独立音量，<strong>不影响 BGM</strong>。原 issue 39 #7，本轮迁入音频域。</p>
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

/** 采样类型短标签：真实音频 / 振荡器占位 / 分档音频（与 AssetsPage 同款，独立保留以解耦两页） */
function sampleTag(sample: KeySoundSample): string {
  if (sample.tierSrcs) return '音频 · 分档';
  if (sample.src) return '音频';
  return '振荡器';
}
