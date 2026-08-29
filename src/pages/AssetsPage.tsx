import { useMemo, useRef, useState } from 'react';
import { Check, Eye, EyeOff, ImagePlus, Music2, Sparkles, Trash2, Upload, Wand2 } from 'lucide-react';
import AppPageShell from '../layouts/AppPageShell';
import { useConfig } from '../app/ProviderTree';
import {
  listNoteSkinPacks,
  normalizeNoteSkinSelection,
} from '../renderer/noteSkin';
import NoteSkinPreview from '../chart/rendering/NoteSkinPreview';
import { backgroundSkinStore } from '../chart/rendering/backgroundSkin';
import { useBackgroundSkin } from '../chart/rendering/useBackgroundSkin';
import { DEFAULT_BACKGROUND_OPACITY, DEFAULT_BACKGROUND_FIT, DEFAULT_BACKGROUND_SCOPE } from '../chart/config/AppSettings';

// 视觉素材页（issue 29 切片 4 闭环后 + issue 44 内容壳迁移）：导航第 3 项。
//   - 接入 <AppPageShell>：原"页内顶部 2 个类别 tab（.assets-tabs）"改为 <AppPageShell.Sidebar> 下 2 个
//     <AppPageShell.SidebarItem>（音符皮肤 / 背景皮肤），Body 走 mode="default" width="wide"；
//   - grill 2026-08-17 + 2026-08-24 定案：
//     - 「素材」tab 收窄为**视觉素材**（音符皮肤 + 背景皮肤），键音整包与 SE 音量已迁音频页
//       （与音源同域，归属于 settings.audio），与 settings.visual.noteSkin 解耦；
//     - 页面内**类别子 tab**（音符皮肤 | 背景皮肤）一次看一个类别，可扩展；
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
//
// 背景皮肤（2026-08-27，Q4 最小模型定案并实现）：1 张本地图片（IndexedDB）+ 启用开关（settings）+ 清除；
//   cover 铺满 + 固定暗色遮罩渲染进画布静态层；本面板承载上传 / 隐藏 / 清除。

type AssetCategory = 'noteskin' | 'background';

// 资产类别 → lucide 图标映射（issue 44 侧边项用图标，替代原"页内顶部 2 tab"）
const ASSET_CATEGORIES: { id: AssetCategory; label: string; icon: typeof Music2 }[] = [
  { id: 'noteskin', label: '音符皮肤', icon: Music2 },
  { id: 'background', label: '背景皮肤', icon: ImagePlus },
];

