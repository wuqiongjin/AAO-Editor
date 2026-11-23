// chart-preview 52：结尾段的**定稿参数表** + **一帧绘制**。
//
// 为什么单测：`ENDING_SPEC` 是用户交回的那份参数 JSON 的落码，键名 / 数值都是验收口径 ——
// 谁顺手"调一下更好看"，这里当场红。绘制形状用记录型假 context 钉住（node 环境没有真 canvas）；
// 光栅观感（章好不好看、粒子的层次）归原型目视验收 + 用户导一条真视频看。
import { describe, expect, it, vi } from 'vitest';
import {
  ENDING_RESULT_SECONDS,
  ENDING_SECONDS,
  ENDING_SPEC,
  ENDING_STAMPS,
  ENDING_STAMP_SECONDS,
  ENDING_TRANS_SECONDS,
  endingUnits,
  type EndingAssets,
  type EndingFrameInput,
  type EndingSpec,
} from '@/src/preview/video/ending';
import { drawEndingFrameAt } from '@/src/preview/video/ending/endingFrame';
import { visibleApproach, SIM_SPRITE_EFFECT_DURATION } from '@/src/preview/video/sim/simGeometry';
import type { SimChart } from '@/src/preview/video/sim/simField';
import {
  ENDING_HIT_LIFE_SECONDS,
  endingTailSeconds,
  lastHitSeconds,
} from '@/src/preview/video/encode/exportSpec';
import { makeRecordingCtx, propValues, type RecordedCall } from '@/tests/support/canvas';

const measureTextOk = () => ({ width: 100 });

const fillRects = (calls: RecordedCall[]) =>
  calls.filter(([k]) => k === 'fillRect').map(([, a]) => a as number[]);

const texts = (calls: RecordedCall[]) =>
  calls.filter(([k]) => k === 'fillText').map(([, a]) => String(a[0]));

/** 缺件常态：素材不在安装包里（票 52 Q12） */
const NO_ASSETS: EndingAssets = {
  stampAp: null,
  stampFc: null,
  markAp: null,
  markFc: null,
  judge: null,
  particles: null,
  maxCombo: null,
  badgeAp: null,
  badgeFc: null,
  badgeClear: null,
  rankDisc: null,
  rankLetterSs: null,
  rankRibbon: null,
  scoreMedal: null,
};

/**
 * 假仿真场末帧：只提供 `drawSimFrameAt` 会读到的最小面（`metrics` 全 0 / 空元素表）。
 * 绘制只走一遍"场地三图 + 空表"的分支，图全是 null ⇒ 只剩兜底底色那一笔。
 */
function frameInput(over: Partial<EndingFrameInput> = {}): EndingFrameInput {
  return {
    stamp: 'ap',
    title: 'ヒカリへ',
    difficultyName: 'EXPERT',
    difficultyColor: '#ff3233',
    level: 25,
    cover: { width: 512, height: 512 } as unknown as CanvasImageSource,
    coverHue: 268,
    counts: { perfect: 667, great: 0, good: 0, bad: 0, miss: 0 },
    maxCombo: 667,
    /** 归一最终分（AUTO 全 PERFECT） */
    score: 1_000_000,
    assets: NO_ASSETS,
    stage: {
      seconds: 120,
      x: 0,
      y: 1,
      frame: {
        chart: {
          approachS: 1,
          elements: [],
          bands: [],
          simultaneous: [],
          hitTimes: [],
        } as unknown as EndingFrameInput['stage']['frame']['chart'],
        scene: {} as unknown as EndingFrameInput['stage']['frame']['scene'],
        metrics: {
          w: 1920,
          h: 1078,
          laneW: 0,
          judgeY: 0,
          centerX: 0,
        } as unknown as EndingFrameInput['stage']['frame']['metrics'],
        assets: {
          background: null,
          field: null,
          playLine: null,
          bandColor: '#000',
          bandColorSp: '#000',
          bandMaterial: { bodyAlpha: 0, rimAlpha: 0, rimFrac: 0 },
          bandMaterialSp: { bodyAlpha: 0, rimAlpha: 0, rimFrac: 0 },
          sprites: null,
        } as unknown as EndingFrameInput['stage']['frame']['assets'],
        noteIcons: {} as unknown as EndingFrameInput['stage']['frame']['noteIcons'],
        spriteIcon: {} as unknown as EndingFrameInput['stage']['frame']['spriteIcon'],
      },
    },
    ...over,
  };
}

