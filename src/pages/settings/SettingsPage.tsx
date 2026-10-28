import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Check, Download, ExternalLink, FolderOpen, FolderSearch, FolderSync, Github, House, Info, MessageCircleQuestion, MonitorCog, RefreshCw, RotateCw, Trash2, Upload } from 'lucide-react';
import appLogo from '../../assets/brand/app-logo.png';
import AppPageShell from '../../layouts/AppPageShell';
import { useConfig } from '../../app/ProviderTree';
import { useCurrentProject } from '../../app/providers/CurrentProjectProvider';
import { CACHE_POLICY_RANGE, loadSettings } from '../../chart/config/AppSettings';
import type { AppSettings } from '../../chart/config/AppSettings';
import { t, type MessageKey } from '../../i18n';
import { clearSongCatalogCache } from '../../community/bestdori/songs';
import { shouldResetSessionAfterDataRootSwitch } from '../../project/CurrentProjectSession';
import { backgroundSkinStore } from '../../rendering/skin/backgroundSkin';
import { showToast } from '../../ui/Toast';
import { APP_VERSION } from '../../app/appVersion';
import WebVersionNote from '../../app/WebVersionNote';
import { hasDesktopRuntime } from '../../app/webNotice';
import {
  checkAppUpdate,
  getAppUpdateState,
  installAppUpdate,
  setAppUpdateSource,
  subscribeAppUpdate,
  type AppUpdateState,
  type UpdateSource,
} from '../../app/appUpdate';
import { toastAppUpdateResult } from '../../app/appUpdateFeedback';
import CnbMark from '../../ui/CnbMark';
import { exportDiagnostics, getDiagnosticsExportBridge } from '../../diagnostics/exportDiagnostics';
import { PRODUCT_LINKS, shortUrl } from '../../app/productLinks';
import ExternalLinkAnchor from '../../ui/ExternalLinkAnchor';

// 设置页：接入 AppPageShell（Sidebar 扁平导航 + Body 设置详情），修改立即生效并持久化。
type Section = 'appearance' | 'data' | 'about';

/**
 * 关于页的四条产品入口（票 18）。顺序即叙事：先「去哪看产品」，再「去哪看代码」。
 * 地址只从 `productLinks.ts` 取 —— 这一页不出现任何裸 URL（锁测会拦）。
 */
const ABOUT_LINKS: Array<{ url: string; icon: typeof House; labelKey: MessageKey }> = [
  { url: PRODUCT_LINKS.home, icon: House, labelKey: 'settings.about.links.home' },
  { url: PRODUCT_LINKS.guide, icon: BookOpen, labelKey: 'settings.about.links.guide' },
  { url: PRODUCT_LINKS.repository, icon: Github, labelKey: 'settings.about.links.repository' },
  { url: PRODUCT_LINKS.issues, icon: MessageCircleQuestion, labelKey: 'settings.about.links.issues' },
];

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

function updateStatusText(state: AppUpdateState): string | null {
  if (state.local === 'downloading' || state.status === 'downloading') {
    return t('update.status.downloading', { percent: Math.round(state.percent ?? 0) });
  }
  if (state.remote === 'checking' || state.status === 'checking') {
    return t('update.status.checking');
  }
  if (state.local === 'ready' || state.status === 'ready') {
    return t('update.status.ready');
  }
  if (state.remote === 'available' || state.status === 'available') {
    return t('update.status.available');
  }
  return null;
}

