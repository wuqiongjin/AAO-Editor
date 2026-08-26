import { useRef, useState } from 'react';
import { AlertTriangle, Check, Clock3, Music2, SlidersHorizontal, Upload, Volume2 } from 'lucide-react';
import { useAudioPage } from '../contexts/AudioPageContext';
import { useConfig } from '../contexts';
import { MAX_DURATION_SECONDS, defaultSettings } from '../utils/AppSettings';
import { KEY_SOUND_SETS, type KeySoundSample } from '../utils/KeySound';
import { KEY_SOUND_KINDS, KEY_SOUND_KIND_META } from '../utils/KeySoundMeta';

// 音频页（issue 28 Q15 + issue 29 切片 4 闭环 + 2026-08-26 索引外置）：
//   - 页面顶部次级索引 = 独立组件（`page-sidebar`，在 `.page-content` 同级左侧），
//     仿照 AppShell 的 `app-nav` 模式：索引在页面**外**、不在 `.page-content` 内；
//   - 3 个 section：音频素材（含谱面时长）/ 键音素材包 / SE 音量；
//   - 键音/SE 与音源同域（settings.audio.{keySet, seVolume}），与视觉素材域解耦。
// - 导入/解码失败用内联错误横幅就地反馈（文字醒目、可即时重试）；
// - 成功仅更新状态，不加 toast；
// - 移除页内"返回工作台"按钮（切页由应用导航承担）；
// - 清除音频不需二次确认（低风险、可重新导入），旁加说明"清除后需重新导入"。
import './AudioPage.css';

type AudioSection = 'audio' | 'keysound' | 'se';

const AUDIO_SECTIONS: { id: AudioSection; label: string; icon: typeof Music2 }[] = [
  { id: 'audio', label: '音频素材', icon: Music2 },
  { id: 'keysound', label: '键音素材包', icon: Volume2 },
  { id: 'se', label: '节奏图示 SE 音量', icon: SlidersHorizontal },
];

export default function AudioPage() {
  const [section, setSection] = useState<AudioSection>('audio');
  return (
    <div className="audio-page">
      <aside className="page-sidebar" aria-label="音频域次级索引">
        <div className="page-sidebar-title">音频域</div>
        <nav role="tablist" aria-label="音频域分类">
          {AUDIO_SECTIONS.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={section === s.id}
                className={`page-sidebar-tab${section === s.id ? ' is-active' : ''}`}
                onClick={() => setSection(s.id)}
              >
                <Icon size={17} />
                <span>{s.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="page-content is-fill">
        <header className="page-intro">
          <span>当前谱面工程</span>
          <h2>音频与键音</h2>
          <p>管理谱面工程使用的音频素材、键音素材包与节奏图示 SE 音量。键音与音源同域（设置对象 audio 段）。</p>
        </header>

        <section className="surface-section audio-detail">
          {section === 'audio' && <AudioSection />}
          {section === 'keysound' && <KeySoundSection />}
          {section === 'se' && <SeVolumeSection />}
        </section>
      </div>
    </div>
  );
}

// ---------------- 音频素材（含谱面时长） ----------------

function AudioSection() {
  const api = useAudioPage();
  const fileRef = useRef<HTMLInputElement>(null);

  const audioName = api?.audioName ?? null;
  const canPlay = audioName !== null;
  const error = api?.error ?? null;
  const pickFile = () => fileRef.current?.click();

  return (
    <>
      <div className="settings-heading">
        <h2>音频素材</h2>
        <p>支持浏览器可解码的常见音频格式；导入后谱面时长将跟随音频长度。</p>
      </div>

      <div className="audio-file">
        <span className="audio-file-icon"><Music2 size={22} /></span>
        <div>
          <strong>{canPlay ? audioName : '尚未导入音频'}</strong>
          <span>{canPlay ? '已加载 · 谱面时长锁定为音频时长' : '无音频模式可正常编辑和预览谱面'}</span>
        </div>
        {canPlay && (
          <button type="button" onClick={() => api?.clearAudio()} title="清除后需重新导入">
            清除
          </button>
        )}
      </div>

      <div className="section-actions">
        <button className="button-primary" type="button" onClick={pickFile}>
          <Upload size={16} />{canPlay ? '更换音频' : '导入音频'}
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files && e.target.files[0]) api?.importAudio(e.target.files[0]); e.target.value = ''; }}
          />
        </button>
        <span>导入后，谱面时长将跟随音频长度。</span>
      </div>

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
            value={Math.round(api?.duration ?? 30)}
            readOnly={canPlay}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!isNaN(v) && v > 0) api?.onDurationChange(Math.min(v, MAX_DURATION_SECONDS));
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
              <button type="button" onClick={() => api?.dismissError()}>知道了</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------- 键音素材包 ----------------

function KeySoundSection() {
  const { settings, setKeySetId } = useConfig();
  const activeId = settings.audio.keySet;

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
                  {active ? (
                    <span className="state-pill success" aria-label="正在使用">
                      <Check size={13} /> 使用中
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="button-primary asset-set-apply"
                      onClick={() => setKeySetId(set.id)}
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
  const { settings, setSeVolume } = useConfig();
  const seVolumePercent = Math.round(settings.audio.seVolume * 100);

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
            onChange={(e) => setSeVolume(Number(e.target.value) / 100)}
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
          onClick={() => setSeVolume(defaultSettings().audio.seVolume)}
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