describe('chart-preview 52 · 定稿参数表（用户 2026-10-26 · 原型 v9）', () => {
  it('三段时长钉死：章 3.0 + 转场 1.55 + 结算 2.95 = 7.5s', () => {
    expect(ENDING_STAMP_SECONDS).toBe(3.0);
    expect(ENDING_TRANS_SECONDS).toBe(1.55);
    expect(ENDING_RESULT_SECONDS).toBe(2.95);
    expect(ENDING_SECONDS).toBe(7.5);
  });

  it('整份 JSON 落码：键名照抄、数值不改（改动即验收口径变更）', () => {
    expect(ENDING_SPEC).toEqual({
      stampDur: 3,
      transDur: 1.55,
      resultDur: 2.95,
      barX: 8.25,
      barY: 12.9,
      // 票 73：顶栏收窄给右上 SCORE RANK 让位
      barW: 74,
      barH: 5.2,
      barR: 0.8,
      starSize: 4,
      starDX: 3.3,
      diffX: 6.5,
      diffH: 3.2,
      diffFont: 2.08,
      diffPadX: 1.45,
      titleX: 18.85,
      titleFont: 3.1,
      titleWeight: 400,
      lvRight: 2.35,
      lvNumFont: 2.35,
      lvLabelFont: 2.35,
      cardRight: 12,
      cardW: 66.7,
      cardTop: 32,
      cardR: 1,
      // 票 73：白卡首行让给 Score 行
      rowFirst: 12,
      rowPitch: 5.9,
      labelH: 4.6,
      labelX: 2.5,
      countRight: 33,
      countFont: 3.6,
      countWeight: 400,
      countDY: 0.7,
      lineInset: 2.25,
      lineLen: 20,
      lineOffset: 2.1,
      padBottom: 3.5,
      comboX: 40,
      // 随 rowFirst 同差值下移，否则 MAX COMBO 压住 Score 行
      comboY: 11.4,
      comboW: 20,
      comboH: 18.2,
      comboDark: 0.575,
      comboFont: 3,
      comboValueFont: 3.6,
      apH: 5,
      apGap: 4.05,
      apDX: 0.1,
      coverSize: 45,
      coverX: 21.2,
      coverY: 50,
      coverFrame: 0.3,
      coverShadow: 0.45,
      // 2026-11-23 第四轮：整块半屏氛围色判为"污染" ⇒ 改卡后柔光；用户原型对比后定档 25 / 1.15
      bgWash: 25,
      bgGlowSize: 1.15,
      stampW: 62.2,
      stampY: 50.5,
      stampIn: 1.3,
      stampOut: 0.25,
      partCount: 65,
      partSize: 3.5,
      partSpeed: 1,
      palette: 'cycle',
      burst2At: 26,
      burst2X: 34,
      burst2Y: 62,
      burst3At: 32,
      burst3X: 66,
      burst3Y: 36,
      burst4At: 52,
      burst4Points: 4,
      burst5At: 66,
      burst5Points: 5,
      wordGlow: 0,
      // 2026-10-28 追加：中央章逐字母入场 + `!` 下的星标（时间类除 ghost/land 的秒数外都是 %stampIn）
      letterSpan: 50,
      letterDur: 0.2,
      letterDrop: 32,
      letterBounce: 0,
      letterInAlpha: 0.5,
      starAt: 7,
      starGrow: 35,
      starHold: 0,
      starFly: 40,
      starBig: 3,
      starSpin: 90,
      ghostAlpha: 0.7,
      ghostGrow: 10,
      ghostSpin: 50,
      ghostTint: 'auto',
      ghostDur: 0.55,
      landGrow: 2.3,
      landAlpha: 0.55,
      landDur: 0.4,
      landPulses: 1,
      // 2026-10-27 追加：舞台两层各自淡出（秒，相对结尾段起点）
      comboFadeAt: 0,
      comboFadeDur: 0,
      trackFadeAt: 0,
      trackFadeDur: 1,
      // 2026-11-07（票 55，第三轮默认值 = 用户交回的调参 JSON）
      markApScale: 0.88,
      markFcScale: 1,
      burstC1: '#ffe27a',
      burstC2: '#8fe9ff',
      burstC3: '#ff9fd2',
      burstC4: '#9dffc4',
      burstC5: '#ffffff',
      burstWaveCount: 6,
      burstStagger: 0.075,
      burstDensity: 1,
      partLife: 1.05,
      partFadePow: 0.85,
      burstScatterX: 33.5,
      burstScatterY: 30,
      burstJitter: 0.28,
      burst6At: 78,
      burst6Points: 2,
      clearBurst: 1,
      bangAt: -0.2,
      bangWipe: 0.22,
      bangSettle: 0.46,
      bangFromX: 6,
      bangFromY: 5,
      bangOverX: 1.6,
      bangOverY: 1,
      bangWobble: 9,
      bangWobbles: 2,
      bangDamp: 2.2,
      starSizeRef: 0.37,
      haloOn: 1,
      haloAlpha: 1,
      haloSurvive: 0.3,
      haloGrow: 9,
      haloDarken: 0.9,
      haloRingRadius: 1.65,
      haloRingWidth: 0.9,
      haloRingAlpha: 0.85,
      haloRingStars: 32,
      haloRingStarSize: 6.8,
      haloRingOffset: 0.07,
      haloDiaCount: 24,
      haloDiaSize: 3,
      haloDiaAt: 0.2,
      haloDiaDur: 0.3,
      haloDiaFadeAt: 0,
      haloDiaFade: 0.5,
      haloDiaFrom: 0.35,
      haloDiaTo: 8.5,
      haloDiaLayout: 'ring',
      haloDiaSeed: 135,
      haloDiaJitter: 0.18,
      // 票 73 · Score 行（%H / 卡宽等比；时间键是 %入场轴 q）
      resultFont: 3.15,
      resultScoreFont: 3.7,
      resultPadX: 1.48,
      resultRowH: 8.89,
      resultRowDY: -1.11,
      resultInAt: 24,
      resultInDur: 24,
      // 票 73 · SCORE RANK 徽章（%W，原型按帧宽缩）
      rankSize: 8.125,
      rankRight: 7.8125,
      rankTop: 6.5625,
      rankLetterScale: 0.6,
      ribbonW: 10.4167,
      ribbonBelow: 0.2083,
      rankInAt: 20,
      rankInDur: 20,
      // 票 82 · 徽章三层各自入场（%徽章窗口 / 缩放倍率 / 缎带上浮 %W）
      rankDiscInFrom: 0,
      rankDiscInTo: 55,
      rankDiscScaleFrom: 0.86,
      rankDiscOvershoot: 0.02,
      rankLetterInFrom: 28,
      rankLetterInTo: 100,
      rankLetterScaleFrom: 1.28,
      rankRibbonInFrom: 55,
      rankRibbonInTo: 100,
      rankRibbonRise: 0.3125,
    });
  });

  it('三档形态：ALL PERFECT / FULL COMBO / 普通 Clear（顺序即 UI 顺序）', () => {
    expect(ENDING_STAMPS).toEqual(['ap', 'fc', 'clear']);
  });
});

