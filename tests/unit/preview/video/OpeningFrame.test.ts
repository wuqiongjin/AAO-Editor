// chart-preview 30：视频开场的**四段时间线** + **一帧绘制**。
//
// 为什么单测：这两块都是纯函数（`openingXxxAt(t)` / `drawOpeningFrameAt(ctx, w, h, input, alpha)`），
// 形状能用记录型假 context 钉住；**光栅观感**（装饰像不像官方、过渡好不好看）不归这里，
// 归原型的目视验收 + 用户导一条真视频看。
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPENING_ITEMS,
  OPENING_STACK,
  OPENING_STACK_T,
  OPENING_FADE_IN_SECONDS,
  OPENING_FADE_OUT_SECONDS,
  OPENING_HOLD_SECONDS,
  OPENING_ITEM_IDS,
  OPENING_SECONDS,
  OPENING_STACK_DRIFT_AT,
  OPENING_STACK_DRIFT_SECONDS,
  OPENING_TRACK_IN_AT,
  OPENING_TRACK_IN_SECONDS,
  drawOpeningFieldBackground,
  drawOpeningFrameAt,
  drawOpeningTrack,
  extractCreditLines,
  openingAlphaAt,
  openingItemOrder,
  openingSegmentAt,
  openingStackDriftAt,
  openingStackMetrics,
  openingTrackAlphaAt,
  type OpeningFrameInput,
  type OpeningItemId,
} from '@/src/preview/video/opening';
import { fieldMetrics } from '@/src/preview/video/sim/simGeometry';
import { getActiveUiLanguage, setActiveUiLanguage } from '@/src/i18n';
import { makeRecordingCtx, propValues, type RecordedCall } from '@/tests/support/canvas';

/** 假封面（node 环境没有真图；`drawSquareCover` 只读 width / height） */
const coverStub = () => ({ width: 512, height: 512 }) as unknown as CanvasImageSource;

/** 垫层推到位的露出厚度（1080p）：`OPENING_STACK_T × 位移倍率` —— 2026-10-27 定稿 1.45× */
const STACK_D = Math.round(OPENING_STACK_T * OPENING_STACK.distance * 1080);

function frameInput(over: Partial<OpeningFrameInput> = {}): OpeningFrameInput {
  return {
    title: 'SENSENFUKOKU',
    difficultyName: 'EXPERT',
    difficultyColor: '#ff2f45',
    artist: 'Roselia',
    cover: coverStub(),
    coverHue: 268,
    items: OPENING_ITEM_IDS,
    ...over,
  };
}

const measureTextOk = () => ({
  width: 100,
  actualBoundingBoxLeft: 0,
  actualBoundingBoxRight: 100,
  actualBoundingBoxAscent: 30,
  actualBoundingBoxDescent: 8,
});

const fillRects = (calls: RecordedCall[]) =>
  calls.filter(([k]) => k === 'fillRect').map(([, a]) => a as number[]);

const texts = (calls: RecordedCall[]) =>
  calls.filter(([k]) => k === 'fillText').map(([, a]) => String(a[0]));

describe('chart-preview 30 · 四段时长（用户 2026-10-10 逐段拍板）', () => {
  it('① 1 / ② 2.2 / ③ 1.75 / ④ 1.8 ⇒ 合计 6.75s（2026-10-27 定稿）；④ 起点在 4.95s', () => {
    expect(OPENING_FADE_IN_SECONDS).toBe(1);
    expect(OPENING_HOLD_SECONDS).toBe(2.2);
    expect(OPENING_FADE_OUT_SECONDS).toBe(1.75);
    expect(OPENING_TRACK_IN_SECONDS).toBe(1.8);
    expect(OPENING_SECONDS).toBe(6.75);
    expect(OPENING_TRACK_IN_AT).toBe(4.95);
  });

  it('分段边界', () => {
    expect(openingSegmentAt(0)).toBe('fadeIn');
    expect(openingSegmentAt(0.99)).toBe('fadeIn');
    expect(openingSegmentAt(1.0)).toBe('hold');
    expect(openingSegmentAt(3.19)).toBe('hold');
    expect(openingSegmentAt(3.2)).toBe('fadeOut');
    expect(openingSegmentAt(4.94)).toBe('fadeOut');
    expect(openingSegmentAt(4.95)).toBe('trackIn');
    expect(openingSegmentAt(6.74)).toBe('trackIn');
    expect(openingSegmentAt(6.75)).toBe('sim');
    expect(openingSegmentAt(9.9)).toBe('sim');
  });

  it('票 74 · ④ 之后仍是 sim 段（前导补偿帧由 frameDriver 按负秒取）', () => {
    expect(openingSegmentAt(OPENING_SECONDS - 0.01)).toBe('trackIn');
    expect(openingSegmentAt(OPENING_SECONDS)).toBe('sim');
    expect(openingSegmentAt(OPENING_SECONDS + 1.25)).toBe('sim');
  });
});

