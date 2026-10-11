// 静态预览工具栏的**导出入口**（chart-preview 37）：
// 将「设置」面板中的「导出信息」迁移至「导出」按钮弹窗，交互对齐 VideoExportControl。
//
// 规格弹层（导出图片）：
//   - 标题：导出图片；
//   - 导出信息组：曲目信息头带总开关（启用头带）+ ? 浮层说明 + 七项字段开关；
//   - 关掉总开关时字段行置灰保留勾选（与设置面板既有行为一致）；
//   - 开始导出按钮：点击触发导出；若超限（exportPlan.ok === false）则置灰禁用并给出原因。
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle, ImageDown } from 'lucide-react';
import IconButton from '../../ui/IconButton';
import { t, type MessageKey } from '../../i18n';
import { EXPORT_FIELD_KEYS } from '../../chart/config/AppSettings';
import { useConfig } from '../../app/ProviderTree';
import type { SheetPlan } from '../../preview';
// 面板定位与「显示」面板/视频导出共用同一份（同一块浮层壳，盒宽口径必须一致，见 issue 29）
import { panelLayoutFor } from './PreviewDisplayPanel';
// 浮层复用菜单壳
import '../projects/ProjectsPage.css';
import './PreviewPage.css';

/** 一行：[标签] [控件]（与 VideoExportControl / PreviewDisplayPanel 同一套行版式） */
function Row({
  label, disabled, children,
}: { label: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <div className={`pvex__row${disabled ? ' is-disabled' : ''}`}>
      <div className="pvex__row-text"><strong>{label}</strong></div>
      {children}
    </div>
  );
}

/** 开关（与 VideoExportControl / PreviewDisplayPanel 同一枚 .switch） */
function Toggle({
  label, checked, disabled, onChange,
}: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`switch${checked ? ' is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export interface StaticExportControlProps {
  /** 没有可导出的谱面 */
  disabled?: boolean;
  /** 是否正在导出 */
  exporting?: boolean;
  /** 导出规划（宽 × 高 / 是否超限），null 表示谱面未就绪 */
  exportPlan?: SheetPlan | null;
  /** 开始导出回调 */
  onExport: () => void;
}

export default function StaticExportControl({
  disabled = false,
  exporting = false,
  exportPlan = null,
  onExport,
}: StaticExportControlProps) {
  const { settings, setExport } = useConfig();

  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const helpWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!helpOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!helpWrapRef.current?.contains(e.target as Node)) {
        setHelpOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [helpOpen]);

  /** 量触发钮定面板位；等值守卫避免冗余重渲 */
  const computePos = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const next = panelLayoutFor(btn.getBoundingClientRect());
    setPos((prev) => (prev.top === next.top && prev.left === next.left ? prev : next));
  }, []);

  // 点面板外 / Esc 收起
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // 窗口伸缩动态跟随
  useEffect(() => {
    if (!open) return;
    let raf1 = 0;
    let raf2 = 0;
    const onResize = () => {
      computePos();
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      raf1 = requestAnimationFrame(() => {
        computePos();
        raf2 = requestAnimationFrame(computePos);
      });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [open, computePos]);

  const exportTitle = exportPlan == null
    ? t('preview.static.export')
    : exportPlan.ok
      ? t('preview.static.exportHint', { w: exportPlan.sheetW, h: exportPlan.sheetH })
      : t('preview.static.exportRefused', { reason: exportPlan.detail });

  const startDisabled = exportPlan == null || !exportPlan.ok || exporting;

  return (
    <div className="pvex">
      <span className="pvex__trigger" ref={btnRef}>
        <IconButton
          width="auto"
          size="sm"
          disabled={disabled || exporting}
          icon={<ImageDown size={15} />}
          label={exporting ? t('preview.static.exporting') : t('preview.static.export.open')}
          title={exportTitle}
          active={open}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => {
            if (!open) computePos();
            setOpen(!open);
          }}
        />
      </span>

      {open && !exporting && createPortal(
        <div
          ref={panelRef}
          className="pp-menu__panel is-portaled pdp__panel pvex__panel"
          style={{ top: pos.top, left: pos.left }}
          role="dialog"
          aria-label={t('preview.static.export.title')}
        >
          <section className="pvex__group">
            <h3 className="pvex__group-title">{t('preview.static.export.title')}</h3>

            <section className="pvex__group pvex__group--sub">
              <div className="pvex__group-head">
                <div className="pvex__group-title-wrap" ref={helpWrapRef}>
                  <h4 className="pvex__group-title">{t('preview.display.group.export')}</h4>
                  <button
                    type="button"
                    className={`pvex__help-btn${helpOpen ? ' is-active' : ''}`}
                    title={t('preview.static.export.note')}
                    aria-label={t('preview.static.export.note')}
                    aria-expanded={helpOpen}
                    onClick={() => setHelpOpen((v) => !v)}
                  >
                    <HelpCircle size={13} />
                  </button>
                  {helpOpen && (
                    <div className="pvex__help-popover" role="tooltip">
                      {t('preview.static.export.note')}
                    </div>
                  )}
                </div>
                <Toggle
                  label={t('preview.display.export.enabled')}
                  checked={settings.export.enabled}
                  onChange={(v) => setExport({ enabled: v })}
                />
              </div>

              {EXPORT_FIELD_KEYS.map((key) => {
                const label = t(`preview.display.export.${key}` as MessageKey);
                return (
                  <Row key={key} label={label} disabled={!settings.export.enabled}>
                    <Toggle
                      label={label}
                      checked={settings.export[key]}
                      disabled={!settings.export.enabled}
                      onChange={(v) => setExport({ [key]: v })}
                    />
                  </Row>
                );
              })}
            </section>

            {exportPlan && !exportPlan.ok && (
              <p className="pvex__note">{t('preview.static.exportRefused', { reason: exportPlan.detail })}</p>
            )}

            <button
              type="button"
              className="action-btn pvex__start"
              disabled={startDisabled}
              onClick={() => {
                setOpen(false);
                onExport();
              }}
            >
              {t('preview.static.export.start')}
            </button>
          </section>
        </div>,
        document.body,
      )}
    </div>
  );
}