describe('chart-preview 52 · %H / %W 换算（按帧高缩放，不按场地）', () => {
  it('1920×1080：1%H = 10.8px、1%W = 19.2px', () => {
    const u = endingUnits(1920, 1080);
    expect(u.hp('stampY')).toBeCloseTo(545.4, 5);
    expect(u.wp('stampW')).toBeCloseTo(1194.24, 5);
  });

  it('720p 等比：同一参数按帧高 / 帧宽各缩一半', () => {
    const full = endingUnits(1920, 1080);
    const small = endingUnits(1280, 720);
    expect(small.hp('cardTop') / full.hp('cardTop')).toBeCloseTo(720 / 1080, 6);
    expect(small.wp('barW') / full.wp('barW')).toBeCloseTo(1280 / 1920, 6);
  });
});

// 票 76：HUD 是跨段独立层，结尾段要插在**舞台与烟花之间**：
// 舞台（含轨道 / 音符 / 打击特效）→ HUD → 加色粒子 → 章字样 → 结算 / 黑幕。
// 画在整帧最后会压住烟花，画在舞台之前又会被场地盖掉。
// 票 75：结尾舞台的固定秒要越过最后一击 + 特效寿命，各层按既有窗口自然判空，
// 不给 SimFrameLayers 加 notes / effects alpha，也不做逐层淡出。
describe('票 75 · 结算舞台的秒已越过末击寿命窗口', () => {
  const D = 120;
  const chart = {
    approachS: 1.25,
    elements: [{ time: D }],
    bands: [{ t0: D - 0.5, t1: D }],
    simultaneous: [{ time: D - 0.25 }],
    hitTimes: [D],
  } as unknown as SimChart;
  const stageSeconds = D + endingTailSeconds(chart, D);

  it('stage.seconds > lastHit + 0.6；音符可见窗口已判空（Δ > 0）', () => {
    expect(stageSeconds).toBeGreaterThan(lastHitSeconds(chart)! + SIM_SPRITE_EFFECT_DURATION);
    expect(stageSeconds - lastHitSeconds(chart)!).toBeGreaterThanOrEqual(ENDING_HIT_LIFE_SECONDS);
    expect(visibleApproach(stageSeconds, D, chart.approachS)).toBeNull();
  });

  it('三段结构不动：ENDING_SECONDS 仍为 7.5s', () => {
    expect(ENDING_SECONDS).toBe(7.5);
  });
});

