import { useRef, useState } from 'react';
import { Check, Download, MonitorCog, RotateCcw, SlidersHorizontal, Upload, Eye } from 'lucide-react';
import AppPageShell from '../layouts/AppPageShell';
import { useConfig } from '../app/ProviderTree';
import { defaultSettings, loadSettings } from '../chart/config/AppSettings';
import type { AppSettings } from '../chart/config/AppSettings';

// 设置页（issue 28 Q13 + issue 39 + issue 44 内容壳迁移）：
//   - 接入 <AppPageShell>：左侧次级索引走 <AppPageShell.Sidebar>（按组分组"应用设置 / 功能设置"），Body 走 mode="default" width="default"；
//   - 侧边索引从"正文内 168px"搬到"正文外 200px"（Q3.2 / §1 统一化产物，detail 区从 752px 涨到 920px）；
//   - 节奏图示 SE 音量（issue 39 #7）已迁音频页（issue 29 切片 4 闭环：键音 + SE 音量与音源同域），
//     此处不再保留「播放」section。
// - 修改立即生效并持久化（versioned settings，ADR-0003 §6）。
type Section = 'appearance' | 'layout' | 'data' | 'canvas';

const THEME_OPTIONS: Array<{ value: AppSettings['theme']; label: string; swatch: string }> = [
  { value: 'light', label: '亮色', swatch: 'light' },
  { value: 'dark', label: '暗色', swatch: 'dark' },
  { value: 'system', label: '跟随系统', swatch: 'system' },
];

const QUALITY_OPTIONS: Array<{ value: AppSettings['display']['imageQuality']; label: string }> = [
  { value: 'smooth', label: '流畅' },
  { value: 'standard', label: '标准' },
  { value: 'hd', label: '高清' },
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

/** 分组"恢复默认"行：本组参数恢复出厂默认，需二次确认（用户反馈：整体重置放配置数据语义不符） */
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
  const { settings, setTheme, setDisplay, setAllSettings } = useConfig();
  const [section, setSection] = useState<Section>('appearance');
  const [importError, setImportError] = useState<string | null>(null);
  // 分组恢复默认：画布显示只重置本组参数（用户反馈：整体重置放在配置数据语义不符）
  const [resetConfirm, setResetConfirm] = useState<'canvas' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
        <section className="settings-detail surface-section">
          {section === 'appearance' && (
            <>
              <div className="settings-heading">
                <h2>外观</h2>
                <p>选择应用 chrome 的显示主题；谱面画布始终保持深色。</p>
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
            </>
          )}

          {section === 'layout' && (
            <>
              <div className="settings-heading">
                <h2>布局</h2>
                <p>面板开合、宽度与画布缩放的说明。</p>
              </div>
              <div className="settings-row">
                <div className="settings-row__text"><strong>工具 / 属性面板</strong><span>在工作台底部或画布两侧拖拽，或点击面板标题旁的收起按钮</span></div>
              </div>
              <div className="settings-row">
                <div className="settings-row__text"><strong>应用导航</strong><span>左侧导航可折叠为图标栏，默认为折叠态</span></div>
              </div>
              <div className="settings-row">
                <div className="settings-row__text"><strong>画布缩放</strong><span>按住 Ctrl 滚动鼠标滚轮可缩放谱面画布</span></div>
              </div>
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
                <p>导入或导出主题、布局、音频偏好、画布显示与快捷键。谱面工程不在此范围。</p>
              </div>
              <div className="data-actions">
                <button className="button-secondary" type="button" onClick={handleExport}>
                  <Download size={16} />导出全部配置
                </button>
                <button className="button-secondary" type="button" onClick={() => fileRef.current?.click()}>
                  <Upload size={16} />导入配置
                </button>
                <input
                  ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImport(f); e.target.value = ''; }}
                />
              </div>
              {importError && <div className="shortcut-error">{importError}</div>}
            </>
          )}
        </section>
      </AppPageShell.Body>
    </AppPageShell>
  );
}