describe('chart-preview 30 · 两段 alpha', () => {
  it('开场画面：① 渐显 → ② 恒 1 → ③ 渐隐 → ④ 起不再画', () => {
    expect(openingAlphaAt(0)).toBe(0);
    expect(openingAlphaAt(0.5)).toBeCloseTo(0.5, 5);
    expect(openingAlphaAt(1.0)).toBe(1);
    expect(openingAlphaAt(3.1)).toBe(1);
    expect(openingAlphaAt(4.075)).toBeCloseTo(0.5, 5);
    expect(openingAlphaAt(4.95)).toBe(0);
    expect(openingAlphaAt(5.5)).toBe(0);
  });

  it('轨道层：④ 之前全 0（③ 里只有背景图），④ 里 0 → 1，之后恒 1', () => {
    expect(openingTrackAlphaAt(0)).toBe(0);
    expect(openingTrackAlphaAt(4.94)).toBe(0);
    expect(openingTrackAlphaAt(4.95)).toBe(0);
    expect(openingTrackAlphaAt(5.85)).toBeCloseTo(0.5, 5);
    expect(openingTrackAlphaAt(6.75)).toBeCloseTo(1, 6);
    expect(openingTrackAlphaAt(8)).toBe(1);
  });
});

describe('chart-preview 30 · 一帧绘制', () => {
  it('**整屏 alpha 只有一个 setter**（第七轮 bug 的锁）：只赋值一次、且就是请求值', () => {
    const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
    drawOpeningFrameAt(proxy, 1920, 1080, frameInput(), 0.5);
    // 子层（装饰 / 垫层 / 封面 / 徽章 / 白条 / 艺人行）一律**继承**这个值：
    // 谁在函数级改了不还，后面画的就都不淡了（表现为"只有装饰在淡"）
    expect(propValues(calls, 'globalAlpha')).toEqual([0.5]);
  });

  it('铺满整块画布（开场段是整屏，不是场地矩形）', () => {
    const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
    drawOpeningFrameAt(proxy, 1920, 1080, frameInput(), 1);
    expect(fillRects(calls)[0]).toEqual([0, 0, 1920, 1080]);
  });

  it('装饰在最下、封面在上（先装饰后封面 ⇒ 装饰被封面 / 白条切边）', () => {
    const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
    drawOpeningFrameAt(proxy, 1920, 1080, frameInput(), 1);
    const coverAt = calls.findIndex(([k]) => k === 'drawImage');
    const stackAt = calls.findIndex(([k, a]) => k === 'fillRect' && (a as number[])[2] === STACK_D);
    expect(coverAt).toBeGreaterThan(0);
    expect(stackAt).toBeGreaterThan(0);
    expect(stackAt).toBeLessThan(coverAt);
  });

  it('垫层**只画露出来的 L 形**（第五轮）：不出现一整块纯色方形', () => {
    const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
    drawOpeningFrameAt(proxy, 1920, 1080, frameInput(), 1);
    const stackSize = 486 + STACK_D - 11; // 封面 + t − i
    const full = fillRects(calls).filter((r) => r[2] === stackSize && r[3] === stackSize);
    expect(full).toEqual([]);
  });

  it('信息项按开关出现：全开 = 徽章 / 标题 / 艺人三处文字', () => {
    const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
    drawOpeningFrameAt(proxy, 1920, 1080, frameInput(), 1);
    const t = texts(calls);
    expect(t).toContain('EXPERT');
    expect(t).toContain('SENSENFUKOKU');
    expect(t).toContain('Roselia');
  });

  it('七项全关 ⇒ 只剩封面（不画徽章 / 白条 / 艺人行 / credits，且整块重新垂直居中）', () => {
    const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
    drawOpeningFrameAt(proxy, 1920, 1080, frameInput({ items: [] }), 1);
    expect(texts(calls)).toEqual([]);
    // 白条是"整宽 × 119 高"一条（铺底那一笔是整屏 1080 高，不算）
    const band = fillRects(calls).filter((r) => r[2] === 1920 && r[3] === 119);
    expect(band).toEqual([]);
  });
});

