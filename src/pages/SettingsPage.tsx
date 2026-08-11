import { useRef, useState } from 'react';
import { Check, Download, MonitorCog, RotateCcw, SlidersHorizontal, Upload } from 'lucide-react';
import { useConfig } from '../contexts';
import { loadSettings } from '../utils/AppSettings';
import type { AppSettings } from '../utils/AppSettings';

// 设置页（issue 28 Q13）：左侧次级索引（外观 / 布局 / 配置数据），右侧详情。
// 音频偏好本期不进设置页（音频页自管）；导入/导出/恢复默认统一收敛在「配置数据」。
type Section = 'appearance' | 'layout' | 'data';

const THEME_OPTIONS: Array<{ value: AppSettings['theme']; label: string; swatch: string }> = [
  { value: 'light', label: '亮色', swatch: 'light' },
  { value: 'dark', label: '暗色', swatch: 'dark' },
  { value: 'system', label: '跟随系统', swatch: 'system' },
];

export default function SettingsPage() {
  const { settings, setTheme, setAllSettings, resetSettings } = useConfig();
  const [section, setSection] = useState<Section>('appearance');
  const [importError, setImportError] = useState<string | null>(null);
  const [resetConfirm, setResetConfirm] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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
    <div className="page-content">
      <header className="page-intro">
        <span>应用设置</span>
        <h2>设置</h2>
        <p>修改立即生效并自动保存。导入与恢复默认属于高风险操作，会在执行前单独确认。</p>
      </header>

      <div className="settings-layout">
        <aside className="settings-index" aria-label="设置分类">
          <button className={section === 'appearance' ? 'is-active' : ''} type="button" onClick={() => setSection('appearance')}>
            <MonitorCog size={17} />外观
          </button>
          <button className={section === 'layout' ? 'is-active' : ''} type="button" onClick={() => setSection('layout')}>
            <SlidersHorizontal size={17} />布局
          </button>
          <button className={section === 'data' ? 'is-active' : ''} type="button" onClick={() => setSection('data')}>
            <Download size={17} />配置数据
          </button>
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
                <div><strong>工具 / 属性面板</strong><span>在工作台底部或画布两侧拖拽，或点击面板标题旁的收起按钮</span></div>
              </div>
              <div className="settings-row">
                <div><strong>应用导航</strong><span>左侧导航可折叠为图标栏，默认为折叠态</span></div>
              </div>
              <div className="settings-row">
                <div><strong>画布缩放</strong><span>按住 Ctrl 滚动鼠标滚轮可缩放谱面画布</span></div>
              </div>
            </>
          )}

          {section === 'data' && (
            <>
              <div className="settings-heading">
                <h2>配置数据</h2>
                <p>导入或导出主题、布局、音频偏好和快捷键。谱面工程不在此范围。</p>
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

              <div className="danger-row">
                <div>
                  <strong>恢复默认设置</strong>
                  <span>{resetConfirm ? '确定恢复？将覆盖当前主题、布局与快捷键。' : '重置为主题、布局、快捷键与音频偏好为出厂默认，不会删除谱面工程'}</span>
                </div>
                {resetConfirm ? (
                  <span style={{ display: 'flex', gap: 8 }}>
                    <button type="button" onClick={() => { resetSettings(); setResetConfirm(false); }}>确认恢复</button>
                    <button
                      type="button"
                      style={{ background: 'var(--bg-inset)', color: 'var(--text)', border: '1px solid var(--border)' }}
                      onClick={() => setResetConfirm(false)}
                    >取消</button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setResetConfirm(true)}>
                    <RotateCcw size={15} />恢复默认
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
