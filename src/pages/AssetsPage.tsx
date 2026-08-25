import { useMemo, useState } from 'react';
import { Check, Image as ImageIcon, Palette } from 'lucide-react';
import { useConfig } from '../contexts';
import { KEY_SOUND_SETS, type KeySoundSample } from '../utils/KeySound';
import { KEY_SOUND_KINDS, KEY_SOUND_KIND_META } from '../utils/KeySoundMeta';
import {
  listNoteSkinPacks,
  normalizeNoteSkinSelection,
  NOTE_SKIN_ITEM_IDS,
  NOTE_SKIN_ITEM_META,
  type NoteSkinItemId,
} from '../renderer/noteSkin';
import NoteSkinPreview from '../components/NoteSkinPreview';

// 素材页（issue 29）：导航第 3 项（音频之后，设置置末）。
// grill 2026-08-17 定案：类别 ≥3 后页内改**类别子 tab**（键音 | 音符皮肤 | 背景皮肤），一次看一个类别。
// - 键音素材包：卡片列表，点「切换」写 settings.audio.keySet（与播放条同字段，立即生效并持久化）。
// - 音符皮肤（grill 2026-08-24 定案）：官方同名整包预设一键应用 + 六条目独立覆盖；
//   顶部综合预览画布（Q8=B，真实精灵绘制）实时反映当前组合。
// - 背景皮肤：占位（数据模型待后续 grill）。

/** 采样类型短标签：真实音频 / 振荡器占位 / 分档音频 */
function sampleTag(sample: KeySoundSample): string {
  if (sample.tierSrcs) return '音频 · 分档';
  if (sample.src) return '音频';
  return '振荡器';
}

type AssetCategory = 'keysound' | 'noteskin' | 'background';

const ASSET_CATEGORIES: { id: AssetCategory; label: string }[] = [
  { id: 'keysound', label: '键音' },
  { id: 'noteskin', label: '音符皮肤' },
  { id: 'background', label: '背景皮肤' },
];

