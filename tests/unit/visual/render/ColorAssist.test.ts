// issue 39 #4 色觉辅助：半拍判断纯函数 + tapVirtual 注册表完整性 + tapVirtualFor 解析 + 设置默认值 + renderNotes 接线
import { describe, it, expect } from 'vitest';
import {
  NOTE_SKIN_PACKS,
  type NoteSkinPackNote,
} from '@/src/visual/gen/noteSkinRegistry.gen';
import { buildActiveNoteIcons, normalizeNoteSkinSelection, FLAT_LANE } from '@/src/visual/noteSkin';
import { isHalfBeatAligned, renderNotes } from '@/src/visual/render';
import { makeCoords } from '@/src/visual/coords';
import { ChartGeometry } from '@/src/chart/geometry/ChartGeometry';
import { defaultSettings } from '@/src/chart/config/AppSettings';
import type { RenderCtx } from '@/src/visual/types';
import type { ChartNote } from '@/src/chart/types';
import { makeNoopCtx } from '@/tests/support/canvas';

const notePacks = NOTE_SKIN_PACKS.filter((p): p is NoteSkinPackNote => p.kind === 'note');

describe('isHalfBeatAligned（色觉辅助半拍整数倍判定，issue 39 #4）', () => {
  // 实拍（普通）款式 ⇔ pos = beat + subBeat/beatDisplay 落在 0.5 拍整数倍
  it('整数拍与半拍整数倍 → 实拍', () => {
    for (const bd of [1, 2, 3, 4, 6, 8, 12, 16]) {
      expect(isHalfBeatAligned(0, 0, bd)).toBe(true);
      expect(isHalfBeatAligned(1, 0, bd)).toBe(true);
      expect(isHalfBeatAligned(2.5, 0, bd)).toBe(true);
      expect(isHalfBeatAligned(13, 0, bd)).toBe(true);
    }
  });

  it('1/4 拍网格的 0.25 偏移 → 虚拍', () => {
    expect(isHalfBeatAligned(0.25, 0, 4)).toBe(false);
    expect(isHalfBeatAligned(0.75, 0, 4)).toBe(false);
    expect(isHalfBeatAligned(2.25, 0, 4)).toBe(false);
  });

  it('subBeat 折算与 getNoteVirtualY 同口径：beat + subBeat/beatDisplay', () => {
    expect(isHalfBeatAligned(1, 2, 4)).toBe(true);   // 1.5 拍 → 实拍
    expect(isHalfBeatAligned(1, 1, 4)).toBe(false);  // 1.25 拍 → 虚拍
    expect(isHalfBeatAligned(0, 8, 16)).toBe(true);  // 0.5 拍 → 实拍
    expect(isHalfBeatAligned(0, 4, 16)).toBe(false); // 0.25 拍 → 虚拍
  });

  it('非 2 幂网格（1/3、1/6、1/12）浮点误差用容差兜住', () => {
    // 1/3 网格：拍位为 k/3，仅 k 为 3 的倍数（整数拍）才落在半拍上
    expect(isHalfBeatAligned(1 / 3, 0, 3)).toBe(false);
    expect(isHalfBeatAligned(2 / 3, 0, 3)).toBe(false);
    expect(isHalfBeatAligned(4 / 3, 0, 3)).toBe(false);
    // 1/6 网格：3/6 = 0.5 精确 → 实拍；2/6 非半拍 → 虚拍
    expect(isHalfBeatAligned(3 / 6, 0, 6)).toBe(true);
    expect(isHalfBeatAligned(9 / 6, 0, 6)).toBe(true); // 1.5
    expect(isHalfBeatAligned(2 / 6, 0, 6)).toBe(false); // 1/3
    // 1/12 网格：6/12 实拍，3/12（0.25）与 4/12（1/3）虚拍
    expect(isHalfBeatAligned(6 / 12, 0, 12)).toBe(true);
    expect(isHalfBeatAligned(3 / 12, 0, 12)).toBe(false);
    expect(isHalfBeatAligned(4 / 12, 0, 12)).toBe(false);
  });

  it('大拍号（长谱面末段）仍精确', () => {
    expect(isHalfBeatAligned(2048.5, 0, 16)).toBe(true);
    expect(isHalfBeatAligned(2048.25, 0, 16)).toBe(false);
  });
});

describe('tapVirtual 注册表完整性（构建脚本产物守约，issue 39 #4）', () => {
  it('7 个音符皮肤包均含 7 轨道 tapVirtual，中间轨（FLAT_LANE=3）非空且矩形在图集内', () => {
    expect(notePacks).toHaveLength(7);
    for (const pack of notePacks) {
      expect(pack.tapVirtual, `${pack.id} 缺 tapVirtual 字段`).toHaveLength(7);
      for (const r of pack.tapVirtual) {
        if (!r) continue;
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(pack.atlasW);
        expect(r.y + r.h).toBeLessThanOrEqual(pack.atlasH);
      }
      expect(pack.tapVirtual[FLAT_LANE], `${pack.id} 缺虚拍中间轨精灵`).not.toBeNull();
    }
  });

  it('skin00 虚拍中间轨坐标钉子：note_normal_16_3 y 翻转后 = (930, 50)', () => {
    // .sprites 原始 m_Rect={x:930,y:854,h:120}，图集高 1024 → y_top = 1024-854-120 = 50
    const skin00 = notePacks.find((p) => p.id === 'skin00')!;
    expect(skin00.tapVirtual[3]).toEqual({ x: 930, y: 50, w: 308, h: 120 });
  });

  it('虚拍与实拍是不同精灵（同尺寸帧，矩形不同）', () => {
    for (const pack of notePacks) {
      const t = pack.tap[FLAT_LANE]!, v = pack.tapVirtual[FLAT_LANE]!;
      expect(v.x === t.x && v.y === t.y, `${pack.id} 虚拍与实拍矩形相同`).toBe(false);
      expect(v.w).toBe(t.w);
      expect(v.h).toBe(t.h);
    }
  });
});

