import { useEffect, useRef, useState } from 'react';
import { Check, Download, FolderOpen, FolderSearch, Info, MonitorCog, RotateCcw, SlidersHorizontal, Upload, Eye } from 'lucide-react';
import AppPageShell from '../../layouts/AppPageShell';
import EmptyState from '../../ui/EmptyState';
import { useConfig } from '../../app/ProviderTree';
import { defaultSettings, loadSettings } from '../../chart/config/AppSettings';
import type { AppSettings } from '../../chart/config/AppSettings';
import { t, type MessageKey } from '../../i18n';

// 设置页：接入 AppPageShell（Sidebar 分组导航 + Body 设置详情），修改立即生效并持久化。
type Section = 'appearance' | 'layout' | 'data' | 'canvas';

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

const QUALITY_OPTIONS: Array<{ value: AppSettings['display']['imageQuality']; labelKey: MessageKey }> = [
  { value: 'smooth', labelKey: 'settings.imageQuality.smooth' },
  { value: 'standard', labelKey: 'settings.imageQuality.standard' },
  { value: 'hd', labelKey: 'settings.imageQuality.hd' },
];

interface DataRootBridge {
  get(): Promise<{ path: string }>;
  change(): Promise<{ ok: boolean; cancelled?: boolean; path: string; message?: string }>;
  claim(): Promise<{ ok: boolean; cancelled?: boolean; path: string; message?: string }>;
}

function getDataRootBridge(): DataRootBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { electronAPI?: { dataRoot?: DataRootBridge } }).electronAPI?.dataRoot;
}

const GRID_STYLE_OPTIONS: Array<{ value: AppSettings['display']['gridStyle']; labelKey: MessageKey }> = [
  { value: 'mono', labelKey: 'settings.gridStyle.mono' },
  { value: 'amber', labelKey: 'settings.gridStyle.amber' },
  { value: 'cyan', labelKey: 'settings.gridStyle.cyan' },
  { value: 'vivid', labelKey: 'settings.gridStyle.vivid' },
];

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

/** 分组"恢复默认"行：本组参数恢复出厂默认，需二次确认 */
function ResetRow({ label, hint, confirming, onConfirm, onToggle }: {
  label: string; hint: string; confirming: boolean; onToggle: () => void; onConfirm: () => void;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row__text">
        <strong>{label}</strong>
        <span>{confirming ? t('settings.reset.confirm', { hint }) : hint}</span>
      </div>
      {confirming ? (
        <span className="inline-actions">
          <button className="button-secondary" type="button" onClick={onConfirm}>{t('settings.reset.confirmBtn')}</button>
          <button className="button-secondary" type="button" onClick={onToggle}>{t('settings.reset.cancel')}</button>
        </span>
      ) : (
        <button className="button-secondary" type="button" onClick={onToggle}>
          <RotateCcw size={15} />{t('settings.reset')}
        </button>
      )}
    </div>
  );
}

/** 行内开关行：布尔参数 */
function ToggleRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="settings-row">
      <div className="settings-row__text">
        <strong>{label}</strong>
        <span>{hint}</span>
      </div>
      <button
        className={`switch${checked ? ' is-on' : ''}`} type="button" role="switch" aria-checked={checked}
        aria-label={label} onClick={() => onChange(!checked)}
      ><span /></button>
    </div>
  );
}

