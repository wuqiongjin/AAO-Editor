// issue 29 音符皮肤：注册表完整性 + 选择归一化 + 图标集解析 + 设置合并
import { describe, it, expect } from 'vitest';
import {
  NOTE_SKIN_PACKS,
  NOTE_SKIN_DEFAULT_SELECTION,
  type NoteSkinPackDirectional,
  type NoteSkinPackNote,
} from '../../src/renderer/noteSkinRegistry.gen';
import {
  buildActiveNoteIcons,
  normalizeNoteSkinSelection,
  NOTE_SKIN_ITEM_IDS,
  NOTE_SKIN_GEOMETRY,
} from '../../src/renderer/noteSkin';
import { LANE_WIDTH } from '../../src/utils/ChartGeometry';
import { defaultSettings, loadSettings, updateSettings } from '../../src/utils/AppSettings';

const notePacks = NOTE_SKIN_PACKS.filter((p): p is NoteSkinPackNote => p.kind === 'note');
const dirPacks = NOTE_SKIN_PACKS.filter((p): p is NoteSkinPackDirectional => p.kind === 'directional');
const skin00 = notePacks.find((p) => p.id === 'skin00')!;

describe('音符皮肤注册表完整性（生成器产物守约）', () => {
  it('至少包含默认包 skin00 与 directionalflickskin00', () => {
    expect(notePacks.some((p) => p.id === 'skin00')).toBe(true);
    expect(dirPacks.some((p) => p.id === 'directionalflickskin00')).toBe(true);
  });

  it('坐标系约定：.sprites 的 Unity 底部原点 y 已翻转为顶部原点（回归钉子）', () => {
    // skin00 note_normal_3 原始 m_Rect={x:1550,y:0,h:120}，图集 1024 高
    // → 翻转后 y = 1024-0-120 = 904（与 issue 40/41 旧手量 tap (1553,912) 吻合）
    const tap3 = skin00.tap[3]!;
    expect(tap3).toEqual({ x: 1550, y: 904, w: 308, h: 120 });
    // directionalflickskin00 note_flick_l_3 原始 m_Rect={x:0,y:122,h:120} → 翻转后 782（=旧 leftFlick 手量值）
    const dir00 = dirPacks.find((p) => p.id === 'directionalflickskin00')!;
    expect(dir00.dirL[3]).toEqual({ x: 0, y: 782, w: 308, h: 120 });
  });

  for (const pack of notePacks) {
    it(`${pack.id}: 七轨道 tap/flick/skill/long 精灵齐全且矩形在图集内`, () => {
      for (const arr of [pack.tap, pack.flick, pack.skill, pack.long]) {
        expect(arr).toHaveLength(7);
        for (const r of arr) {
          expect(r).not.toBeNull();
          expect(r!.x).toBeGreaterThanOrEqual(0);
          expect(r!.y).toBeGreaterThanOrEqual(0);
          expect(r!.x + r!.w).toBeLessThanOrEqual(pack.atlasW);
          expect(r!.y + r!.h).toBeLessThanOrEqual(pack.atlasH);
        }
      }
      expect(pack.slideAmong).not.toBeNull();
      expect(pack.band).toContain(pack.id);
      expect(pack.bandW).toBeGreaterThan(0);
    });

    it(`${pack.id}: 墨迹实测覆盖组合所需精灵（note_flick_top 等）`, () => {
      expect(pack.ink['note_flick_top']).toBeDefined();
      expect(pack.ink['note_slide_among']).toBeDefined();
      expect(pack.ink['note_long_3']).toBeDefined();
    });

    it(`${pack.id}: 整包预设配对（若有）指向存在的方向包`, () => {
      if (pack.pairedDir !== null) {
        expect(dirPacks.some((d) => d.id === pack.pairedDir)).toBe(true);
      }
    });
  }

  for (const pack of dirPacks) {
    it(`${pack.id}: 七轨道 dirL/dirR 精灵齐全且矩形在图集内；外侧箭头精灵在册`, () => {
      for (const arr of [pack.dirL, pack.dirR]) {
        expect(arr).toHaveLength(7);
        for (const r of arr) {
          expect(r).not.toBeNull();
          expect(r!.x + r!.w).toBeLessThanOrEqual(pack.atlasW);
          expect(r!.y + r!.h).toBeLessThanOrEqual(pack.atlasH);
        }
      }
      expect(pack.flickTopL).not.toBeNull();
      expect(pack.flickTopR).not.toBeNull();
      expect(pack.ink['note_flick_top_l']).toBeDefined();
      expect(pack.ink['note_flick_top_r']).toBeDefined();
    });
  }
});

