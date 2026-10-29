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
import { getActiveUiLanguage, t, type MessageKey } from '../../i18n';
import type { AppSettings, PreviewBeatMarkDivision, PreviewTimeMarkInterval } from '../../chart/config/AppSettings';
import {
  PREVIEW_BEAT_MARK_DIVISIONS,
  PREVIEW_TIME_MARK_INTERVALS,
  SIM_NOTE_SPEED_RANGE,
  normalizeNoteSpeed,
} from '../../chart/config/AppSettings';
import { GRID_STYLE_PRESETS, type GridStylePreset } from '../../rendering/gridStyle';
import { normalizeNoteSkinSelection, noteSkinPresetLabel } from '../../rendering/skin/noteSkin';
import {
  SIM_ASSET_SERVERS,
  loadImageElement,
  simAssetPackThumbUrl,
  simAssetUrls,
} from '../../preview/video/sim/simAssets';
import { drawFieldLayers } from '../../preview/video/sim/simField';
import { fieldMetrics } from '../../preview/video/sim/simGeometry';
import {
  listSimBackgroundPacks,
  listSimFieldPacks,
  normalizeSimAssetPackId,
  simPackDisplayName,
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

/** 两个素材包选择器的文案（设置行的标签 / 选择器分组的全称，两处共用一份） */
const PACK_LABEL_KEYS: Record<SimAssetPackKind, { label: MessageKey; full: MessageKey }> = {
  background: { label: 'preview.display.bgPack', full: 'preview.display.bgPack.full' },
  field: { label: 'preview.display.fieldPack', full: 'preview.display.fieldPack.full' },
};

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

/** 素材包大预览的画布尺寸（16:9 ≈ 设计面 1334:750；够看清两侧描边与车道花纹） */
const PACK_PREVIEW_W = 300;
const PACK_PREVIEW_H = 169;
/**
 * 大预览的壳宽（CSS `.pdp__preview` 的 padding 4×2 + border 1×2）。
 * 浮层是 content-box（portal 到 body，吃不到 `.app-shell *` 的 border-box），
 * 定位要的是**盒**宽 —— 拿内容宽算会让贴右缘时溢出 10px（照 `PANEL_CHROME_W` 的先例）。
 */
const PACK_PREVIEW_CHROME_W = 10;
const PACK_PREVIEW_BOX_W = PACK_PREVIEW_W + PACK_PREVIEW_CHROME_W;
/** 大预览与面板之间的间距 */
const PACK_PREVIEW_GAP = 10;
/** 大预览底部留给名字的高度（估算值，只用于视口夹取） */
const PACK_PREVIEW_CAPTION_H = 22;

/**
 * 大预览的定位：**默认贴面板左侧**（面板贴右缘 ⇒ 左侧是仿真场，正好"看着画面挑"），
 * 左侧放不下时翻到面板右侧；纵向对齐面板顶并夹进视口。跟随面板 `pos`（窗口伸缩时一起动）。
 */
function packPreviewLayout(panel: { top: number; left: number }) {
  const left = panel.left - PACK_PREVIEW_BOX_W - PACK_PREVIEW_GAP >= VIEWPORT_MARGIN
    ? panel.left - PACK_PREVIEW_BOX_W - PACK_PREVIEW_GAP
    : panel.left + PANEL_BOX_W + PACK_PREVIEW_GAP;
  const maxTop = Math.max(
    VIEWPORT_MARGIN,
    window.innerHeight - PACK_PREVIEW_H - PACK_PREVIEW_CAPTION_H - VIEWPORT_MARGIN,
  );
  const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - PACK_PREVIEW_BOX_W - VIEWPORT_MARGIN);
  return {
    top: Math.min(Math.max(VIEWPORT_MARGIN, panel.top), maxTop),
    left: Math.min(Math.max(VIEWPORT_MARGIN, left), maxLeft),
  };
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
  value, label, min, max, step = 10, onChange,
}: {
  value: number;
  label: string;
  min: number;
  max: number;
  /** 步长（**百分数**单位；背景亮度按全站滑杆惯例 5，其余沿用 10） */
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="slider-control pdp__slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.round(value * 100)}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
      />
      <span className="slider-value">{Math.round(value * 100)}%</span>
    </div>
  );
}

