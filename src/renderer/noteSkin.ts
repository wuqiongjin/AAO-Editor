// 音符皮肤运行时解析器（issue 29，grill 2026-08-24 定案 + 用户视觉反馈修订 2026-08-24）：
// 把 settings.visual.noteSkin 的六条目选择（tap/flick/skill/dirL/dirR/slide）
// 解析为渲染器消费的图标集 ActiveNoteIcons。包 id 非法/缺失时回退默认包（定案 Q10：静默回退）。
//
// 视觉修订（用户对照 Bestdori 实机反馈，2026-08-24）：
// 1. **全轨道扁平化（FLAT_LANE）**——官方 per-lane 精灵自带透视倾斜（外侧轨道歪），实机观感为端正，
//    故任意轨道统一取中间轨（lane 3）精灵；注册表保留 per-lane 数据备查。
// 2. 滑条端点基底 = note_long_*（长条端帽），不再是 note_normal；带 flick/skill 时仍由调用方覆盖。
// 3. 滑键箭头（note_flick_top）按构建期实测墨迹精确组合（对标实机：箭头墨迹 ≈ 主体宽 0.68，
//    墨迹底部压在主体中心线上方 3px）。
// 4. 方向键 = 扁平本体 ×N 条覆盖轨道 + note_flick_top_l/r 箭头组合到最外侧（几何由墨迹推导）。
import {
  NOTE_SKIN_PACKS,
  NOTE_SKIN_DEFAULT_SELECTION,
  type NoteSkinPack,
  type NoteSkinPackDirectional,
  type NoteSkinPackNote,
  type NoteSkinRect,
} from './noteSkinRegistry.gen';
import { LANE_WIDTH } from '../utils/ChartGeometry';
import type { SpriteIconConfig } from '../components/CanvasSpriteIcon';

/** 素材页「音符皮肤」六条目（定案：左右方向键同族两皮肤，拆两条目；slide 管连接带+SP带+中间结点三件套） */
export type NoteSkinItemId = 'tap' | 'flick' | 'skill' | 'dirL' | 'dirR' | 'slide';
export type NoteSkinSelection = Record<NoteSkinItemId, string>;

export const NOTE_SKIN_ITEM_IDS: NoteSkinItemId[] = ['tap', 'flick', 'skill', 'dirL', 'dirR', 'slide'];

/** 条目元数据（素材页 UI 用）：中文标签 + 说明 + 可选包类别 */
export const NOTE_SKIN_ITEM_META: Record<NoteSkinItemId, { label: string; hint: string; eligible: 'note' | 'directional' }> = {
  tap: { label: '单键', hint: '普通单点音符（note_normal）', eligible: 'note' },
  flick: { label: '滑键', hint: '带 flick 标记的单键（note_flick + 顶部箭头）', eligible: 'note' },
  skill: { label: '技能键', hint: '带 skill 标记的单键（note_skill）', eligible: 'note' },
  dirL: { label: '左方向键', hint: '向左方向滑键：本体 + 外侧箭头（note_flick_l + note_flick_top_l）', eligible: 'directional' },
  dirR: { label: '右方向键', hint: '向右方向滑键：本体 + 外侧箭头（note_flick_r + note_flick_top_r）', eligible: 'directional' },
  slide: { label: '滑条', hint: '连接带 longNoteLine + SP 带 longNoteLine2 + 中间结点 note_slide_among', eligible: 'note' },
};

/** 扁平化轨道：官方 per-lane 精灵带透视倾斜，实机观感为端正 → 全轨道统一取中间轨精灵 */
export const FLAT_LANE = 3;

// ---- 组合几何常量（由 Bestdori 实机截图对标 / 旧实现组合反推，2026-08-24；导出供测试与调参） ----
export const NOTE_SKIN_GEOMETRY = {
  /** 主音符设计尺寸（render.ts 消费缺省值：NOTE_ICON_SIZE × NOTE_HEIGHT_SCALE） */
  MAIN_W: 36,
  MAIN_H: 21.6,
  /** 滑键箭头：墨迹宽 = 主体宽 × 0.68；墨迹底部落在主体中心线上方 3px（图5 紧贴观感） */
  FLICK_TOP_INK_W_RATIO: 0.68,
  FLICK_TOP_INK_BOTTOM_Y: -3,
  /** 方向键：本体设计宽 45（DIRECTIONAL_ICON_SIZE）；箭头墨迹高 16；
   *  箭头中线相对本体中线的外推量（设计 px）。
   *  第 1 轮：OVERLAP=15 → 箭头塞本体正中（重叠）
   *  第 2 轮：INTO_BODY=5（向内偏移 5px）→ 箭头完全在本体内（外缘不外露）
   *  第 3 轮：INTO_BODY=0（无偏移）→ 箭头中线在本体外缘附近，外缘露本体外 2-3px（"一点点距离"）
   *  更大值（如 15）会让外缘明显外露、像两个独立元素。 */
  DIR_BODY_HALF_W: 22.5,
  DIR_CHEVRON_INK_H: 16,
  DIR_CHEVRON_INTO_BODY: 3,
} as const;