export default function AssetsPage() {
  const [category, setCategory] = useState<AssetCategory>('noteskin');

  return (
    <AppPageShell>
      <AppPageShell.Header
        eyebrow="应用素材"
        title="视觉素材"
        description="管理谱面编辑使用的视觉素材包（音符皮肤、背景皮肤）。键音素材包已迁至音频页。切换立即生效并自动保存。"
      />

      <AppPageShell.Sidebar ariaLabel="素材类别">
        {ASSET_CATEGORIES.map((cat) => (
          <AppPageShell.SidebarItem
            key={cat.id}
            icon={cat.icon}
            label={cat.label}
            active={category === cat.id}
            onClick={() => setCategory(cat.id)}
          />
        ))}
      </AppPageShell.Sidebar>

      <AppPageShell.Body mode="default">
        {category === 'noteskin' && <NoteSkinPanel />}
        {category === 'background' && <BackgroundPanel />}
      </AppPageShell.Body>
    </AppPageShell>
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

// ---------------- 背景皮肤（issue 29 Q4 最小模型，2026-08-27 定案并实现） ----------------
// 最小模型 = 1 张图（本地单张上传，png/jpeg/webp ≤20MB）+ 启用开关 + 清除。
// 图片本体存 IndexedDB（utils/backgroundSkin.ts），settings.visual.backgroundSkin.enabled 只存开关位；
// 上传成功自动启用；清除同时删库存档并关开关。渲染效果见 renderer/staticLayerCache.ts（cover 铺满 + 固定暗色遮罩）。

const BG_ACCEPT = 'image/png,image/jpeg,image/webp';
const BG_MAX_FILE_BYTES = 20 * 1024 * 1024;

function BackgroundPanel() {
  const { settings, setBackgroundSkin } = useConfig();
  const snap = useBackgroundSkin();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bg = settings.visual?.backgroundSkin;
  const enabled = bg?.enabled ?? false;
  const opacityPct = Math.round((bg?.opacity ?? DEFAULT_BACKGROUND_OPACITY) * 100);
  const image = snap.image;

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setError('仅支持 PNG / JPEG / WebP 格式图片');
      return;
    }
    if (file.size > BG_MAX_FILE_BYTES) {
      setError('图片过大（上限 20MB），请压缩后重试');
      return;
    }
    setBusy(true);
    try {
      await backgroundSkinStore.setImage(file);
      // 上传即启用（最小模型的"开关"语义：用户可见的结果优先）
      setBackgroundSkin({ enabled: true });
    } catch (e) {
      console.error('[AssetsPage] 背景图保存失败:', e);
      setError('背景图保存失败，请重试');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleClear = async () => {
    setError(null);
    setBusy(true);
    try {
      await backgroundSkinStore.clear();
      setBackgroundSkin({ enabled: false });
    } catch (e) {
      console.error('[AssetsPage] 背景图清除失败:', e);
      setError('清除失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="skin-panel" aria-label="背景皮肤">
      <div className="section-heading">
        <div>
          <h2>谱面背景皮肤</h2>
        </div>
        <span className="state-label">{image ? (enabled ? '使用中' : '已隐藏') : '未设置'}</span>
      </div>

      <div className={`asset-set skin-preset bg-card${image && enabled ? ' is-active' : ''}`}>
        <input
          ref={fileRef}
          type="file"
          accept={BG_ACCEPT}
          aria-hidden="true"
          tabIndex={-1}
          className="bg-file-input"
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />

        {/* 预览：真实背景图等比缩放展示；未上传时为占位视觉 */}
        <div className={`bg-preview${image && !enabled ? ' is-off' : ''}`} aria-hidden="true">
          {image ? (
            <img src={image.url} alt="" />
          ) : (
            <ImagePlus size={26} />
          )}
        </div>

        <div className="asset-set-body">
          <div className="asset-set-head">
            <strong>{image ? '自定义背景图' : '谱面画布背景'}</strong>
            {snap.status === 'ready' && image && enabled && (
              <span className="state-pill success" aria-label="背景正在使用">
                <Check size={13} /> 使用中
              </span>
            )}
            {snap.status === 'ready' && image && !enabled && (
              <span className="state-pill warning">已隐藏</span>
            )}
            <span className="inline-actions">
              {(!image || !enabled) && (
                <button
                  type="button"
                  className="button-primary"
                  disabled={busy || snap.status !== 'ready'}
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload size={14} />{image ? '更换并启用' : '上传图片'}
                </button>
              )}
              {image && enabled && (
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy}
                  onClick={() => setBackgroundSkin({ enabled: false })}
                >
                  <EyeOff size={14} />隐藏
                </button>
              )}
              {image && !enabled && (
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy}
                  onClick={() => setBackgroundSkin({ enabled: true })}
                >
                  <Eye size={14} />启用
                </button>
              )}
              {image && (
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy}
                  onClick={() => void handleClear()}
                >
                  <Trash2 size={14} />清除
                </button>
              )}
            </span>
          </div>

          {error ? (
            <span className="field-help is-error">{error}</span>
          ) : (
            <span className="field-help">
              给谱面画布设置一张背景图（PNG / JPEG / WebP，≤20MB）。画布固定深色主题不变，背景图为其上可选层；
              自动铺满并压暗以保证音符可读。仅存本机，不上传服务器，随编辑器配置持久保存。
            </span>
          )}
        </div>
      </div>

      {/* 显示范围（用户 grill 定案：默认仅轨道外，不覆盖轨道本身，不影响作谱） */}
      <div className="settings-row">
        <div className="settings-row__text">
          <strong>显示范围</strong>
          <span>仅轨道外 = 背景只出现在轨道两侧空白区，轨道区域保持原始深色，完全不影响作谱；全画布 = 沉浸式铺满（轨道区压暗）。</span>
        </div>
        <select
          className="select-control"
          value={bg?.scope ?? DEFAULT_BACKGROUND_SCOPE}
          disabled={!image || !enabled || busy}
          onChange={(e) => setBackgroundSkin({ scope: e.target.value as 'outsideTrack' | 'fullCanvas' })}
          aria-label="背景显示范围"
        >
          <option value="outsideTrack">仅轨道外</option>
          <option value="fullCanvas">全画布</option>
        </select>
      </div>

      {/* 填充方式（issue 29 扩展配置 grill 定案）：cover 铺满裁剪 / contain 完整显示留黑边 */}
      <div className="settings-row">
        <div className="settings-row__text">
          <strong>填充方式</strong>
          <span>铺满裁剪 = 等比放大盖满画布、超出裁剪；完整显示 = 等比缩放到放得下、不足处留黑边（不裁剪）。</span>
        </div>
        <select
          className="select-control"
          value={bg?.fit ?? DEFAULT_BACKGROUND_FIT}
          disabled={!image || !enabled || busy}
          onChange={(e) => setBackgroundSkin({ fit: e.target.value as 'cover' | 'contain' })}
          aria-label="背景填充方式"
        >
          <option value="cover">铺满裁剪</option>
          <option value="contain">完整显示</option>
        </select>
      </div>

      {/* 不透明度（issue 29 修订 2026-08-27）：图片自身 alpha 合成，越低画布原始黑色占比越多；默认 55% 与首版固定遮罩观感一致 */}
      <div className="settings-row">
        <div className="settings-row__text">
          <strong>背景不透明度</strong>
          <span>图片越透明，画布原始黑色背景占比越多。0%（纯黑）— 100%（原图全亮），默认 55%。</span>
        </div>
        <div className="slider-control">
          <input
            type="range" min={0} max={100} step={5} value={opacityPct}
            disabled={!image || !enabled || busy}
            onChange={(e) => setBackgroundSkin({ opacity: Number(e.target.value) / 100 })}
            aria-label="背景图不透明度"
          />
          <span className="slider-value">{opacityPct}%</span>
        </div>
      </div>

      <div className="flow-note"><Check size={15} />启用后立即在画布生效；「隐藏」保留图片、一键恢复，「清除」彻底删除。</div>
    </section>
  );
}
