import { useMemo, useRef, useState } from 'react';
import { Check, Eye, EyeOff, ImageOff, ImagePlus, Music2, Sparkles, Trash2, Upload, Wand2 } from 'lucide-react';
import AppPageShell from '../layouts/AppPageShell';
import EmptyState from '../ui/EmptyState';
import { useConfig } from '../app/ProviderTree';
import {
  listNoteSkinPacks,
  normalizeNoteSkinSelection,
} from './noteSkin';
import NoteSkinPreview from '../chart/rendering/NoteSkinPreview';
import { backgroundSkinStore } from '../chart/rendering/backgroundSkin';
import { useBackgroundSkin } from '../chart/rendering/useBackgroundSkin';
import { DEFAULT_BACKGROUND_OPACITY, DEFAULT_BACKGROUND_FIT, DEFAULT_BACKGROUND_SCOPE } from '../chart/config/AppSettings';

// 视觉素材页（导航第 3 项）：音符皮肤（整包预设 + 条目独立覆盖）+ 背景皮肤（单图上传/隐藏/清除）。

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
        description="音符与背景皮肤；键音包在音频页。切换立即生效并自动保存。"
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
    <section className="assets-panel app-stagger" aria-label="音符皮肤">
      {/* 删掉"音符皮肤"标题（与 AppPageShell.Header 重复），{notePacks.length} 移到整包预设右侧 */}
      <div className="section-heading">
        <div>
          <h2 className="visually-hidden">音符皮肤</h2>
        </div>
      </div>

      {/* 外层 surface-section 卡片（内部保留 .skin-preset card 容器） */}
      <section className="surface-section skin-preset-section">
        <div className="skin-section">
          <h3 className="skin-section-title">
            <Wand2 size={16} />
            <span className="skin-section-title__label">整包预设</span>
            <span className="skin-section-title__count state-label">{notePacks.length} 个</span>
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
                      {/* 整包预设用 .skin-pill（与键音素材包统一规格）*/}
                      {active ? (
                        <span className="skin-pill is-active" aria-label="整包正在使用">
                          <Check size={12} />整包使用中
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="skin-pill"
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
      </section>

      {/* 综合预览 + 按条目选择 */}
      <NoteSkinPreview
        selection={selection}
        onChange={(item, packId) => setNoteSkin({ [item]: packId })}
      />
    </section>
  );
}

// ---------------- 背景皮肤：单图上传（IndexedDB 存图）+ 启用开关 + 清除 ----------------

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
    <section className="assets-panel app-stagger" aria-label="背景皮肤">
      {/* 删除 section-heading（h2 "谱面背景皮肤" 与 AppPageShell.Header 重复；state-label 与上传卡内 EmptyState/asset-set 状态重复）。
          assets-panel 直接装 2 个 surface-section 子卡：上传卡 + 设置卡。 */}

      <section className="surface-section bg-skin-section">
        {/* 空态：未上传图片时引导上传 */}
      {/* file input 无条件挂载：挂在 image 分支内会让已传图后的"更换"按钮 click() 落空 */}
      <input
        ref={fileRef}
        type="file"
        accept={BG_ACCEPT}
        aria-hidden="true"
        tabIndex={-1}
        className="visually-hidden-input"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      {image ? (
        <div className={`bg-upload-card${enabled ? ' is-active' : ''}`}>
          <div className={`bg-preview${!enabled ? ' is-off' : ''}`} aria-hidden="true">
            <img src={image.url} alt="" />
          </div>

          <div className="bg-upload-main">
            <div className="bg-upload-head">
              <div className="bg-upload-title">
                <strong>自定义背景图</strong>
                {snap.status === 'ready' && enabled && (
                  <span className="state-pill success" aria-label="背景正在使用">
                    <Check size={13} /> 使用中
                  </span>
                )}
                {snap.status === 'ready' && !enabled && (
                  <span className="state-pill warning">已隐藏</span>
                )}
              </div>
              <div className="bg-upload-actions">
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload size={14} />更换
                </button>
                {enabled ? (
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={busy}
                    onClick={() => setBackgroundSkin({ enabled: false })}
                  >
                    <EyeOff size={14} />隐藏
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={busy}
                    onClick={() => setBackgroundSkin({ enabled: true })}
                  >
                    <Eye size={14} />启用
                  </button>
                )}
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy}
                  onClick={() => void handleClear()}
                >
                  <Trash2 size={14} />清除
                </button>
              </div>
            </div>

            {error ? (
              <span className="field-help is-error">{error}</span>
            ) : (
              <span className="field-help">
                显示范围、填充与不透明度在下方卡片调整；仅存本机，不上传服务器。
              </span>
            )}
          </div>
        </div>
      ) : (
        <EmptyState
          icon={ImageOff}
          title="未设置背景"
          description="上传 PNG / JPEG / WebP（≤20MB），仅存本机。"
          primaryAction={{
            label: '上传图片',
            onClick: () => fileRef.current?.click(),
            icon: Upload,
            disabled: busy || snap.status !== 'ready',
          }}
        >
          {error && <span className="field-help is-error">{error}</span>}
        </EmptyState>
      )}
      </section>

      {/* 显示范围/填充方式/不透明度 包到 surface-section 设置卡（bg-skin-settings-section），
          与上传卡同款，形成"上传卡 + 设置卡"双卡结构。 */}
      <section className="surface-section bg-skin-settings-section">
        {/* 显示范围 */}
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

        {/* 填充方式 */}
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

        {/* 不透明度 */}
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
    </section>
  );
}
