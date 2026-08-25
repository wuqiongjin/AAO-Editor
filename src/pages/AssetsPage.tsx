import { useMemo, useState } from 'react';
import { Check, Image as ImageIcon, Palette, Sparkles, Wand2 } from 'lucide-react';
import { useConfig } from '../contexts';
import { KEY_SOUND_SETS, type KeySoundSample } from '../utils/KeySound';
import { KEY_SOUND_KINDS, KEY_SOUND_KIND_META } from '../utils/KeySoundMeta';
import {
  listNoteSkinPacks,
  normalizeNoteSkinSelection,
} from '../renderer/noteSkin';
import NoteSkinPreview from '../components/NoteSkinPreview';

// 素材页（issue 29）：导航第 3 项（音频之后，设置置末）。
// grill 2026-08-17 定案：类别 ≥3 后页内改**类别子 tab**（键音 | 音符皮肤 | 背景皮肤），一次看一个类别。
//   - 键音素材包：卡片列表，点「使用此包」写 settings.audio.keySet（与播放条同字段，立即生效并持久化）。
//   - 音符皮肤（grill 2026-08-24 定案 + 2026-08-25 形态整改）：官方同名整包预设一键应用 + 六条目独立覆盖；
//     顶部综合预览画布（Q8=B 真实精灵绘制）实时反映当前组合。
//   - 背景皮肤：占位（数据模型待后续 grill）。
//
// 形态整改（2026-08-25 切片 1，详见 issue 29 Comments）：
//   - 选中态：去掉「切换」按钮，整卡加 ✓ 主色实心徽标 + 描边/底色对比；
//   - 未选中态：主色实心「使用此包 / 应用」按钮；
//   - 整包预设被部分条目覆盖时，预设卡 + 该条目卡 各显示一个「● 已覆盖 / 已修改」红点（Q9=A 双点提示）；
//   - 「按条目独立覆盖」改为「条目卡 + 包缩略格」网格（Q3-1 = 网格+缩略；缩略真实精灵在下轮切片接入，本轮先占位文字方块）；
//   - 综合预览改 2×3 网格 + 当前组合大标题（Q3-2）。

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

      <div className="asset-set-grid">
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
                      onClick={() => onSelect(set.id)}
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

  /** "整包预设被部分条目覆盖"——与默认完全相等才算"未修改" */
  const isPresetModified = (noteId: string, pairedDir: string | null) =>
    !isPresetActive(noteId, pairedDir);

  return (
    <section className="skin-panel" aria-label="音符皮肤">
      <div className="section-heading">
        <div>
          <h2>音符皮肤</h2>
          <p>谱面音符的外观素材包。每行 = 1 个音符类型 = 1 个真实精灵示例 + 1 组可选包。点任意缩略切换；与整包预设并存。</p>
        </div>
        <span className="state-label">{packs.length} 个</span>
      </div>

      {/* 整包预设（Q14 切片 3 前置：一键整包 = 高频高优，先看见） */}
      <div className="skin-section">
        <div className="skin-section-head">
          <Wand2 size={16} />
          <h3>整包预设</h3>
          <span className="field-help">官方同编号配对，一键写入六条目；之后仍可按条目单独覆盖。</span>
        </div>
        <div className="skin-preset-list">
          {notePacks.map((pack) => {
            const active = isPresetActive(pack.id, pack.pairedDir);
            const modified = isPresetModified(pack.id, pack.pairedDir);
            return (
              <div
                key={pack.id}
                className={[
                  'asset-set',
                  'skin-preset',
                  active ? 'is-active' : '',
                  modified && !active ? 'is-modified' : '',
                ].filter(Boolean).join(' ')}
              >
                <div className="asset-set-visual" aria-hidden="true">
                  <Sparkles size={20} />
                </div>
                <div className="asset-set-body">
                  <div className="asset-set-head">
                    <strong>{pack.label}</strong>
                    {active ? (
                      <span className="state-pill success" aria-label="整包正在使用">
                        <Check size={13} /> 整包使用中
                      </span>
                    ) : modified ? (
                      <span className="state-pill warning" aria-label="已被条目覆盖">
                        ● 已修改
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="button-primary asset-set-apply"
                        onClick={() => applyPreset(pack.id, pack.pairedDir)}
                      >
                        应用整包
                      </button>
                    )}
                  </div>
                  {/* 整包预设 = 1 套皮肤 = 同时覆盖 6 类音符；不向用户暴露"方向键配对"这种实现细节 */}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 综合预览 + 按条目选择（Q13=A 切片 3：6 列 2 行，列对齐；高信息密度） */}
      <NoteSkinPreview
        selection={selection}
        onChange={(item, packId) => setNoteSkin({ [item]: packId })}
      />
    </section>
  );
}

// 单条目覆盖行已并入 NoteSkinPreview（2026-08-25 切片 2），此处不再需要 SkinItemRow。

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