export function getNoteSkinPack(id: string): NoteSkinPack | undefined {
  return NOTE_SKIN_PACKS.find((p) => p.id === id);
}

export function listNoteSkinPacks(): NoteSkinPack[] {
  return NOTE_SKIN_PACKS;
}

/** 默认选择（六条目默认值，来自构建期生成器）；供 UI 判定"是否已覆盖" */
export const DEFAULT_NOTE_SKIN_SELECTION: NoteSkinSelection = NOTE_SKIN_DEFAULT_SELECTION as NoteSkinSelection;

/** 选择归一化：缺字段/包不存在/类别不符 → 默认包（定案 Q10 静默回退） */
export function normalizeNoteSkinSelection(raw: unknown): NoteSkinSelection {
  const sel = { ...NOTE_SKIN_DEFAULT_SELECTION } as NoteSkinSelection;
  if (!raw || typeof raw !== 'object') return sel;
  const obj = raw as Record<string, unknown>;
  for (const item of NOTE_SKIN_ITEM_IDS) {
    const v = obj[item];
    if (typeof v !== 'string') continue;
    const pack = getNoteSkinPack(v);
    if (!pack) continue;
    if (pack.kind !== NOTE_SKIN_ITEM_META[item].eligible) continue;
    sel[item] = v;
  }
  return sel;
}

/** 官方矩形 → 渲染配置（src 指向包图集） */
function rectToConfig(src: string, r: NoteSkinRect): SpriteIconConfig {
  return { src, x: r.x, y: r.y, w: r.w, h: r.h };
}

function notePack(sel: NoteSkinSelection, item: 'tap' | 'flick' | 'skill' | 'slide'): NoteSkinPackNote {
  // normalize 保证存在且类别正确；这里兜底断言
  const pack = getNoteSkinPack(sel[item]);
  if (!pack || pack.kind !== 'note') throw new Error(`noteSkin: 条目 ${item} 的包 ${sel[item]} 不是音符皮肤包`);
  return pack;
}

function dirPack(sel: NoteSkinSelection, item: 'dirL' | 'dirR'): NoteSkinPackDirectional {
  const pack = getNoteSkinPack(sel[item]);
  if (!pack || pack.kind !== 'directional') throw new Error(`noteSkin: 条目 ${item} 的包 ${sel[item]} 不是方向键皮肤包`);
  return pack;
}

// 方向键墨迹缺省值（构建期墨迹测量失败时的兜底；实测值见注册表 ink）
const DEFAULT_DIR_INK = {
  L: { inkLeft: 42, inkRight: 56 },
  R: { inkLeft: 55, inkRight: 42 },
};

export interface ActiveNoteIcons {
  /** 当前（已归一化）选择，供预览/调试 */
  selection: NoteSkinSelection;
  tapFor(lane: number): SpriteIconConfig;
  flickFor(lane: number): SpriteIconConfig;
  skillFor(lane: number): SpriteIconConfig;
  /** 方向键第 k 条覆盖轨道的精灵（扁平化：任意轨道同图）；k=0 为锚点轨 */
  dirFor(type: 'L' | 'R', lane: number): SpriteIconConfig;
  /** 方向键墨迹（同时点击线端点贴边用）：构建期实测 → overrides 覆写 → 缺省 */
  dirInk(type: 'L' | 'R'): { w: number; inkLeft: number; inkRight: number };
  /** 滑条连接带（整图，渲染时拉伸进连接四边形） */
  slideBand: SpriteIconConfig;
  slideAmongFor(lane: number): SpriteIconConfig;
  /** 滑条端点基底（= note_long 长条端帽；结点带 flick/skill 时由调用方 spread 覆盖） */
  slideEndpointFor(lane: number): SpriteIconConfig;
  /** 滑键顶部箭头装饰（墨迹精确组合；包未提供时为 null） */
  flickTopDecorator: SpriteIconConfig | null;
  /** 方向键整组视觉：N 条覆盖轨道本体 + 最外侧箭头（用户定案 2026-08-24 问题4） */
  dirGroup(type: 'L' | 'R', length: number): DirGroupVisual;
  /** 预热清单：当前选择涉及的全部图片 URL */
  preloadSrcs(): string[];
}

