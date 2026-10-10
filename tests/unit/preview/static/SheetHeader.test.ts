// chart-preview 14 · 导出图文版的头部横带（纯函数）：版式 / 字段开关与回落 / BPM 口径 / chips 排布 / 截断。
//
// 出图（drawSheetHeader）只做"照单执行"：模型与几何都在纯函数里算好，本文件锁的就是这份单子；
// 像素级观感走真机核对（票面验收点），不在这里赌 canvas mock。
import { describe, expect, it, vi } from 'vitest';
import { t } from '@/src/i18n';
import { DEFAULT_EXPORT_FIELDS, type ExportFieldSettings } from '@/src/chart/config/AppSettings';
import {
  EXPORT_HEADER_H,
  HEADER_COVER_MAX,
  bpmRangeText,
  buildSheetHeaderModel,
  formatExportStamp,
  layoutChips,
  layoutInfoStack,
  loadCoverImage,
  sheetHeaderMetrics,
  truncateText,
  type HeaderChip,
  type SheetHeaderInput,
} from '@/src/preview/static/sheetHeader';

/** `DIFF_COLORS[3]`（EX）—— 难度 chip 的颜色由页面传入，preview 域不 import 工程域 */
const DIFF_EX_COLOR = '#ff3e40';

/** 全关 → 只开指定项（默认档另有断言） */
function fields(open: Partial<ExportFieldSettings> = {}): ExportFieldSettings {
  return { ...DEFAULT_EXPORT_FIELDS, projectName: false, chartTitle: false, difficulty: false, bpm: false, ...open };
}

/** 一份齐全的输入（测哪项就覆盖哪项） */
function input(over: Partial<SheetHeaderInput> = {}): SheetHeaderInput {
  return {
    projectName: 'My Project',
    chartTitle: 'My Chart',
    difficulty: 'EXP 32',
    difficultyColor: DIFF_EX_COLOR,
    durationSeconds: 90,
    noteCount: 1234,
    bpms: [120],
    exportedAt: new Date(2026, 9, 6, 21, 30).getTime(),
    fields: fields(),
    cover: null,
    coverHue: 200,
    ...over,
  };
}

describe('chart-preview 14 · 头部横带常量与版式', () => {
  it('横带高 440 = 392 封面 + 上下各 24（2026-10-06 版式整改；改它要同步复算宽图面积上限）', () => {
    expect(EXPORT_HEADER_H).toBe(440);
    expect(HEADER_COVER_MAX).toBe(392);
  });

  it('宽图（392 封面 + 32 间隔 + 24 右缘）；封面最多占图宽一半、392 封顶', () => {
    const wide = sheetHeaderMetrics(5_491);              // 19 面板（3 分钟谱）
    expect(wide.coverSize).toBe(392);
    expect(wide.pad).toBe(24);
    expect(wide.gap).toBe(32);
    expect(wide.textX).toBe(392 + 32);                   // 封面贴左缘：文字区 = 封面 + 间隔
    expect(wide.textW).toBe(5_491 - 424 - 24);

    const twoPanels = sheetHeaderMetrics(578);           // 2 面板恰为 578：封面缩到图宽一半 289
    expect(twoPanels.coverSize).toBe(289);
    expect(twoPanels.textX).toBe(289 + 32);
    expect(twoPanels.textW).toBe(578 - 321 - 24);

    const narrow = sheetHeaderMetrics(289);              // 窄图：封面缩到 144（图宽一半）
    expect(narrow.coverSize).toBe(144);
    expect(narrow.textX).toBe(144 + 32);
    expect(narrow.textW).toBe(289 - 176 - 24);

    expect(sheetHeaderMetrics(0)).toMatchObject({ coverSize: 0, textX: 0, textW: 0 });
    expect(sheetHeaderMetrics(Number.NaN)).toMatchObject({ coverSize: 0, textX: 0, textW: 0 });
  });

  it('BPM 口径（用户 2026-10-06 定案）：多条取绝对值 min–max、单条只写一个值、无有效值不给', () => {
    expect(bpmRangeText([120])).toBe('120');
    expect(bpmRangeText([240, 120.5])).toBe('120.5–240');
    // 倒流区的负 BPM 按速度读（绝对值），小数最多两位
    expect(bpmRangeText([-240, 120.333])).toBe('120.33–240');
    expect(bpmRangeText([])).toBeNull();
    expect(bpmRangeText([0])).toBeNull();
    expect(bpmRangeText([Number.NaN, Number.POSITIVE_INFINITY])).toBeNull();
  });

  it('导出时刻写到分钟（本地时区）', () => {
    expect(formatExportStamp(new Date(2026, 9, 6, 21, 30).getTime())).toBe('2026-10-06 21:30');
    expect(formatExportStamp(new Date(2026, 0, 2, 3, 4).getTime())).toBe('2026-01-02 03:04');
  });
});

