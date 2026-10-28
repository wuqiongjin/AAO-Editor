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
      barW: 85,
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
      rowFirst: 5.6,
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
      comboY: 5,
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
      partCount: 56,
      partSize: 3.5,
      partSpeed: 1,
      palette: 'cycle',
      burst2At: 24,
      burst2X: 34,
      burst2Y: 62,
      burst3At: 42,
      burst3X: 66,
      burst3Y: 36,
      burst4At: 62,
      burst4Points: 4,
      burst5At: 80,
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

  it('结算：顶栏写难度 / 曲名 / Lv（没有 SS、得分、排名）', () => {
    const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
    drawEndingFrameAt(proxy, 1920, 1080, frameInput(), ENDING_SECONDS - 0.1);
    const t = texts(calls);
    expect(t).toContain('EXPERT');
    expect(t).toContain('ヒカリへ');
    expect(t).toContain('25');
    expect(t).toContain('Lv.');
    expect(t).toContain('MAX');
    expect(t).toContain('COMBO');
    // 结算从判定区起：得分 / 排名 / SS 一律不画
    expect(t.join('')).not.toMatch(/SCORE|RANK|SS/);
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

  it('`clear`（普通 Clear）**无章**：章段不画字、也不放粒子', () => {
    const { proxy, calls } = makeRecordingCtx({ measureText: measureTextOk });
    drawEndingFrameAt(proxy, 1920, 1080, frameInput({ stamp: 'clear' }), 1.0);
    expect(texts(calls)).toEqual([]);
    // 章段只该有兜底底色那一笔（无粒子、无字块）
    expect(calls.filter(([k]) => k === 'drawImage')).toEqual([]);
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
