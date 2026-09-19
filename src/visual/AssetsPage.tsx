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
import { t, type MessageKey } from '../i18n';

// 视觉素材页（导航第 3 项）：音符皮肤（整包预设 + 条目独立覆盖）+ 背景皮肤（单图上传/隐藏/清除）。

type AssetCategory = 'noteskin' | 'background';

// 资产类别 → lucide 图标映射（issue 44 侧边项用图标，替代原"页内顶部 2 tab"）
const ASSET_CATEGORIES: { id: AssetCategory; labelKey: MessageKey; icon: typeof Music2 }[] = [
  { id: 'noteskin', labelKey: 'assets.noteskin', icon: Music2 },
  { id: 'background', labelKey: 'assets.background', icon: ImagePlus },
];

export default function AssetsPage() {
  const [category, setCategory] = useState<AssetCategory>('noteskin');

  return (
    <AppPageShell>
      <AppPageShell.Header
        eyebrow={t('assets.header.eyebrow')}
        title={t('assets.header.title')}
        description={t('assets.header.description')}
      />

      <AppPageShell.Sidebar ariaLabel={t('assets.sidebar.aria')}>
        {ASSET_CATEGORIES.map((cat) => (
          <AppPageShell.SidebarItem
            key={cat.id}
            icon={cat.icon}
            label={t(cat.labelKey)}
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
    <section className="assets-panel app-stagger" aria-label={t('assets.noteskin')}>
      {/* 删掉"音符皮肤"标题（与 AppPageShell.Header 重复），{notePacks.length} 移到整包预设右侧 */}
      <div className="section-heading">
        <div>
          <h2 className="visually-hidden">{t('assets.noteskin')}</h2>
        </div>
      </div>

      {/* 外层 surface-section 卡片（内部保留 .skin-preset card 容器） */}
      <section className="surface-section skin-preset-section">
        <div className="skin-section">
          <h3 className="skin-section-title">
            <Wand2 size={16} />
            <span className="skin-section-title__label">{t('assets.preset')}</span>
            <span className="skin-section-title__count state-label">{t('assets.presetCount', { count: notePacks.length })}</span>
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
                        <span className="skin-pill is-active" aria-label={t('assets.presetInUseAria')}>
                          <Check size={12} />{t('assets.presetInUse')}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="skin-pill"
                          onClick={() => applyPreset(pack.id, pack.pairedDir)}
                        >
                          {t('assets.applyPreset')}
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
      setError(t('assets.bg.typeError'));
      return;
    }
    if (file.size > BG_MAX_FILE_BYTES) {
      setError(t('assets.bg.sizeError'));
      return;
    }
    setBusy(true);
    try {
      await backgroundSkinStore.setImage(file);
      // 上传即启用（最小模型的"开关"语义：用户可见的结果优先）
      setBackgroundSkin({ enabled: true });
    } catch (e) {
      console.error('[AssetsPage] 背景图保存失败:', e);
      setError(t('assets.bg.saveError'));
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
      setError(t('assets.bg.clearError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="assets-panel app-stagger" aria-label={t('assets.background')}>
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
                <strong>{t('assets.bg.custom')}</strong>
                {snap.status === 'ready' && enabled && (
                  <span className="state-pill success" aria-label={t('assets.bg.inUseAria')}>
                    <Check size={13} /> {t('assets.bg.visible')}
                  </span>
                )}
                {snap.status === 'ready' && !enabled && (
                  <span className="state-pill warning">{t('assets.bg.hidden')}</span>
                )}
              </div>
              <div className="bg-upload-actions">
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload size={14} />{t('assets.bg.replace')}
                </button>
                {enabled ? (
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={busy}
                    onClick={() => setBackgroundSkin({ enabled: false })}
                  >
                    <EyeOff size={14} />{t('assets.bg.hide')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={busy}
                    onClick={() => setBackgroundSkin({ enabled: true })}
                  >
                    <Eye size={14} />{t('assets.bg.enable')}
                  </button>
                )}
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy}
                  onClick={() => void handleClear()}
                >
                  <Trash2 size={14} />{t('assets.bg.clear')}
                </button>
              </div>
            </div>

            {error ? (
              <span className="field-help is-error">{error}</span>
            ) : (
              <span className="field-help">
                {t('assets.bg.help')}
              </span>
            )}
          </div>
        </div>
      ) : (
        <EmptyState
          icon={ImageOff}
          title={t('assets.bg.emptyTitle')}
          description={t('assets.bg.emptyDescription')}
          primaryAction={{
            label: t('assets.bg.upload'),
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
            <strong>{t('assets.bg.scope')}</strong>
            <span>{t('assets.bg.scope.hint')}</span>
          </div>
          <select
            className="select-control"
            value={bg?.scope ?? DEFAULT_BACKGROUND_SCOPE}
            disabled={!image || !enabled || busy}
            onChange={(e) => setBackgroundSkin({ scope: e.target.value as 'outsideTrack' | 'fullCanvas' })}
            aria-label={t('assets.bg.scope')}
          >
            <option value="outsideTrack">{t('assets.bg.scope.outsideTrack')}</option>
            <option value="fullCanvas">{t('assets.bg.scope.fullCanvas')}</option>
          </select>
        </div>

        {/* 填充方式 */}
        <div className="settings-row">
          <div className="settings-row__text">
            <strong>{t('assets.bg.fit')}</strong>
            <span>{t('assets.bg.fit.hint')}</span>
          </div>
          <select
            className="select-control"
            value={bg?.fit ?? DEFAULT_BACKGROUND_FIT}
            disabled={!image || !enabled || busy}
            onChange={(e) => setBackgroundSkin({ fit: e.target.value as 'cover' | 'contain' })}
            aria-label={t('assets.bg.fit')}
          >
            <option value="cover">{t('assets.bg.fit.cover')}</option>
            <option value="contain">{t('assets.bg.fit.contain')}</option>
          </select>
        </div>

        {/* 不透明度 */}
        <div className="settings-row">
          <div className="settings-row__text">
            <strong>{t('assets.bg.opacity')}</strong>
            <span>{t('assets.bg.opacity.hint')}</span>
          </div>
          <div className="slider-control">
            <input
              type="range" min={0} max={100} step={5} value={opacityPct}
              disabled={!image || !enabled || busy}
              onChange={(e) => setBackgroundSkin({ opacity: Number(e.target.value) / 100 })}
              aria-label={t('assets.bg.opacity')}
            />
            <span className="slider-value">{opacityPct}%</span>
          </div>
        </div>

        <div className="flow-note"><Check size={15} />{t('assets.bg.note')}</div>
      </section>
    </section>
  );
}
