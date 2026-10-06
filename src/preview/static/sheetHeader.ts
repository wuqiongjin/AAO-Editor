// 导出图文版的「头部横带」（chart-preview 14；ADR-0016 §7）：导出图 = **封面区 + 信息区 + 谱面区**。
//
// 一律图文版：不管工程有没有封面，导出物都是这条横带 + 下面的面板区；没有封面走占位块
// （工程 id 派生色相的深色渐变，hue 由页面算好传入 —— preview 域不 import 工程域）。
// 横带高 `EXPORT_HEADER_H`（= 289 封面 + 上下各 24），横带以下才是面板（`panelLayout` 的 headerH）。
//
// 信息区字段（`settings.export`，7 项可开关；默认 = 谱面标题 + 难度等级 + BPM）：
//   大字标题 = 谱面标题（未填回落工程名）；副行 = 工程名（与标题重复时去重不画）；
//   指标 chips = 难度等级 / 时长 / 音符数 / BPM / 导出时间（按字段表顺序）。
// 窄图（≤2 面板）：封面自动缩窄（最多占图宽一半，289 封顶），文字走截断 —— 不因图窄而画爆。
//
// 图里恒定深色（导出物是一张独立图片，与界面主题无关，照 `selectionStyle` 的画布配色惯例：
// 独立常量，不接 CSS 设计令牌）。
import { t } from '../../i18n';
import type { ExportFieldSettings } from '../../chart/config/AppSettings';
import { formatTimeCompact } from '../../chart/geometry/TimeFormat';

/** 头部横带高度（CSS px）：289 封面 + 上下各 24 padding。改它要同步复算宽图面积上限（ADR-0016 §7） */
export const EXPORT_HEADER_H = 337;
/** 横带内边距（上 / 下 / 右；封面**贴左缘**，左侧没有 padding） */
export const HEADER_PAD = 24;
/** 封面边长上限（= 横带高 − 上下 padding）：方形裁切，短边居中取满 */
export const HEADER_COVER_MAX = EXPORT_HEADER_H - HEADER_PAD * 2;
/** 封面与文字区之间的间隔 */
export const HEADER_GAP = 24;

/** 图里恒定的深色配色（独立图片，不跟界面主题 / 令牌走） */
const HEADER_BG_TOP = '#1b2130';
const HEADER_BG_BOTTOM = '#0e1119';
const HEADER_TITLE_COLOR = '#f4f6fb';
const HEADER_SUBTITLE_COLOR = 'rgba(232, 238, 250, 0.66)';
const CHIP_BG = 'rgba(255, 255, 255, 0.10)';
const CHIP_BORDER = 'rgba(255, 255, 255, 0.20)';
const CHIP_TEXT_COLOR = '#eef2fa';
/** 无衬线（标题 / 副行）与等宽（指标 chips，读数感）字体链 */
const HEADER_SANS = '"Segoe UI Variable", "Noto Sans CJK SC", "PingFang SC", system-ui, sans-serif';
const HEADER_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const TITLE_PX = 46;
const SUBTITLE_PX = 24;
const CHIP_PX = 20;
const CHIP_H = 46;
const CHIP_GAP = 12;
const CHIP_PAD_X = 18;
/** chips 最多铺两行（再放不下就截掉后面的；窄图下这是常态） */
const CHIP_MAX_ROWS = 2;