describe('chart-preview 30 · 栈几何（关掉的项不留空位）', () => {
  it('全开 vs 只留封面：栈变矮，且上下留白相等', () => {
    const all = openingStackMetrics(1920, 1080, ['difficulty', 'title', 'artist']);
    const coverOnly = openingStackMetrics(1920, 1080, []);
    expect(coverOnly.bottom - coverOnly.top).toBeLessThan(all.bottom - all.top);
    expect(coverOnly.top).toBeCloseTo(1080 - (coverOnly.bottom - coverOnly.top) - coverOnly.top, 5);
  });

  it('关掉标题 ⇒ 白条不画（bandY 是 NaN），微章 / 艺人行照旧', () => {
    const m = openingStackMetrics(1920, 1080, ['difficulty', 'artist']);
    expect(Number.isNaN(m.bandY)).toBe(true);
    expect(Number.isNaN(m.badgeTop)).toBe(false);
    expect(Number.isNaN(m.artistCy)).toBe(false);
  });

  it('装饰链的 y 是**相对白条上缘**的（改版式时整链跟着白条走，不会浮在半空）', () => {
    const all = openingStackMetrics(1920, 1080, ['difficulty', 'title', 'artist']);
    // 白条位置随"有没有徽章"变 ⇒ 装饰锚点也跟着变（这是相对定位的直接后果）
    const noBadge = openingStackMetrics(1920, 1080, ['title', 'artist']);
    expect(noBadge.bandY).not.toBe(all.bandY);
  });
});

describe('chart-preview 30 · 场地的两层（③ 背景 / ④ 轨道）', () => {
  const imgs = {
    background: coverStub(),
    field: coverStub(),
    playLine: coverStub(),
  };
  const m = fieldMetrics(1334, 750);

  it('③ 只画**表演背景图**：场地图 / 判定线一张都不画', () => {
    const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
    drawOpeningFieldBackground(proxy, m, imgs);
    const drawn = calls.filter(([k]) => k === 'drawImage');
    expect(drawn.length).toBe(1);
    expect(drawn[0][1][0]).toBe(imgs.background);
  });

  it('③ 背景亮度（票 43）：只有背景层压暗，层集合仍是那一张背景图', () => {
    const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
    drawOpeningFieldBackground(proxy, m, imgs, 0.5);
    expect(propValues(calls, 'fillStyle')).toContain('rgba(0, 0, 0, 0.5)');
    expect(calls.filter(([k]) => k === 'drawImage').map(([, a]) => a[0])).toEqual([imgs.background]);
  });

  it('④ 画**整块轨道** = 场地图 + 判定线，两张一起（一张都不能只画判定线）', () => {
    const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
    drawOpeningTrack(proxy, m, imgs, 1);
    const drawn = calls.filter(([k]) => k === 'drawImage');
    expect(drawn.length).toBe(2);
    expect(drawn.map(([, a]) => a[0])).toEqual([imgs.field, imgs.playLine]);
    expect(propValues(calls, 'globalAlpha')).toEqual([1]);
  });

  it('④ 的 alpha 渐显；alpha ≤ 0 时整层不画', () => {
    const half = makeRecordingCtx({ measureText: measureTextOk });
    drawOpeningTrack(half.proxy, m, imgs, 0.5);
    expect(propValues(half.calls, 'globalAlpha')).toEqual([0.5]);

    const zero = makeRecordingCtx({ measureText: measureTextOk });
    drawOpeningTrack(zero.proxy, m, imgs, 0);
    expect(zero.calls.filter(([k]) => k === 'drawImage')).toEqual([]);
  });
});