/** 方向键整组视觉：offsetVirtualX 为虚拟 X 偏移（调用方 × viewport.scale）；
 *  extraDesignX / drawW / drawH 为设计 px（调用方 × spriteScale） */
export interface DirGroupVisual {
  bodies: { config: SpriteIconConfig; offsetVirtualX: number }[];
  /** 最外侧箭头（包未提供时为 null） */
  chevron: {
    config: SpriteIconConfig;
    /** 最外侧覆盖轨道相对锚点的虚拟 X 偏移（含符号） */
    offsetVirtualX: number;
    /** 相对该轨道中心的额外设计 px 偏移（含重叠量与墨迹偏心修正，含符号） */
    extraDesignX: number;
    drawW: number;
    drawH: number;
  } | null;
}

export function buildActiveNoteIcons(selection: NoteSkinSelection): ActiveNoteIcons {
  const tapPack = notePack(selection, 'tap');
  const flickPack = notePack(selection, 'flick');
  const skillPack = notePack(selection, 'skill');
  const slidePack = notePack(selection, 'slide');
  const dirLPack = dirPack(selection, 'dirL');
  const dirRPack = dirPack(selection, 'dirR');

  /** 扁平化取图：任意轨道统一取中间轨精灵（视觉修订 1） */
  const flatRect = (pack: NoteSkinPackNote, arr: (NoteSkinRect | null)[], what: string): SpriteIconConfig => {
    const r = arr[FLAT_LANE];
    if (!r) throw new Error(`noteSkin: ${pack.id} 缺 ${what} 精灵`);
    return rectToConfig(pack.atlas, r);
  };
  const flatDirRect = (pack: NoteSkinPackDirectional, arr: (NoteSkinRect | null)[], what: string): SpriteIconConfig => {
    const r = arr[FLAT_LANE];
    if (!r) throw new Error(`noteSkin: ${pack.id} 缺 ${what} 精灵`);
    return rectToConfig(pack.atlas, r);
  };

  const tapConfig = flatRect(tapPack, tapPack.tap, 'tap');
  const flickConfig = flatRect(flickPack, flickPack.flick, 'flick');
  const skillConfig = flatRect(skillPack, skillPack.skill, 'skill');
  const longConfig = flatRect(slidePack, slidePack.long, 'long');
  const amongConfig = slidePack.slideAmong ? rectToConfig(slidePack.atlas, slidePack.slideAmong) : longConfig;
  const dirLConfig = flatDirRect(dirLPack, dirLPack.dirL, 'dirL');
  const dirRConfig = flatDirRect(dirRPack, dirRPack.dirR, 'dirR');

  // 滑键箭头（视觉修订 3）：墨迹宽 = 主体 × 0.68，墨迹底部压在主体中心线上方 3px，墨迹水平居中
  const flickTopDecorator: SpriteIconConfig | null = (() => {
    const top = flickPack.flickTop;
    const ink = flickPack.ink['note_flick_top'];
    if (!top || !ink) return null;
    const inkW = top.w - ink.left - ink.right;
    const inkH = top.h - ink.top - ink.bottom;
    if (inkW <= 0 || inkH <= 0) return null;
    const drawW = NOTE_SKIN_GEOMETRY.MAIN_W * NOTE_SKIN_GEOMETRY.FLICK_TOP_INK_W_RATIO * (top.w / inkW);
    const drawH = drawW * (top.h / top.w);
    const inkBottomF = (top.h - ink.bottom) / top.h;
    const offsetY = NOTE_SKIN_GEOMETRY.FLICK_TOP_INK_BOTTOM_Y - drawH * (inkBottomF - 0.5);
    const inkCenterXF = (ink.left + inkW / 2) / top.w;
    const offsetX = -(inkCenterXF - 0.5) * drawW;
    return {
      ...rectToConfig(flickPack.atlas, top),
      offsetX,
      offsetY,
      scaleX: drawW / NOTE_SKIN_GEOMETRY.MAIN_W,
      scaleY: drawH / NOTE_SKIN_GEOMETRY.MAIN_H,
      zIndex: 10,
    };
  })();

  const dirInkCfg = (type: 'L' | 'R') => {
    const pack = type === 'L' ? dirLPack : dirRPack;
    const override = type === 'L' ? pack.inkL : pack.inkR;
    if (override) return { w: (type === 'L' ? pack.dirL[FLAT_LANE] : pack.dirR[FLAT_LANE])?.w ?? 308, inkLeft: override.inkLeft, inkRight: override.inkRight };
    // 构建期实测墨迹（本体精灵的左右不透明缩进）
    const name = type === 'L' ? `note_flick_l_${FLAT_LANE}` : `note_flick_r_${FLAT_LANE}`;
    const measured = pack.ink[name];
    const rect = (type === 'L' ? pack.dirL[FLAT_LANE] : pack.dirR[FLAT_LANE]);
    if (measured && rect) return { w: rect.w, inkLeft: measured.left, inkRight: measured.right };
    const dft = DEFAULT_DIR_INK[type];
    return { w: 308, inkLeft: dft.inkLeft, inkRight: dft.inkRight };
  };

  const dirGroup = (type: 'L' | 'R', length: number): DirGroupVisual => {
    const pack = type === 'L' ? dirLPack : dirRPack;
    const sign = type === 'L' ? -1 : 1;
    const len = Math.min(Math.max(Math.round(length) || 1, 1), 3);
    const config = type === 'L' ? dirLConfig : dirRConfig;
    const bodies = Array.from({ length: len }, (_, k) => ({
      config,
      offsetVirtualX: sign * k * LANE_WIDTH,
    }));

    // 外侧箭头（视觉修订 4 第 2 轮 2026-08-25）：箭头中线 = 本体外缘 - sign * DIR_CHEVRON_INTO_BODY
    //   即箭头中线相对本体远缘 = sign * (DIR_BODY_HALF_W - DIR_CHEVRON_INTO_BODY)（负=L 在本体内，正=R 在本体内）
    //   箭头墨迹半宽 inkHalfW，箭头左(L)/右(R)墨迹缘相对本体远缘 = -(DIR_BODY_HALF_W - DIR_CHEVRON_INTO_BODY) ± inkHalfW
    //   INTO_BODY > inkHalfW：箭头左半压本体；INTO_BODY = inkHalfW：箭头左缘贴本体外缘；INTO_BODY < inkHalfW：箭头部分外露
    const topRect = type === 'L' ? pack.flickTopL : pack.flickTopR;
    const ink = pack.ink[type === 'L' ? 'note_flick_top_l' : 'note_flick_top_r'];
    let chevron: DirGroupVisual['chevron'] = null;
    if (topRect && ink) {
      const inkW = topRect.w - ink.left - ink.right;
      const inkH = topRect.h - ink.top - ink.bottom;
      if (inkW > 0 && inkH > 0) {
        const drawH = NOTE_SKIN_GEOMETRY.DIR_CHEVRON_INK_H * (topRect.h / inkH);
        const drawW = drawH * (topRect.w / topRect.h);
        const inkHalfW = (drawW * inkW) / topRect.w / 2;
        const inkCenterXF = (ink.left + inkW / 2) / topRect.w;
        // 箭头中线相对本体中线（设计 px）：sign 决定方向，INTO_BODY 控制向内吃进量
        const arrowCenterX = sign * (NOTE_SKIN_GEOMETRY.DIR_BODY_HALF_W - NOTE_SKIN_GEOMETRY.DIR_CHEVRON_INTO_BODY);
        chevron = {
          config: rectToConfig(pack.atlas, topRect),
          offsetVirtualX: sign * (len - 1) * LANE_WIDTH,
          extraDesignX: arrowCenterX - (inkCenterXF - 0.5) * drawW,
          drawW,
          drawH,
        };
        void inkHalfW; // 保留为未来 if 调整用（断言可见性）
      }
    }
    return { bodies, chevron };
  };

  return {
    selection,
    tapFor: () => tapConfig,
    flickFor: () => flickConfig,
    skillFor: () => skillConfig,
    dirFor: (type) => (type === 'L' ? dirLConfig : dirRConfig),
    dirInk: dirInkCfg,
    slideBand: { src: slidePack.band, x: 0, y: 0, w: slidePack.bandW, h: slidePack.bandH },
    slideAmongFor: () => amongConfig,
    slideEndpointFor: () => longConfig,
    flickTopDecorator,
    dirGroup,
    preloadSrcs: () => [...new Set([tapPack.atlas, flickPack.atlas, skillPack.atlas, slidePack.band, dirLPack.atlas, dirRPack.atlas])],
  };
}