export default function AssetsPage() {
  const { settings, setKeySetId } = useConfig();
  const activeId = settings.audio.keySet;
  const [category, setCategory] = useState<AssetCategory>('keysound');

  return (
    <div className="page-content is-fill">
      <header className="page-intro">
        <span>应用素材</span>
        <h2>素材</h2>
        <p>管理谱面编辑使用的键音与视觉素材包。切换立即生效并自动保存。</p>
      </header>

      <div className="assets-tabs" role="tablist" aria-label="素材类别">
        {ASSET_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            role="tab"
            aria-selected={category === cat.id}
            className={`assets-tab${category === cat.id ? ' is-active' : ''}`}
            onClick={() => setCategory(cat.id)}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {category === 'keysound' && <KeySoundPanel activeId={activeId} onSelect={setKeySetId} />}
      {category === 'noteskin' && <NoteSkinPanel />}
      {category === 'background' && <BackgroundPlaceholder />}
    </div>
  );
}

// ---------------- 键音素材包 ----------------

function KeySoundPanel({ activeId, onSelect }: { activeId: string; onSelect: (id: string) => void }) {
  return (
    <section className="assets-sets" aria-label="键音素材包">
      <div className="section-heading">
        <div>
          <h2>键音素材包</h2>
          <p>播放时按击打样式（单键 / 滑键 / 技能键 / 滑条 / 方向键）触发对应音效</p>
        </div>
        <span className="state-label">{KEY_SOUND_SETS.length} 个</span>
      </div>

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
                  <span className="state-label success">使用中</span>
                ) : (
                  <button type="button" onClick={() => onSelect(set.id)}>
                    切换
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

      <div className="flow-note"><Check size={15} />切换后立即对后续播放生效；当前播放中的按键音将在暂停/重播后使用新素材。</div>
    </section>
  );
}

// ---------------- 音符皮肤（issue 29） ----------------

function NoteSkinPanel() {
  const { settings, setNoteSkin } = useConfig();
  // 读取即归一化：缺省/非法包 id 回退默认包（渲染器同规则，两处观感一致）
  const selection = useMemo(() => normalizeNoteSkinSelection(settings.visual?.noteSkin), [settings.visual?.noteSkin]);
  const packs = listNoteSkinPacks();
  const notePacks = packs.filter((p) => p.kind === 'note');

  /** 整包预设 = 官方同名配对（skin0N + directionalflickskin0N）一键写入六条目 */
  const applyPreset = (noteId: string, pairedDir: string | null) => {
    setNoteSkin({
      tap: noteId,
      flick: noteId,
      skill: noteId,
      slide: noteId,
      ...(pairedDir ? { dirL: pairedDir, dirR: pairedDir } : {}),
    });
  };

  const isPresetActive = (noteId: string, pairedDir: string | null) =>
    selection.tap === noteId && selection.flick === noteId && selection.skill === noteId && selection.slide === noteId
    && (pairedDir === null || (selection.dirL === pairedDir && selection.dirR === pairedDir));

  return (
    <section className="skin-panel" aria-label="音符皮肤">
      <div className="section-heading">
        <div>
          <h2>音符皮肤</h2>
          <p>谱面音符的外观素材包。整包一键应用，或按条目单独覆盖；预览实时反映当前组合。</p>
        </div>
        <span className="state-label">{packs.length} 个</span>
      </div>

      {/* 综合预览（grill Q8=B）：真实精灵绘制六类样例，选择变化即时刷新 */}
      <NoteSkinPreview selection={selection} />

      <div className="skin-presets">
        <h3>整包预设</h3>
        <div className="skin-preset-list">
          {notePacks.map((pack) => {
            const active = isPresetActive(pack.id, pack.pairedDir);
            return (
              <div key={pack.id} className={`skin-preset${active ? ' is-active' : ''}`}>
                <div className="skin-preset-head">
                  <strong>{pack.label}</strong>
                  {active ? (
                    <span className="state-label success">使用中</span>
                  ) : (
                    <button type="button" onClick={() => applyPreset(pack.id, pack.pairedDir)}>应用整包</button>
                  )}
                </div>
                <span className="field-help">
                  {pack.pairedDir ? `含方向键配对：${packs.find((p) => p.id === pack.pairedDir)?.label ?? pack.pairedDir}` : '不含方向键配对'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="skin-items">
        <h3>按条目覆盖</h3>
        {NOTE_SKIN_ITEM_IDS.map((item: NoteSkinItemId) => {
          const meta = NOTE_SKIN_ITEM_META[item];
          const eligible = packs.filter((p) => p.kind === meta.eligible);
          return (
            <label key={item} className="skin-item">
              <span className="skin-item-name" title={meta.hint}>{meta.label}</span>
              <select
                value={selection[item]}
                onChange={(e) => setNoteSkin({ [item]: e.target.value })}
              >
                {eligible.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </label>
          );
        })}
        <div className="flow-note"><Check size={15} />条目选择立即生效并自动保存；画布音符外观即时切换。</div>
      </div>
    </section>
  );
}

// ---------------- 背景皮肤（占位） ----------------

function BackgroundPlaceholder() {
  return (
    <aside className="assets-skin surface-section" aria-label="背景皮肤（占位）">
      <div className="assets-skin-head">
        <ImageIcon size={18} />
        <div>
          <h2>谱面背景皮肤</h2>
          <p>谱面画布背景图</p>
        </div>
      </div>

      <div className="skin-preview" aria-hidden="true">
        <Palette size={22} />
      </div>

      <span className="skin-badge">即将支持</span>
      <span className="field-help">给谱面画布设置背景图（画布固定深色主题不变，背景图是其上的可选层）。数据模型待后续定案，此处仅预留分类。</span>
    </aside>
  );
}