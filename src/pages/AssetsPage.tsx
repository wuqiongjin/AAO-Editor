import { useMemo, useState } from 'react';
import { Check, Image as ImageIcon, Palette, Sparkles, Wand2 } from 'lucide-react';
import { useConfig } from '../contexts';
import {
  listNoteSkinPacks,
  normalizeNoteSkinSelection,
} from '../renderer/noteSkin';
import NoteSkinPreview from '../components/NoteSkinPreview';

// 视觉素材页（issue 29 切片 4 闭环后）：导航第 3 项。
// grill 2026-08-17 + 2026-08-24 定案：
//   - 「素材」tab 收窄为**视觉素材**（音符皮肤 + 背景皮肤），键音整包与 SE 音量已迁音频页
//     （与音源同域，归属于 settings.audio），与 settings.visual.noteSkin 解耦；
//   - 页面内**类别子 tab**（音符皮肤 | 背景皮肤）一次看一个类别，可扩展；
//   - 音符皮肤：官方同名整包预设一键应用 + 六条目独立覆盖；
//     顶部综合预览画布（Q8=B 真实精灵绘制）实时反映当前组合。
//
// 形态整改（2026-08-25 切片 1-4，详见 issue 29 Comments）：
//   - 选中态：去掉「切换」按钮，整卡加 ✓ 主色实心徽标 + 描边/底色对比；
//   - 未选中态：主色实心「应用」按钮；
//   - 整包预设被部分条目覆盖时，预设卡 + 该条目卡 各显示一个「● 已覆盖 / 已修改」红点（Q9=A 双点提示）；
//   - 「按条目独立覆盖」改为「条目卡 + 包缩略格」网格；
//   - 综合预览改 6 列 2 行（Q13=A，列对齐，高信息密度）；
//   - 同号方向 vs 普通包用户视角下是 1 套皮肤（label 同名 = "Skin 0N"），底层 id 区分；
//   - 副标 subtitle = "整包应用" / "已自定义 · N 项"（琥珀色 = 已自定义）。

type AssetCategory = 'noteskin' | 'background';

const ASSET_CATEGORIES: { id: AssetCategory; label: string }[] = [
  { id: 'noteskin', label: '音符皮肤' },
  { id: 'background', label: '背景皮肤' },
];

export default function AssetsPage() {
  const [category, setCategory] = useState<AssetCategory>('noteskin');

  return (
    <div className="page-content is-wide">
      <header className="page-intro">
        <span>应用素材</span>
        <h2>视觉素材</h2>
        <p>管理谱面编辑使用的视觉素材包（音符皮肤、背景皮肤）。键音素材包已迁至音频页。切换立即生效并自动保存。</p>
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

      {category === 'noteskin' && <NoteSkinPanel />}
      {category === 'background' && <BackgroundPlaceholder />}
    </div>
  );
}

// ---------------- 音符皮肤（issue 29） ----------------

function NoteSkinPanel() {
  const { settings, setNoteSkin } = useConfig();
  // 读取即归一化：缺省/非法包 id 回退默认包（渲染器同规则，两处观感一致）
  const selection = useMemo(() => normalizeNoteSkinSelection(settings.visual?.noteSkin), [settings.visual?.noteSkin]);
  const notePacks = listNoteSkinPacks().filter((p) => p.kind === 'note');

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
        </div>
        <span className="state-label">{notePacks.length} 个</span>
      </div>

      {/* 整包预设（一键整包 = 高频高优，先看见） */}
      <div className="skin-section">
        <h3 className="skin-section-title">
          <Wand2 size={16} />
          整包预设
        </h3>
        <div className="skin-preset-list">
          {notePacks.map((pack) => {
            const active = isPresetActive(pack.id, pack.pairedDir);
            return (
              <div
                key={pack.id}
                className={[
                  'asset-set',
                  'skin-preset',
                  active ? 'is-active' : '',
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
