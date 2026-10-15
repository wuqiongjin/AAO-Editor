import { useEffect, useRef, useState } from 'react';
import { Check, Download, FolderOpen, FolderSearch, FolderSync, MonitorCog, Trash2, Upload } from 'lucide-react';
import AppPageShell from '../../layouts/AppPageShell';
import { useConfig } from '../../app/ProviderTree';
import { CACHE_POLICY_RANGE, loadSettings } from '../../chart/config/AppSettings';
import type { AppSettings } from '../../chart/config/AppSettings';
import { t, type MessageKey } from '../../i18n';
import { clearSongCatalogCache } from '../../community/bestdori/songs';

// 设置页：接入 AppPageShell（Sidebar 扁平导航 + Body 设置详情），修改立即生效并持久化。
type Section = 'appearance' | 'data';

const THEME_OPTIONS: Array<{ value: AppSettings['theme']; labelKey: MessageKey; swatch: string }> = [
  { value: 'light', labelKey: 'settings.theme.light', swatch: 'light' },
  { value: 'dark', labelKey: 'settings.theme.dark', swatch: 'dark' },
  { value: 'system', labelKey: 'settings.theme.system', swatch: 'system' },
];

const UI_FONT_STACK_OPTIONS: Array<{ value: AppSettings['uiFontStack']; labelKey: MessageKey }> = [
  { value: 'geist', labelKey: 'settings.uiFont.geist' },
  { value: 'yahei', labelKey: 'settings.uiFont.yahei' },
  { value: 'noto', labelKey: 'settings.uiFont.noto' },
];

interface DataRootBridge {
  get(): Promise<{ path: string }>;
  open(): Promise<{ ok: boolean; path: string; message?: string }>;
  change(): Promise<{ ok: boolean; cancelled?: boolean; path: string; message?: string }>;
  claim(): Promise<{ ok: boolean; cancelled?: boolean; path: string; message?: string }>;
}

function getDataRootBridge(): DataRootBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { electronAPI?: { dataRoot?: DataRootBridge } }).electronAPI?.dataRoot;
}

/** 社区素材缓存（票 14）：只开占用查询与清除两条，没有别的面 */
interface AssetCacheStats {
  totalBytes: number;
  count: number;
  byKind: Record<string, { bytes: number; count: number }>;
}

interface AssetCacheBridge {
  stats(): Promise<AssetCacheStats>;
  clear(): Promise<{ freedBytes: number }>;
}

function getAssetCacheBridge(): AssetCacheBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { electronAPI?: { assetCache?: AssetCacheBridge } }).electronAPI?.assetCache;
}

/** 字节 → 人看的（B / KB / MB / GB，一位小数） */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** 行内滑块行：百分比参数（值以比例存储，UI 以 % 显示） */
function PercentSliderRow({
  label, hint, value, min, max, step, onChange,
}: {
  label: string; hint: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row__text">
        <strong>{label}</strong>
        <span>{hint}</span>
      </div>
      <div className="slider-control">
        <input
          type="range" min={min} max={max} step={step} value={Math.round(value * 100)}
          onChange={(e) => onChange(Number(e.target.value) / 100)}
        />
        <span className="slider-value">{Math.round(value * 100)}%</span>
      </div>
    </div>
  );
}