describe('buildActiveNoteIcons.tapVirtualFor（默认皮肤包）', () => {
  const icons = buildActiveNoteIcons(normalizeNoteSkinSelection(undefined));
  const skin00 = notePacks.find((p) => p.id === 'skin00')!;

  it('返回 tap 皮肤包的虚拍中间轨配置（全轨道扁平化与 tapFor 同规）', () => {
    const flat = skin00.tapVirtual[FLAT_LANE]!;
    for (const lane of [0, 3, 6]) {
      const cfg = icons.tapVirtualFor(lane);
      expect(cfg.src).toBe(skin00.atlas);
      expect(cfg.x).toBe(flat.x);
      expect(cfg.y).toBe(flat.y);
      expect(cfg.w).toBe(flat.w);
      expect(cfg.h).toBe(flat.h);
    }
    // 与实拍款是不同矩形
    expect(icons.tapVirtualFor(0).x).not.toBe(icons.tapFor(0).x);
  });
});

describe('AppSettings.display.colorAssist（issue 39 #4）', () => {
  it('默认开启', () => {
    expect(defaultSettings().display.colorAssist).toBe(true);
  });
});

// ---- renderNotes 接线：色觉辅助开关 → tap 选款（stub spriteIcon 捕获绘制配置，仿 RendererPerf 模式） ----

const geom = new ChartGeometry([{ beat: 0, bpm: 120 }], { endBeat: 8 } , { w: 750, h: 900 });
const stubCtx = makeNoopCtx();

/** 用给定音符序列 + colorAssist 渲染一遍，返回 spriteIcon.render 收到的前几个 {src,x,y,w,h} */
function captureTaps(notes: ChartNote[], colorAssist: boolean) {
  const viewport = { scrollX: 0, scrollY: 0, scale: 1, virtualWidth: 0, virtualHeight: 0 };
  const calls: { src: string; x: number; y: number; w: number; h: number }[] = [];
  const rc = {
    geometry: geom,
    viewport,
    surface: { w: 750, h: 900 },
    dpr: 1,
    beatDisplay: 4,
    chartEndBeat: 8,
    notes,
    selectedItems: [],
    selectionBox: null,
    slideBuffer: null,
    hoverPos: null,
    clipboard: [],
    markerBeat: null,
    armedTool: null,
    spriteIcon: {
      render: (_c: unknown, cfg: { src: string; x: number; y: number; w: number; h: number }) => calls.push(cfg),
      renderDecorator: () => undefined,
    },
    noteIcons: buildActiveNoteIcons(normalizeNoteSkinSelection(undefined)),
    display: { noteSize: 1, slideOpacity: 1, simultaneousClickLines: false, colorAssist },
  } as unknown as RenderCtx;
  renderNotes(stubCtx, makeCoords(geom, viewport, 4, notes), rc, notes.map((note, index) => ({ note, index })));
  return calls;
}

describe('renderNotes 色觉辅助接线（issue 39 #4）', () => {
  const icons = buildActiveNoteIcons(normalizeNoteSkinSelection(undefined));
  const tap3 = icons.tapFor(3);
  const virt3 = icons.tapVirtualFor(3);
  const flick3 = icons.flickFor(3);
  const skill3 = icons.skillFor(3);

  const single = (beat: number, extra: Partial<ChartNote> = {}): ChartNote =>
    ({ type: 'Single', lane: 3, beat, subBeat: 0, ...extra } as ChartNote);

  it('开启时：半拍整数倍 → 实拍款；非半拍（1.25）→ 虚拍款；flick/skill 不受影响', () => {
    const calls = captureTaps(
      [single(1.0), single(1.25), single(1.0, { flick: true }), single(1.0, { skill: true })],
      true,
    );
    expect(calls[0]).toMatchObject({ x: tap3.x, y: tap3.y });
    expect(calls[1]).toMatchObject({ x: virt3.x, y: virt3.y });
    expect(calls[2]).toMatchObject({ x: flick3.x, y: flick3.y });
    expect(calls[3]).toMatchObject({ x: skill3.x, y: skill3.y });
  });

  it('关闭时：所有普通 tap 都是实拍款', () => {
    const calls = captureTaps([single(1.0), single(1.25), single(1.375)], false);
    for (const c of calls) expect(c).toMatchObject({ x: tap3.x, y: tap3.y });
  });

  it('subBeat 字段记法同样判定：beat=1 subBeat=1（1.25 拍）→ 虚拍款', () => {
    const notes = [{ type: 'Single', lane: 3, beat: 1, subBeat: 1 } as ChartNote];
    const calls = captureTaps(notes, true);
    expect(calls[0]).toMatchObject({ x: virt3.x, y: virt3.y });
  });

  it('整数拍用虚拍/实拍不同帧：确保两分支绘制源矩形确实不同（回归钉子）', () => {
    expect(virt3.src).toBe(tap3.src); // 同图集
    expect([virt3.x, virt3.y]).not.toEqual([tap3.x, tap3.y]);
  });
});