describe('票 76 · 跨段 HUD 插在舞台与烟花之间', () => {
  it('HUD 回调在 drawStage 之后、`lighter` 粒子之前（爆炸压在分数条 / 生命条上）', () => {
    const { proxy, calls } = makeRecordingCtx({
      measureText: measureTextOk,
      createRadialGradient: () => ({ addColorStop: () => undefined }),
    });
    const particles = { naturalWidth: 512, naturalHeight: 512 } as unknown as HTMLImageElement;
    drawEndingFrameAt(
      proxy, 1920, 1080,
      frameInput({ assets: { ...NO_ASSETS, particles } }), 1.0,
      undefined,
      (c) => { c.lineDashOffset = 424242; },
    );
    // frameInput 的舞台原点 = (0, 1)，这个 setTransform 就是 drawStage 那一笔
    const stage = calls.findIndex(([k, a]) => k === 'setTransform' && a[4] === 0 && a[5] === 1);
    const hud = calls.findIndex(([k, a]) => k === 'lineDashOffset' && a[0] === 424242);
    const lighter = calls.findIndex(([k, a]) => k === 'globalCompositeOperation' && a[0] === 'lighter');
    expect(stage).toBeGreaterThanOrEqual(0);
    expect(lighter).toBeGreaterThanOrEqual(0);
    expect(hud).toBeGreaterThan(stage);
    expect(hud).toBeLessThan(lighter);
  });
});

