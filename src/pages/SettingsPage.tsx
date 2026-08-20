import { useRef, useState } from 'react';
import { Check, Download, MonitorCog, RotateCcw, SlidersHorizontal, Upload, Eye, Music2 } from 'lucide-react';
import { useConfig } from '../contexts';
import { defaultSettings, loadSettings } from '../utils/AppSettings';
import type { AppSettings } from '../utils/AppSettings';

// 设置页（issue 28 Q13 + issue 39）：左侧次级索引分为两组——
// 「应用设置」：外观 / 布局 / 配置数据（现有三类归入，语义不变）
// 「功能设置」：画布显示 / 播放（谱面呈现参数，issue 39）
// 修改立即生效并持久化（versioned settings，ADR-0003 §6）。
type Section = 'appearance' | 'layout' | 'data' | 'canvas' | 'playback';

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
  const { settings, setTheme, setDisplay, setSeVolume, setAllSettings } = useConfig();
  const [section, setSection] = useState<Section>('appearance');
  const [importError, setImportError] = useState<string | null>(null);
  // 分组恢复默认：画布显示/播放各自只重置本组参数（用户反馈：整体重置放在配置数据语义不符）
  const [resetConfirm, setResetConfirm] = useState<'canvas' | 'playback' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const resetCanvasDefaults = () => setDisplay(defaultSettings().display);
  const resetPlaybackDefaults = () => setSeVolume(defaultSettings().audio.seVolume);

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
    <div className="page-content is-fill">
      <header className="page-intro">
        <span>应用设置</span>
        <h2>设置</h2>
        <p>修改立即生效并自动保存。导入与恢复默认属于高风险操作，会在执行前单独确认。</p>
      </header>

      <div className="settings-layout">
        <aside className="settings-index" aria-label="设置分类">
          <div className="settings-index-group" role="group" aria-label="应用设置">
            <div className="settings-index-title">应用设置</div>
            <button className={section === 'appearance' ? 'is-active' : ''} type="button" onClick={() => setSection('appearance')}>
              <MonitorCog size={17} />外观
            </button>
            <button className={section === 'layout' ? 'is-active' : ''} type="button" onClick={() => setSection('layout')}>
              <SlidersHorizontal size={17} />布局
            </button>
            <button className={section === 'data' ? 'is-active' : ''} type="button" onClick={() => setSection('data')}>
              <Download size={17} />配置数据
            </button>
          </div>
          <div className="settings-index-group" role="group" aria-label="功能设置">
            <div className="settings-index-title">功能设置</div>
            <button className={section === 'canvas' ? 'is-active' : ''} type="button" onClick={() => setSection('canvas')}>
              <Eye size={17} />画布显示
            </button>
            <button className={section === 'playback' ? 'is-active' : ''} type="button" onClick={() => setSection('playback')}>
              <Music2 size={17} />播放
            </button>
          </div>
        </aside>

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

          {section === 'playback' && (
            <>
              <div className="settings-heading">
                <h2>播放</h2>
                <p>播放过程中的音效参数；音频 tab 只管谱面 BGM，不在此范围。</p>
              </div>
              <PercentSliderRow
                label="节奏图示 SE 音量" hint="键音（音符击打音效）的独立音量，不影响 BGM"
                value={settings.audio.seVolume} min={0} max={100} step={5}
                onChange={(v) => setSeVolume(v)}
              />
              <ResetRow
                label="恢复默认" hint="将本组（播放）全部参数恢复为出厂默认，不影响其它设置"
                confirming={resetConfirm === 'playback'}
                onToggle={() => setResetConfirm(resetConfirm === 'playback' ? null : 'playback')}
                onConfirm={() => { resetPlaybackDefaults(); setResetConfirm(null); }}
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
      </div>
    </div>
  );
}
