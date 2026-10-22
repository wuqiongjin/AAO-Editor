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
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, SlidersHorizontal } from 'lucide-react';
import IconButton from '../../ui/IconButton';
import { useAppNav } from '../../layouts/AppNav';
import { useConfig } from '../../app/ProviderTree';
import { t, type MessageKey } from '../../i18n';
import type { AppSettings, PreviewBeatMarkDivision, PreviewTimeMarkInterval } from '../../chart/config/AppSettings';
import {
  PREVIEW_BEAT_MARK_DIVISIONS,
  PREVIEW_TIME_MARK_INTERVALS,
  SIM_NOTE_SPEED_RANGE,
  normalizeNoteSpeed,
} from '../../chart/config/AppSettings';
import { GRID_STYLE_PRESETS, type GridStylePreset } from '../../rendering/gridStyle';
import { normalizeNoteSkinSelection, noteSkinPresetLabel } from '../../rendering/skin/noteSkin';
import { SIM_ASSET_SERVERS, simAssetPackThumbUrl } from '../../preview/video/sim/simAssets';
import {
  listSimBackgroundPacks,
  listSimFieldPacks,
  normalizeSimAssetPackId,
  type SimAssetPackKind,
} from '../../preview/video/sim/simAssetPacks';
import type { PreviewMode } from '../../preview';
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

/** 面板**内容**宽（= CSS `.pdp__panel { width }`；定位要的是**盒**宽，见下） */
const PANEL_W = 320;
/**
 * 面板**盒**宽 = 内容宽 + 壳（`.pdp__panel` 的 padding 6×2 + 菜单壳 `.pp-menu__panel` 的 border 1×2）。
 *
 * 定位按盒宽对齐触发钮右缘：`.pdp__panel` 是 content-box，拿内容宽当盒宽会让面板右缘恒比触发钮
 * 右缘多出 14px（issue 29 实测：面板 right 1432 / 触发钮 right 1418）。这两条 CSS 声明与本文件
 * 这三个常量的一致性由 `tests/static/PreviewPanelAnchorWidth.test.ts` 钉住。
 */
const PANEL_CHROME_W = 14;
const PANEL_BOX_W = PANEL_W + PANEL_CHROME_W;
/** 面板离视口边缘的留白（贴右缘式放不下时的下限） */
const VIEWPORT_MARGIN = 8;

/**
 * 面板定位：贴触发钮**右缘**（盒宽对齐）并夹进视口，纵向贴触发钮下缘 +3。
 * 量测输入来自工具栏右簇那枚图标钮：右簇贴页面右缘 ⇒ 窗宽一变它就动，故定位必须随伸缩重算
 * （见组件里那段 resize 监听），只在打开那一刻量一次是不够的。
 */
/**
 * 贴触发钮**右缘**（盒宽对齐）+ 夹进视口。**导出规格面板也用它**（issue 29 同款病灶）：
 * 两块面板共用同一块浮层壳（`.pp-menu__panel` + 320 内容宽），盒宽口径必须只有这一份，
 * 否则缩放窗口时两块面板会朝不同的边缘对齐。
 */
export function panelLayoutFor(rect: { right: number; bottom: number }) {
  const left = Math.min(
    Math.max(VIEWPORT_MARGIN, rect.right - PANEL_BOX_W),
    Math.max(VIEWPORT_MARGIN, window.innerWidth - PANEL_BOX_W - VIEWPORT_MARGIN),
  );
  return { top: rect.bottom + 3, left };
}

/**
 * 一行：[标签] [控件]（行版式是面板自己的：浮层里要紧凑，不复用设置页那套 64px 行高）。
 * `disabled` = 整行置灰不可点（2026-10-06：头带总开关关掉时信息区字段保留勾选但不可改 ——
 * 保留勾选是为了再开时原样回来，置灰是为了说明"现在改它没用"）。
 */
function Row({ label, disabled = false, children }: { label: string; disabled?: boolean; children: ReactNode }) {
  return (
    <div className={`pdp__row${disabled ? ' is-disabled' : ''}`}>
      <div className="pdp__row-text">
        <strong>{label}</strong>
      </div>
      {children}
    </div>
  );
}