describe('chart-preview 52 · 一帧绘制', () => {
  it('章铺满整帧（场地由仿真场末帧那张离屏图来；node 下只铺兜底底色，不炸）', () => {
    const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
    drawEndingFrameAt(proxy, 1920, 1080, frameInput(), 0);
    expect(fillRects(calls)[0]).toEqual([0, 0, 1920, 1080]);
  });

  it('结算：顶栏写难度 / 曲名 / Lv，白卡首行是固定 `Score` + 归一最终分（票 73）', () => {
    const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
    drawEndingFrameAt(proxy, 1920, 1080, frameInput(), ENDING_SECONDS - 0.1);
    const t = texts(calls);
    expect(t).toContain('EXPERT');
    expect(t).toContain('ヒカリへ');
    expect(t).toContain('25');
    expect(t).toContain('Lv.');
    expect(t).toContain('MAX');
    expect(t).toContain('COMBO');
    // 标签固定 `Score`（不做 i18n）；分数是无前导零的归一分
    expect(t).toContain('Score');
    expect(t).toContain('1000000');
    expect(t).not.toContain('得分');
    // 缺 `MenuAtlas` ⇒ rank 走纯字降级；2026-11-14 定案顶端只到 SS，不画实机没有的 SS+
    expect(t).toContain('SS');
    expect(t).not.toContain('SS+');
    expect(t.join('')).not.toContain('AUTO PLAY');
  });

  it('票 73 · Score 行在卡片入场那一段就淡入（不是五行判完才出现）', () => {
    const early = makeRecordingCtx({ measureText: measureTextOk });
    drawEndingFrameAt(early.proxy, 1920, 1080, frameInput(), ENDING_STAMP_SECONDS + 0.5);
    expect(texts(early.calls)).not.toContain('Score');
    const settle = makeRecordingCtx({ measureText: measureTextOk });
    drawEndingFrameAt(settle.proxy, 1920, 1080, frameInput(), ENDING_SECONDS - 0.1);
    expect(texts(settle.calls)).toContain('Score');
  });

  // 票 84 第四轮：左半幅整块氛围色被用户判为"污染"（大面积色板压掉官方房间背景）。
  // 新口径 = 只在封面卡背后点一盏同色的灯；浓度 0 = 完全不画（生产缺省 25 / 半径 1.15）。
  it('结算氛围：浓度 0 一笔不画；拉起只有卡后一团径向光，没有半屏线性色板', () => {
    const radial: number[][] = [];
    const linear: number[][] = [];
    const fakeCtx = {
      drawImage: () => undefined,
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4).fill(128),
      }),
    };
    // `coverWashColor` 在 node 下没有 document 会直接返回 null；这里给一个只够它取色的假 canvas
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx }),
    });
    try {
      const draw = (bgWash: number) => {
        const { proxy } = makeRecordingCtx({
          measureText: measureTextOk,
          createRadialGradient: (...a: unknown[]) => {
            radial.push(a as number[]);
            return { addColorStop: () => undefined };
          },
          createLinearGradient: (...a: unknown[]) => {
            linear.push(a as number[]);
            return { addColorStop: () => undefined };
          },
        });
        drawEndingFrameAt(proxy, 1920, 1080, frameInput(), ENDING_SECONDS - 0.1, { bgWash });
      };
      draw(0);
      expect(radial).toHaveLength(0);

      draw(40);
      expect(radial).toHaveLength(1);
      expect(linear).toHaveLength(0);
      // createRadialGradient(x0, y0, r0, x1, y1, r1)：内外圈同心
      const [cx, cy, r0, cx1, cy1, r1] = radial[0]!;
      expect(cx!).toBeCloseTo(0.212 * 1920, 6);
      expect(cy!).toBeCloseTo(0.5 * 1080, 6);
      expect(cx1).toBe(cx);
      expect(cy1).toBe(cy);
      // 内圈 = 卡边长的 0.45（卡体自己盖住最亮那圈）、外圈 = ×`bgGlowSize`（生产缺省 1.15）
      expect(r0!).toBeCloseTo(0.45 * 0.45 * 1080, 6);
      expect(r1!).toBeCloseTo(1.15 * 0.45 * 1080, 6);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('票 73/83 · 有 `result/score-medal.png` 时 Score 行贴官方圆星章（缺件留空，不画假章）', () => {
    const medal = { naturalWidth: 29, naturalHeight: 30 } as unknown as HTMLImageElement;
    const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
    drawEndingFrameAt(
      proxy, 1920, 1080,
      frameInput({ assets: { ...NO_ASSETS, scoreMedal: medal } }), ENDING_SECONDS - 0.1,
    );
    const hit = calls.filter(([k]) => k === 'drawImage')
      .map(([, a]) => a as unknown[]).find((a) => a[0] === medal);
    // 票 83 起是整图派生件 ⇒ 源矩形从 (0,0) 起，尺寸 = 素材尺寸
    expect(hit?.slice(1, 5)).toEqual([0, 0, 29, 30]);
  });

  it('票 73/82 · 右上徽章三层各自整图：太阳纹盘 + 字母层 + SCORE RANK 缎带', () => {
    const rankDisc = { naturalWidth: 140, naturalHeight: 132 } as unknown as HTMLImageElement;
    const rankLetter = { naturalWidth: 86, naturalHeight: 82 } as unknown as HTMLImageElement;
    const rankRibbon = { naturalWidth: 190, naturalHeight: 35 } as unknown as HTMLImageElement;
    const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
    drawEndingFrameAt(
      proxy, 1920, 1080,
      frameInput({ assets: { ...NO_ASSETS, rankDisc, rankLetterSs: rankLetter, rankRibbon } }), ENDING_SECONDS - 0.1,
    );
    const args = calls.filter(([k]) => k === 'drawImage').map(([, a]) => a as unknown[]);
    const disc = args.find((a) => a[0] === rankDisc);
    const letter = args.find((a) => a[0] === rankLetter);
    const ribbon = args.find((a) => a[0] === rankRibbon);
    expect(disc?.slice(1, 5)).toEqual([0, 0, 140, 132]);
    expect(letter?.slice(1, 5)).toEqual([0, 0, 86, 82]);
    expect(ribbon?.slice(1, 5)).toEqual([0, 0, 190, 35]);
    // 终态尺寸与票 73 一致：盘 8.125%W、字母 6 成盘宽、缎带 10.4167%W
    expect(disc?.[7] as number).toBeCloseTo(156, 1);
    expect(letter?.[7] as number).toBeCloseTo(93.6, 1);
    expect(ribbon?.[7] as number).toBeCloseTo(200, 0);
    // 满分档是 SS（实机没有 SS+ 徽章）⇒ 贴大号字母，不再走纯字
    expect(texts(calls)).not.toContain('SS');
  });

  it('票 82 · 分层入场：窗口前段只有圆盘，字母 / 缎带还在路上（不是整组一起淡入）', () => {
    const rankDisc = { naturalWidth: 140, naturalHeight: 132 } as unknown as HTMLImageElement;
    const rankLetter = { naturalWidth: 86, naturalHeight: 82 } as unknown as HTMLImageElement;
    const rankRibbon = { naturalWidth: 190, naturalHeight: 35 } as unknown as HTMLImageElement;
    const assets = { ...NO_ASSETS, rankDisc, rankLetterSs: rankLetter, rankRibbon };
    // 窗口 = rankInAt / rankInDur，落在 transDur 的那条 q 轴上（endingFrame 的 `at()` 同源）
    const span = Math.max(0.45, ENDING_TRANS_SECONDS * 0.6);
    const base = ENDING_STAMP_SECONDS + ENDING_TRANS_SECONDS * 0.4;
    const windowStart = base + span * (ENDING_SPEC.rankInAt / 100);
    const windowDur = span * (ENDING_SPEC.rankInDur / 100);
    const at = (pct: number) => {
      const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
      drawEndingFrameAt(proxy, 1920, 1080, frameInput({ assets }), windowStart + windowDur * (pct / 100));
      const args = calls.filter(([k]) => k === 'drawImage').map(([, a]) => a as unknown[]);
      return { calls, args, images: args.map((a) => a[0]) };
    };
    /** 某次 drawImage 发生时的 globalAlpha（取它之前最近一次赋值） */
    const alphaOf = (calls: RecordedCall[], img: unknown): number | undefined => {
      const i = calls.findIndex(([k, a]) => k === 'drawImage' && (a as unknown[])[0] === img);
      if (i < 0) return undefined;
      for (let j = i; j >= 0; j--) if (calls[j]![0] === 'globalAlpha') return calls[j]![1][0] as number;
      return 1;
    };

    const early = at(20);
    expect(early.images).toContain(rankDisc);
    expect(early.images).not.toContain(rankLetter);
    expect(early.images).not.toContain(rankRibbon);

    const done = at(100);
    expect(done.images).toContain(rankDisc);
    expect(done.images).toContain(rankLetter);
    expect(done.images).toContain(rankRibbon);

    // 三层各自 alpha（票 82 锁测原句）：中段三个值互不相同，共用一份时这里只会有一个数
    const mid = at(80);
    const midAlphas = [rankDisc, rankLetter, rankRibbon].map((img) => alphaOf(mid.calls, img));
    expect(midAlphas.every((v) => v !== undefined)).toBe(true);
    expect(new Set(midAlphas).size).toBe(3);

    // 圆盘过冲 1.02（票 82 实现口径表）：峰值段宽度大于终态 156
    const discPeak = at(35).args.find((a) => a[0] === rankDisc);
    expect(discPeak?.[7] as number).toBeGreaterThan(156);
    // 窗口走完回到终态，过冲不得留在排版上
    const discDone = done.args.find((a) => a[0] === rankDisc);
    expect(discDone?.[7] as number).toBeCloseTo(156, 1);
  });

  it('五行判定 + MAX COMBO 的计数照 `counts` / `maxCombo` 画（四位补零）', () => {
    const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
    drawEndingFrameAt(
      proxy,
      1920,
      1080,
      frameInput({
        counts: { perfect: 667, great: 0, good: 0, bad: 0, miss: 0 },
        maxCombo: 667,
      }),
      ENDING_SECONDS - 0.1,
    );
    const t = texts(calls);
    // 前导 0 逐字画（每个数字一笔），末位也算在 4 位里
    expect(t.filter((s) => s === '0').length).toBeGreaterThanOrEqual(3);
    expect(t).toContain('6');
  });

  it('2026-11-14 验收 · 只有前导 0 染灰：`2083` 的 0 与全 0 的末位都是深色', () => {
    const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
    drawEndingFrameAt(
      proxy, 1920, 1080,
      frameInput({
        counts: { perfect: 2083, great: 0, good: 0, bad: 0, miss: 0 },
        maxCombo: 2083,
      }),
      ENDING_SECONDS - 0.1,
    );
    // `drawCount` 每画一位前先设一次 fillStyle ⇒ 逐笔把「字 + 当时的颜色」配起来
    let color = '';
    const digits: Array<[string, string]> = [];
    for (const [k, a] of calls) {
      if (k === 'fillStyle') color = String(a[0]);
      if (k === 'fillText' && /^[0-9]$/.test(String(a[0]))) digits.push([String(a[0]), color]);
    }
    const groups = Array.from({ length: Math.floor(digits.length / 4) }, (_, i) => digits.slice(i * 4, i * 4 + 4));
    const DARK = '#3b3b3b';
    const GRAY = '#c9c9c9';
    expect(groups).toContainEqual([['2', DARK], ['0', DARK], ['8', DARK], ['3', DARK]]);
    expect(groups).toContainEqual([['0', GRAY], ['0', GRAY], ['0', GRAY], ['0', DARK]]);
    // 中间的 0 不许再被误判成前导零
    expect(digits.filter(([d, c]) => d === '0' && c === GRAY)).toHaveLength(12); // 4 行 0000 × 3
  });

  it('MAX COMBO 有韩服真件时贴图（不再用文字拼两行）', () => {
    const maxCombo = { naturalWidth: 112, naturalHeight: 59 } as unknown as HTMLImageElement;
    const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
    drawEndingFrameAt(
      proxy,
      1920,
      1080,
      frameInput({ assets: { ...NO_ASSETS, maxCombo } }),
      ENDING_SECONDS - 0.1,
    );
    const draws = calls.filter(([k]) => k === 'drawImage').map(([, a]) => a[0]);
    expect(draws).toContain(maxCombo);
    // 两行字不再出现（'MAX' / 'COMBO' 都不该被 fillText）
    expect(texts(calls)).not.toContain('MAX');
    expect(texts(calls)).not.toContain('COMBO');
  });

  it('顶栏星徽三态各取自己的派生件（虹彩 / 粉 / 金），同一比例尺保留相对大小', () => {
    const badgeAp = { naturalWidth: 57, naturalHeight: 55 } as unknown as HTMLImageElement;
    const badgeFc = { naturalWidth: 57, naturalHeight: 55 } as unknown as HTMLImageElement;
    const badgeClear = { naturalWidth: 47, naturalHeight: 45 } as unknown as HTMLImageElement;
    const assets = { ...NO_ASSETS, badgeAp, badgeFc, badgeClear };
    const boxOf = (stamp: 'ap' | 'fc' | 'clear'): unknown[] | null => {
      const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
      drawEndingFrameAt(proxy, 1920, 1080, frameInput({ stamp, assets }), ENDING_SECONDS - 0.1);
      const want = stamp === 'ap' ? badgeAp : stamp === 'fc' ? badgeFc : badgeClear;
      const hit = calls
        .filter(([k]) => k === 'drawImage')
        .map(([, a]) => a as unknown[])
        .find((a) => a[0] === want);
      return hit ? hit.slice(1, 5) : null;
    };
    // 源矩形 = 素材本体；`clear` 素材更小 ⇒ 同一比例尺下画出来也小
    expect(boxOf('ap')).toEqual([0, 0, 57, 55]);
    expect(boxOf('fc')).toEqual([0, 0, 57, 55]);
    expect(boxOf('clear')).toEqual([0, 0, 47, 45]);
  });

  it('AP / FC 是**两套材质**：结算标只认 mark*，不拿中央章那张大图缩下去', () => {
    const stampAp = { naturalWidth: 1028, naturalHeight: 187 } as unknown as HTMLImageElement;
    const markAp = { naturalWidth: 221, naturalHeight: 40 } as unknown as HTMLImageElement;
    const drawSources = (assets: EndingAssets): unknown[] =>
      (() => {
        const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
        drawEndingFrameAt(proxy, 1920, 1080, frameInput({ assets }), ENDING_SECONDS - 0.1);
        return calls.filter(([k]) => k === 'drawImage').map(([, a]) => (a as unknown[])[0]);
      })();
    // 只有中央章的大图 ⇒ 结算标那格走纯字，不贴它
    const onlyBig = drawSources({ ...NO_ASSETS, stampAp });
    expect(onlyBig).not.toContain(stampAp);
    // 只有结算标的小图 ⇒ 直接贴它
    const onlySmall = drawSources({ ...NO_ASSETS, markAp });
    expect(onlySmall).toContain(markAp);
  });

  /**
   * 票 55 定案 C：CLEAR **只补普通烟花**，仍不画章字样与结算角标。
   * 旧版只断言「什么都没画」，靠 `NO_ASSETS.particles = null` 让 `drawParticles` 提前 return
   * 才假绿 —— 这里给一张粒子假图，真正验证「有画」以及 `clearBurst` 关得掉。
   * node 环境没有 document ⇒ `starSprite()` 返回 null、贴图画不出来，但拖尾的 `stroke` 仍在。
   */
  it('`clear` 无章、无角标，但章段**放普通烟花**（票 55 定案 C）', () => {
    const particles = { width: 512, height: 512 } as unknown as HTMLImageElement;
    const withParticles = { ...NO_ASSETS, particles };
    const draw = (over: Partial<EndingFrameInput>, spec?: Partial<EndingSpec>) => {
      const { proxy, calls } = makeRecordingCtx({
        measureText: measureTextOk,
        createRadialGradient: () => ({ addColorStop: () => undefined }),
      });
      drawEndingFrameAt(proxy, 1920, 1080, frameInput(over), 1.0, spec);
      return calls;
    };
    const strokes = (calls: RecordedCall[]) => calls.filter(([k]) => k === 'stroke').length;

    const active = draw({ stamp: 'clear', assets: withParticles });
    expect(strokes(active)).toBeGreaterThan(0);
    // 缺件 / 关掉开关 ⇒ 一笔粒子都不放
    expect(strokes(draw({ stamp: 'clear' }))).toBe(0);
    expect(strokes(draw({ stamp: 'clear', assets: withParticles }, { clearBurst: 0 }))).toBe(0);
    // 但中央章字样与结算角标都不画
    expect(texts(active)).toEqual([]);
    expect(active.filter(([k]) => k === 'drawImage')).toEqual([]);
  });

  it('AP / FC / CLEAR 三态在章段都放普通烟花', () => {
    const particles = { width: 512, height: 512 } as unknown as HTMLImageElement;
    for (const stamp of ENDING_STAMPS) {
      const { proxy, calls } = makeRecordingCtx({
        measureText: measureTextOk,
        createRadialGradient: () => ({ addColorStop: () => undefined }),
      });
      drawEndingFrameAt(
        proxy, 1920, 1080,
        frameInput({ stamp, assets: { ...NO_ASSETS, particles } }), 1.0,
      );
      expect(calls.filter(([k]) => k === 'stroke').length, `${stamp} 应有粒子拖尾`).toBeGreaterThan(0);
    }
  });

  it('黑幕转场：盖到全黑那一拍整帧压黑（转场段内 alpha 递减、抬完不再画）', () => {
    const full = makeRecordingCtx({ measureText: measureTextOk });
    drawEndingFrameAt(full.proxy, 1920, 1080, frameInput(), ENDING_STAMP_SECONDS + 0.4);
    expect(full.calls.filter(([k, a]) => k === 'fillRect' && (a as number[])[2] === 1920).length).toBeGreaterThan(0);

    const done = makeRecordingCtx({ measureText: measureTextOk });
    drawEndingFrameAt(
      done.proxy,
      1920,
      1080,
      frameInput(),
      ENDING_STAMP_SECONDS + ENDING_TRANS_SECONDS + 0.2,
    );
    // 幕布抬完（0.62T）之后不再压黑
    expect(propValues(done.calls, 'globalAlpha').filter((v) => v === 1).length).toBeGreaterThan(0);
    expect(done.calls.filter(([k, a]) => k === 'fillStyle' && a[0] === '#000000')).toEqual([]);
  });
});