/**
 * 素材包选择器的共用查表（chart-preview 41 · ADR-0018 §1；票 56）：
 * 包清单是唯一真相，选中的 ID 先归一化（不在清单里 → 默认 `skin00`），显示名走分层命名
 * （issue 49：官方 API > 社区 fallback > 包 ID，取件侧产出、这里只查表）。
 *
 * 缩略从素材自身缩放生成（`<img>` + CSS，不额外抓图）：轨道取该包场地图、背景取主图。
 */
function packDisplayInfo(kind: SimAssetPackKind, value: string) {
  const packs = kind === 'field' ? listSimFieldPacks() : listSimBackgroundPacks();
  const activeId = normalizeSimAssetPackId(kind, value);
  const pack = packs.find((p) => p.id === activeId);
  return {
    packs,
    activeId,
    display: pack ? simPackDisplayName(pack, kind) : activeId,
    // 只同步 jp 一个服务器（ADR-0018 §2）⇒ 缩略图按探测顺序的首服取
    thumb: simAssetPackThumbUrl(kind, activeId, SIM_ASSET_SERVERS[0]),
  };
}

/**
 * 设置视图里的一行「当前选择」（票 56 Q6=P1）：缩略 + 显示名 + 「更换」。
 * 格子不在这层画 —— 33 个包塞进设置列表会造成嵌套滚动（滚轮被网格吃掉，见票 56 追加症状）。
 */
function SimPackRow({
  kind, label, value, buttonRef, onOpen,
}: {
  kind: SimAssetPackKind;
  /** 行标签（UI 文案：「背景」/「轨道」） */
  label: string;
  value: string;
  /** 「更换」钮的 ref（从选择器返回时把焦点还给它） */
  buttonRef?: (el: HTMLButtonElement | null) => void;
  onOpen: () => void;
}) {
  const { packs, display, thumb } = packDisplayInfo(kind, value);
  // 读不到图（404 / 快照没摆）→ 那一格降级成只有名字；换包后按新 URL 重新尝试
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  // 清单为空（这类素材一个包都没取到）→ 整行不出现（列表即真相，不占"缺失"位）
  if (packs.length === 0) return null;
  const showThumb = thumb !== null && thumb !== brokenSrc;

  return (
    <div className="pdp__row pdp__row--stack">
      <div className="pdp__row-text"><strong>{label}</strong></div>
      <div className="pdp__pack-current">
        {showThumb ? (
          <img
            className="pdp__pack-current-thumb"
            src={thumb}
            alt=""
            onError={() => setBrokenSrc(thumb)}
          />
        ) : (
          <span className="pdp__pack-current-thumb is-empty" aria-hidden="true" />
        )}
        <span className="pdp__pack-current-name" title={display}>{display}</span>
        <button
          ref={buttonRef}
          type="button"
          className="action-btn pdp__pack-change"
          aria-label={t('preview.display.pack.changeNamed', { name: label })}
          onClick={onOpen}
        >
          {t('preview.display.pack.change')}
        </button>
      </div>
    </div>
  );
}

/**
 * 素材包缩略图网格（**只出现在二级选择器视图**，票 56 Q6=P1）：
 * 一列不再自带滚动 —— 由面板统一滚，滚轮不会被网格截走。
 *
 * **列表即真相**：只渲染清单里实际取到的包；选中的 ID 不在清单里时高亮跟随归一化结果
 * （回落默认 `skin00`），不弹错、不占"缺失"行。
 */
