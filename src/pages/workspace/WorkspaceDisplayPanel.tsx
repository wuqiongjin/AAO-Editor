// 工作台顶栏画布显示浮层面板（issue 170）
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import { useConfig } from '../../app/ProviderTree';
import { defaultSettings, type AppSettings } from '../../chart/config/AppSettings';
import { GRID_STYLE_PRESETS, type GridStylePreset } from '../../rendering/gridStyle';
import { t, type MessageKey } from '../../i18n';
import './WorkspaceDisplayPanel.css';

/** 画质档选项（映射至 settings.imageQuality.* 键） */
const QUALITY_OPTIONS: ReadonlyArray<{ value: AppSettings['display']['imageQuality']; labelKey: MessageKey }> =
  (['smooth', 'standard', 'hd'] as const).map((value) => ({
    value,
    labelKey: `settings.imageQuality.${value}` as MessageKey,
  }));

/** 轨道颜色主题选项（从 GRID_STYLE_PRESETS 派生） */
const GRID_OPTIONS: ReadonlyArray<{ value: GridStylePreset; labelKey: MessageKey }> =
  GRID_STYLE_PRESETS.map((value) => ({ value, labelKey: `settings.gridStyle.${value}` as MessageKey }));

/** 面板内容宽 */
const PANEL_W = 320;
/** 面板盒宽 = 内容宽 320 + padding 6×2 + 菜单壳 border 1×2 = 334 */
const PANEL_CHROME_W = 14;
const PANEL_BOX_W = PANEL_W + PANEL_CHROME_W;
const VIEWPORT_MARGIN = 8;

export function panelLayoutFor(rect: { right: number; bottom: number }) {
  const left = Math.min(
    Math.max(VIEWPORT_MARGIN, rect.right - PANEL_BOX_W),
    Math.max(VIEWPORT_MARGIN, window.innerWidth - PANEL_BOX_W - VIEWPORT_MARGIN),
  );
  return { top: rect.bottom + 3, left };
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="wdp__row">
      <div className="wdp__row-text">
        <strong>{label}</strong>
      </div>
      {children}
    </div>
  );
}