/** 信息区输入（页面按「工程 + 谱面 + 设置」组装；preview 域不 import 工程域） */
export interface SheetHeaderInput {
  /** 工程名（null = 没填） */
  projectName: string | null;
  /** 谱面标题（null = 没填，显示回落工程名） */
  chartTitle: string | null;
  /** 难度 + 等级（页面按 `DIFF_SHORT` 惯例算好，如「EXP 32」；null = 没这项） */
  difficulty: string | null;
  /** 谱面时长（秒） */
  durationSeconds: number;
  /** 音符数（口径 = `countChartNotes`） */
  noteCount: number;
  /** 谱面 BPM 值列表（可含负值 = 倒流区；空 = 不显示）。页面口径走 `getBpmEvents`：未写 BPM 的谱
   *  按 ADR-0001 保底读到默认 120 —— 那是它实际的 BPM，照常显示；空 / 全 0 才会没有 chip */
  bpms: readonly number[];
  /** 导出时刻（ms 时间戳；本地时区写到分钟） */
  exportedAt: number;
  /** 信息字段开关（`settings.export`） */
  fields: ExportFieldSettings;
  /** 封面图（null / 空 Blob = 走色相占位块） */
  cover?: Blob | null;
  /** 占位块色相（工程 id 派生） */
  coverHue: number;
}

/** 信息区要画的东西（由输入按字段开关算出；空槽位 = 不画） */
export interface SheetHeaderModel {
  /** 大字标题 */
  title: string | null;
  /** 副行（工程名；与标题重复时去重为 null） */
  subtitle: string | null;
  /** 指标 chips（顺序 = 字段表顺序） */
  chips: string[];
}

const trimmed = (s: string | null | undefined): string | null => {
  const v = s?.trim();
  return v ? v : null;
};