function SimPackGrid({
  kind, full, value, onChange, onHover,
}: {
  kind: SimAssetPackKind;
  /** 全称（分组 aria-label 用：表演背景 / 场地皮肤包） */
  full: string;
  value: string;
  onChange: (packId: string) => void;
  /** hover / focus 到某一格（大预览用；null = 离开） */
  onHover?: (packId: string | null) => void;
}) {
  const { packs, activeId } = packDisplayInfo(kind, value);
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  if (packs.length === 0) return null;

  return (
    <div
      className={`pdp__pack-grid pdp__pack-grid--${kind}`}
      role="group"
      aria-label={full}
      onMouseLeave={() => onHover?.(null)}
    >
      {packs.map((pack) => {
        const thumb = simAssetPackThumbUrl(kind, pack.id, SIM_ASSET_SERVERS[0]);
        const display = simPackDisplayName(pack, kind);
        return (
          <button
            key={pack.id}
            type="button"
            className={`pdp__pack-item${pack.id === activeId ? ' is-active' : ''}`}
            aria-pressed={pack.id === activeId}
            title={display}
            onMouseEnter={() => onHover?.(pack.id)}
            onFocus={() => onHover?.(pack.id)}
            onBlur={() => onHover?.(null)}
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
            <span className="pdp__pack-id">{display}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * hover / focus 大预览（票 56 Q1=D）：**浮在面板左侧**（面板贴右缘 ⇒ 左侧就是仿真场），
 * 不占面板版面；一张 canvas 随 hover 的那一格重画，不缓存 33 张。
 *
 * 画面 = 场地三层（背景 → 轨道 → 判定线），几何与层序直接复用 `drawFieldLayers` ——
 * "看着画面挑"必须与正片同源（背景用当前选中的背景包，轨道用 hover 的包；反之亦然）。
 * 亮度（票 43）也照当前设置压，所见即所得。
 */
function SimPackPreview({
  kind, packId, name, bgPackId, fieldPackId, brightness, panel,
}: {
  kind: SimAssetPackKind;
  packId: string;
  /** 该包的显示名（浮层底部那行小字） */
  name: string;
  bgPackId: string;
  fieldPackId: string;
  brightness: number;
  /** 面板的 fixed 位置（大预览贴它左侧） */
  panel: { top: number; left: number };
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** 同一批 URL 不重复 new Image（浏览器 HTTP 缓存之外再省一层解码） */
  const imagesRef = useRef(new Map<string, HTMLImageElement>());
  const pos = packPreviewLayout(panel);
  const urls = useMemo(
    () => simAssetUrls(SIM_ASSET_SERVERS[0], {
      field: kind === 'field' ? packId : fieldPackId,
      background: kind === 'background' ? packId : bgPackId,
    }),
    [kind, packId, bgPackId, fieldPackId],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    const cache = imagesRef.current;
    // 切换高亮时不闪：同 URL 复用已解码的图
    const load = (src: string) => {
      const hit = cache.get(src);
      if (hit) return Promise.resolve<HTMLImageElement | null>(hit);
      return loadImageElement(src)
        .then((img) => { cache.set(src, img); return img; })
        .catch(() => null);
    };

    void Promise.all([load(urls.background), load(urls.field), load(urls.playLine)])
      .then(([background, field, playLine]) => {
        if (cancelled) return;
        const dpr = 2;
        canvas.width = PACK_PREVIEW_W * dpr;
        canvas.height = PACK_PREVIEW_H * dpr;
        let ctx: CanvasRenderingContext2D | null = null;
        try {
          ctx = canvas.getContext('2d');
        } catch {
          ctx = null; // jsdom 没有实现 2d 上下文：测试里只弱化预览，不影响选择
        }
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawFieldLayers(
          ctx,
          fieldMetrics(PACK_PREVIEW_W, PACK_PREVIEW_H),
          { background, field, playLine },
          brightness,
        );
      });

    return () => { cancelled = true; };
  }, [urls, brightness]);

  return createPortal(
    <div className="pdp__preview" style={{ top: pos.top, left: pos.left }} aria-hidden="true">
      <canvas ref={canvasRef} className="pdp__preview-canvas" />
      <span className="pdp__preview-name">{name}</span>
    </div>,
    document.body,
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
  /** 二级选择器视图（票 56 Q6=P1）：null = 设置视图 */
  const [picker, setPicker] = useState<SimAssetPackKind | null>(null);
  /** 选择器里 hover / focus 的包（大预览用） */
  const [hovered, setHovered] = useState<string | null>(null);
  const btnRef = useRef<HTMLSpanElement>(null);
  /** 面板自身（切换视图时把滚动位置归零：设置视图滚过一段后进选择器不该从半截开始） */
  const panelRef = useRef<HTMLDivElement>(null);
  /** 「更换」钮的 ref：从选择器返回时把焦点还给它（Esc / 返回两条路） */
  const rowRefs = useRef<Partial<Record<SimAssetPackKind, HTMLButtonElement | null>>>({});
  const pendingRowFocus = useRef<SimAssetPackKind | null>(null);
  /** 刚进选择器：挂载后把焦点送进网格（原「更换」钮已卸载） */
  const pendingPickerFocus = useRef(false);

  const close = useCallback(() => {
    setOpen(false);
    setPicker(null);
    setHovered(null);
  }, []);

  /** 量触发钮定面板位；打开前与开着时窗口伸缩都走它（算式见 panelLayoutFor） */
  const computePos = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const next = panelLayoutFor(btn.getBoundingClientRect());
    // 等值守卫：补测路径会反复调用，几何没变时别平白制造一次重渲
    setPos((prev) => (prev.top === next.top && prev.left === next.left ? prev : next));
  }, []);

  const toggle = useCallback(() => {
    if (open) {
      close();
      return;
    }
    computePos();   // 先量再开：首帧就到位，不出现"先落在旧处再跳一下"
    setPicker(null);
    setHovered(null);
    setOpen(true);
  }, [open, computePos, close]);

  /** 进二级选择器（从设置视图的一行「更换」） */
  const openPicker = useCallback((kind: SimAssetPackKind) => {
    pendingPickerFocus.current = true;
    setPicker(kind);
    setHovered(null);
  }, []);

  /** 从选择器返回设置视图（焦点还给对应行的「更换」钮） */
  const backToSettings = useCallback(() => {
    if (!picker) return;
    pendingRowFocus.current = picker;
    setPicker(null);
    setHovered(null);
  }, [picker]);

  // 选择器整块卸载，不接住焦点会掉到 body：还给对应行的「更换」钮
  useEffect(() => {
    if (!open || picker) return;
    const kind = pendingRowFocus.current;
    if (!kind) return;
    pendingRowFocus.current = null;
    rowRefs.current[kind]?.focus();
  }, [open, picker]);

  // 「更换」钮已卸载，不接住焦点会掉到 body（下一次 Tab 走出弹窗）：
  // 落在当前选中格，空清单落「返回」
  useEffect(() => {
    if (!open || !picker || !pendingPickerFocus.current) return;
    pendingPickerFocus.current = false;
    const panel = panelRef.current;
    const target =
      panel?.querySelector<HTMLButtonElement>('.pdp__pack-item.is-active')
      ?? panel?.querySelector<HTMLButtonElement>('.pdp__back');
    target?.focus();
  }, [open, picker]);

  // 切视图（设置 ↔ 选择器）时面板滚动归零：两块内容高度差很大，沿用旧 scrollTop 会从半截开始
  useEffect(() => {
    if (!open) return;
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }, [open, picker]);

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

  // Esc：选择器视图里先退回设置视图（再按一次才关面板）；设置视图里关面板并把焦点还给触发钮
  // （点面板外由遮罩负责，照 ScopePicker）。焦点给外壳里那枚 `<button>`（外壳只是量尺，不可聚焦）
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (picker) {
        backToSettings();
        return;
      }
      close();
      btnRef.current?.querySelector('button')?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, close, picker, backToSettings]);

  const { display, preview } = settings;
  // 显示名按当前界面语言选服（issue 49）→ 依赖里带 lang：运行中切语言当场换名
  const lang = getActiveUiLanguage();
  const skinName = useMemo(
    () => noteSkinPresetLabel(normalizeNoteSkinSelection(settings.visual?.noteSkin)) ?? t('preview.display.skin.custom'),
    [settings.visual?.noteSkin, lang],
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
            ref={panelRef}
            className="pp-menu__panel is-portaled pdp__panel"
            style={{ top: pos.top, left: pos.left }}
            role="dialog"
            aria-label={t('preview.display.title')}
            // 滚轮滚面板时 hover 的格子会移走（不触发 mouseleave），收起预览
            onScroll={() => { if (hovered) setHovered(null); }}
          >
            {/* 二级选择器视图（票 56 Q6=P1）：整块面板换成网格，**由面板自己滚**（格子不再
                自带限高 / 内滚）⇒ 设置列表里的嵌套滚动与"滚轮被网格吃掉"从结构上消失。 */}
            {picker ? (
              <div className="pdp__picker">
                <div className="pdp__picker-head">
                  <button
                    type="button"
                    className="pdp__back"
                    aria-label={t('preview.display.pack.back')}
                    onClick={backToSettings}
                  >
                    <ChevronLeft size={13} />
                    <span>{t('preview.display.pack.back')}</span>
                  </button>
                  <h3 className="pdp__picker-title">{t(PACK_LABEL_KEYS[picker].label)}</h3>
                </div>
                <SimPackGrid
                  kind={picker}
                  full={t(PACK_LABEL_KEYS[picker].full)}
                  value={picker === 'field' ? preview.fieldPackId : preview.bgPackId}
                  onChange={(packId) => setPreview(
                    picker === 'field' ? { fieldPackId: packId } : { bgPackId: packId },
                  )}
                  onHover={setHovered}
                />
              </div>
            ) : (
              <>
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
                {/* 背景亮度（票 43）：100% = 原图，只向下压暗；只压背景层，不动轨道 / 音符 */}
                <Row label={t('preview.display.bgBrightness')}>
                  <Percent
                    label={t('preview.display.bgBrightness')}
                    value={preview.bgBrightness}
                    min={0}
                    max={100}
                    step={5}
                    onChange={(bgBrightness) => setPreview({ bgBrightness })}
                  />
                </Row>
                {/* 表演背景 / 场地皮肤包（41）：两个独立选择器。设置视图只留一行「当前选择」，
                    格子进二级选择器（票 56 Q6=P1）—— 33 个包塞在设置列表里会形成嵌套滚动，
                    滚轮会被网格吃掉；挑背景仍从本面板进（定案 #4） */}
                <SimPackRow
                  kind="background"
                  label={t(PACK_LABEL_KEYS.background.label)}
                  value={preview.bgPackId}
                  buttonRef={(el) => { rowRefs.current.background = el; }}
                  onOpen={() => openPicker('background')}
                />
                <SimPackRow
                  kind="field"
                  label={t(PACK_LABEL_KEYS.field.label)}
                  value={preview.fieldPackId}
                  buttonRef={(el) => { rowRefs.current.field = el; }}
                  onOpen={() => openPicker('field')}
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
              </>
            )}
          </div>
          {/* hover / focus 大预览（票 56 Q1=D）：浮在面板左侧、不占面板版面；
              画面 = 背景 → 轨道 → 判定线（复用 drawFieldLayers），亮度照当前设置 */}
          {picker && hovered ? (
            <SimPackPreview
              kind={picker}
              packId={hovered}
              name={packDisplayInfo(picker, hovered).display}
              bgPackId={preview.bgPackId}
              fieldPackId={preview.fieldPackId}
              brightness={preview.bgBrightness}
              panel={pos}
            />
          ) : null}
        </>,
        document.body,
      )}
    </div>
  );
}