function Toggle({
  label, checked, onChange,
}: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch${checked ? ' is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

function Select<T extends string | number>({
  value, label, options, onChange,
}: {
  value: T;
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <select
      className="select-control"
      value={String(value)}
      aria-label={label}
      onChange={(e) => {
        const hit = options.find((o) => String(o.value) === e.target.value);
        if (hit) onChange(hit.value);
      }}
    >
      {options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
    </select>
  );
}

function Percent({
  value, label, min, max, onChange,
}: {
  value: number;
  label: string;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="slider-control wdp__slider">
      <input
        type="range"
        min={min}
        max={max}
        step={10}
        value={Math.round(value * 100)}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
      />
      <span className="slider-value">{Math.round(value * 100)}%</span>
    </div>
  );
}

export default function WorkspaceDisplayPanel() {
  const { settings, setDisplay } = useConfig();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [confirmingReset, setConfirmingReset] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setConfirmingReset(false);
  }, []);

  const computePos = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const next = panelLayoutFor(btn.getBoundingClientRect());
    setPos((prev) => (prev.top === next.top && prev.left === next.left ? prev : next));
  }, []);

  const toggle = useCallback(() => {
    if (!open) computePos();
    setOpen(!open);
    setConfirmingReset(false);
  }, [open, computePos]);

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

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
      btnRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  const { display } = settings;

  const qualityOptions = useMemo(() => QUALITY_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) })), []);
  const gridOptions = useMemo(() => GRID_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) })), []);

  const handleReset = () => {
    setDisplay(defaultSettings().display);
    setConfirmingReset(false);
  };

  return (
    <div className="wdp">
      <button
        ref={btnRef}
        type="button"
        className={`ws-topbar-icon-btn${open ? ' is-active' : ''}`}
        title={t('workspace.displaySettings')}
        aria-label={t('workspace.displaySettings')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        <SlidersHorizontal size={14} />
      </button>

      {open && createPortal(
        <>
          <span className="pp-menu__scrim" onClick={close} />
          <div
            className="pp-menu__panel is-portaled wdp__panel"
            style={{ top: pos.top, left: pos.left }}
            role="dialog"
            aria-label={t('workspace.displaySettings')}
          >
            <section className="wdp__group" aria-label={t('settings.section.canvas')}>
              <div className="wdp__group-head">
                <h3 className="wdp__group-title">{t('settings.section.canvas')}</h3>
              </div>
              <Row label={t('settings.noteSize')}>
                <Percent
                  label={t('settings.noteSize')}
                  value={display.noteSize}
                  min={10}
                  max={200}
                  onChange={(noteSize) => setDisplay({ noteSize })}
                />
              </Row>
              <Row label={t('settings.slideOpacity')}>
                <Percent
                  label={t('settings.slideOpacity')}
                  value={display.slideOpacity}
                  min={10}
                  max={100}
                  onChange={(slideOpacity) => setDisplay({ slideOpacity })}
                />
              </Row>
              <Row label={t('settings.simultaneousClickLines')}>
                <Toggle
                  label={t('settings.simultaneousClickLines')}
                  checked={display.simultaneousClickLines}
                  onChange={(simultaneousClickLines) => setDisplay({ simultaneousClickLines })}
                />
              </Row>
              <Row label={t('settings.colorAssist')}>
                <Toggle
                  label={t('settings.colorAssist')}
                  checked={display.colorAssist}
                  onChange={(colorAssist) => setDisplay({ colorAssist })}
                />
              </Row>
              <Row label={t('settings.verticalRatio')}>
                <Percent
                  label={t('settings.verticalRatio')}
                  value={display.verticalRatio}
                  min={50}
                  max={200}
                  onChange={(verticalRatio) => setDisplay({ verticalRatio })}
                />
              </Row>
              <Row label={t('settings.imageQuality')}>
                <Select<AppSettings['display']['imageQuality']>
                  label={t('settings.imageQuality')}
                  value={display.imageQuality}
                  options={qualityOptions}
                  onChange={(imageQuality) => setDisplay({ imageQuality })}
                />
              </Row>
              <Row label={t('settings.gridStyle')}>
                <Select<GridStylePreset>
                  label={t('settings.gridStyle')}
                  value={display.gridStyle}
                  options={gridOptions}
                  onChange={(gridStyle) => setDisplay({ gridStyle })}
                />
              </Row>
              <Row label={t('settings.lineShapeTiers')}>
                <Toggle
                  label={t('settings.lineShapeTiers')}
                  checked={display.lineShapeTiers}
                  onChange={(lineShapeTiers) => setDisplay({ lineShapeTiers })}
                />
              </Row>
              <Row label={t('settings.gridOpacity')}>
                <Percent
                  label={t('settings.gridOpacity')}
                  value={display.gridOpacity}
                  min={10}
                  max={100}
                  onChange={(gridOpacity) => setDisplay({ gridOpacity })}
                />
              </Row>
              <Row label={t('settings.labelScale')}>
                <Percent
                  label={t('settings.labelScale')}
                  value={display.labelScale}
                  min={50}
                  max={300}
                  onChange={(labelScale) => setDisplay({ labelScale })}
                />
              </Row>

              <div className="wdp__reset-row">
                {!confirmingReset ? (
                  <button
                    type="button"
                    className="action-btn wdp__reset-btn"
                    onClick={() => setConfirmingReset(true)}
                  >
                    <RotateCcw size={13} />
                    <span>{t('settings.reset')}</span>
                  </button>
                ) : (
                  <div className="wdp__reset-confirm">
                    <span className="wdp__reset-prompt">{t('settings.reset.confirm', { hint: '' })}</span>
                    <div className="wdp__reset-actions">
                      <button
                        type="button"
                        className="action-btn action-btn--danger"
                        onClick={handleReset}
                      >
                        {t('settings.reset.confirmBtn')}
                      </button>
                      <button
                        type="button"
                        className="action-btn"
                        onClick={() => setConfirmingReset(false)}
                      >
                        {t('settings.reset.cancel')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