/** 行内数字行：一个带单位的数（缓存策略这类参数，票 18） */
function NumberRow({
  label, hint, value, min, max, onChange,
}: {
  label: string; hint: string; value: number; min: number; max: number; onChange: (v: number) => void;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row__text">
        <strong>{label}</strong>
        <span>{hint}</span>
      </div>
      <input
        className="number-control"
        type="number"
        min={min}
        max={max}
        step={1}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export default function SettingsPage() {
  const { settings, setTheme, setUiLanguage, setUiTypeScale, setUiFontStack, setCachePolicy, setAllSettings } = useConfig();
  const [section, setSection] = useState<Section>('appearance');
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dataRootApi = getDataRootBridge();
  const [dataRootPath, setDataRootPath] = useState<string | null>(null);
  const [dataRootError, setDataRootError] = useState<string | null>(null);
  const [dataRootBusy, setDataRootBusy] = useState(false);
  const cacheApi = getAssetCacheBridge();
  const [cacheStats, setCacheStats] = useState<AssetCacheStats | null>(null);
  const [cacheBusy, setCacheBusy] = useState(false);
  const [cacheNote, setCacheNote] = useState<string | null>(null);
  const [cacheError, setCacheError] = useState<string | null>(null);

  useEffect(() => {
    if (!dataRootApi) return;
    let cancelled = false;
    dataRootApi.get().then((r) => {
      if (!cancelled) setDataRootPath(r.path);
    }).catch(() => {
      if (!cancelled) setDataRootError(t('settings.dataRoot.readFail'));
    });
    return () => { cancelled = true; };
  }, [dataRootApi]);

  useEffect(() => {
    if (!cacheApi) return;
    let cancelled = false;
    cacheApi.stats().then((r) => {
      if (!cancelled) setCacheStats(r);
    }).catch(() => {
      if (!cancelled) setCacheError(t('settings.cache.readFail'));
    });
    return () => { cancelled = true; };
  }, [cacheApi]);

  const handleClearCache = async () => {
    if (!cacheApi || cacheBusy) return;
    setCacheBusy(true);
    setCacheError(null);
    setCacheNote(null);
    try {
      const r = await cacheApi.clear();
      // 曲库索引的会话内缓存一并失效，否则「清了重拉」在同一会话里看不出效果（票 14）
      clearSongCatalogCache();
      setCacheStats({ totalBytes: 0, count: 0, byKind: {} });
      setCacheNote(t('settings.cache.cleared', { size: formatBytes(r.freedBytes) }));
    } catch {
      setCacheError(t('settings.cache.clearFail'));
    } finally {
      setCacheBusy(false);
    }
  };

  const applyDataRootResult = async (
    run: () => Promise<{ ok: boolean; cancelled?: boolean; path: string; message?: string }>,
    failMessage: string,
  ) => {
    if (!dataRootApi || dataRootBusy) return;
    setDataRootBusy(true);
    setDataRootError(null);
    try {
      const r = await run();
      if (r.cancelled) return;
      if (!r.ok) {
        setDataRootError(r.message || failMessage);
        return;
      }
      setDataRootPath(r.path);
    } catch {
      setDataRootError(failMessage);
    } finally {
      setDataRootBusy(false);
    }
  };

  const handleOpenDataRoot = () => void applyDataRootResult(() => dataRootApi!.open(), t('settings.dataRoot.openFail'));
  const handleChangeDataRoot = () => void applyDataRootResult(() => dataRootApi!.change(), t('settings.dataRoot.changeFail'));
  const handleClaimDataRoot = () => void applyDataRootResult(() => dataRootApi!.claim(), t('settings.dataRoot.claimFail'));

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'aao-settings.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = String(reader.result);
        // 经 loadSettings 校验+字段合并，避免非法 schema 破坏设置
        const merged = loadSettings({ getItem: () => raw });
        setAllSettings(merged);
        setImportError(null);
      } catch {
        setImportError(t('settings.importFail'));
      }
    };
    reader.readAsText(file);
  };

  return (
    <AppPageShell>
      <AppPageShell.Header
        eyebrow={t('settings.header.eyebrow')}
        title={t('settings.header.title')}
        description={t('settings.header.description')}
      />

      <AppPageShell.Sidebar ariaLabel={t('settings.sidebar.aria')}>
        <AppPageShell.SidebarItem
          icon={MonitorCog}
          label={t('settings.section.appearance')}
          active={section === 'appearance'}
          onClick={() => setSection('appearance')}
        />
        <AppPageShell.SidebarItem
          icon={Download}
          label={t('settings.section.data')}
          active={section === 'data'}
          onClick={() => setSection('data')}
        />
      </AppPageShell.Sidebar>

      <AppPageShell.Body mode="default">
        <section className="settings-detail surface-section app-stagger">
          {section === 'appearance' && (
            <>
              <div className="settings-heading">
                <h2>{t('settings.section.appearance')}</h2>
                <p>{t('settings.appearance.intro')}</p>
              </div>
              <div className="theme-options">
                {THEME_OPTIONS.map((opt) => {
                  const active = settings.theme === opt.value;
                  return (
                    <button
                      key={opt.value}
                      className={`theme-option${active ? ' is-active' : ''}`}
                      type="button"
                      onClick={() => setTheme(opt.value)}
                    >
                      <span className={`theme-preview ${opt.swatch}`}><i /><i /><i /></span>
                      <span>{t(opt.labelKey)}</span>
                      <span className="radio-mark">{active && <Check size={13} />}</span>
                    </button>
                  );
                })}
              </div>
              <div className="settings-row">
                <div className="settings-row__text">
                  <strong>{t('settings.uiLanguage')}</strong>
                  <span>{t('settings.uiLanguage.hint')}</span>
                </div>
                <select
                  className="select-control"
                  value={settings.uiLanguage}
                  onChange={(e) => setUiLanguage(e.target.value as AppSettings['uiLanguage'])}
                  aria-label={t('settings.uiLanguage')}
                >
                  <option value="zh-CN">{t('settings.uiLanguage.zh-CN')}</option>
                  <option value="en">{t('settings.uiLanguage.en')}</option>
                </select>
              </div>
              <PercentSliderRow
                label={t('settings.uiTypeScale')} hint={t('settings.uiTypeScale.hint')}
                value={settings.uiTypeScale} min={70} max={150} step={10}
                onChange={(v) => setUiTypeScale(v)}
              />
              <div className="settings-row">
                <div className="settings-row__text">
                  <strong>{t('settings.uiFont')}</strong>
                  <span>{t('settings.uiFont.hint')}</span>
                </div>
                <select
                  className="select-control"
                  value={settings.uiFontStack}
                  onChange={(e) => setUiFontStack(e.target.value as AppSettings['uiFontStack'])}
                  aria-label={t('settings.uiFont')}
                >
                  {UI_FONT_STACK_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {section === 'data' && (
            <>
              <div className="settings-heading">
                <h2>{t('settings.section.data')}</h2>
                <p>{t('settings.data.intro')}</p>
              </div>
              {dataRootApi && (
                <>
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <strong>{t('settings.dataRoot')}</strong>
                      <span>{dataRootPath ?? t('settings.dataRoot.reading')}</span>
                    </div>
                    <span className="inline-actions">
                      <button
                        className="button-secondary"
                        type="button"
                        disabled={dataRootBusy || !dataRootPath}
                        onClick={handleOpenDataRoot}
                      >
                        <FolderOpen size={15} />{t('settings.dataRoot.open')}
                      </button>
                      <button
                        className="button-secondary"
                        type="button"
                        disabled={dataRootBusy}
                        onClick={handleChangeDataRoot}
                      >
                        <FolderSync size={15} />{t('settings.dataRoot.change')}
                      </button>
                      <button
                        className="button-secondary"
                        type="button"
                        disabled={dataRootBusy}
                        onClick={handleClaimDataRoot}
                      >
                        <FolderSearch size={15} />{t('settings.dataRoot.claim')}
                      </button>
                    </span>
                  </div>
                  {dataRootError && <div className="shortcut-error">{dataRootError}</div>}
                </>
              )}
              {cacheApi && (
                <>
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <strong>{t('settings.cache')}</strong>
                      <span>
                        {cacheNote
                          ?? (cacheStats == null
                            ? t('settings.cache.reading')
                            : cacheStats.count === 0
                              ? t('settings.cache.empty')
                              : t('settings.cache.usage', { size: formatBytes(cacheStats.totalBytes) }))}
                      </span>
                    </div>
                    <button
                      className="button-secondary"
                      type="button"
                      disabled={cacheBusy || cacheStats == null}
                      onClick={() => void handleClearCache()}
                    >
                      <Trash2 size={15} />{t('settings.cache.clear')}
                    </button>
                  </div>
                  <NumberRow
                    label={t('settings.cache.idleDays')}
                    hint={t('settings.cache.idleDays.hint')}
                    value={settings.cachePolicy.maxIdleDays}
                    min={CACHE_POLICY_RANGE.idleDays.min}
                    max={CACHE_POLICY_RANGE.idleDays.max}
                    onChange={(v) => setCachePolicy({ maxIdleDays: v })}
                  />
                  <NumberRow
                    label={t('settings.cache.maxSize')}
                    hint={t('settings.cache.maxSize.hint')}
                    value={settings.cachePolicy.maxMegabytes}
                    min={CACHE_POLICY_RANGE.megabytes.min}
                    max={CACHE_POLICY_RANGE.megabytes.max}
                    onChange={(v) => setCachePolicy({ maxMegabytes: v })}
                  />
                  {cacheError && <div className="shortcut-error">{cacheError}</div>}
                </>
              )}
              <div className="settings-row">
                <div className="settings-row__text">
                  <strong>{t('settings.prefs')}</strong>
                  <span>{t('settings.prefs.hint')}</span>
                </div>
                <span className="inline-actions">
                  <button className="button-secondary" type="button" onClick={handleExport}>
                    <Download size={16} />{t('settings.export')}
                  </button>
                  <button className="button-secondary" type="button" onClick={() => fileRef.current?.click()}>
                    <Upload size={16} />{t('settings.import')}
                  </button>
                  <input
                    ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImport(f); e.target.value = ''; }}
                  />
                </span>
              </div>
              {importError && <div className="shortcut-error">{importError}</div>}
            </>
          )}
        </section>
      </AppPageShell.Body>
    </AppPageShell>
  );
}