function Toggle({
  label, checked, onChange, disabled = false,
}: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
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

/**
 * 步进的两档（照 Bestdori 那枚 `my-numeric-input` 的 `small: .1 / large: .5`）：
 * 贴着输入框的一对 = 小步 0.1，外侧一对 = 大步 0.5（图标用双尖以示"跳得多"）。
 */
const SPEED_STEPS = { small: 0.1, large: 0.5 } as const;

/** 一枚步进钮：`delta` 带符号（负 = 减），`large` = 大步那对（图标用双尖以示"跳得多"） */
function SpeedStep({ delta, large, label, onStep }: {
  delta: number;
  large: boolean;
  label: string;
  onStep: (delta: number) => void;
}) {
  const Icon =
    delta < 0 ? (large ? ChevronsLeft : ChevronLeft) : (large ? ChevronsRight : ChevronRight);
  return (
    <button
      type="button"
      className="pdp__step"
      aria-label={label}
      title={label}
      onClick={() => onStep(delta)}
    >
      <Icon size={12} />
    </button>
  );
}

/**
 * 音符速度档（1..12 步长 0.1；值是"档"不是比例，故不走 `Percent`）。
 *
 * 形态照 Bestdori 那枚 `my-numeric-input`：**数字输入框为主**（能直接敲 11.9 这种非半档值），
 * 滑杆退到第二行做粗调，两侧步进分小 0.1 / 大 0.5 两档（票 24 定案）。
 */
function NoteSpeed({
  value, label, onChange,
}: {
  value: number;
  label: string;
  onChange: (v: number) => void;
}) {
  // 输入框是"草稿"：边敲边把解析出来的值写回设置（敲到一半的 "1" 也是合法档位），
  // 失焦再回到归一化后的那个数 —— 免得 "12." 这种半成品一直挂在框里。
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: number) => onChange(normalizeNoteSpeed(raw, value));
  const stepBy = (delta: number) => commit(value + delta);
  return (
    <div className="pdp__row pdp__row--stack">
      <div className="pdp__row-text"><strong>{label}</strong></div>
      {/* 一条上排完：滑杆（粗调）→ 步进（大 / 小）→ 数值框 → 步进（小 / 大）。
          数值框夹在两对步进钮中间 = 一枚 spinbutton，不再是"读数 + 各在各处的旋钮"。 */}
      <div className="pdp__speed-line">
        <input
          type="range"
          className="pdp__speed-slider"
          min={SIM_NOTE_SPEED_RANGE.min}
          max={SIM_NOTE_SPEED_RANGE.max}
          step={SIM_NOTE_SPEED_RANGE.step}
          value={value}
          aria-label={label}
          onChange={(e) => { setDraft(null); commit(Number(e.target.value)); }}
        />
        <SpeedStep
          delta={-SPEED_STEPS.large}
          large
          label={t('preview.display.noteSpeed.decrease', { delta: SPEED_STEPS.large })}
          onStep={stepBy}
        />
        <SpeedStep
          delta={-SPEED_STEPS.small}
          large={false}
          label={t('preview.display.noteSpeed.decrease', { delta: SPEED_STEPS.small })}
          onStep={stepBy}
        />
        <input
          type="number"
          className="pdp__number"
          min={SIM_NOTE_SPEED_RANGE.min}
          max={SIM_NOTE_SPEED_RANGE.max}
          step={SIM_NOTE_SPEED_RANGE.step}
          inputMode="decimal"
          value={draft ?? value.toFixed(1)}
          aria-label={label}
          onChange={(e) => {
            setDraft(e.target.value);
            const parsed = Number(e.target.value);
            if (e.target.value.trim() !== '' && Number.isFinite(parsed)) commit(parsed);
          }}
          onBlur={() => setDraft(null)}
        />
        <SpeedStep
          delta={SPEED_STEPS.small}
          large={false}
          label={t('preview.display.noteSpeed.increase', { delta: SPEED_STEPS.small })}
          onStep={stepBy}
        />
        <SpeedStep
          delta={SPEED_STEPS.large}
          large
          label={t('preview.display.noteSpeed.increase', { delta: SPEED_STEPS.large })}
          onStep={stepBy}
        />
      </div>
    </div>
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

/**
 * 仿真场素材包缩略图网格（chart-preview 41 · ADR-0018 §1）：背景 / 轨道两个独立选择器，
 * 显示名 = 包 ID（辨识交给缩略图，与音符皮肤整包预设同一口径）。
 *
 * 缩略从素材自身缩放生成（`<img>` + CSS 裁切，不额外抓图）：轨道取该包场地图、背景取主图。
 * **列表即真相**：只渲染清单里实际取到的包；选中的 ID 不在清单里时高亮跟随归一化结果
 * （回落默认 `skin00`），不弹错、不占"缺失"行。
 */
function SimPackGrid({
  kind, label, full, value, onChange,
}: {
  kind: SimAssetPackKind;
  /** 行标签（UI 文案：「背景」/「轨道」） */
  label: string;
  /** 全称（tooltip 用：表演背景 / 场地皮肤包） */
  full: string;
  value: string;
  onChange: (packId: string) => void;
}) {
  const packs = kind === 'field' ? listSimFieldPacks() : listSimBackgroundPacks();
  // 只同步 jp 一个服务器（ADR-0018 §2）⇒ 缩略图按探测顺序的首服取；真要读不到时
  // `<img onError>` 把那一格降级成"只有包 ID"，不影响选择。
  const server = SIM_ASSET_SERVERS[0];
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  const activeId = normalizeSimAssetPackId(kind, value);
  if (packs.length === 0) return null;

  return (
    <div className="pdp__row pdp__row--stack">
      <div className="pdp__row-text"><strong>{label}</strong></div>
      <div className="pdp__pack-grid" role="group" aria-label={full}>
        {packs.map((pack) => {
          const thumb = simAssetPackThumbUrl(kind, pack.id, server);
          return (
            <button
              key={pack.id}
              type="button"
              className={`pdp__pack-item${pack.id === activeId ? ' is-active' : ''}`}
              aria-pressed={pack.id === activeId}
              title={`${full} · ${pack.id}`}
              onClick={() => onChange(pack.id)}
            >
              {thumb && !broken.has(thumb) ? (
                <img
                  src={thumb}
                  alt=""
                  loading="lazy"
                  onError={() => setBroken((prev) => new Set(prev).add(thumb))}
                />
              ) : null}
              <span className="pdp__pack-id">{pack.id}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 面板形态（chart-preview 05 / 37）：同一份「设置」控件在两种预览形态下显示不同的组 ——
 * 静态（标记 + 画布共享 + 皮肤）/ 动态（**仿真场** + 画布共享 + 皮肤）。
 * 「画布共享」与「音符皮肤」两组两种形态共用（同一份数据，改了双方生效）。
 * 导出相关设置已迁移至导出按钮弹窗（StaticExportControl / VideoExportControl）。
 */
export interface PreviewDisplayPanelProps {
  mode?: PreviewMode;
}

export default function PreviewDisplayPanel({ mode = 'static' }: PreviewDisplayPanelProps) {
  const { settings, setDisplay, setPreview } = useConfig();
  const { setActivePage } = useAppNav();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLSpanElement>(null);

  const close = useCallback(() => setOpen(false), []);

  /** 量触发钮定面板位；打开前与开着时窗口伸缩都走它（算式见 panelLayoutFor） */
  const computePos = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const next = panelLayoutFor(btn.getBoundingClientRect());
    // 等值守卫：补测路径会反复调用，几何没变时别平白制造一次重渲
    setPos((prev) => (prev.top === next.top && prev.left === next.left ? prev : next));
  }, []);

  const toggle = useCallback(() => {
    if (!open) computePos();   // 先量再开：首帧就到位，不出现"先落在旧处再跳一下"
    setOpen(!open);
  }, [open, computePos]);

  // 开着时跟随触发钮（issue 29）：右簇贴页面右缘 ⇒ 伸缩窗口就把它挪走，不重新量的话面板停在旧位置、
  // 与触发钮脱节；缩到 1180（1600 开面板）时更糟 —— 面板右缘跑到视口外 252px，右侧控件点不到。
  //
  // 跨帧补测的理由照 `src/ui/ScopePicker.tsx` 那段（票 11 #1 同款病灶）：触发钮几何未必在 resize
  // 当帧落定（那边是 AppPageShell 的 ResizeObserver 异步写 --aps-*；本页是纯 CSS 布局，当帧量通常
  // 就够，双帧兜底字体 / 滚动条那类迟到几何）。等值守卫让补测不制造冗余重渲。
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
            {/* 两组形态各一组"这一屏自己特有的"：静态 = 标记（只有预览面板会画），
                动态 = 仿真场（音符速度 + 镜向）。两组的其余部分共用。 */}
            {mode === 'static' ? (
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
            ) : (
              <section className="pdp__group" aria-label={t('preview.display.group.sim')}>
                <h3 className="pdp__group-title">{t('preview.display.group.sim')}</h3>
                {/* 音符速度 = 接近模型的唯一档（档位 1..12 步长 0.1；T = 分段映射：n ≤ 11 → (12 − n)/2、
                   n > 11 → (16 − n)/10 秒，越大越快，见 `approachSeconds`）。
                    它自己就是一整行（上段标签 + 数字框 + 步进，下段滑杆），故不再套 `Row` */}
                <NoteSpeed
                  label={t('preview.display.noteSpeed')}
                  value={preview.noteSpeed}
                  onChange={(noteSpeed) => setPreview({ noteSpeed })}
                />
                {/* 镜向与静态那张同一个开关（`settings.preview.mirror`）：整轨镜像含方向箭头翻面 */}
                <Row label={t('preview.display.mirror')}>
                  <Toggle
                    label={t('preview.display.mirror')}
                    checked={preview.mirror}
                    onChange={(mirror) => setPreview({ mirror })}
                  />
                </Row>
                {/* 表演背景 / 场地皮肤包（41）：两个独立选择器，缩略图网格 + 包 ID 显示名，
                    挑背景要看着画面挑（定案 #4：入口在预览页设置面板） */}
                <SimPackGrid
                  kind="background"
                  label={t('preview.display.bgPack')}
                  full={t('preview.display.bgPack.full')}
                  value={preview.bgPackId}
                  onChange={(bgPackId) => setPreview({ bgPackId })}
                />
                <SimPackGrid
                  kind="field"
                  label={t('preview.display.fieldPack')}
                  full={t('preview.display.fieldPack.full')}
                  value={preview.fieldPackId}
                  onChange={(fieldPackId) => setPreview({ fieldPackId })}
                />
              </section>
            )}

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
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