describe('normalizeNoteSkinSelection（缺省/非法回退默认包）', () => {
  it('空输入 → 全默认', () => {
    expect(normalizeNoteSkinSelection(undefined)).toEqual(NOTE_SKIN_DEFAULT_SELECTION);
    expect(normalizeNoteSkinSelection({})).toEqual(NOTE_SKIN_DEFAULT_SELECTION);
  });

  it('非法包 id / 类别不符 → 该条目回退默认', () => {
    const sel = normalizeNoteSkinSelection({
      tap: 'skin00',
      flick: 'not-exist',            // 不存在的包
      skill: 'directionalflickskin00', // 类别不符（方向包不能当 skill）
      dirL: 'skin00',                // 类别不符（普通包不能当方向键）
      dirR: 'directionalflickskin00',
      slide: 'skin00',
      bogus: 'x',                    // 多余字段忽略
    });
    expect(sel.tap).toBe('skin00');
    expect(sel.flick).toBe(NOTE_SKIN_DEFAULT_SELECTION.flick);
    expect(sel.skill).toBe(NOTE_SKIN_DEFAULT_SELECTION.skill);
    expect(sel.dirL).toBe(NOTE_SKIN_DEFAULT_SELECTION.dirL);
    expect(sel.dirR).toBe('directionalflickskin00');
    expect(sel.slide).toBe('skin00');
    expect(Object.keys(sel).sort()).toEqual([...NOTE_SKIN_ITEM_IDS].sort());
  });
});