function AboutSection({
  version, packaged, updateState, autoCheck, onAutoCheck, onCheck, onInstall, onUpdateSource,
  diagnosticsAvailable, includeChart, exportBusy, onIncludeChart, onExportDiagnostics,
}: {
  version: string;
  packaged: boolean;
  updateState: AppUpdateState;
  autoCheck: boolean;
  onAutoCheck: (v: boolean) => void;
  onCheck: () => void;
  onInstall: () => void;
  onUpdateSource: (source: UpdateSource) => void;
  diagnosticsAvailable: boolean;
  includeChart: boolean;
  exportBusy: boolean;
  onIncludeChart: (v: boolean) => void;
  onExportDiagnostics: () => void;
}) {
  const busy = updateState.remote === 'checking' || updateState.local === 'downloading' || updateState.status === 'checking' || updateState.status === 'downloading';
  const sourceLocked = updateState.local === 'downloading' || updateState.status === 'downloading';
  const ready = updateState.local === 'ready' || updateState.status === 'ready';
  const status = packaged ? updateStatusText(updateState) : null;
  const source = updateState.updateSource === 'cnb' ? 'cnb' : 'github';
  return (
    <>
      <div className="settings-heading">
        <h2>{t('settings.section.about')}</h2>
        <p>{t('settings.about.intro')}</p>
      </div>
      <div className="about-identity">
        <div className="about-identity__row">
          <img className="about-identity__mark" src={appLogo} alt="" width={48} height={48} />
          <div className="about-identity__text">
            <strong className="about-identity__name">{t('app.name')}</strong>
            <span className="about-identity__ver">{t('settings.appVersion')} {version}</span>
          </div>
        </div>
        {/* 在线版身份说明（票 04）：与首访弹窗同一份内容。并入身份卡、用一道细线隔开——
            另起一张卡或让一段字悬在卡片下方都不成体统（2026-10-25 用户验收）。 */}
        {!hasDesktopRuntime() && (
          <div className="about-note">
            <p className="about-note__title">{t('web.notice.title')}</p>
            <WebVersionNote compact />
          </div>
        )}
        {/* 产品入口（票 18，2026-10-28 验收改版）：四行改成**身份卡内的一行紧凑入口**。
            为什么不再各占一行：四行 46px 的行体（连同分隔线近 190px）把关于页撑得要滚，
            而它们只是四个地址 —— 信息密度决定了一行 chip 就够，且与身份卡合成"产品信息"
            这一块，不再和下面的设置行抢层级。地址只进 tooltip（去掉协议），
            点击拦默认行为走统一出口（见 ui/ExternalLinkAnchor）。 */}
        <div className="about-links">
          {ABOUT_LINKS.map(({ url, icon: Icon, labelKey }) => (
            <ExternalLinkAnchor key={labelKey} className="about-link" href={url} title={shortUrl(url)}>
              <Icon size={14} strokeWidth={1.7} aria-hidden />
              <span className="about-link__label">{t(labelKey)}</span>
              <ExternalLink className="about-link__arrow" size={11} strokeWidth={1.8} aria-hidden />
            </ExternalLinkAnchor>
          ))}
        </div>
      </div>
      {packaged && (
        <>
          <div className="settings-row">
            <div className="settings-row__text">
              <strong>{t('settings.autoCheck')}</strong>
              <span>{t('settings.autoCheck.hint')}</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoCheck}
              aria-label={t('settings.autoCheck')}
              className={`switch${autoCheck ? ' is-on' : ''}`}
              onClick={() => onAutoCheck(!autoCheck)}
            >
              <span />
            </button>
          </div>
          <div className="settings-row">
            <div className="settings-row__text">
              <strong>{t('settings.checkUpdate')}</strong>
              <span>{status ?? t('settings.checkUpdate.hint')}</span>
            </div>
            <span className="inline-actions">
              {ready ? (
                <button className="button-primary" type="button" onClick={onInstall}>
                  <RotateCw size={15} />{t('update.restart')}
                </button>
              ) : null}
              <button
                className="button-secondary"
                type="button"
                disabled={busy}
                onClick={onCheck}
              >
                <RefreshCw size={15} />{t('settings.checkUpdate')}
              </button>
            </span>
          </div>
          <div className="settings-row">
            <div className="settings-row__text">
              <strong>{t('settings.updateSource')}</strong>
              <span>{t('settings.updateSource.hint')}</span>
            </div>
            <div className="update-source-options" role="radiogroup" aria-label={t('settings.updateSource')}>
              <button
                type="button"
                role="radio"
                className={`update-source-option${source === 'github' ? ' is-active' : ''}`}
                aria-checked={source === 'github'}
                aria-label={t('update.source.github')}
                disabled={sourceLocked}
                onClick={() => onUpdateSource('github')}
              >
                <Github size={15} aria-hidden />
                <span>{t('update.source.github')}</span>
              </button>
              <button
                type="button"
                role="radio"
                className={`update-source-option${source === 'cnb' ? ' is-active' : ''}`}
                aria-checked={source === 'cnb'}
                aria-label={t('update.source.cnb')}
                disabled={sourceLocked}
                onClick={() => onUpdateSource('cnb')}
              >
                <CnbMark size={15} />
                <span>{t('update.source.cnb')}</span>
              </button>
            </div>
          </div>
        </>
      )}
      {diagnosticsAvailable && (
        <div className="settings-row settings-row--diagnostics">
          <div className="settings-row__text">
            <strong>{t('settings.diagnostics')}</strong>
            <span>{t('settings.diagnostics.hint')}</span>
            <button
              type="button"
              className="settings-export-opt"
              role="checkbox"
              aria-checked={includeChart}
              onClick={() => onIncludeChart(!includeChart)}
            >
              <span className={`settings-check${includeChart ? ' is-on' : ''}`} aria-hidden>
                {includeChart ? <Check size={11} strokeWidth={3} /> : null}
              </span>
              <span>{t('settings.diagnostics.includeChart')}</span>
            </button>
          </div>
          <button
            className="button-secondary"
            type="button"
            disabled={exportBusy}
            onClick={onExportDiagnostics}
          >
            <Download size={15} />{t('settings.diagnostics.export')}
          </button>
        </div>
      )}
    </>
  );
}

