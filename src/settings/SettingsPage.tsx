import { useEffect, useRef, useState } from 'react';
import { Check, Download, FolderOpen, FolderSearch, Info, MonitorCog, RotateCcw, SlidersHorizontal, Upload, Eye } from 'lucide-react';
import AppPageShell from '../layouts/AppPageShell';
import EmptyState from '../ui/EmptyState';
import { useConfig } from '../app/ProviderTree';
import { defaultSettings, loadSettings } from '../chart/config/AppSettings';
import type { AppSettings } from '../chart/config/AppSettings';

// 设置页：接入 AppPageShell（Sidebar 分组导航 + Body 设置详情），修改立即生效并持久化。
type Section = 'appearance' | 'layout' | 'data' | 'canvas';

const THEME_OPTIONS: Array<{ value: AppSettings['theme']; label: string; swatch: string }> = [
  { value: 'light', label: '亮色', swatch: 'light' },
  { value: 'dark', label: '暗色', swatch: 'dark' },
  { value: 'system', label: '跟随系统', swatch: 'system' },
];

const UI_FONT_STACK_OPTIONS: Array<{ value: AppSettings['uiFontStack']; label: string }> = [
  { value: 'geist', label: 'Geist' },
  { value: 'yahei', label: '微软雅黑' },
  { value: 'noto', label: 'Noto / 思源黑体' },
];