describe('chart-preview 14 · 信息区模型（字段开关 / 回落 / 去重）', () => {
  it('默认档（谱面标题 + 难度等级 + BPM）：大字标题 = 谱面标题，副行去重不画', () => {
    const model = buildSheetHeaderModel(input({ fields: DEFAULT_EXPORT_FIELDS }));
    expect(model).toEqual({
      title: 'My Chart',
      subtitle: null,                                   // 工程名默认关
      chips: [
        { text: 'EXP 32', accent: DIFF_EX_COLOR },      // 难度 = 传进来的难度色
        { text: t('preview.export.chip.bpm', { range: '120' }), accent: '#fcd34d' },
      ],
    });
  });

  it('谱面标题未填 → 回落工程名；工程名与标题重复时副行自动去重', () => {
    const fallback = buildSheetHeaderModel(input({
      chartTitle: null,
      fields: fields({ chartTitle: true, projectName: true }),
    }));
    expect(fallback.title).toBe('My Project');
    expect(fallback.subtitle).toBeNull();

    const sameName = buildSheetHeaderModel(input({
      chartTitle: 'My Project',
      fields: fields({ chartTitle: true, projectName: true }),
    }));
    expect(sameName).toEqual({ title: 'My Project', subtitle: null, chips: [] });

    const different = buildSheetHeaderModel(input({ fields: fields({ chartTitle: true, projectName: true }) }));
    expect(different).toEqual({ title: 'My Chart', subtitle: 'My Project', chips: [] });
  });

  it('谱面标题关而工程名开 → 工程名顶上标题位（不留空槽）', () => {
    const model = buildSheetHeaderModel(input({ fields: fields({ projectName: true }) }));
    expect(model).toEqual({ title: 'My Project', subtitle: null, chips: [] });
  });

  it('全关 / 空串 / 空白 → 一个槽位都不画', () => {
    expect(buildSheetHeaderModel(input({ fields: fields() }))).toEqual({ title: null, subtitle: null, chips: [] });
    expect(buildSheetHeaderModel(input({
      projectName: '  ', chartTitle: '', fields: fields({ chartTitle: true, projectName: true }),
    }))).toEqual({ title: null, subtitle: null, chips: [] });
  });

  it('chips 顺序 = 难度 → 时长 → 音符数 → BPM → 导出时间（全开时逐项在场，各带自己的重音色）', () => {
    const model = buildSheetHeaderModel(input({ fields: { ...fields(), difficulty: true, duration: true, noteCount: true, bpm: true, exportedAt: true } }));
    expect(model.chips).toEqual([
      { text: 'EXP 32', accent: DIFF_EX_COLOR },
      { text: t('preview.export.chip.duration', { time: '1:30' }), accent: '#7dd3fc' },
      { text: t('preview.export.chip.notes', { count: '1,234' }), accent: '#c4b5fd' },
      { text: t('preview.export.chip.bpm', { range: '120' }), accent: '#fcd34d' },
      { text: t('preview.export.chip.exportedAt', { time: '2026-10-06 21:30' }), accent: '#94a3b8' },
    ]);
  });

  it('难度 chip 用页面传进来的难度色；没传（老数据 / 空串）回落默认字色', () => {
    const model = buildSheetHeaderModel(input({ difficultyColor: '#3464fc', fields: fields({ difficulty: true }) }));
    expect(model.chips).toEqual([{ text: 'EXP 32', accent: '#3464fc' }]);   // EZ 蓝
    expect(buildSheetHeaderModel(input({ difficultyColor: null, fields: fields({ difficulty: true }) })).chips[0]?.accent).toBe('#eef2fa');
    expect(buildSheetHeaderModel(input({ difficultyColor: '  ', fields: fields({ difficulty: true }) })).chips[0]?.accent).toBe('#eef2fa');
  });

  it('缺数据项开也不画：难度 / 等级没填不冒出空 chip；BPM 无有效值不画', () => {
    const model = buildSheetHeaderModel(input({
      difficulty: null, bpms: [], fields: fields({ difficulty: true, bpm: true }),
    }));
    expect(model.chips).toEqual([]);
  });

  it('音符数千位分隔用 ASCII 逗号（不赌 ICU）', () => {
    const model = buildSheetHeaderModel(input({ noteCount: 1234567, fields: fields({ noteCount: true }) }));
    expect(model.chips).toEqual([{ text: t('preview.export.chip.notes', { count: '1,234,567' }), accent: '#c4b5fd' }]);
  });
});

