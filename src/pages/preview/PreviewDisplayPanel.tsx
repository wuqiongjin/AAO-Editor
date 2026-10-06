// 预览页的「设置」面板（chart-preview 08；2026-09-30 用户定案，二轮收敛文案）：
// 工具栏一个钮弹出三组 ——
//   【标记】`settings.preview`：BPM / 时间 / 节拍线 / Combo 标记 + 镜向（只有预览面板会画，跨会话记住）；
//   【画布显示】`settings.display`：与设置页那一节**同一份数据**（改了工作台画布同步变，
//     = Bestdori 行为）；只放对预览有观感意义的项（文字大小 / 线形分层留在设置页），不放行内说明；
//   【音符皮肤】显示当前整包名 + 跳素材页（不做第二套选择器）。
// 形态照站内：触发钮 = `IconButton`；浮层壳 = `.pp-menu__scrim` / `.pp-menu__panel.is-portaled`
// （与 ScopePicker / PreviewChartSwitcher 同一套，显式 import 那份 CSS）；控件 = `.slider-control` /
// `.slider-value` / `.switch` / `.select-control`（设置页同一套词汇，不新造样式），只有行版式是面板自己的。
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { SlidersHorizontal } from 'lucide-react';
import IconButton from '../../ui/IconButton';
import { useAppNav } from '../../layouts/AppNav';
import { useConfig } from '../../app/ProviderTree';
import { t, type MessageKey } from '../../i18n';
import type { AppSettings, PreviewBeatMarkDivision, PreviewTimeMarkInterval } from '../../chart/config/AppSettings';
import {
  EXPORT_FIELD_KEYS,
  PREVIEW_BEAT_MARK_DIVISIONS,
  PREVIEW_TIME_MARK_INTERVALS,
} from '../../chart/config/AppSettings';
import { GRID_STYLE_PRESETS, type GridStylePreset } from '../../rendering/gridStyle';
import { normalizeNoteSkinSelection, noteSkinPresetLabel } from '../../rendering/skin/noteSkin';
// 浮层复用菜单壳（与 ScopePicker 同因：`.pp-menu__*` 定义在 ProjectsPage.css，别指望那一页先挂载）
import '../projects/ProjectsPage.css';
import './PreviewPage.css';

/** 画质档（选项从 AppSettings 的联合派生，映射回设置页同一批 i18n key） */
const QUALITY_OPTIONS: ReadonlyArray<{ value: AppSettings['display']['imageQuality']; labelKey: MessageKey }> =
  (['smooth', 'standard', 'hd'] as const).map((value) => ({
    value,
    labelKey: `settings.imageQuality.${value}` as MessageKey,
  }));

/** 轨道颜色主题：选项直接从白名单常量派生（`GRID_STYLE_PRESETS` 是单一来源） */
const GRID_OPTIONS: ReadonlyArray<{ value: GridStylePreset; labelKey: MessageKey }> =
  GRID_STYLE_PRESETS.map((value) => ({ value, labelKey: `settings.gridStyle.${value}` as MessageKey }));

/** 面板宽（浮层贴右缘定位时用；与 CSS 里的 `.pdp__panel` 宽度同值） */
const PANEL_W = 320;

/** 一行：[标签] [控件]（行版式是面板自己的：浮层里要紧凑，不复用设置页那套 64px 行高） */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pdp__row">
      <div className="pdp__row-text">
        <strong>{label}</strong>
      </div>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
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

/** 百分比滑杆（值以比例存储，UI 显示 %）——与设置页同一形态（`.slider-control` + `.slider-value`） */
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
    <div className="slider-control pdp__slider">
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