const QUALITY_OPTIONS: Array<{ value: AppSettings['display']['imageQuality']; label: string }> = [
  { value: 'smooth', label: '流畅' },
  { value: 'standard', label: '标准' },
  { value: 'hd', label: '高清' },
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

const GRID_STYLE_OPTIONS: Array<{ value: AppSettings['display']['gridStyle']; label: string }> = [
  { value: 'mono', label: '灰阶' },
  { value: 'amber', label: '琥珀' },
  { value: 'cyan', label: '青蓝' },
  { value: 'vivid', label: '多彩' },
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
        <span>{confirming ? `确定恢复？${hint}` : hint}</span>
      </div>
      {confirming ? (
        <span className="inline-actions">
          <button className="button-secondary" type="button" onClick={onConfirm}>确认恢复</button>
          <button className="button-secondary" type="button" onClick={onToggle}>取消</button>
        </span>
      ) : (
        <button className="button-secondary" type="button" onClick={onToggle}>
          <RotateCcw size={15} />恢复默认
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
  const { settings, setTheme, setUiTypeScale, setUiFontStack, setDisplay, setAllSettings } = useConfig();
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
      if (!cancelled) setDataRootError('无法读取当前保存位置');
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

  const handleChangeDataRoot = () => void applyDataRootResult(() => dataRootApi!.change(), '更改保存位置失败');
  const handleClaimDataRoot = () => void applyDataRootResult(() => dataRootApi!.claim(), '无法使用该文件夹');

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
        setImportError('导入失败：配置文件格式不正确。');
      }
    };
    reader.readAsText(file);
  };

  return (
    <AppPageShell>
      <AppPageShell.Header
        eyebrow="应用设置"
        title="设置"
        description="修改立即生效并自动保存。导入与恢复默认属于高风险操作，会在执行前单独确认。"
      />

      <AppPageShell.Sidebar ariaLabel="设置分类">
        <AppPageShell.SidebarGroup title="应用设置">
          <AppPageShell.SidebarItem icon={MonitorCog} label="外观" active={section === 'appearance'} onClick={() => setSection('appearance')} />
          <AppPageShell.SidebarItem icon={SlidersHorizontal} label="布局" active={section === 'layout'} onClick={() => setSection('layout')} />
          <AppPageShell.SidebarItem icon={Download} label="配置数据" active={section === 'data'} onClick={() => setSection('data')} />
        </AppPageShell.SidebarGroup>
        <AppPageShell.SidebarGroup title="功能设置">
          <AppPageShell.SidebarItem icon={Eye} label="画布显示" active={section === 'canvas'} onClick={() => setSection('canvas')} />
        </AppPageShell.SidebarGroup>
      </AppPageShell.Sidebar>

      <AppPageShell.Body mode="default">
        <section className="settings-detail surface-section app-stagger">
          {section === 'appearance' && (
            <>
              <div className="settings-heading">
                <h2>外观</h2>
                <p>主题、界面字体与字号只作用于应用 chrome；谱面画布始终深色，标线文字大小在「画布显示」里单独调。</p>
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
                      <span>{opt.label}</span>
                      <span className="radio-mark">{active && <Check size={13} />}</span>
                    </button>
                  );
                })}
              </div>
              <PercentSliderRow
                label="界面字号" hint="导航、设置、弹窗等 chrome 文字相对出厂的比例（70%–150%）"
                value={settings.uiTypeScale} min={70} max={150} step={10}
                onChange={(v) => setUiTypeScale(v)}
              />
              <div className="settings-row">
                <div className="settings-row__text">
                  <strong>界面字体</strong>
                  <span>无衬线回退链；不随界面语言自动切换。等宽字体不换族。</span>
                </div>
                <select
                  className="select-control"
                  value={settings.uiFontStack}
                  onChange={(e) => setUiFontStack(e.target.value as AppSettings['uiFontStack'])}
                  aria-label="界面字体"
                >
                  {UI_FONT_STACK_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {section === 'layout' && (
            <>
              <div className="settings-heading">
                <h2>布局</h2>
                <p>面板开合、宽度与画布缩放的说明。</p>
              </div>
              {/* layout 段无可配置控件，用 EmptyState 作说明区 */}
              <EmptyState
                icon={Info}
                title="布局在工作台内调整"
                description="工具 / 属性面板可拖拽或点击标题旁的收起按钮；应用导航可在左侧折叠为图标栏；画布缩放按住 Ctrl 滚动鼠标滚轮。"
              />
            </>
          )}

          {section === 'canvas' && (
            <>
              <div className="settings-heading">
                <h2>画布显示</h2>
                <p>谱面画布上音符与判定线的呈现参数，修改即对画布生效。</p>
              </div>
              <PercentSliderRow
                label="节奏图示大小" hint="音符占轨道的大小（相对所在轨道宽度）"
                value={settings.display.noteSize} min={10} max={200} step={10}
                onChange={(v) => setDisplay({ noteSize: v })}
              />
              <PercentSliderRow
                label="长压线不透明度" hint="滑条（Slide）线条的不透明度，调低则变淡"
                value={settings.display.slideOpacity} min={10} max={100} step={10}
                onChange={(v) => setDisplay({ slideOpacity: v })}
              />
              <ToggleRow
                label="同时点击线" hint="同节拍的同水平线音符之间显示连接线"
                checked={settings.display.simultaneousClickLines}
                onChange={(v) => setDisplay({ simultaneousClickLines: v })}
              />
              <ToggleRow
                label="色觉辅助" hint="非半拍整数倍位置的单键显示为虚拍款式，用形态区分细分节奏（实/虚拍）"
                checked={settings.display.colorAssist}
                onChange={(v) => setDisplay({ colorAssist: v })}
              />
              <PercentSliderRow
                label="纵向比例" hint="每小节的纵向高度（与整体缩放正交并存）"
                value={settings.display.verticalRatio} min={50} max={200} step={10}
                onChange={(v) => setDisplay({ verticalRatio: v })}
              />
              <div className="settings-row">
                <div className="settings-row__text">
                  <strong>图像品质</strong>
                  <span>画布渲染精度档位；标准为默认行为</span>
                </div>
                <select
                  className="select-control"
                  value={settings.display.imageQuality}
                  onChange={(e) => setDisplay({ imageQuality: e.target.value as AppSettings['display']['imageQuality'] })}
                  aria-label="图像品质"
                >
                  {QUALITY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div className="settings-row">
                <div className="settings-row__text">
                  <strong>轨道颜色</strong>
                  <span>网格线层级配色：整拍最亮眼，逐级变暗（黑底上保持可辨）</span>
                </div>
                <select
                  className="select-control"
                  value={settings.display.gridStyle}
                  onChange={(e) => setDisplay({ gridStyle: e.target.value as AppSettings['display']['gridStyle'] })}
                  aria-label="轨道颜色"
                >
                  {GRID_STYLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <ToggleRow
                label="线形分层" hint="开启后按层级叠加线形（整拍实线、1/2 长虚线、1/4 短虚线、更细为点线）；关闭时整拍实线、非整拍短虚线"
                checked={settings.display.lineShapeTiers}
                onChange={(v) => setDisplay({ lineShapeTiers: v })}
              />
              <PercentSliderRow
                label="轨道线透明度" hint="网格线（节拍线/子节拍线）的整体不透明度"
                value={settings.display.gridOpacity} min={10} max={100} step={10}
                onChange={(v) => setDisplay({ gridOpacity: v })}
              />
              <PercentSliderRow
                label="文字大小" hint="谱面标线文字（BPM 数值 / START / END）与实时读数的缩放"
                value={settings.display.labelScale} min={50} max={300} step={10}
                onChange={(v) => setDisplay({ labelScale: v })}
              />
              <ResetRow
                label="恢复默认" hint="将本组（画布显示）全部参数恢复为出厂默认，不影响其它设置"
                confirming={resetConfirm === 'canvas'}
                onToggle={() => setResetConfirm(resetConfirm === 'canvas' ? null : 'canvas')}
                onConfirm={() => { resetCanvasDefaults(); setResetConfirm(null); }}
              />
            </>
          )}

          {section === 'data' && (
            <>
              <div className="settings-heading">
                <h2>配置数据</h2>
                <p>谱面保存位置，以及主题与快捷键的导入导出。</p>
              </div>
              {dataRootApi && (
                <>
                  <div className="settings-row">
                    <div className="settings-row__text">
                      <strong>谱面与资源</strong>
                      <span>{dataRootPath ?? '读取中…'}</span>
                    </div>
                    <span className="inline-actions">
                      <button
                        className="button-secondary"
                        type="button"
                        disabled={dataRootBusy}
                        onClick={handleChangeDataRoot}
                      >
                        <FolderOpen size={15} />更改保存位置
                      </button>
                      <button
                        className="button-secondary"
                        type="button"
                        disabled={dataRootBusy}
                        onClick={handleClaimDataRoot}
                      >
                        <FolderSearch size={15} />使用已有数据文件夹
                      </button>
                    </span>
                  </div>
                  {dataRootError && <div className="shortcut-error">{dataRootError}</div>}
                </>
              )}
              <div className="settings-row">
                <div className="settings-row__text">
                  <strong>偏好设置</strong>
                  <span>主题、界面字体与字号、布局、快捷键与画布显示。</span>
                </div>
                <span className="inline-actions">
                  <button className="button-secondary" type="button" onClick={handleExport}>
                    <Download size={16} />导出设置
                  </button>
                  <button className="button-secondary" type="button" onClick={() => fileRef.current?.click()}>
                    <Upload size={16} />导入设置
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