describe('chart-preview 14 · 文字截断与 chips 排布', () => {
  /** 等宽桩：每字符 10px（够表达"放不下 → 截断"这件事） */
  const measure = (s: string) => s.length * 10;

  it('truncateText：放得下原样、放不下截到省略号、一分宽都不给就空串', () => {
    expect(truncateText('abc', 30, measure)).toBe('abc');
    expect(truncateText('abcdef', 30, measure)).toBe('ab…');       // 'ab…' = 30
    expect(truncateText('abcdef', 20, measure)).toBe('a…');        // 只剩一位字符 + 省略号
    expect(truncateText('abcdef', 10, measure)).toBe('');           // 连"字符 + 省略号"都放不下
    expect(truncateText('abcdef', 0, measure)).toBe('');
    expect(truncateText('', 100, measure)).toBe('');
  });

  it('chips 流式排布：等距同行、放不下换行、超两行截掉、单枚超宽跳过、底对齐', () => {
    // 每枚 = len×10 + 56（两侧 28 padding）；GAP 16、H 72
    const chips = ['aa', 'bb', 'cc'].map((text) => ({ text, accent: '#eef2fa' }));
    const oneRow = layoutChips(chips, measure, 100, 300, 300);
    expect(oneRow.map((c) => ({ x: c.x, y: c.y }))).toEqual([
      { x: 100, y: 300 - 72 },        // 单行底对齐：y = bottom − 72
      { x: 100 + 76 + 16, y: 300 - 72 },
      { x: 100 + (76 + 16) * 2, y: 300 - 72 },
    ]);
    expect(oneRow.every((c) => c.w === 76 && c.h === 72)).toBe(true);

    // 宽 200：一行只放 2 枚（76 + 16 + 76 = 168 ≤ 200），4 枚 → 两行、底对齐
    const twoRows = layoutChips(chips.concat({ text: 'dd', accent: '#eef2fa' }), measure, 0, 200, 300);
    expect(twoRows).toHaveLength(4);
    expect(twoRows.map((c) => c.y)).toEqual([140, 140, 228, 228]);   // 300 − (72×2 + 16)
    expect(twoRows[2]).toMatchObject({ x: 0, y: 228 });
    expect(twoRows[3]).toMatchObject({ x: 92, y: 228 });

    // 超两行截掉：宽 100 一行只放 1 枚 → 5 枚只留前两行的 2 枚
    const five = ['aa', 'bb', 'cc', 'dd', 'ee'].map((text) => ({ text, accent: '#eef2fa' }));
    expect(layoutChips(five, measure, 0, 100, 300)).toHaveLength(2);

    // 单枚超宽整枚跳过（不截断 chip 文本），后面的照排
    const skipped = layoutChips([{ text: 'a'.repeat(40), accent: '#eef2fa' }, { text: 'aa', accent: '#eef2fa' }], measure, 0, 300, 300);
    expect(skipped.map((c) => c.text)).toEqual(['aa']);
    // 落点带上各自的 accent（画图要用它描边 / 写字）
    expect(skipped[0]?.accent).toBe('#eef2fa');

    expect(layoutChips(chips, measure, 0, 0, 300)).toEqual([]);   // 没有文字区 → 不画
  });
});

describe('chart-preview 14 · 信息区竖直排布（2026-10-06 版式整改）', () => {
  // 内容区 = 440 − 上下各 24 = 392；行盒：标题 132 / 副行 48；间隙：标题→副行 16、副行→chips 36；chip 行 72
  const model = (title: string | null, subtitle: string | null) => ({ title, subtitle, chips: [] as HeaderChip[] });

  it('三槽位齐 + chips 一行：整体垂直居中（上下各留 44 空白，不再是旧档的 141 px 空档）', () => {
    const box = layoutInfoStack(model('标题', '工程名'), [[]]);
    expect(box.titleY).toBe(68);                      // 24 + (392 − 304) / 2
    expect(box.subtitleY).toBe(216);                  // 68 + 132 + 16
    expect(box.chipsBottom).toBe(372);                // 216 + 48 + 36 + 72 ≤ 内容区底 416
  });

  it('最满（chips 两行）：恰好吃满内容区，不越界去咬 padding', () => {
    const box = layoutInfoStack(model('标题', '工程名'), [[], []]);
    expect(box.titleY).toBe(24);                      // 没有余量可居中 → 顶部锚定
    expect(box.subtitleY).toBe(172);
    expect(box.chipsBottom).toBe(416);                // = 440 − 24（内容区底边，正好是分界线以上）
  });

  it('只有标题时居中；空槽位不占位也不给坐标', () => {
    const only = layoutInfoStack(model('标题', null), []);
    expect(only).toEqual({ titleY: 154, subtitleY: null, chipsBottom: null });

    expect(layoutInfoStack(model(null, null), [])).toEqual({ titleY: null, subtitleY: null, chipsBottom: null });
  });
});

describe('chart-preview 14 · 封面解码', () => {
  it('无封面 / 空 Blob 直接 null（走占位块）', async () => {
    expect(await loadCoverImage(null)).toBeNull();
    expect(await loadCoverImage(undefined)).toBeNull();
    expect(await loadCoverImage(new Blob([]))).toBeNull();
  });

  it('环境没有 createImageBitmap → null（不抛）；有则解码，失败也回 null', async () => {
    const bitmap = { width: 10, height: 10 } as unknown as ImageBitmap;
    const stub = vi.fn(async () => bitmap);
    vi.stubGlobal('createImageBitmap', stub);
    try {
      expect(await loadCoverImage(new Blob([new Uint8Array([1])]))).toBe(bitmap);
      stub.mockRejectedValueOnce(new Error('坏图'));
      expect(await loadCoverImage(new Blob([new Uint8Array([2])]))).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});