/** 千位分组（手搓，不赌运行环境 ICU 的 `toLocaleString`） */
function groupThousands(n: number): string {
  return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** BPM 读数：整数原样、小数最多两位（谱面 BPM 可以是小数） */
function formatBpm(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

/**
 * BPM 摘要（用户 2026-10-06 定案口径）：多条取**绝对值**的 min–max（倒流区的负 BPM 按速度读，
 * 如 "120–240"），单条只写一个值；没有有效值（空 / 全 0 / 非有限）→ null。
 * 只出**区间文本**，套 i18n 外壳（"BPM …"）在 `buildSheetHeaderModel` 里、与其它 chips 同一处。
 */
export function bpmRangeText(bpms: readonly number[]): string | null {
  const values = bpms.filter((v) => Number.isFinite(v) && v !== 0).map((v) => Math.abs(v));
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? formatBpm(min) : `${formatBpm(min)}–${formatBpm(max)}`;
}

/** 导出时刻（本地时区，写到分钟，如 2026-10-06 21:30） */
export function formatExportStamp(ms: number): string {
  const d = new Date(Number.isFinite(ms) ? ms : 0);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 输入 → 信息区模型（字段开关 / 回落 / 去重 / 格式化都在这里，画图与单测共用一份）。
 * - 大字标题：`chartTitle` 开 → 谱面标题 ?? 工程名；关而 `projectName` 开 → 工程名顶上标题位；
 * - 副行：`projectName` 开、且工程名与标题不同才画（"谱面标题未填回落工程名"时自动去重）。
 */
export function buildSheetHeaderModel(input: SheetHeaderInput): SheetHeaderModel {
  const name = trimmed(input.projectName);
  const chartTitle = trimmed(input.chartTitle);
  const { fields } = input;
  const title = fields.chartTitle
    ? (chartTitle ?? name)
    : (fields.projectName ? name : null);
  const subtitle = fields.projectName && name && name !== title ? name : null;

  const chips: string[] = [];
  if (fields.difficulty && input.difficulty) chips.push(input.difficulty);
  if (fields.duration) {
    chips.push(t('preview.export.chip.duration', { time: formatTimeCompact(input.durationSeconds) }));
  }
  if (fields.noteCount) {
    chips.push(t('preview.export.chip.notes', { count: groupThousands(input.noteCount) }));
  }
  if (fields.bpm) {
    const range = bpmRangeText(input.bpms);
    if (range) chips.push(t('preview.export.chip.bpm', { range }));
  }
  if (fields.exportedAt) {
    chips.push(t('preview.export.chip.exportedAt', { time: formatExportStamp(input.exportedAt) }));
  }
  return { title, subtitle, chips };
}

/** 一行文字放不下就截断加省略号（窄图下的文字截断；空串 = 一个字符都放不下） */
export function truncateText(text: string, maxW: number, measure: (s: string) => number): string {
  if (maxW <= 0 || text.length === 0) return '';
  if (measure(text) <= maxW) return text;
  let cut = text;
  while (cut.length > 0 && measure(`${cut}…`) > maxW) cut = cut.slice(0, -1);
  return cut.length > 0 ? `${cut}…` : '';
}

// ---------------------------------------------------------------- 版式

export interface SheetHeaderMetrics {
  /** 封面条边长（方形裁切；窄图自动缩窄） */
  coverSize: number;
  /** 内边距（上 / 下 / 右） */
  pad: number;
  /** 封面与文字区间隔 */
  gap: number;
  /** 文字区左缘 / 可用宽（窄图下可能很小 —— 文字走截断） */
  textX: number;
  textW: number;
}

/** 横带版式：封面最多占图宽一半、289 封顶（≤2 面板的窄图自动缩窄，文字区跟着变窄） */
export function sheetHeaderMetrics(sheetW: number): SheetHeaderMetrics {
  const width = Number.isFinite(sheetW) ? Math.max(0, Math.floor(sheetW)) : 0;
  const coverSize = Math.max(0, Math.min(HEADER_COVER_MAX, Math.floor(width / 2)));
  const textX = coverSize + (coverSize > 0 ? HEADER_GAP : 0);
  return {
    coverSize,
    pad: HEADER_PAD,
    gap: HEADER_GAP,
    textX,
    textW: Math.max(0, width - textX - HEADER_PAD),
  };
}

/** 一枚 chip 的落点（CSS px） */
export interface ChipBox {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * chips 流式排布（底对齐、最多两行）：放不下图宽的单枚跳过，行放满换行，超过两行的截掉。
 * 纯计算（`measure` 注入），画图与单测共用。
 */
export function layoutChips(
  chips: readonly string[],
  measure: (s: string) => number,
  textX: number,
  textW: number,
  bottom: number,
): ChipBox[] {
  if (textW <= 0) return [];
  const rows: { text: string; w: number }[][] = [];
  let cur: { text: string; w: number }[] = [];
  let used = 0;
  for (const text of chips) {
    const w = Math.ceil(measure(text)) + CHIP_PAD_X * 2;
    if (w > textW) continue;
    const need = cur.length === 0 ? w : w + CHIP_GAP;
    if (cur.length > 0 && used + need > textW) {
      rows.push(cur);
      cur = [];
      used = 0;
    }
    cur.push({ text, w });
    used += cur.length === 1 ? w : w + CHIP_GAP;
    if (rows.length >= CHIP_MAX_ROWS) break;
  }
  if (cur.length > 0 && rows.length < CHIP_MAX_ROWS) rows.push(cur);

  const total = rows.length > 0 ? rows.length * CHIP_H + (rows.length - 1) * CHIP_GAP : 0;
  const out: ChipBox[] = [];
  let y = bottom - total;
  for (const row of rows) {
    let x = textX;
    for (const c of row) {
      out.push({ text: c.text, x, y, w: c.w, h: CHIP_H });
      x += c.w + CHIP_GAP;
    }
    y += CHIP_H + CHIP_GAP;
  }
  return out;
}

// ---------------------------------------------------------------- 画图

export interface SheetHeaderDraw {
  /** 整张图逻辑宽（= `plan.sheetW`） */
  sheetW: number;
  model: SheetHeaderModel;
  /** 已解码的封面（null = 占位块） */
  cover: CanvasImageSource | null;
  /** 占位块色相 */
  coverHue: number;
}

/** 画整条头部横带（深色底 + 封面（或占位块）+ 标题 / 副行 / chips） */
export function drawSheetHeader(ctx: CanvasRenderingContext2D, p: SheetHeaderDraw): void {
  const { sheetW, model } = p;
  if (!(sheetW > 0)) return;
  const m = sheetHeaderMetrics(sheetW);

  const bg = ctx.createLinearGradient(0, 0, 0, EXPORT_HEADER_H);
  bg.addColorStop(0, HEADER_BG_TOP);
  bg.addColorStop(1, HEADER_BG_BOTTOM);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, sheetW, EXPORT_HEADER_H);

  if (m.coverSize > 0) drawCover(ctx, m, p.cover, p.coverHue);
  if (m.textW > 0) drawInfo(ctx, model, m);
}

/** 封面：方形裁切（短边居中取满）画进左上角；无封面（或图坏了）露底下的色相占位块 */
function drawCover(ctx: CanvasRenderingContext2D, m: SheetHeaderMetrics, cover: CanvasImageSource | null, hue: number): void {
  const size = m.coverSize;
  const x = 0;
  const y = m.pad;
  const h = ((hue % 360) + 360) % 360;
  const placeholder = ctx.createLinearGradient(x, y, x + size, y + size);
  placeholder.addColorStop(0, `hsl(${h}, 42%, 34%)`);
  placeholder.addColorStop(1, `hsl(${(h + 36) % 360}, 42%, 17%)`);
  ctx.fillStyle = placeholder;
  ctx.fillRect(x, y, size, size);

  if (!cover) return;
  const iw = Number((cover as { width?: number }).width ?? 0);
  const ih = Number((cover as { height?: number }).height ?? 0);
  if (!(iw > 0 && ih > 0)) return;
  const side = Math.min(iw, ih);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cover, (iw - side) / 2, (ih - side) / 2, side, side, x, y, size, size);
}

/** 文字区：大字标题 / 副行（顶部锚定）+ 指标 chips（底对齐、两行封顶） */
function drawInfo(ctx: CanvasRenderingContext2D, model: SheetHeaderModel, m: SheetHeaderMetrics): void {
  const measure = (s: string) => ctx.measureText(s).width;
  ctx.save();
  ctx.textBaseline = 'top';

  if (model.title) {
    ctx.fillStyle = HEADER_TITLE_COLOR;
    ctx.font = `700 ${TITLE_PX}px ${HEADER_SANS}`;
    ctx.fillText(truncateText(model.title, m.textW, measure), m.textX, m.pad + 6);
  }
  if (model.subtitle) {
    ctx.fillStyle = HEADER_SUBTITLE_COLOR;
    ctx.font = `500 ${SUBTITLE_PX}px ${HEADER_SANS}`;
    ctx.fillText(truncateText(model.subtitle, m.textW, measure), m.textX, m.pad + 78);
  }

  const bottom = EXPORT_HEADER_H - m.pad;
  ctx.font = `600 ${CHIP_PX}px ${HEADER_MONO}`;
  for (const box of layoutChips(model.chips, measure, m.textX, m.textW, bottom)) {
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, box.h / 2);
    ctx.fillStyle = CHIP_BG;
    ctx.fill();
    ctx.strokeStyle = CHIP_BORDER;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = CHIP_TEXT_COLOR;
    ctx.textBaseline = 'middle';
    ctx.fillText(box.text, box.x + CHIP_PAD_X, box.y + box.h / 2 + 1);
    ctx.textBaseline = 'top';
  }
  ctx.restore();
}

/**
 * 解码封面（`createImageBitmap`；浏览器不支持的极老环境回 null → 走占位块）。
 * 出图是一次性的（没有"下一帧补上"的机会），所以这里 await 到位再画。
 */
export async function loadCoverImage(cover: Blob | null | undefined): Promise<ImageBitmap | null> {
  if (!cover || cover.size === 0) return null;
  if (typeof createImageBitmap !== 'function') return null;
  try {
    return await createImageBitmap(cover);
  } catch {
    return null;
  }
}