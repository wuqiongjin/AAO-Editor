// chart-preview 52：结尾段的**定稿参数表** + **一帧绘制**。
//
// 为什么单测：`ENDING_SPEC` 是用户交回的那份参数 JSON 的落码，键名 / 数值都是验收口径 ——
// 谁顺手"调一下更好看"，这里当场红。绘制形状用记录型假 context 钉住（node 环境没有真 canvas）；
// 光栅观感（章好不好看、粒子的层次）归原型目视验收 + 用户导一条真视频看。
import { describe, expect, it } from 'vitest';
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
  menu: null,
  rhythmGameUI: null,
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
      // 票 64：顶栏收窄给右上 SCORE RANK 让位
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
      // 票 64：白卡首行让给 Score 行
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
      bgBlur: 6,
      bgBright: 65,
      bgScrim: 42,
      bgFadeFrom: 30,
      bgFadeTo: 56,
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
      // 票 64 · Score 行（%H / 卡宽等比；时间键是 %入场轴 q）
      resultFont: 3.15,
      resultScoreFont: 3.7,
      resultPadX: 1.48,
      resultRowH: 8.89,
      resultRowDY: -1.11,
      resultInAt: 24,
      resultInDur: 24,
      // 票 64 · SCORE RANK 徽章（%W，原型按帧宽缩）
      rankSize: 8.125,
      rankRight: 7.8125,
      rankTop: 6.5625,
      rankLetterScale: 0.6,
      ribbonW: 10.4167,
      ribbonBelow: 0.2083,
      rankInAt: 20,
      rankInDur: 20,
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

describe('chart-preview 52 · 一帧绘制', () => {
  it('章铺满整帧（场地由仿真场末帧那张离屏图来；node 下只铺兜底底色，不炸）', () => {
    const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
    drawEndingFrameAt(proxy, 1920, 1080, frameInput(), 0);
    expect(fillRects(calls)[0]).toEqual([0, 0, 1920, 1080]);
  });

  it('结算：顶栏写难度 / 曲名 / Lv，白卡首行是固定 `Score` + 归一最终分（票 64）', () => {
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
    // 缺 `MenuAtlas` ⇒ rank 走纯字降级，不画自造 `AUTO PLAY` 字样
    expect(t).toContain('SS+');
    expect(t.join('')).not.toContain('AUTO PLAY');
  });

  it('票 64 · Score 行在卡片入场那一段就淡入（不是五行判完才出现）', () => {
    const early = makeRecordingCtx({ measureText: measureTextOk });
    drawEndingFrameAt(early.proxy, 1920, 1080, frameInput(), ENDING_STAMP_SECONDS + 0.5);
    expect(texts(early.calls)).not.toContain('Score');
    const settle = makeRecordingCtx({ measureText: measureTextOk });
    drawEndingFrameAt(settle.proxy, 1920, 1080, frameInput(), ENDING_SECONDS - 0.1);
    expect(texts(settle.calls)).toContain('Score');
  });

  it('票 64 · 有 `RhythmGameUI.png` 时 Score 行贴官方圆星章（缺件留空，不画假章）', () => {
    const rhythmGameUI = { naturalWidth: 1024, naturalHeight: 1024 } as unknown as HTMLImageElement;
    const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
    drawEndingFrameAt(
      proxy, 1920, 1080,
      frameInput({ assets: { ...NO_ASSETS, rhythmGameUI } }), ENDING_SECONDS - 0.1,
    );
    const hit = calls.filter(([k]) => k === 'drawImage')
      .map(([, a]) => a as unknown[]).find((a) => a[0] === rhythmGameUI);
    expect(hit?.slice(1, 5)).toEqual([7, 421, 29, 30]);
  });

  it('票 64 · 有 `MenuAtlas.png` 时右上徽章 = 太阳纹盘 + 字母层 + SCORE RANK 缎带', () => {
    const menu = { naturalWidth: 2048, naturalHeight: 2048 } as unknown as HTMLImageElement;
    const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
    drawEndingFrameAt(
      proxy, 1920, 1080,
      frameInput({ assets: { ...NO_ASSETS, menu } }), ENDING_SECONDS - 0.1,
    );
    const boxes = calls.filter(([k, a]) => k === 'drawImage' && (a as unknown[])[0] === menu)
      .map(([, a]) => (a as unknown[]).slice(1, 5));
    expect(boxes).toContainEqual([1080, 1286, 140, 132]); // 太阳纹盘
    expect(boxes).toContainEqual([1375, 855, 190, 35]); // SCORE RANK 缎带
    // 只有 SS 一档的大号字母切图登记在册；满分 SS+ 走纯字降级
    expect(texts(calls)).not.toContain('SS');
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

  it('顶栏星徽按 `atlas/MenuAtlas.png` 切三格（虹彩 / 粉 / 金），不是另一张 HUD 图集', () => {
    const menu = { naturalWidth: 2048, naturalHeight: 2048 } as unknown as HTMLImageElement;
    const boxOf = (stamp: 'ap' | 'fc' | 'clear'): unknown[] | null => {
      const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
      drawEndingFrameAt(
        proxy,
        1920,
        1080,
        frameInput({ stamp, assets: { ...NO_ASSETS, menu } }),
        ENDING_SECONDS - 0.1,
      );
      const hit = calls
        .filter(([k]) => k === 'drawImage')
        .map(([, a]) => a as unknown[])
        .find((a) => a[0] === menu);
      return hit ? hit.slice(1, 5) : null;
    };
    // 三格不同尺寸 ⇒ 绘制按**同一比例尺**（`starSize` 对最大那格），保留相对大小
    expect(boxOf('ap')).toEqual([116, 218, 57, 55]);
    expect(boxOf('fc')).toEqual([60, 257, 57, 55]);
    expect(boxOf('clear')).toEqual([275, 230, 47, 45]);
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