// 票 84 第二次回修（用户 2026-11-23）：结算的固定背景**只从结算画面起**生效。
// 中央章与黑幕淡入那一拍仍是打歌末帧的舞台（相框封面也在）；换景落在黑幕盖满（0.22T）之后，
// 那一帧整屏全黑，看不出换景。提前换 = 章还没演完背景就变成房间。
describe('票 84 回修 · 结算固定背景只在黑幕盖满之后换上', () => {
  const lastBg = { width: 2048, height: 1024, tag: 'last' } as unknown as CanvasImageSource;
  const fixedBg = { width: 2048, height: 1024, tag: 'fixed' } as unknown as CanvasImageSource;
  const frameCover = { width: 512, height: 512, tag: 'frame-cover' } as unknown as CanvasImageSource;

  /** 打歌末帧用的是 AAO 舞台（末帧背景 + 相框封面），结算固定背景另给一张假图 */
  const stageFrameInput = (): EndingFrameInput => {
    const base = frameInput({ stageBackground: fixedBg });
    return {
      ...base,
      stage: {
        ...base.stage,
        frame: {
          ...base.stage.frame,
          assets: {
            ...base.stage.frame.assets,
            background: lastBg,
            stageFrame: { cover: frameCover },
          },
        },
      },
    };
  };

  const sources = (calls: RecordedCall[]) =>
    calls.filter(([k]) => k === 'drawImage').map(([, a]) => (a as unknown[])[0]);

  const draw = (elapsed: number) => {
    const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
    drawEndingFrameAt(proxy, 1920, 1080, stageFrameInput(), elapsed);
    return sources(calls);
  };

  it('中央章：仍是打歌末帧的舞台 + 相框封面，不出现固定背景', () => {
    const s = draw(1.0);
    expect(s).toContain(lastBg);
    expect(s).toContain(frameCover);
    expect(s).not.toContain(fixedBg);
  });

  it('黑幕淡入段（< 0.22T）不换景；盖满之后换固定背景并撤掉相框', () => {
    const fading = draw(ENDING_STAMP_SECONDS + ENDING_TRANS_SECONDS * 0.2);
    expect(fading).toContain(lastBg);
    expect(fading).toContain(frameCover);
    expect(fading).not.toContain(fixedBg);

    const covered = draw(ENDING_STAMP_SECONDS + ENDING_TRANS_SECONDS * 0.3);
    expect(covered).toContain(fixedBg);
    expect(covered).not.toContain(lastBg);
    expect(covered).not.toContain(frameCover);

    const settle = draw(ENDING_SECONDS - 0.1);
    expect(settle).toContain(fixedBg);
    expect(settle).not.toContain(lastBg);
    expect(settle).not.toContain(frameCover);
  });

  it('票 42 · 结算换景清掉 liveBgFit，固定背景走幕布取景不是设计面 cover', () => {
    const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
    const input = stageFrameInput();
    input.stage.frame.assets.liveBgFit = 'cover';
    drawEndingFrameAt(proxy, 1920, 1080, input, ENDING_SECONDS - 0.1);
    const bgCall = calls.find(([k, a]) => k === 'drawImage' && (a as unknown[])[0] === fixedBg);
    expect(bgCall).toBeTruthy();
    const args = bgCall![1] as number[];
    // cover 铺设计面会是 (0, 0, 1920, 1078)；幕布矩形宽 1.32W、原点为负
    expect(args.slice(1, 5)).not.toEqual([0, 0, 1920, 1078]);
    expect(args[1]!).toBeLessThan(0);
  });
});