export default function SettingsPage({ active = true }: { active?: boolean }) {
  const { settings, setTheme, setUiLanguage, setUiTypeScale, setUiFontStack, setAutoCheck, setCachePolicy, setAllSettings } = useConfig();
  // 切数据根的联动对象（chart-projects 39）：目录消费者通知 + 当前工程会话 + 存储门面
  const { projectId, store, reset, notifyCatalogChanged } = useCurrentProject();
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
  const [cacheError, setCacheError] = useState<string | null>(null);
  const [updateState, setUpdateState] = useState<AppUpdateState>(getAppUpdateState);
  const diagnosticsAvailable = Boolean(getDiagnosticsExportBridge());
  const [includeChart, setIncludeChart] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  useEffect(() => subscribeAppUpdate(setUpdateState), []);

  const handleCheckUpdate = async () => {
    const next = await checkAppUpdate();
    if (next.remote === 'current' || next.status === 'current') toastAppUpdateResult(next);
  };

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

  /** 拉一次缓存占用。`isCancelled` 供挂载 effect 防卸载后 setState；切根重拉走缺省（不取消）。
   *  回 promise 供「等真实占用落地再放开按钮」的调用方 await（票 48 Q3）。 */
  const loadCacheStats = useCallback((isCancelled: () => boolean = () => false): Promise<void> => {
    if (!cacheApi) return Promise.resolve();
    return cacheApi.stats()
      .then((r) => { if (!isCancelled()) setCacheStats(r); })
      .catch(() => { if (!isCancelled()) setCacheError(t('settings.cache.readFail')); });
  }, [cacheApi]);

  useEffect(() => {
    if (!cacheApi) return;
    let cancelled = false;
    loadCacheStats(() => cancelled);
    return () => { cancelled = true; };
  }, [cacheApi, loadCacheStats]);

  // 切回设置页时重拉占用（票 48 Q2）：保活页不重挂载，stats 停在挂载时那一帧；
  // 照票 38 的边沿模式（先例 ProjectsPage）—— 只有 active false→true 才拉，停留期间不重复。
  const wasActiveRef = useRef(active);
  useEffect(() => {
    if (!(active && !wasActiveRef.current)) {
      wasActiveRef.current = active;
      return;
    }
    wasActiveRef.current = true;
    loadCacheStats();
  }, [active, loadCacheStats]);

  const handleClearCache = async () => {
    if (!cacheApi || cacheBusy) return;
    setCacheBusy(true);
    setCacheError(null);
    try {
      const r = await cacheApi.clear();
      // 曲库索引的会话内缓存一并失效，否则「清了重拉」在同一会话里看不出效果（票 14）
      clearSongCatalogCache();
      // 票 48 Q3：以主进程结算为准 —— clear() 返回时内存索引已重置，同 tick 重拉即真实占用。
      // 先置瞬时 reading（不拿旧占用糊脸、顺带禁掉按钮），等 stats 落地再放开（票 48 评审回修）。
      setCacheStats(null);
      await loadCacheStats();
      // 票 48 Q1：「已清除」是一次性反馈（toast 2.6s 自动消失），不常驻状态行
      showToast(t('settings.cache.cleared', { size: formatBytes(r.freedBytes) }), 'success');
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
      // 换根才联动（chart-projects 39）：「打开数据目录」只是开文件管理器，根没变，
      // 不必惊动各消费者；同目录重新认领 likewise。
      if (r.path !== dataRootPath) {
        // 主进程各 IPC（project:list / backgroundSkin / assetCache）都按**当前根**出数，
        // 但渲染侧的单例与会话还停在旧根。38 的激活 reload 只盖住「切回工程页时列表重读」
        // 这一条导航时序；这里补换根本身——递增 catalogEpoch，所有目录消费者即时刷新，
        // 不依赖用户接下来点到哪一页。
        //
        // 次序：先作废按 id 的会话派生值（封面 Blob 稳定器 / lastOpened 下限）——新旧目录
        // 可能出现同 id 工程，不丢就把旧根的 Blob 身份与时间戳漏给新盘；再校验会话；
        // 最后统一通知（reset 与 notify 落同一次批处理，消费者看到的是结算后的状态）。
        store.resetCatalogCaches();
        const listed = await store.list().catch((err: unknown) => {
          // 读新目录失败：不当作"旧工程消失了"（一次读错不该静默重置会话），跳过校验但仍通知
          console.warn('[chart-project] 切根后读取新目录失败，跳过会话校验:', err);
          return null;
        });
        if (listed && shouldResetSessionAfterDataRootSwitch(projectId, listed)) reset();
        notifyCatalogChanged();
        // 单例失效：背景皮肤重新装载（Electron 下图真身在 <数据根>/assets/background-skin.bin，
        // 主进程按当前根出字节，渲染侧不重读就还画着旧根的图）；缓存占用按新根的 cacheDir 重拉。
        void backgroundSkinStore.reload();
        loadCacheStats();
      }
    } catch {
      setDataRootError(failMessage);
    } finally {
      setDataRootBusy(false);
    }
  };

  const handleOpenDataRoot = () => void applyDataRootResult(() => dataRootApi!.open(), t('settings.dataRoot.openFail'));
  const handleChangeDataRoot = () => void applyDataRootResult(() => dataRootApi!.change(), t('settings.dataRoot.changeFail'));
  const handleClaimDataRoot = () => void applyDataRootResult(() => dataRootApi!.claim(), t('settings.dataRoot.claimFail'));

  const handleExportDiagnostics = async () => {
    if (!diagnosticsAvailable || exportBusy) return;
    setExportBusy(true);
    try {
      const result = await exportDiagnostics({
        pageId: 'settings',
        projectId,
        settings,
        includeChart,
        getProject: (id) => store.get(id),
      });
      if ('unavailable' in result) return;
      if (!result.cancelled) showToast(t('settings.diagnostics.exported'), 'success');
    } catch {
      showToast(t('settings.diagnostics.failed'), 'danger');
    } finally {
      setExportBusy(false);
    }
  };

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
        <AppPageShell.SidebarItem
          icon={Info}
          label={t('settings.section.about')}
          active={section === 'about'}
          onClick={() => setSection('about')}
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
                        {cacheStats == null
                          ? t('settings.cache.reading')
                          : cacheStats.count === 0
                            ? t('settings.cache.empty')
                            : t('settings.cache.usage', { size: formatBytes(cacheStats.totalBytes) })}
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

          {section === 'about' && (
            <AboutSection
              version={updateState.currentVersion || APP_VERSION}
              packaged={updateState.packaged}
              updateState={updateState}
              autoCheck={settings.autoCheck}
              onAutoCheck={setAutoCheck}
              onCheck={() => void handleCheckUpdate()}
              onInstall={() => void installAppUpdate()}
              onUpdateSource={(source) => void setAppUpdateSource(source)}
              diagnosticsAvailable={diagnosticsAvailable}
              includeChart={includeChart}
              exportBusy={exportBusy}
              onIncludeChart={setIncludeChart}
              onExportDiagnostics={() => void handleExportDiagnostics()}
            />
          )}
        </section>
      </AppPageShell.Body>
    </AppPageShell>
  );
}