// 50：堆叠缓出（定案 A 轻推）—— 垫层从封面正后方向右上推出，单层、小位移、缓出曲线
describe('chart-preview 50 · 堆叠 A 轻推', () => {
  it('缓出曲线：0.4s 起推 2.5s 到位（2026-10-27 定稿）；缺省（Infinity）= 已推完', () => {
    expect(OPENING_STACK_DRIFT_AT).toBe(0.4);
    expect(OPENING_STACK_DRIFT_SECONDS).toBe(2.5);
    expect(openingStackDriftAt(0)).toBe(0);
    expect(openingStackDriftAt(0.4)).toBe(0);
    expect(openingStackDriftAt(-1)).toBe(0);
    expect(openingStackDriftAt(1.65)).toBeCloseTo(0.875, 6); // 缓出三次：过半时已推 87.5%
    expect(openingStackDriftAt(2.9)).toBe(1);
    expect(openingStackDriftAt(6.7)).toBe(1);
    expect(openingStackDriftAt(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('没推出来时垫层不画（厚度 0）；推完后顶条露出的厚度 = stackD', () => {
    const m = openingStackMetrics(1920, 1080, [...OPENING_ITEM_IDS], 0, OPENING_STACK.distance);
    const thickness = (seconds?: number) => {
      const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
      if (seconds === undefined) drawOpeningFrameAt(proxy, 1920, 1080, frameInput(), 1);
      else drawOpeningFrameAt(proxy, 1920, 1080, frameInput(), 1, seconds);
      // 顶条：起点在封面左缘之内、y 在封面上方
      const band = fillRects(calls)
        .filter((r) => Math.abs(r[0] - (m.coverX + m.stackInset)) < 1.5 && r[1] < m.top)
        .sort((a, b) => a[1] - b[1])[0];
      return band ? m.top - band[1] : 0;
    };
    expect(thickness(0)).toBe(0);
    expect(thickness(2.9)).toBe(m.stackD);
    expect(thickness()).toBe(m.stackD); // 缺省 = 最终版式（返回类型：number）
  });

});

describe('chart-preview 30 · 信息项的有序列表', () => {
  it('只留开着的项，顺序照 `OPENING_ITEM_IDS`（票 79 起共 7 项）', () => {
    const items = { ...DEFAULT_OPENING_ITEMS, title: false } as Record<OpeningItemId, boolean>;
    expect(openingItemOrder(items)).toEqual([
      'difficulty', 'artist', 'lyricist', 'composer', 'arranger', 'charter',
    ]);
    expect(openingItemOrder({ ...DEFAULT_OPENING_ITEMS })).toEqual([...OPENING_ITEM_IDS]);
  });
});

describe('票 79 · 附加字段逐项 gate + i18n 标签', () => {
  const allCredits = {
    lyricist: '織田あすか',
    composer: '都丸椋太',
    arranger: '堀川大翼',
    charter: 'A、B',
  };

  it('extractCreditLines 只取开着的项；关掉的两行不画也不占位', () => {
    expect(extractCreditLines(allCredits, ['composer', 'charter'])).toEqual([
      '作曲：都丸椋太', '谱师：A、B',
    ]);
    expect(extractCreditLines(allCredits, [])).toEqual([]);
    expect(extractCreditLines(null, [...OPENING_ITEM_IDS])).toEqual([]);
  });

  it('drawOpeningFrameAt：开 2 关 2 只画 2 行，且栈高按 2 行算', () => {
    const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
    drawOpeningFrameAt(proxy, 1920, 1080, frameInput({
      credits: allCredits,
      items: ['difficulty', 'title', 'artist', 'composer', 'charter'],
    }), 1);
    const t = texts(calls).filter((s) => /作词|作曲|编曲|谱师/.test(s));
    expect(t).toEqual(['作曲：都丸椋太', '谱师：A、B']);
  });

  it('联合创作的名字原样一行输出（不解析、不拆行）', () => {
    const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
    drawOpeningFrameAt(proxy, 1920, 1080, frameInput({
      credits: { charter: 'A、B / C' },
      items: [...OPENING_ITEM_IDS],
    }), 1);
    expect(texts(calls).filter((s) => /谱师/.test(s))).toEqual(['谱师：A、B / C']);
  });

  it('英文界面：Lyricist / Composer / Arranger / Charter + 半角冒号空格', () => {
    const prev = getActiveUiLanguage();
    setActiveUiLanguage('en');
    try {
      expect(extractCreditLines(allCredits, [...OPENING_ITEM_IDS])).toEqual([
        'Lyricist: 織田あすか', 'Composer: 都丸椋太', 'Arranger: 堀川大翼', 'Charter: A、B',
      ]);
    } finally {
      setActiveUiLanguage(prev);
    }
  });
});

describe('chart-preview 39 · 可选附加字段（作词/作曲/编曲/谱师）渲染与对齐', () => {
  it('extractCreditLines：按作词/作曲/编曲/谱师顺序提取，空值与纯空白过滤', () => {
    expect(extractCreditLines(null)).toEqual([]);
    expect(extractCreditLines({})).toEqual([]);
    expect(extractCreditLines({ lyricist: '  ', composer: '', arranger: null, charter: undefined })).toEqual([]);

    expect(
      extractCreditLines({
        charter: ' 千石抚子 ',
        lyricist: '織田あすか',
        composer: ' 都丸椋太',
      }),
    ).toEqual(['作词：織田あすか', '作曲：都丸椋太', '谱师：千石抚子']);
  });

  it('未提供 credits 时：不画任何附加字段文字', () => {
    const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
    drawOpeningFrameAt(proxy, 1920, 1080, frameInput({ credits: null }), 1);
    const t = texts(calls);
    expect(t).not.toEqual(expect.arrayContaining([expect.stringMatching(/作词|作曲|编曲|谱师/)]));
  });

  it('提供部分字段时（如仅谱师）：只画谱师行，其余不出现也不占位', () => {
    const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
    drawOpeningFrameAt(proxy, 1920, 1080, frameInput({
      credits: { charter: '千石抚子' },
    }), 1);
    const t = texts(calls);
    expect(t).toContain('谱师：千石抚子');
    expect(t.filter((s) => /作词|作曲|编曲/.test(s))).toEqual([]);
  });

  it('方案 B 首字对齐块居中：多个字段时，首字 X 坐标完全一致（严格垂直对齐）', () => {
    const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
    drawOpeningFrameAt(proxy, 1920, 1080, frameInput({
      credits: {
        lyricist: '織田あすか（Elements Garden）',
        composer: '都丸椋太（Elements Garden）',
        arranger: '都丸椋太（Elements Garden）',
        charter: '千石抚子',
      },
    }), 1);

    // 过滤出 credits 字段绘制的 fillText 调用
    const creditCalls = calls.filter(
      ([k, a]) => k === 'fillText' && /作词|作曲|编曲|谱师/.test(String((a as unknown[])[0])),
    );
    expect(creditCalls.length).toBe(4);

    // 方案 B 不变量：所有 credits 行的 x 坐标必须相同（首字对齐）
    const xPositions = creditCalls.map(([, a]) => (a as number[])[1]);
    expect(new Set(xPositions).size).toBe(1);

    // y 坐标单调递增
    const yPositions = creditCalls.map(([, a]) => (a as number[])[2]);
    for (let i = 1; i < yPositions.length; i++) {
      expect(yPositions[i]).toBeGreaterThan(yPositions[i - 1]);
    }
  });
});