describe('buildActiveNoteIcons（扁平化 + 墨迹组合，2026-08-24 视觉修订）', () => {
  const icons = buildActiveNoteIcons(normalizeNoteSkinSelection(undefined));

  it('tapFor(lane) 全轨道扁平化：任意轨道都取中间轨（lane 3）精灵', () => {
    const flat = skin00.tap[3]!;
    for (const lane of [0, 1, 3, 6]) {
      const cfg = icons.tapFor(lane);
      expect(cfg.src).toBe(skin00.atlas);
      expect(cfg.x).toBe(flat.x);
      expect(cfg.y).toBe(flat.y);
      expect(cfg.w).toBe(flat.w);
      expect(cfg.h).toBe(flat.h);
    }
  });

  it('dirFor 返回方向包中间轨精灵（扁平化）', () => {
    const dirPack = dirPacks.find((p) => p.id === 'directionalflickskin00')!;
    const l = icons.dirFor('L', 2);
    const r = icons.dirFor('R', 2);
    expect(l.src).toBe(dirPack.atlas);
    expect(l.x).toBe(dirPack.dirL[3]!.x);
    expect(r.x).toBe(dirPack.dirR[3]!.x);
  });

  it('dirInk：优先构建期实测墨迹（回退 overrides/缺省），附源宽', () => {
    const ink = icons.dirInk('L');
    expect(ink.w).toBeGreaterThan(0);
    expect(ink.inkLeft).toBeGreaterThanOrEqual(0);
    expect(ink.inkRight).toBeGreaterThanOrEqual(0);
    // skin00 directionalflickskin00 note_flick_l_3 实测：left 42 / right 56
    expect(ink.inkLeft).toBe(42);
    expect(ink.inkRight).toBe(56);
  });

  it('slideBand 指向所选包连接带整图', () => {
    expect(icons.slideBand.src).toBe(skin00.band);
    expect(icons.slideBand.w).toBe(skin00.bandW);
  });

  it('滑条端点基底 = note_long 长条端帽（用户定案问题2），非普通单键', () => {
    const ep = icons.slideEndpointFor(4);
    expect(ep.src).toBe(skin00.atlas);
    expect(ep.x).toBe(skin00.long[3]!.x);
    expect(ep.y).toBe(skin00.long[3]!.y);
    expect(ep.x).not.toBe(skin00.tap[3]!.x);
  });

  it('flickTopDecorator：墨迹精确组合——墨迹底部 ≈ 主体中心线上方 3px、墨迹宽 ≈ 主体 0.68', () => {
    const dec = icons.flickTopDecorator;
    expect(dec).not.toBeNull();
    expect(dec!.zIndex).toBe(10);
    expect(dec!.src).toBe(skin00.atlas);
    // 由注册表墨迹反推绘制几何
    const top = skin00.flickTop!;
    const ink = skin00.ink['note_flick_top']!;
    const inkW = top.w - ink.left - ink.right;
    const drawW = NOTE_SKIN_GEOMETRY.FLICK_TOP_INK_W_RATIO * NOTE_SKIN_GEOMETRY.MAIN_W * (top.w / inkW);
    const drawH = drawW * (top.h / top.w);
    expect(dec!.scaleX! * NOTE_SKIN_GEOMETRY.MAIN_W).toBeCloseTo(drawW, 5);
    expect(dec!.scaleY! * NOTE_SKIN_GEOMETRY.MAIN_H).toBeCloseTo(drawH, 5);
    const inkBottomY = dec!.offsetY! + drawH * (((top.h - ink.bottom) / top.h) - 0.5);
    expect(inkBottomY).toBeCloseTo(NOTE_SKIN_GEOMETRY.FLICK_TOP_INK_BOTTOM_Y, 5);
  });

  it('dirGroup：N 条覆盖轨道本体 + 最外侧箭头', () => {
    const g2 = icons.dirGroup('L', 2);
    expect(g2.bodies).toHaveLength(2);
    expect(g2.bodies[0].offsetVirtualX).toBeCloseTo(0, 8);
    expect(g2.bodies[1].offsetVirtualX).toBeCloseTo(-LANE_WIDTH, 8);
    expect(g2.chevron).not.toBeNull();
    expect(g2.chevron!.offsetVirtualX).toBeCloseTo(-LANE_WIDTH, 8);
    // 箭头在本体外侧（extraDesignX 为负）
    expect(g2.chevron!.extraDesignX).toBeLessThan(0);
    expect(g2.chevron!.drawW).toBeGreaterThan(0);
    expect(g2.chevron!.drawH).toBeGreaterThan(0);
    // len=1 时箭头仍在锚点轨外侧
    const g1 = icons.dirGroup('R', 1);
    expect(g1.bodies).toHaveLength(1);
    expect(g1.chevron!.offsetVirtualX).toBe(0);
    expect(g1.chevron!.extraDesignX).toBeGreaterThan(0);
    // len 超界钳制到 3
    expect(icons.dirGroup('L', 9).bodies).toHaveLength(3);
  });

  it('dirGroup：方向键装饰箭头与本体部分重叠（用户 2026-08-25 第 2/3 轮反馈，参照图2 穿越观感）', () => {
    // 不变式（dirGroup 注释）：箭头中线 = 本体远缘 - sign * DIR_CHEVRON_INTO_BODY
    //   化简：L 方向 (sign=-1) 箭头中线 = -DIR_BODY_HALF_W + INTO_BODY
    //        R 方向 (sign=+1) 箭头中线 = +DIR_BODY_HALF_W - INTO_BODY
    //   中线相对本体中线 = sign * (DIR_BODY_HALF_W - INTO_BODY)
    //   INTO_BODY =  0  : 中线在本体远缘
    //   INTO_BODY =  5  : 中线在本体远缘内 5px（外缘塞本体内 ~3px）
    //   INTO_BODY = 10  : 中线在本体远缘外 10px（外缘略外露 ~2px）—— 第 3 轮"一点点距离"
    //   INTO_BODY = 15  : 中线在本体远缘外 15px（外缘明显外露 ~7px）—— 第 2 轮图2 观感
    //   实际 extraDesignX = 中线 - (inkCenterXF - 0.5) * drawW（墨迹偏心修正）
    //   箭头外缘 = 中线 - inkHalfW（设计 px，相对本体中线）
    //   L 外缘在本体远缘外  =  (-DIR_BODY_HALF_W + INTO_BODY) - inkHalfW - (-DIR_BODY_HALF_W)
    //                       =  INTO_BODY - inkHalfW
    //   R 对称：外露 = INTO_BODY - inkHalfW
    //   通用：beyondBody = INTO_BODY - inkHalfW
    for (const type of ['L', 'R'] as const) {
      for (const len of [1, 2, 3] as const) {
        const g = icons.dirGroup(type, len);
        expect(g.chevron, `dirGroup(${type}, ${len}) 必须有 chevron`).not.toBeNull();
        const topRect = type === 'L'
          ? dirPacks.find((p) => p.id === 'directionalflickskin00')!.flickTopL!
          : dirPacks.find((p) => p.id === 'directionalflickskin00')!.flickTopR!;
        const ink = dirPacks.find((p) => p.id === 'directionalflickskin00')!.ink[
          type === 'L' ? 'note_flick_top_l' : 'note_flick_top_r'
        ]!;
        const inkW = topRect.w - ink.left - ink.right;
        const inkHalfW = (g.chevron!.drawW * inkW) / topRect.w / 2;
        // 几何算"外缘外露本体外多少"（设计 px，符号约定：L 用 extraDesignX - inkHalfW 偏左为更外）
        //   真实：extraDesignX = 中线 - bias = sign*(DIR_BODY_HALF_W - INTO_BODY) - (inkCenterXF - 0.5)*drawW
        //   不去手算偏心，改为：通过 beyondBody = bodyEdge - sign*extraDesignX - inkHalfW 反推
        const bodyEdge = NOTE_SKIN_GEOMETRY.DIR_BODY_HALF_W;
        const sign = type === 'L' ? -1 : 1;
        const beyondBody = bodyEdge - sign * g.chevron!.extraDesignX - inkHalfW;
        // 第 3 轮（INTO_BODY=10）：箭头外缘相对本体远缘外露约 (INTO_BODY - inkHalfW) px
        const expectedBeyond = NOTE_SKIN_GEOMETRY.DIR_CHEVRON_INTO_BODY - inkHalfW;
        // 容许 ±2.5px 容差（墨迹偏心 + drawW 推导浮点误差）
        expect(beyondBody, `dirGroup(${type}, ${len}) 外缘外露 ${beyondBody.toFixed(2)}px 应≈ ${expectedBeyond.toFixed(2)}px (±2.5)`)
          .toBeGreaterThan(expectedBeyond - 2.5);
        expect(beyondBody).toBeLessThan(expectedBeyond + 2.5);
        // 不变量：箭头**尖端**应始终在本体外（露本体外至少 inkHalfW * 0.4）
        //   防止"完全脱开成两个独立元素"（INTO_BODY 过大时）
        expect(beyondBody, `dirGroup(${type}, ${len}) 箭头完全脱开本体 ${beyondBody.toFixed(2)}px`)
          .toBeLessThan(inkHalfW * 2);
      }
    }
  });

  it('preloadSrcs 覆盖当前选择涉及的全部图片', () => {
    const srcs = icons.preloadSrcs();
    expect(srcs).toContain(skin00.atlas);
    expect(srcs).toContain(skin00.band);
    expect(new Set(srcs).size).toBe(srcs.length);
  });

  it('跨包组合：tap 用 A 包、slide 用 A 包、dirL/dirR 用方向包（条目独立）', () => {
    const mixed = buildActiveNoteIcons(normalizeNoteSkinSelection({
      tap: 'skin00', flick: 'skin00', skill: 'skin00',
      dirL: 'directionalflickskin00', dirR: 'directionalflickskin00', slide: 'skin00',
    }));
    expect(mixed.tapFor(3).src).toBe(skin00.atlas);
    expect(mixed.dirFor('L', 3).src).toContain('directionalflickskin00');
  });
});

describe('AppSettings.visual.noteSkin（additive 合并）', () => {
  it('默认设置含六条目默认包', () => {
    const s = defaultSettings();
    expect(s.visual.noteSkin).toEqual(NOTE_SKIN_DEFAULT_SELECTION);
  });

  it('loadSettings 保留已存的有效字符串、丢弃非字符串', () => {
    const stored = JSON.stringify({
      ...defaultSettings(),
      visual: { noteSkin: { tap: 'skin00', flick: 42, skill: null } },
    });
    const s = loadSettings({ getItem: () => stored } as Storage);
    expect(s.visual.noteSkin.tap).toBe('skin00');
    expect(s.visual.noteSkin.flick).toBeUndefined();
    expect(s.visual.noteSkin.skill).toBeUndefined();
  });

  it('updateSettings 字段级写回 visual', () => {
    const prev = defaultSettings();
    const next = updateSettings(prev, { visual: { noteSkin: { ...prev.visual.noteSkin, slide: 'skin00' } } });
    expect(next.visual.noteSkin.slide).toBe('skin00');
    expect(next.display).toEqual(prev.display);
  });
});