export default function PreviewDisplayPanel() {
  const { settings, setDisplay, setPreview, setExport } = useConfig();
  const { setActivePage } = useAppNav();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLSpanElement>(null);

  const close = useCallback(() => setOpen(false), []);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      if (!prev && btnRef.current) {
        const r = btnRef.current.getBoundingClientRect();
        // 贴右缘对齐并夹进视口（工具栏那排按钮可以有多个实例：页面工具栏一份、全屏浮层一份）
        const left = Math.min(Math.max(8, r.right - PANEL_W), Math.max(8, window.innerWidth - PANEL_W - 8));
        setPos({ top: r.bottom + 3, left });
      }
      return !prev;
    });
  }, []);

  // Esc 关面板并把焦点还给触发钮（点面板外由遮罩负责，照 ScopePicker）。
  // 焦点给外壳里那枚 `<button>`（外壳只是量尺，本身不可聚焦）
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
      btnRef.current?.querySelector('button')?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  const { display, preview } = settings;
  const skinName = useMemo(
    () => noteSkinPresetLabel(normalizeNoteSkinSelection(settings.visual?.noteSkin)) ?? t('preview.display.skin.custom'),
    [settings.visual?.noteSkin],
  );

  const timeOptions = useMemo(
    () => PREVIEW_TIME_MARK_INTERVALS.map((v) => ({
      value: v,
      label: v === 'off' ? t('preview.display.off') : t('preview.display.seconds', { count: v }),
    })),
    [],
  );
  const beatOptions = useMemo(
    () => PREVIEW_BEAT_MARK_DIVISIONS.map((v) => ({
      value: v,
      label: v === 'off' ? t('preview.display.off') : `1/${v}`,
    })),
    [],
  );
  const qualityOptions = useMemo(() => QUALITY_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) })), []);
  const gridOptions = useMemo(() => GRID_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) })), []);

  return (
    <div className="pdp">
      {/* 触发钮的量尺挂在外壳上：`IconButton` 不是 forwardRef 组件（全站同一件事），
          而浮层定位只要一个矩形（宽高与内容同尺寸的 inline-flex 外壳就够） */}
      <span className="pdp__trigger" ref={btnRef}>
        <IconButton
          width="auto"
          size="sm"
          icon={<SlidersHorizontal size={15} />}
          label={t('preview.display.open')}
          title={t('preview.display.title')}
          active={open}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={toggle}
        />
      </span>

      {open && createPortal(
        <>
          <span className="pp-menu__scrim" onClick={close} />
          {/* portal 是硬要求：外壳的进场动画会给直系子元素建常驻 stacking context（见 ScopePicker） */}
          <div
            className="pp-menu__panel is-portaled pdp__panel"
            style={{ top: pos.top, left: pos.left }}
            role="dialog"
            aria-label={t('preview.display.title')}
          >
            <section className="pdp__group" aria-label={t('preview.display.group.marks')}>
              <h3 className="pdp__group-title">{t('preview.display.group.marks')}</h3>
              <Row label={t('preview.display.bpmMarks')}>
                <Toggle
                  label={t('preview.display.bpmMarks')}
                  checked={preview.bpmMarks}
                  onChange={(bpmMarks) => setPreview({ bpmMarks })}
                />
              </Row>
              <Row label={t('preview.display.timeMarks')}>
                <Select<PreviewTimeMarkInterval>
                  label={t('preview.display.timeMarks')}
                  value={preview.timeMarks}
                  options={timeOptions}
                  onChange={(timeMarks) => setPreview({ timeMarks })}
                />
              </Row>
              <Row label={t('preview.display.beatMarks')}>
                <Select<PreviewBeatMarkDivision>
                  label={t('preview.display.beatMarks')}
                  value={preview.beatMarks}
                  options={beatOptions}
                  onChange={(beatMarks) => setPreview({ beatMarks })}
                />
              </Row>
              <Row label={t('preview.display.comboMarks')}>
                <Toggle
                  label={t('preview.display.comboMarks')}
                  checked={preview.comboMarks}
                  onChange={(comboMarks) => setPreview({ comboMarks })}
                />
              </Row>
              <Row label={t('preview.display.mirror')}>
                <Toggle
                  label={t('preview.display.mirror')}
                  checked={preview.mirror}
                  onChange={(mirror) => setPreview({ mirror })}
                />
              </Row>
            </section>

            {/* 选项顺序照设置页「画布显示」那一节（同一份数据的两个入口，顺序也一致更好认） */}
            <section className="pdp__group" aria-label={t('preview.display.group.canvas')}>
              <h3 className="pdp__group-title">{t('preview.display.group.canvas')}</h3>
              <Row label={t('settings.noteSize')}>
                <Percent label={t('settings.noteSize')} value={display.noteSize} min={10} max={200}
                  onChange={(noteSize) => setDisplay({ noteSize })} />
              </Row>
              <Row label={t('settings.slideOpacity')}>
                <Percent label={t('settings.slideOpacity')} value={display.slideOpacity} min={10} max={100}
                  onChange={(slideOpacity) => setDisplay({ slideOpacity })} />
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
                <Percent label={t('settings.verticalRatio')} value={display.verticalRatio} min={50} max={200}
                  onChange={(verticalRatio) => setDisplay({ verticalRatio })} />
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
              <Row label={t('settings.gridOpacity')}>
                <Percent label={t('settings.gridOpacity')} value={display.gridOpacity} min={10} max={100}
                  onChange={(gridOpacity) => setDisplay({ gridOpacity })} />
              </Row>
              {/* 文字大小 / 线形分层不进本面板（用户 2026-09-30 三轮定案：对预览作用不大，设置页仍可改） */}
            </section>

            <section className="pdp__group" aria-label={t('preview.display.group.skin')}>
              <h3 className="pdp__group-title">{t('preview.display.group.skin')}</h3>
              <Row label={skinName}>
                <button
                  type="button"
                  className="action-btn pdp__skin-open"
                  onClick={() => { close(); setActivePage('assets'); }}
                >
                  {t('preview.display.skin.open')}
                </button>
              </Row>
            </section>

            {/* 导出信息（chart-preview 14）：这张宽图的头带里写哪些字段，落 `settings.export`（跨会话记住）——
                与上一组「怎么看」分开：这是**导出物里写什么**。谱师姓名不在这里（本票不做）。 */}
            <section className="pdp__group" aria-label={t('preview.display.group.export')}>
              <h3 className="pdp__group-title">{t('preview.display.group.export')}</h3>
              {EXPORT_FIELD_KEYS.map((key) => {
                const label = t(`preview.display.export.${key}` as MessageKey);
                return (
                  <Row key={key} label={label}>
                    <Toggle
                      label={label}
                      checked={settings.export[key]}
                      onChange={(v) => setExport({ [key]: v })}
                    />
                  </Row>
                );
              })}
            </section>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