export default function SettingsPage() {
  const { settings, setTheme, setUiLanguage, setUiTypeScale, setUiFontStack, setDisplay, setAllSettings } = useConfig();
  const [section, setSection] = useState<Section>('appearance');
  const [importError, setImportError] = useState<string | null>(null);
  const [resetConfirm, setResetConfirm] = useState<'canvas' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dataRootApi = getDataRootBridge();
  const [dataRootPath, setDataRootPath] = useState<string | null>(null);
  const [dataRootError, setDataRootError] = useState<string | null>(null);
  const [dataRootBusy, setDataRootBusy] = useState(false);

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

  const handleChangeDataRoot = () => void applyDataRootResult(() => dataRootApi!.change(), t('settings.dataRoot.changeFail'));
  const handleClaimDataRoot = () => void applyDataRootResult(() => dataRootApi!.claim(), t('settings.dataRoot.claimFail'));

  const resetCanvasDefaults = () => setDisplay(defaultSettings().display);

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bangdream-settings.json';
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
        <AppPageShell.SidebarGroup title={t('settings.group.app')}>
          <AppPageShell.SidebarItem icon={MonitorCog} label={t('settings.section.appearance')} active={section === 'appearance'} onClick={() => setSection('appearance')} />
          <AppPageShell.SidebarItem icon={SlidersHorizontal} label={t('settings.section.layout')} active={section === 'layout'} onClick={() => setSection('layout')} />
          <AppPageShell.SidebarItem icon={Download} label={t('settings.section.data')} active={section === 'data'} onClick={() => setSection('data')} />
        </AppPageShell.SidebarGroup>
        <AppPageShell.SidebarGroup title={t('settings.group.feature')}>
          <AppPageShell.SidebarItem icon={Eye} label={t('settings.section.canvas')} active={section === 'canvas'} onClick={() => setSection('canvas')} />
        </AppPageShell.SidebarGroup>
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

          {section === 'layout' && (
            <>
              <div className="settings-heading">
                <h2>{t('settings.section.layout')}</h2>
                <p>{t('settings.layout.intro')}</p>
              </div>
              <EmptyState
                icon={Info}
                title={t('settings.layout.emptyTitle')}
                description={t('settings.layout.emptyDescription')}
              />
            </>
          )}

          {section === 'canvas' && (
            <>
              <div className="settings-heading">
                <h2>{t('settings.section.canvas')}</h2>
                <p>{t('settings.canvas.intro')}</p>
              </div>
              <PercentSliderRow
                label={t('settings.noteSize')} hint={t('settings.noteSize.hint')}
                value={settings.display.noteSize} min={10} max={200} step={10}
                onChange={(v) => setDisplay({ noteSize: v })}
              />
              <PercentSliderRow
                label={t('settings.slideOpacity')} hint={t('settings.slideOpacity.hint')}
                value={settings.display.slideOpacity} min={10} max={100} step={10}
                onChange={(v) => setDisplay({ slideOpacity: v })}
              />
              <ToggleRow
                label={t('settings.simultaneousClickLines')} hint={t('settings.simultaneousClickLines.hint')}
                checked={settings.display.simultaneousClickLines}
                onChange={(v) => setDisplay({ simultaneousClickLines: v })}
              />
              <ToggleRow
                label={t('settings.colorAssist')} hint={t('settings.colorAssist.hint')}
                checked={settings.display.colorAssist}
                onChange={(v) => setDisplay({ colorAssist: v })}
              />
              <PercentSliderRow
                label={t('settings.verticalRatio')} hint={t('settings.verticalRatio.hint')}
                value={settings.display.verticalRatio} min={50} max={200} step={10}
                onChange={(v) => setDisplay({ verticalRatio: v })}
              />
              <div className="settings-row">
                <div className="settings-row__text">
                  <strong>{t('settings.imageQuality')}</strong>
                  <span>{t('settings.imageQuality.hint')}</span>
                </div>
                <select
                  className="select-control"
                  value={settings.display.imageQuality}
                  onChange={(e) => setDisplay({ imageQuality: e.target.value as AppSettings['display']['imageQuality'] })}
                  aria-label={t('settings.imageQuality')}
                >
                  {QUALITY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
                  ))}
                </select>
              </div>
              <div className="settings-row">
                <div className="settings-row__text">
                  <strong>{t('settings.gridStyle')}</strong>
                  <span>{t('settings.gridStyle.hint')}</span>
                </div>
                <select
                  className="select-control"
                  value={settings.display.gridStyle}
                  onChange={(e) => setDisplay({ gridStyle: e.target.value as AppSettings['display']['gridStyle'] })}
                  aria-label={t('settings.gridStyle')}
                >
                  {GRID_STYLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
                  ))}
                </select>
              </div>
              <ToggleRow
                label={t('settings.lineShapeTiers')} hint={t('settings.lineShapeTiers.hint')}
                checked={settings.display.lineShapeTiers}
                onChange={(v) => setDisplay({ lineShapeTiers: v })}
              />
              <PercentSliderRow
                label={t('settings.gridOpacity')} hint={t('settings.gridOpacity.hint')}
                value={settings.display.gridOpacity} min={10} max={100} step={10}
                onChange={(v) => setDisplay({ gridOpacity: v })}
              />
              <PercentSliderRow
                label={t('settings.labelScale')} hint={t('settings.labelScale.hint')}
                value={settings.display.labelScale} min={50} max={300} step={10}
                onChange={(v) => setDisplay({ labelScale: v })}
              />
              <ResetRow
                label={t('settings.reset')} hint={t('settings.reset.hint')}
                confirming={resetConfirm === 'canvas'}
                onToggle={() => setResetConfirm(resetConfirm === 'canvas' ? null : 'canvas')}
                onConfirm={() => { resetCanvasDefaults(); setResetConfirm(null); }}
              />
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
                        disabled={dataRootBusy}
                        onClick={handleChangeDataRoot}
                      >
                        <FolderOpen size={15} />{t('settings.dataRoot.change')}
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

