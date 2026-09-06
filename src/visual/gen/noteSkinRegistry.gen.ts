// 由 scripts/build-note-skins.mjs 从 docs/resource/bestdori 归档生成（issue 29）——勿手改。
// 坐标来源：各包 .sprites 的官方精灵矩形（源图像素，左上角原点）；扩容/重生成见脚本头部说明。
// 归档目录不入库不入运行时；此处产物（本文件 + public/assets/skins/<packId>/）已入库。

export interface NoteSkinRect { x: number; y: number; w: number; h: number; }

/** 方向键墨迹缩进（源像素）：同时点击线贴墨迹边缘用（issue 40 同名语义） */
export interface NoteSkinInk { inkLeft: number; inkRight: number; }

/** 精灵不透明墨迹边界（构建期对 PNG 实测的源像素缩进），供运行时精确组合箭头/贴边 */
export interface NoteSkinInkBox { left: number; top: number; right: number; bottom: number; }

export interface NoteSkinPackNote {
  kind: 'note';
  id: string;
  label: string;
  atlas: string;
  atlasW: number;
  atlasH: number;
  /** 单键 note_normal_<lane>，下标 = 轨道 0..6 */
  tap: (NoteSkinRect | null)[];
  /** 虚拍款 note_normal_16_<lane>（issue 39 #4 色觉辅助：非半拍整数倍位置的 tap 款式；缺该精灵的包为 null，渲染回退普通款） */
  tapVirtual: (NoteSkinRect | null)[];
  /** 滑键主体 note_flick_<lane>（菱形本体，箭头为独立 flickTop） */
  flick: (NoteSkinRect | null)[];
  /** 技能键 note_skill_<lane> */
  skill: (NoteSkinRect | null)[];
  /** 长条端帽 note_long_<lane>（滑条端点基底，用户定案 2026-08-24 问题2） */
  long: (NoteSkinRect | null)[];
  /** 滑键顶部箭头 note_flick_top */
  flickTop: NoteSkinRect | null;
  /** 滑条中间结点 note_slide_among */
  slideAmong: NoteSkinRect | null;
  /** 精灵墨迹边界（Record<精灵名, ink>） */
  ink: Record<string, NoteSkinInkBox>;
  /** 滑条连接带 longNoteLine.png（整图拉伸） */
  band: string;
  bandW: number;
  bandH: number;
  /** SP 滑条连接带 longNoteLine2.png（本轮仅随包提供，渲染接线归 issue 09） */
  bandSp: string | null;
  bandSpW: number;
  bandSpH: number;
  /** 同时点击线贴图（本轮维持矢量线，仅随包提供） */
  simultaneous: string | null;
  simultaneousW: number;
  simultaneousH: number;
  /** 同编号配对的方向包（整包预设一键应用用）；无配对为 null */
  pairedDir: string | null;
}

export interface NoteSkinPackDirectional {
  kind: 'directional';
  id: string;
  label: string;
  atlas: string;
  atlasW: number;
  atlasH: number;
  /** 左方向键 note_flick_l_<lane>（完整外观，含箭头） */
  dirL: (NoteSkinRect | null)[];
  /** 右方向键 note_flick_r_<lane> */
  dirR: (NoteSkinRect | null)[];
  /** 左方向箭头 note_flick_top_l（组装到方向滑键最外侧，用户定案 2026-08-24 问题4） */
  flickTopL: NoteSkinRect | null;
  /** 右方向箭头 note_flick_top_r */
  flickTopR: NoteSkinRect | null;
  /** 精灵墨迹边界（Record<精灵名, ink>） */
  ink: Record<string, NoteSkinInkBox>;
  /** 可选墨迹覆写（overrides 注入） */
  inkL?: NoteSkinInk;
  inkR?: NoteSkinInk;
}

export type NoteSkinPack = NoteSkinPackNote | NoteSkinPackDirectional;

export const NOTE_SKIN_PACKS: NoteSkinPack[] = [
  {
    "kind": "note",
    "id": "skin00",
    "label": "Skin 00",
    "atlas": "./assets/skins/skin00/RhythmGameSprites.png",
    "atlasW": 2048,
    "atlasH": 1024,
    "tap": [
      {
        "x": 620,
        "y": 172,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 416,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 1550,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 50,
        "w": 308,
        "h": 120
      },
      {
        "x": 1550,
        "y": 782,
        "w": 308,
        "h": 120
      }
    ],
    "tapVirtual": [
      {
        "x": 930,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 50,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 1550,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 538,
        "w": 308,
        "h": 120
      }
    ],
    "flick": [
      {
        "x": 620,
        "y": 294,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 50,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 172,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 416,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 660,
        "w": 308,
        "h": 120
      }
    ],
    "skill": [
      {
        "x": 930,
        "y": 172,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 416,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 172,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 294,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 416,
        "w": 308,
        "h": 120
      }
    ],
    "long": [
      {
        "x": 1550,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 50,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 294,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 538,
        "w": 308,
        "h": 120
      }
    ],
    "flickTop": {
      "x": 1240,
      "y": 32,
      "w": 171,
      "h": 138
    },
    "slideAmong": {
      "x": 310,
      "y": 294,
      "w": 308,
      "h": 120
    },
    "ink": {
      "note_flick_2": {
        "left": 4,
        "top": 9,
        "right": 6,
        "bottom": 9
      },
      "note_normal_0": {
        "left": 4,
        "top": 9,
        "right": 4,
        "bottom": 10
      },
      "note_skill_3": {
        "left": 4,
        "top": 9,
        "right": 4,
        "bottom": 9
      },
      "note_long_flash_5": {
        "left": 4,
        "top": 9,
        "right": 4,
        "bottom": 9
      },
      "note_long_flash_4": {
        "left": 5,
        "top": 9,
        "right": 5,
        "bottom": 9
      },
      "note_long_5": {
        "left": 5,
        "top": 9,
        "right": 4,
        "bottom": 9
      },
      "note_skill_5": {
        "left": 4,
        "top": 9,
        "right": 4,
        "bottom": 9
      },
      "note_skill_2": {
        "left": 4,
        "top": 9,
        "right": 5,
        "bottom": 9
      },
      "note_long_flash_3": {
        "left": 5,
        "top": 9,
        "right": 5,
        "bottom": 9
      },
      "note_long_flash_2": {
        "left": 5,
        "top": 9,
        "right": 5,
        "bottom": 9
      },
      "note_normal_16_1": {
        "left": 5,
        "top": 9,
        "right": 5,
        "bottom": 10
      },
      "note_slide_among": {
        "left": 5,
        "top": 47,
        "right": 5,
        "bottom": 51
      },
      "note_long_2": {
        "left": 4,
        "top": 9,
        "right": 5,
        "bottom": 9
      },
      "note_skill_1": {
        "left": 4,
        "top": 9,
        "right": 4,
        "bottom": 9
      },
      "note_normal_2": {
        "left": 4,
        "top": 9,
        "right": 4,
        "bottom": 10
      },
      "note_flick_1": {
        "left": 5,
        "top": 9,
        "right": 5,
        "bottom": 9
      },
      "note_flick_6": {
        "left": 4,
        "top": 9,
        "right": 2,
        "bottom": 9
      },
      "note_normal_16_5": {
        "left": 4,
        "top": 9,
        "right": 3,
        "bottom": 10
      },
      "note_normal_16_3": {
        "left": 5,
        "top": 9,
        "right": 5,
        "bottom": 10
      },
      "note_normal_16_0": {
        "left": 3,
        "top": 9,
        "right": 4,
        "bottom": 10
      },
      "note_normal_6": {
        "left": 4,
        "top": 9,
        "right": 3,
        "bottom": 10
      },
      "note_long_3": {
        "left": 5,
        "top": 9,
        "right": 5,
        "bottom": 9
      },
      "note_flick_0": {
        "left": 3,
        "top": 9,
        "right": 4,
        "bottom": 9
      },
      "note_long_flash_6": {
        "left": 4,
        "top": 9,
        "right": 3,
        "bottom": 9
      },
      "note_flick_3": {
        "left": 6,
        "top": 9,
        "right": 6,
        "bottom": 9
      },
      "note_normal_1": {
        "left": 4,
        "top": 9,
        "right": 4,
        "bottom": 10
      },
      "note_long_4": {
        "left": 5,
        "top": 9,
        "right": 5,
        "bottom": 9
      },
      "note_normal_16_2": {
        "left": 6,
        "top": 9,
        "right": 5,
        "bottom": 10
      },
      "note_long_0": {
        "left": 3,
        "top": 9,
        "right": 4,
        "bottom": 9
      },
      "note_flick_5": {
        "left": 4,
        "top": 9,
        "right": 5,
        "bottom": 9
      },
      "note_long_flash_1": {
        "left": 4,
        "top": 9,
        "right": 4,
        "bottom": 9
      },
      "note_skill_0": {
        "left": 3,
        "top": 9,
        "right": 4,
        "bottom": 9
      },
      "note_long_flash_0": {
        "left": 3,
        "top": 9,
        "right": 4,
        "bottom": 9
      },
      "note_normal_3": {
        "left": 5,
        "top": 9,
        "right": 5,
        "bottom": 10
      },
      "note_normal_16_4": {
        "left": 4,
        "top": 9,
        "right": 6,
        "bottom": 10
      },
      "note_skill_6": {
        "left": 4,
        "top": 9,
        "right": 4,
        "bottom": 9
      },
      "note_normal_5": {
        "left": 5,
        "top": 9,
        "right": 4,
        "bottom": 10
      },
      "note_flick_4": {
        "left": 6,
        "top": 9,
        "right": 4,
        "bottom": 9
      },
      "note_normal_4": {
        "left": 4,
        "top": 9,
        "right": 5,
        "bottom": 10
      },
      "note_flick_top": {
        "left": 7,
        "top": 3,
        "right": 7,
        "bottom": 8
      },
      "note_normal_16_6": {
        "left": 4,
        "top": 9,
        "right": 4,
        "bottom": 10
      },
      "note_skill_4": {
        "left": 5,
        "top": 9,
        "right": 5,
        "bottom": 9
      },
      "note_long_6": {
        "left": 4,
        "top": 9,
        "right": 4,
        "bottom": 9
      },
      "note_long_1": {
        "left": 5,
        "top": 9,
        "right": 4,
        "bottom": 9
      }
    },
    "band": "./assets/skins/skin00/longNoteLine.png",
    "bandW": 146,
    "bandH": 205,
    "bandSp": "./assets/skins/skin00/longNoteLine2.png",
    "bandSpW": 146,
    "bandSpH": 205,
    "simultaneous": "./assets/skins/skin00/simultaneous_line.png",
    "simultaneousW": 10,
    "simultaneousH": 27,
    "pairedDir": "directionalflickskin00"
  },
  {
    "kind": "note",
    "id": "skin01",
    "label": "Skin 01",
    "atlas": "./assets/skins/skin01/RhythmGameSprites.png",
    "atlasW": 2048,
    "atlasH": 1024,
    "tap": [
      {
        "x": 620,
        "y": 172,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 416,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 1550,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 50,
        "w": 308,
        "h": 120
      },
      {
        "x": 1550,
        "y": 782,
        "w": 308,
        "h": 120
      }
    ],
    "tapVirtual": [
      {
        "x": 930,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 50,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 1550,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 538,
        "w": 308,
        "h": 120
      }
    ],
    "flick": [
      {
        "x": 620,
        "y": 294,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 50,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 172,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 416,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 660,
        "w": 308,
        "h": 120
      }
    ],
    "skill": [
      {
        "x": 930,
        "y": 172,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 416,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 172,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 294,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 416,
        "w": 308,
        "h": 120
      }
    ],
    "long": [
      {
        "x": 1550,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 50,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 294,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 538,
        "w": 308,
        "h": 120
      }
    ],
    "flickTop": {
      "x": 1240,
      "y": 32,
      "w": 171,
      "h": 138
    },
    "slideAmong": {
      "x": 310,
      "y": 294,
      "w": 308,
      "h": 120
    },
    "ink": {
      "note_long_flash_4": {
        "left": 24,
        "top": 7,
        "right": 22,
        "bottom": 7
      },
      "note_normal_2": {
        "left": 23,
        "top": 8,
        "right": 25,
        "bottom": 7
      },
      "note_long_flash_2": {
        "left": 22,
        "top": 7,
        "right": 24,
        "bottom": 7
      },
      "note_long_5": {
        "left": 24,
        "top": 7,
        "right": 19,
        "bottom": 7
      },
      "note_skill_2": {
        "left": 22,
        "top": 7,
        "right": 25,
        "bottom": 7
      },
      "note_normal_16_2": {
        "left": 23,
        "top": 8,
        "right": 25,
        "bottom": 7
      },
      "note_skill_6": {
        "left": 21,
        "top": 7,
        "right": 14,
        "bottom": 7
      },
      "note_long_6": {
        "left": 21,
        "top": 7,
        "right": 14,
        "bottom": 7
      },
      "note_normal_1": {
        "left": 19,
        "top": 8,
        "right": 24,
        "bottom": 7
      },
      "note_long_3": {
        "left": 24,
        "top": 7,
        "right": 24,
        "bottom": 7
      },
      "note_slide_among": {
        "left": 1,
        "top": 49,
        "right": 0,
        "bottom": 48
      },
      "note_long_0": {
        "left": 14,
        "top": 7,
        "right": 21,
        "bottom": 7
      },
      "note_normal_6": {
        "left": 21,
        "top": 8,
        "right": 14,
        "bottom": 7
      },
      "note_long_flash_1": {
        "left": 18,
        "top": 7,
        "right": 22,
        "bottom": 7
      },
      "note_normal_4": {
        "left": 25,
        "top": 8,
        "right": 22,
        "bottom": 7
      },
      "note_long_1": {
        "left": 19,
        "top": 7,
        "right": 24,
        "bottom": 7
      },
      "note_normal_16_4": {
        "left": 24,
        "top": 8,
        "right": 23,
        "bottom": 7
      },
      "note_skill_3": {
        "left": 25,
        "top": 7,
        "right": 25,
        "bottom": 7
      },
      "note_normal_16_3": {
        "left": 25,
        "top": 8,
        "right": 24,
        "bottom": 7
      },
      "note_long_flash_5": {
        "left": 22,
        "top": 7,
        "right": 18,
        "bottom": 7
      },
      "note_normal_16_5": {
        "left": 24,
        "top": 8,
        "right": 19,
        "bottom": 7
      },
      "note_flick_4": {
        "left": 26,
        "top": 7,
        "right": 25,
        "bottom": 8
      },
      "note_flick_2": {
        "left": 25,
        "top": 7,
        "right": 26,
        "bottom": 8
      },
      "note_skill_1": {
        "left": 19,
        "top": 7,
        "right": 24,
        "bottom": 7
      },
      "note_long_flash_6": {
        "left": 20,
        "top": 7,
        "right": 13,
        "bottom": 7
      },
      "note_skill_5": {
        "left": 24,
        "top": 7,
        "right": 19,
        "bottom": 7
      },
      "note_flick_1": {
        "left": 23,
        "top": 7,
        "right": 26,
        "bottom": 8
      },
      "note_long_4": {
        "left": 24,
        "top": 7,
        "right": 23,
        "bottom": 7
      },
      "note_normal_16_6": {
        "left": 21,
        "top": 8,
        "right": 15,
        "bottom": 7
      },
      "note_normal_16_0": {
        "left": 15,
        "top": 8,
        "right": 21,
        "bottom": 7
      },
      "note_normal_0": {
        "left": 15,
        "top": 8,
        "right": 20,
        "bottom": 7
      },
      "note_skill_4": {
        "left": 24,
        "top": 7,
        "right": 23,
        "bottom": 7
      },
      "note_flick_6": {
        "left": 25,
        "top": 7,
        "right": 21,
        "bottom": 8
      },
      "note_normal_16_1": {
        "left": 19,
        "top": 7,
        "right": 24,
        "bottom": 7
      },
      "note_long_flash_3": {
        "left": 24,
        "top": 7,
        "right": 24,
        "bottom": 7
      },
      "note_flick_5": {
        "left": 26,
        "top": 7,
        "right": 23,
        "bottom": 8
      },
      "note_long_flash_0": {
        "left": 13,
        "top": 7,
        "right": 20,
        "bottom": 7
      },
      "note_flick_0": {
        "left": 21,
        "top": 7,
        "right": 25,
        "bottom": 8
      },
      "note_long_2": {
        "left": 23,
        "top": 7,
        "right": 25,
        "bottom": 7
      },
      "note_normal_5": {
        "left": 24,
        "top": 8,
        "right": 19,
        "bottom": 7
      },
      "note_skill_0": {
        "left": 14,
        "top": 7,
        "right": 21,
        "bottom": 7
      },
      "note_flick_top": {
        "left": 4,
        "top": 0,
        "right": 4,
        "bottom": 2
      },
      "note_flick_3": {
        "left": 26,
        "top": 7,
        "right": 26,
        "bottom": 8
      },
      "note_normal_3": {
        "left": 25,
        "top": 8,
        "right": 25,
        "bottom": 7
      }
    },
    "band": "./assets/skins/skin01/longNoteLine.png",
    "bandW": 146,
    "bandH": 205,
    "bandSp": "./assets/skins/skin01/longNoteLine2.png",
    "bandSpW": 146,
    "bandSpH": 205,
    "simultaneous": "./assets/skins/skin01/simultaneous_line.png",
    "simultaneousW": 10,
    "simultaneousH": 27,
    "pairedDir": "directionalflickskin01"
  },
  {
    "kind": "note",
    "id": "skin02",
    "label": "Skin 02",
    "atlas": "./assets/skins/skin02/RhythmGameSprites.png",
    "atlasW": 2048,
    "atlasH": 1024,
    "tap": [
      {
        "x": 0,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 172,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 294,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 50,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 172,
        "w": 308,
        "h": 120
      }
    ],
    "tapVirtual": [
      {
        "x": 0,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 50,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 294,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 416,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 50,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 50,
        "w": 308,
        "h": 120
      }
    ],
    "flick": [
      {
        "x": 0,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 172,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 416,
        "w": 308,
        "h": 120
      },
      {
        "x": 1550,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 172,
        "w": 308,
        "h": 120
      }
    ],
    "skill": [
      {
        "x": 310,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 172,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 294,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 538,
        "w": 308,
        "h": 120
      }
    ],
    "long": [
      {
        "x": 620,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 416,
        "w": 308,
        "h": 120
      },
      {
        "x": 1550,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 1550,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 294,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 416,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 782,
        "w": 308,
        "h": 120
      }
    ],
    "flickTop": {
      "x": 1240,
      "y": 32,
      "w": 171,
      "h": 138
    },
    "slideAmong": {
      "x": 1550,
      "y": 782,
      "w": 308,
      "h": 120
    },
    "ink": {
      "note_normal_3": {
        "left": 34,
        "top": 9,
        "right": 34,
        "bottom": 10
      },
      "note_normal_1": {
        "left": 30,
        "top": 9,
        "right": 33,
        "bottom": 10
      },
      "note_long_0": {
        "left": 26,
        "top": 9,
        "right": 30,
        "bottom": 10
      },
      "note_normal_16_6": {
        "left": 29,
        "top": 9,
        "right": 27,
        "bottom": 10
      },
      "note_flick_5": {
        "left": 34,
        "top": 9,
        "right": 34,
        "bottom": 10
      },
      "note_long_5": {
        "left": 32,
        "top": 9,
        "right": 31,
        "bottom": 10
      },
      "note_skill_1": {
        "left": 30,
        "top": 9,
        "right": 33,
        "bottom": 10
      },
      "note_skill_2": {
        "left": 32,
        "top": 9,
        "right": 34,
        "bottom": 10
      },
      "note_long_2": {
        "left": 32,
        "top": 9,
        "right": 34,
        "bottom": 10
      },
      "note_slide_among": {
        "left": 5,
        "top": 49,
        "right": 6,
        "bottom": 54
      },
      "note_normal_2": {
        "left": 32,
        "top": 9,
        "right": 34,
        "bottom": 10
      },
      "note_flick_top": {
        "left": 5,
        "top": 1,
        "right": 5,
        "bottom": 5
      },
      "note_flick_2": {
        "left": 34,
        "top": 9,
        "right": 35,
        "bottom": 10
      },
      "note_skill_6": {
        "left": 29,
        "top": 9,
        "right": 27,
        "bottom": 10
      },
      "note_normal_16_2": {
        "left": 32,
        "top": 9,
        "right": 34,
        "bottom": 10
      },
      "note_flick_0": {
        "left": 32,
        "top": 9,
        "right": 34,
        "bottom": 10
      },
      "note_skill_3": {
        "left": 34,
        "top": 9,
        "right": 34,
        "bottom": 10
      },
      "note_normal_16_4": {
        "left": 34,
        "top": 9,
        "right": 33,
        "bottom": 10
      },
      "note_long_flash_0": {
        "left": 26,
        "top": 9,
        "right": 30,
        "bottom": 10
      },
      "note_normal_16_3": {
        "left": 34,
        "top": 9,
        "right": 34,
        "bottom": 10
      },
      "note_normal_16_0": {
        "left": 26,
        "top": 9,
        "right": 30,
        "bottom": 10
      },
      "note_normal_5": {
        "left": 32,
        "top": 9,
        "right": 31,
        "bottom": 10
      },
      "note_long_flash_5": {
        "left": 32,
        "top": 9,
        "right": 31,
        "bottom": 10
      },
      "note_long_flash_1": {
        "left": 30,
        "top": 9,
        "right": 33,
        "bottom": 10
      },
      "note_long_flash_3": {
        "left": 34,
        "top": 9,
        "right": 34,
        "bottom": 10
      },
      "note_long_1": {
        "left": 30,
        "top": 9,
        "right": 33,
        "bottom": 10
      },
      "note_normal_16_5": {
        "left": 32,
        "top": 9,
        "right": 31,
        "bottom": 10
      },
      "note_long_flash_6": {
        "left": 29,
        "top": 9,
        "right": 27,
        "bottom": 10
      },
      "note_long_3": {
        "left": 34,
        "top": 9,
        "right": 34,
        "bottom": 10
      },
      "note_flick_6": {
        "left": 33,
        "top": 9,
        "right": 33,
        "bottom": 10
      },
      "note_normal_6": {
        "left": 29,
        "top": 9,
        "right": 27,
        "bottom": 10
      },
      "note_normal_4": {
        "left": 34,
        "top": 9,
        "right": 33,
        "bottom": 10
      },
      "note_long_4": {
        "left": 34,
        "top": 9,
        "right": 33,
        "bottom": 10
      },
      "note_skill_5": {
        "left": 32,
        "top": 9,
        "right": 31,
        "bottom": 10
      },
      "note_long_flash_4": {
        "left": 34,
        "top": 9,
        "right": 33,
        "bottom": 10
      },
      "note_skill_4": {
        "left": 34,
        "top": 9,
        "right": 33,
        "bottom": 10
      },
      "note_long_6": {
        "left": 29,
        "top": 9,
        "right": 27,
        "bottom": 10
      },
      "note_long_flash_2": {
        "left": 32,
        "top": 9,
        "right": 34,
        "bottom": 10
      },
      "note_skill_0": {
        "left": 26,
        "top": 9,
        "right": 30,
        "bottom": 10
      },
      "note_flick_3": {
        "left": 34,
        "top": 9,
        "right": 35,
        "bottom": 10
      },
      "note_flick_1": {
        "left": 33,
        "top": 9,
        "right": 34,
        "bottom": 10
      },
      "note_flick_4": {
        "left": 34,
        "top": 9,
        "right": 34,
        "bottom": 10
      },
      "note_normal_16_1": {
        "left": 30,
        "top": 9,
        "right": 33,
        "bottom": 10
      },
      "note_normal_0": {
        "left": 26,
        "top": 9,
        "right": 30,
        "bottom": 10
      }
    },
    "band": "./assets/skins/skin02/longNoteLine.png",
    "bandW": 146,
    "bandH": 205,
    "bandSp": "./assets/skins/skin02/longNoteLine2.png",
    "bandSpW": 146,
    "bandSpH": 205,
    "simultaneous": "./assets/skins/skin02/simultaneous_line.png",
    "simultaneousW": 10,
    "simultaneousH": 27,
    "pairedDir": "directionalflickskin02"
  },
  {
    "kind": "note",
    "id": "skin03",
    "label": "Skin 03",
    "atlas": "./assets/skins/skin03/RhythmGameSprites.png",
    "atlasW": 2048,
    "atlasH": 1024,
    "tap": [
      {
        "x": 0,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 172,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 294,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 50,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 172,
        "w": 308,
        "h": 120
      }
    ],
    "tapVirtual": [
      {
        "x": 0,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 50,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 294,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 416,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 50,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 50,
        "w": 308,
        "h": 120
      }
    ],
    "flick": [
      {
        "x": 0,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 172,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 416,
        "w": 308,
        "h": 120
      },
      {
        "x": 1550,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 172,
        "w": 308,
        "h": 120
      }
    ],
    "skill": [
      {
        "x": 310,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 172,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 294,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 538,
        "w": 308,
        "h": 120
      }
    ],
    "long": [
      {
        "x": 620,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 416,
        "w": 308,
        "h": 120
      },
      {
        "x": 1550,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 1550,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 294,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 416,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 782,
        "w": 308,
        "h": 120
      }
    ],
    "flickTop": {
      "x": 1240,
      "y": 32,
      "w": 171,
      "h": 138
    },
    "slideAmong": {
      "x": 1550,
      "y": 782,
      "w": 308,
      "h": 120
    },
    "ink": {
      "note_flick_3": {
        "left": 13,
        "top": 9,
        "right": 13,
        "bottom": 9
      },
      "note_long_2": {
        "left": 12,
        "top": 9,
        "right": 12,
        "bottom": 9
      },
      "note_long_6": {
        "left": 12,
        "top": 9,
        "right": 12,
        "bottom": 9
      },
      "note_normal_4": {
        "left": 12,
        "top": 9,
        "right": 12,
        "bottom": 9
      },
      "note_slide_among": {
        "left": 2,
        "top": 39,
        "right": 2,
        "bottom": 39
      },
      "note_flick_top": {
        "left": 6,
        "top": 2,
        "right": 6,
        "bottom": 7
      },
      "note_long_flash_3": {
        "left": 12,
        "top": 9,
        "right": 12,
        "bottom": 9
      },
      "note_normal_6": {
        "left": 12,
        "top": 9,
        "right": 12,
        "bottom": 8
      },
      "note_skill_0": {
        "left": 11,
        "top": 9,
        "right": 12,
        "bottom": 9
      },
      "note_skill_5": {
        "left": 12,
        "top": 9,
        "right": 12,
        "bottom": 9
      },
      "note_flick_5": {
        "left": 13,
        "top": 9,
        "right": 13,
        "bottom": 9
      },
      "note_normal_16_3": {
        "left": 12,
        "top": 9,
        "right": 12,
        "bottom": 9
      },
      "note_skill_4": {
        "left": 12,
        "top": 9,
        "right": 12,
        "bottom": 9
      },
      "note_normal_2": {
        "left": 12,
        "top": 9,
        "right": 12,
        "bottom": 9
      },
      "note_normal_16_4": {
        "left": 12,
        "top": 9,
        "right": 13,
        "bottom": 9
      },
      "note_normal_16_5": {
        "left": 12,
        "top": 9,
        "right": 12,
        "bottom": 9
      },
      "note_normal_16_0": {
        "left": 12,
        "top": 9,
        "right": 12,
        "bottom": 9
      },
      "note_skill_2": {
        "left": 12,
        "top": 9,
        "right": 12,
        "bottom": 9
      },
      "note_flick_0": {
        "left": 12,
        "top": 9,
        "right": 13,
        "bottom": 9
      },
      "note_long_flash_2": {
        "left": 12,
        "top": 9,
        "right": 13,
        "bottom": 9
      },
      "note_flick_6": {
        "left": 12,
        "top": 9,
        "right": 12,
        "bottom": 8
      },
      "note_flick_4": {
        "left": 13,
        "top": 9,
        "right": 13,
        "bottom": 9
      },
      "note_long_1": {
        "left": 12,
        "top": 8,
        "right": 12,
        "bottom": 9
      },
      "note_long_flash_1": {
        "left": 12,
        "top": 9,
        "right": 12,
        "bottom": 9
      },
      "note_long_4": {
        "left": 12,
        "top": 8,
        "right": 12,
        "bottom": 9
      },
      "note_normal_16_1": {
        "left": 12,
        "top": 9,
        "right": 13,
        "bottom": 9
      },
      "note_long_flash_4": {
        "left": 12,
        "top": 9,
        "right": 12,
        "bottom": 9
      },
      "note_normal_1": {
        "left": 12,
        "top": 9,
        "right": 12,
        "bottom": 9
      },
      "note_skill_3": {
        "left": 12,
        "top": 9,
        "right": 12,
        "bottom": 9
      },
      "note_normal_16_6": {
        "left": 12,
        "top": 9,
        "right": 12,
        "bottom": 9
      },
      "note_normal_16_2": {
        "left": 12,
        "top": 9,
        "right": 13,
        "bottom": 9
      },
      "note_long_flash_6": {
        "left": 12,
        "top": 9,
        "right": 12,
        "bottom": 9
      },
      "note_flick_2": {
        "left": 13,
        "top": 9,
        "right": 13,
        "bottom": 9
      },
      "note_flick_1": {
        "left": 12,
        "top": 9,
        "right": 13,
        "bottom": 9
      },
      "note_long_flash_0": {
        "left": 12,
        "top": 8,
        "right": 12,
        "bottom": 9
      },
      "note_skill_1": {
        "left": 12,
        "top": 9,
        "right": 12,
        "bottom": 9
      },
      "note_normal_3": {
        "left": 12,
        "top": 9,
        "right": 12,
        "bottom": 9
      },
      "note_skill_6": {
        "left": 12,
        "top": 9,
        "right": 12,
        "bottom": 9
      },
      "note_long_5": {
        "left": 12,
        "top": 9,
        "right": 12,
        "bottom": 9
      },
      "note_long_flash_5": {
        "left": 12,
        "top": 9,
        "right": 12,
        "bottom": 9
      },
      "note_normal_0": {
        "left": 12,
        "top": 9,
        "right": 12,
        "bottom": 9
      },
      "note_normal_5": {
        "left": 12,
        "top": 9,
        "right": 12,
        "bottom": 9
      },
      "note_long_0": {
        "left": 11,
        "top": 8,
        "right": 12,
        "bottom": 9
      },
      "note_long_3": {
        "left": 12,
        "top": 8,
        "right": 12,
        "bottom": 9
      }
    },
    "band": "./assets/skins/skin03/longNoteLine.png",
    "bandW": 146,
    "bandH": 205,
    "bandSp": "./assets/skins/skin03/longNoteLine2.png",
    "bandSpW": 146,
    "bandSpH": 205,
    "simultaneous": "./assets/skins/skin03/simultaneous_line.png",
    "simultaneousW": 10,
    "simultaneousH": 27,
    "pairedDir": "directionalflickskin03"
  },
  {
    "kind": "note",
    "id": "skin04",
    "label": "Skin 04",
    "atlas": "./assets/skins/skin04/RhythmGameSprites.png",
    "atlasW": 2048,
    "atlasH": 1024,
    "tap": [
      {
        "x": 620,
        "y": 172,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 416,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 1550,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 50,
        "w": 308,
        "h": 120
      },
      {
        "x": 1550,
        "y": 782,
        "w": 308,
        "h": 120
      }
    ],
    "tapVirtual": [
      {
        "x": 930,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 50,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 1550,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 538,
        "w": 308,
        "h": 120
      }
    ],
    "flick": [
      {
        "x": 620,
        "y": 294,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 50,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 172,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 416,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 660,
        "w": 308,
        "h": 120
      }
    ],
    "skill": [
      {
        "x": 930,
        "y": 172,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 416,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 172,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 294,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 416,
        "w": 308,
        "h": 120
      }
    ],
    "long": [
      {
        "x": 1550,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 50,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 294,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 538,
        "w": 308,
        "h": 120
      }
    ],
    "flickTop": {
      "x": 1240,
      "y": 32,
      "w": 171,
      "h": 138
    },
    "slideAmong": {
      "x": 310,
      "y": 294,
      "w": 308,
      "h": 120
    },
    "ink": {
      "note_skill_3": {
        "left": 14,
        "top": 29,
        "right": 15,
        "bottom": 23
      },
      "note_long_flash_2": {
        "left": 12,
        "top": 29,
        "right": 15,
        "bottom": 23
      },
      "note_flick_5": {
        "left": 12,
        "top": 29,
        "right": 10,
        "bottom": 23
      },
      "note_flick_top": {
        "left": 7,
        "top": 3,
        "right": 7,
        "bottom": 8
      },
      "note_long_6": {
        "left": 10,
        "top": 29,
        "right": 7,
        "bottom": 23
      },
      "note_normal_6": {
        "left": 10,
        "top": 29,
        "right": 7,
        "bottom": 23
      },
      "note_normal_16_2": {
        "left": 12,
        "top": 29,
        "right": 15,
        "bottom": 23
      },
      "note_flick_1": {
        "left": 10,
        "top": 29,
        "right": 13,
        "bottom": 23
      },
      "note_normal_4": {
        "left": 14,
        "top": 29,
        "right": 13,
        "bottom": 23
      },
      "note_normal_3": {
        "left": 14,
        "top": 29,
        "right": 15,
        "bottom": 23
      },
      "note_long_3": {
        "left": 14,
        "top": 29,
        "right": 15,
        "bottom": 23
      },
      "note_long_2": {
        "left": 12,
        "top": 29,
        "right": 15,
        "bottom": 23
      },
      "note_skill_5": {
        "left": 12,
        "top": 29,
        "right": 11,
        "bottom": 23
      },
      "note_long_flash_5": {
        "left": 12,
        "top": 29,
        "right": 10,
        "bottom": 23
      },
      "note_long_flash_0": {
        "left": 7,
        "top": 29,
        "right": 10,
        "bottom": 23
      },
      "note_long_flash_1": {
        "left": 10,
        "top": 29,
        "right": 13,
        "bottom": 23
      },
      "note_normal_16_6": {
        "left": 10,
        "top": 29,
        "right": 7,
        "bottom": 23
      },
      "note_long_0": {
        "left": 7,
        "top": 29,
        "right": 10,
        "bottom": 23
      },
      "note_skill_1": {
        "left": 10,
        "top": 29,
        "right": 13,
        "bottom": 23
      },
      "note_long_4": {
        "left": 14,
        "top": 29,
        "right": 13,
        "bottom": 23
      },
      "note_normal_1": {
        "left": 10,
        "top": 29,
        "right": 13,
        "bottom": 23
      },
      "note_skill_4": {
        "left": 14,
        "top": 29,
        "right": 13,
        "bottom": 23
      },
      "note_normal_16_4": {
        "left": 14,
        "top": 29,
        "right": 13,
        "bottom": 23
      },
      "note_flick_4": {
        "left": 14,
        "top": 29,
        "right": 13,
        "bottom": 23
      },
      "note_skill_0": {
        "left": 7,
        "top": 29,
        "right": 10,
        "bottom": 23
      },
      "note_long_flash_4": {
        "left": 14,
        "top": 29,
        "right": 13,
        "bottom": 23
      },
      "note_normal_0": {
        "left": 7,
        "top": 29,
        "right": 10,
        "bottom": 23
      },
      "note_flick_2": {
        "left": 12,
        "top": 29,
        "right": 15,
        "bottom": 23
      },
      "note_normal_2": {
        "left": 12,
        "top": 29,
        "right": 15,
        "bottom": 23
      },
      "note_normal_16_3": {
        "left": 14,
        "top": 29,
        "right": 15,
        "bottom": 23
      },
      "note_long_flash_6": {
        "left": 10,
        "top": 29,
        "right": 7,
        "bottom": 23
      },
      "note_skill_6": {
        "left": 10,
        "top": 29,
        "right": 7,
        "bottom": 23
      },
      "note_flick_0": {
        "left": 7,
        "top": 29,
        "right": 10,
        "bottom": 23
      },
      "note_flick_3": {
        "left": 14,
        "top": 29,
        "right": 15,
        "bottom": 23
      },
      "note_long_flash_3": {
        "left": 14,
        "top": 29,
        "right": 15,
        "bottom": 23
      },
      "note_normal_16_1": {
        "left": 10,
        "top": 29,
        "right": 13,
        "bottom": 23
      },
      "note_normal_16_5": {
        "left": 12,
        "top": 29,
        "right": 11,
        "bottom": 23
      },
      "note_skill_2": {
        "left": 12,
        "top": 29,
        "right": 15,
        "bottom": 23
      },
      "note_long_1": {
        "left": 10,
        "top": 29,
        "right": 13,
        "bottom": 23
      },
      "note_normal_16_0": {
        "left": 7,
        "top": 29,
        "right": 10,
        "bottom": 23
      },
      "note_normal_5": {
        "left": 12,
        "top": 29,
        "right": 11,
        "bottom": 23
      },
      "note_flick_6": {
        "left": 10,
        "top": 29,
        "right": 7,
        "bottom": 23
      },
      "note_slide_among": {
        "left": 1,
        "top": 51,
        "right": 1,
        "bottom": 43
      },
      "note_long_5": {
        "left": 12,
        "top": 29,
        "right": 11,
        "bottom": 23
      }
    },
    "band": "./assets/skins/skin04/longNoteLine.png",
    "bandW": 146,
    "bandH": 205,
    "bandSp": "./assets/skins/skin04/longNoteLine2.png",
    "bandSpW": 146,
    "bandSpH": 205,
    "simultaneous": "./assets/skins/skin04/simultaneous_line.png",
    "simultaneousW": 10,
    "simultaneousH": 27,
    "pairedDir": "directionalflickskin04"
  },
  {
    "kind": "note",
    "id": "skin05",
    "label": "Skin 05",
    "atlas": "./assets/skins/skin05/RhythmGameSprites.png",
    "atlasW": 2048,
    "atlasH": 1024,
    "tap": [
      {
        "x": 0,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 172,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 294,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 50,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 172,
        "w": 308,
        "h": 120
      }
    ],
    "tapVirtual": [
      {
        "x": 0,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 50,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 294,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 416,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 50,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 50,
        "w": 308,
        "h": 120
      }
    ],
    "flick": [
      {
        "x": 0,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 172,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 416,
        "w": 308,
        "h": 120
      },
      {
        "x": 1550,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 172,
        "w": 308,
        "h": 120
      }
    ],
    "skill": [
      {
        "x": 310,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 172,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 294,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 538,
        "w": 308,
        "h": 120
      }
    ],
    "long": [
      {
        "x": 620,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 416,
        "w": 308,
        "h": 120
      },
      {
        "x": 1550,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 1550,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 294,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 416,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 782,
        "w": 308,
        "h": 120
      }
    ],
    "flickTop": {
      "x": 1240,
      "y": 32,
      "w": 171,
      "h": 138
    },
    "slideAmong": {
      "x": 1550,
      "y": 782,
      "w": 308,
      "h": 120
    },
    "ink": {
      "note_long_6": {
        "left": 9,
        "top": 25,
        "right": 3,
        "bottom": 29
      },
      "note_skill_4": {
        "left": 20,
        "top": 25,
        "right": 15,
        "bottom": 29
      },
      "note_normal_16_2": {
        "left": 14,
        "top": 25,
        "right": 21,
        "bottom": 29
      },
      "note_long_5": {
        "left": 15,
        "top": 25,
        "right": 9,
        "bottom": 28
      },
      "note_normal_16_5": {
        "left": 14,
        "top": 25,
        "right": 9,
        "bottom": 29
      },
      "note_long_flash_2": {
        "left": 14,
        "top": 25,
        "right": 20,
        "bottom": 29
      },
      "note_long_1": {
        "left": 8,
        "top": 25,
        "right": 15,
        "bottom": 28
      },
      "note_slide_among": {
        "left": 6,
        "top": 47,
        "right": 6,
        "bottom": 52
      },
      "note_normal_4": {
        "left": 20,
        "top": 25,
        "right": 16,
        "bottom": 29
      },
      "note_skill_5": {
        "left": 14,
        "top": 25,
        "right": 8,
        "bottom": 29
      },
      "note_long_2": {
        "left": 15,
        "top": 25,
        "right": 21,
        "bottom": 28
      },
      "note_long_3": {
        "left": 22,
        "top": 25,
        "right": 22,
        "bottom": 29
      },
      "note_normal_16_0": {
        "left": 1,
        "top": 25,
        "right": 8,
        "bottom": 29
      },
      "note_normal_3": {
        "left": 21,
        "top": 25,
        "right": 22,
        "bottom": 29
      },
      "note_long_flash_1": {
        "left": 7,
        "top": 25,
        "right": 14,
        "bottom": 29
      },
      "note_skill_0": {
        "left": 1,
        "top": 25,
        "right": 8,
        "bottom": 29
      },
      "note_normal_5": {
        "left": 15,
        "top": 24,
        "right": 9,
        "bottom": 28
      },
      "note_long_flash_4": {
        "left": 20,
        "top": 25,
        "right": 15,
        "bottom": 29
      },
      "note_long_flash_0": {
        "left": 1,
        "top": 25,
        "right": 8,
        "bottom": 29
      },
      "note_flick_0": {
        "left": 2,
        "top": 25,
        "right": 10,
        "bottom": 28
      },
      "note_flick_3": {
        "left": 21,
        "top": 25,
        "right": 22,
        "bottom": 28
      },
      "note_flick_2": {
        "left": 15,
        "top": 26,
        "right": 21,
        "bottom": 29
      },
      "note_flick_4": {
        "left": 21,
        "top": 26,
        "right": 16,
        "bottom": 28
      },
      "note_normal_1": {
        "left": 8,
        "top": 24,
        "right": 15,
        "bottom": 28
      },
      "note_skill_6": {
        "left": 7,
        "top": 25,
        "right": 2,
        "bottom": 29
      },
      "note_long_flash_3": {
        "left": 20,
        "top": 25,
        "right": 21,
        "bottom": 29
      },
      "note_normal_2": {
        "left": 15,
        "top": 25,
        "right": 21,
        "bottom": 29
      },
      "note_long_flash_6": {
        "left": 7,
        "top": 25,
        "right": 2,
        "bottom": 29
      },
      "note_normal_16_3": {
        "left": 21,
        "top": 25,
        "right": 22,
        "bottom": 29
      },
      "note_normal_16_6": {
        "left": 7,
        "top": 25,
        "right": 2,
        "bottom": 29
      },
      "note_normal_6": {
        "left": 8,
        "top": 26,
        "right": 3,
        "bottom": 28
      },
      "note_normal_16_1": {
        "left": 8,
        "top": 25,
        "right": 15,
        "bottom": 29
      },
      "note_normal_0": {
        "left": 2,
        "top": 25,
        "right": 9,
        "bottom": 29
      },
      "note_flick_1": {
        "left": 9,
        "top": 25,
        "right": 15,
        "bottom": 29
      },
      "note_flick_top": {
        "left": 5,
        "top": 1,
        "right": 5,
        "bottom": 5
      },
      "note_flick_6": {
        "left": 8,
        "top": 26,
        "right": 3,
        "bottom": 29
      },
      "note_skill_3": {
        "left": 21,
        "top": 24,
        "right": 21,
        "bottom": 28
      },
      "note_skill_2": {
        "left": 14,
        "top": 25,
        "right": 21,
        "bottom": 29
      },
      "note_skill_1": {
        "left": 7,
        "top": 24,
        "right": 14,
        "bottom": 28
      },
      "note_long_0": {
        "left": 2,
        "top": 25,
        "right": 9,
        "bottom": 28
      },
      "note_long_flash_5": {
        "left": 14,
        "top": 25,
        "right": 8,
        "bottom": 29
      },
      "note_long_4": {
        "left": 21,
        "top": 25,
        "right": 16,
        "bottom": 29
      },
      "note_flick_5": {
        "left": 14,
        "top": 26,
        "right": 10,
        "bottom": 28
      },
      "note_normal_16_4": {
        "left": 20,
        "top": 25,
        "right": 15,
        "bottom": 29
      }
    },
    "band": "./assets/skins/skin05/longNoteLine.png",
    "bandW": 146,
    "bandH": 205,
    "bandSp": "./assets/skins/skin05/longNoteLine2.png",
    "bandSpW": 146,
    "bandSpH": 205,
    "simultaneous": "./assets/skins/skin05/simultaneous_line.png",
    "simultaneousW": 10,
    "simultaneousH": 27,
    "pairedDir": null
  },
  {
    "kind": "note",
    "id": "skin06",
    "label": "Skin 06",
    "atlas": "./assets/skins/skin06/RhythmGameSprites.png",
    "atlasW": 2048,
    "atlasH": 1024,
    "tap": [
      {
        "x": 0,
        "y": 776,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 172,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 288,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 44,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 654,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 172,
        "w": 308,
        "h": 120
      }
    ],
    "tapVirtual": [
      {
        "x": 0,
        "y": 532,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 50,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 294,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 416,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 50,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 50,
        "w": 308,
        "h": 120
      }
    ],
    "flick": [
      {
        "x": 930,
        "y": 416,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 172,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 410,
        "w": 308,
        "h": 120
      },
      {
        "x": 1550,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 172,
        "w": 308,
        "h": 120
      }
    ],
    "skill": [
      {
        "x": 310,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 166,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 294,
        "w": 308,
        "h": 120
      },
      {
        "x": 930,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 538,
        "w": 308,
        "h": 120
      }
    ],
    "long": [
      {
        "x": 620,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 1240,
        "y": 416,
        "w": 308,
        "h": 120
      },
      {
        "x": 1550,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 1550,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 294,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 416,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 782,
        "w": 308,
        "h": 120
      }
    ],
    "flickTop": {
      "x": 1240,
      "y": 32,
      "w": 171,
      "h": 138
    },
    "slideAmong": {
      "x": 1550,
      "y": 782,
      "w": 308,
      "h": 120
    },
    "ink": {
      "note_long_flash_1": {
        "left": 32,
        "top": 12,
        "right": 40,
        "bottom": 4
      },
      "note_flick_3": {
        "left": 40,
        "top": 12,
        "right": 40,
        "bottom": 3
      },
      "note_slide_among": {
        "left": 13,
        "top": 49,
        "right": 13,
        "bottom": 53
      },
      "note_long_2": {
        "left": 37,
        "top": 12,
        "right": 41,
        "bottom": 4
      },
      "note_normal_0": {
        "left": 26,
        "top": 12,
        "right": 37,
        "bottom": 4
      },
      "note_normal_16_5": {
        "left": 39,
        "top": 12,
        "right": 33,
        "bottom": 4
      },
      "note_long_flash_0": {
        "left": 26,
        "top": 12,
        "right": 37,
        "bottom": 0
      },
      "note_normal_16_6": {
        "left": 37,
        "top": 12,
        "right": 27,
        "bottom": 4
      },
      "note_normal_16_1": {
        "left": 32,
        "top": 12,
        "right": 40,
        "bottom": 4
      },
      "note_skill_0": {
        "left": 26,
        "top": 12,
        "right": 37,
        "bottom": 4
      },
      "note_normal_1": {
        "left": 32,
        "top": 12,
        "right": 40,
        "bottom": 4
      },
      "note_skill_5": {
        "left": 39,
        "top": 12,
        "right": 32,
        "bottom": 4
      },
      "note_flick_5": {
        "left": 41,
        "top": 12,
        "right": 34,
        "bottom": 3
      },
      "note_long_flash_6": {
        "left": 37,
        "top": 12,
        "right": 27,
        "bottom": 4
      },
      "note_normal_16_0": {
        "left": 26,
        "top": 12,
        "right": 37,
        "bottom": 4
      },
      "note_flick_2": {
        "left": 37,
        "top": 12,
        "right": 41,
        "bottom": 3
      },
      "note_long_3": {
        "left": 40,
        "top": 12,
        "right": 41,
        "bottom": 4
      },
      "note_skill_6": {
        "left": 37,
        "top": 12,
        "right": 27,
        "bottom": 4
      },
      "note_normal_4": {
        "left": 41,
        "top": 12,
        "right": 36,
        "bottom": 4
      },
      "note_skill_1": {
        "left": 30,
        "top": 12,
        "right": 40,
        "bottom": 4
      },
      "note_long_4": {
        "left": 41,
        "top": 12,
        "right": 37,
        "bottom": 4
      },
      "note_flick_1": {
        "left": 35,
        "top": 12,
        "right": 41,
        "bottom": 3
      },
      "note_flick_6": {
        "left": 41,
        "top": 12,
        "right": 33,
        "bottom": 3
      },
      "note_long_flash_2": {
        "left": 37,
        "top": 12,
        "right": 41,
        "bottom": 4
      },
      "note_long_flash_3": {
        "left": 40,
        "top": 12,
        "right": 41,
        "bottom": 4
      },
      "note_flick_4": {
        "left": 41,
        "top": 12,
        "right": 38,
        "bottom": 3
      },
      "note_skill_2": {
        "left": 36,
        "top": 12,
        "right": 41,
        "bottom": 4
      },
      "note_normal_16_2": {
        "left": 37,
        "top": 12,
        "right": 41,
        "bottom": 4
      },
      "note_long_1": {
        "left": 32,
        "top": 12,
        "right": 40,
        "bottom": 4
      },
      "note_normal_5": {
        "left": 39,
        "top": 12,
        "right": 33,
        "bottom": 4
      },
      "note_normal_16_3": {
        "left": 40,
        "top": 12,
        "right": 41,
        "bottom": 4
      },
      "note_long_0": {
        "left": 26,
        "top": 12,
        "right": 37,
        "bottom": 4
      },
      "note_normal_2": {
        "left": 36,
        "top": 12,
        "right": 41,
        "bottom": 4
      },
      "note_long_flash_5": {
        "left": 39,
        "top": 12,
        "right": 32,
        "bottom": 4
      },
      "note_normal_16_4": {
        "left": 41,
        "top": 12,
        "right": 37,
        "bottom": 4
      },
      "note_flick_top": {
        "left": 1,
        "top": 0,
        "right": 1,
        "bottom": 0
      },
      "note_long_5": {
        "left": 39,
        "top": 12,
        "right": 33,
        "bottom": 4
      },
      "note_long_flash_4": {
        "left": 41,
        "top": 12,
        "right": 37,
        "bottom": 4
      },
      "note_flick_0": {
        "left": 33,
        "top": 12,
        "right": 41,
        "bottom": 3
      },
      "note_skill_3": {
        "left": 40,
        "top": 12,
        "right": 40,
        "bottom": 4
      },
      "note_long_6": {
        "left": 37,
        "top": 12,
        "right": 27,
        "bottom": 4
      },
      "note_normal_3": {
        "left": 40,
        "top": 12,
        "right": 41,
        "bottom": 4
      },
      "note_normal_6": {
        "left": 37,
        "top": 12,
        "right": 27,
        "bottom": 4
      },
      "note_skill_4": {
        "left": 41,
        "top": 12,
        "right": 36,
        "bottom": 4
      }
    },
    "band": "./assets/skins/skin06/longNoteLine.png",
    "bandW": 146,
    "bandH": 205,
    "bandSp": "./assets/skins/skin06/longNoteLine2.png",
    "bandSpW": 146,
    "bandSpH": 205,
    "simultaneous": "./assets/skins/skin06/simultaneous_line.png",
    "simultaneousW": 10,
    "simultaneousH": 27,
    "pairedDir": null
  },
  {
    "kind": "directional",
    "id": "directionalflickskin00",
    "label": "Skin 00",
    "atlas": "./assets/skins/directionalflickskin00/DirectionalFlickSprites.png",
    "atlasW": 1024,
    "atlasH": 1024,
    "dirL": [
      {
        "x": 0,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 660,
        "w": 308,
        "h": 120
      }
    ],
    "dirR": [
      {
        "x": 0,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 416,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 294,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 172,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 50,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 660,
        "w": 308,
        "h": 120
      }
    ],
    "flickTopL": {
      "x": 310,
      "y": 487,
      "w": 138,
      "h": 171
    },
    "flickTopR": {
      "x": 310,
      "y": 315,
      "w": 138,
      "h": 170
    },
    "ink": {
      "note_flick_l_2": {
        "left": 40,
        "top": 11,
        "right": 54,
        "bottom": 5
      },
      "note_flick_l_0": {
        "left": 36,
        "top": 11,
        "right": 36,
        "bottom": 5
      },
      "note_flick_l_6": {
        "left": 44,
        "top": 11,
        "right": 19,
        "bottom": 5
      },
      "note_flick_l_5": {
        "left": 44,
        "top": 11,
        "right": 32,
        "bottom": 5
      },
      "note_flick_r_3": {
        "left": 55,
        "top": 11,
        "right": 42,
        "bottom": 5
      },
      "note_flick_r_6": {
        "left": 35,
        "top": 11,
        "right": 36,
        "bottom": 5
      },
      "note_flick_r_0": {
        "left": 18,
        "top": 11,
        "right": 45,
        "bottom": 5
      },
      "note_flick_r_1": {
        "left": 31,
        "top": 11,
        "right": 44,
        "bottom": 5
      },
      "note_flick_l_3": {
        "left": 42,
        "top": 11,
        "right": 56,
        "bottom": 5
      },
      "note_flick_r_2": {
        "left": 43,
        "top": 11,
        "right": 43,
        "bottom": 5
      },
      "note_flick_r_5": {
        "left": 44,
        "top": 11,
        "right": 38,
        "bottom": 5
      },
      "note_flick_r_4": {
        "left": 53,
        "top": 11,
        "right": 40,
        "bottom": 5
      },
      "note_flick_top_r": {
        "left": 16,
        "top": 13,
        "right": 10,
        "bottom": 8
      },
      "note_flick_l_4": {
        "left": 43,
        "top": 11,
        "right": 44,
        "bottom": 5
      },
      "note_flick_top_l": {
        "left": 10,
        "top": 15,
        "right": 16,
        "bottom": 7
      },
      "note_flick_l_1": {
        "left": 38,
        "top": 11,
        "right": 45,
        "bottom": 5
      }
    }
  },
  {
    "kind": "directional",
    "id": "directionalflickskin01",
    "label": "Skin 01",
    "atlas": "./assets/skins/directionalflickskin01/DirectionalFlickSprites.png",
    "atlasW": 1024,
    "atlasH": 1024,
    "dirL": [
      {
        "x": 0,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 660,
        "w": 308,
        "h": 120
      }
    ],
    "dirR": [
      {
        "x": 0,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 416,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 294,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 172,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 50,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 660,
        "w": 308,
        "h": 120
      }
    ],
    "flickTopL": {
      "x": 310,
      "y": 487,
      "w": 138,
      "h": 171
    },
    "flickTopR": {
      "x": 310,
      "y": 314,
      "w": 138,
      "h": 171
    },
    "ink": {
      "note_flick_r_1": {
        "left": 31,
        "top": 11,
        "right": 44,
        "bottom": 5
      },
      "note_flick_r_4": {
        "left": 53,
        "top": 11,
        "right": 40,
        "bottom": 5
      },
      "note_flick_l_6": {
        "left": 44,
        "top": 11,
        "right": 19,
        "bottom": 5
      },
      "note_flick_r_3": {
        "left": 55,
        "top": 11,
        "right": 42,
        "bottom": 5
      },
      "note_flick_l_5": {
        "left": 44,
        "top": 10,
        "right": 32,
        "bottom": 5
      },
      "note_flick_top_l": {
        "left": 11,
        "top": 16,
        "right": 17,
        "bottom": 8
      },
      "note_flick_l_0": {
        "left": 36,
        "top": 11,
        "right": 36,
        "bottom": 5
      },
      "note_flick_l_4": {
        "left": 43,
        "top": 10,
        "right": 44,
        "bottom": 5
      },
      "note_flick_r_0": {
        "left": 18,
        "top": 11,
        "right": 45,
        "bottom": 5
      },
      "note_flick_top_r": {
        "left": 17,
        "top": 15,
        "right": 11,
        "bottom": 9
      },
      "note_flick_r_2": {
        "left": 43,
        "top": 11,
        "right": 43,
        "bottom": 5
      },
      "note_flick_l_2": {
        "left": 40,
        "top": 11,
        "right": 54,
        "bottom": 5
      },
      "note_flick_l_1": {
        "left": 38,
        "top": 11,
        "right": 45,
        "bottom": 5
      },
      "note_flick_l_3": {
        "left": 42,
        "top": 11,
        "right": 56,
        "bottom": 5
      },
      "note_flick_r_5": {
        "left": 44,
        "top": 11,
        "right": 38,
        "bottom": 5
      },
      "note_flick_r_6": {
        "left": 35,
        "top": 8,
        "right": 36,
        "bottom": 5
      }
    }
  },
  {
    "kind": "directional",
    "id": "directionalflickskin02",
    "label": "Skin 02",
    "atlas": "./assets/skins/directionalflickskin02/DirectionalFlickSprites.png",
    "atlasW": 1024,
    "atlasH": 1024,
    "dirL": [
      {
        "x": 0,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 660,
        "w": 308,
        "h": 120
      }
    ],
    "dirR": [
      {
        "x": 0,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 416,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 294,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 172,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 50,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 660,
        "w": 308,
        "h": 120
      }
    ],
    "flickTopL": {
      "x": 310,
      "y": 487,
      "w": 138,
      "h": 171
    },
    "flickTopR": {
      "x": 310,
      "y": 314,
      "w": 138,
      "h": 171
    },
    "ink": {
      "note_flick_r_3": {
        "left": 26,
        "top": 13,
        "right": 31,
        "bottom": 9
      },
      "note_flick_l_5": {
        "left": 33,
        "top": 14,
        "right": 7,
        "bottom": 9
      },
      "note_flick_l_1": {
        "left": 27,
        "top": 14,
        "right": 20,
        "bottom": 8
      },
      "note_flick_r_0": {
        "left": 0,
        "top": 14,
        "right": 34,
        "bottom": 9
      },
      "note_flick_r_2": {
        "left": 16,
        "top": 14,
        "right": 32,
        "bottom": 9
      },
      "note_flick_r_5": {
        "left": 19,
        "top": 14,
        "right": 28,
        "bottom": 9
      },
      "note_flick_l_0": {
        "left": 24,
        "top": 14,
        "right": 12,
        "bottom": 9
      },
      "note_flick_l_6": {
        "left": 34,
        "top": 14,
        "right": 0,
        "bottom": 9
      },
      "note_flick_l_2": {
        "left": 28,
        "top": 14,
        "right": 27,
        "bottom": 9
      },
      "note_flick_top_r": {
        "left": 5,
        "top": 2,
        "right": 7,
        "bottom": 0
      },
      "note_flick_r_1": {
        "left": 6,
        "top": 14,
        "right": 34,
        "bottom": 8
      },
      "note_flick_r_4": {
        "left": 26,
        "top": 13,
        "right": 28,
        "bottom": 9
      },
      "note_flick_r_6": {
        "left": 12,
        "top": 12,
        "right": 24,
        "bottom": 8
      },
      "note_flick_l_3": {
        "left": 31,
        "top": 13,
        "right": 27,
        "bottom": 9
      },
      "note_flick_top_l": {
        "left": 4,
        "top": 2,
        "right": 8,
        "bottom": 0
      },
      "note_flick_l_4": {
        "left": 32,
        "top": 14,
        "right": 17,
        "bottom": 9
      }
    }
  },
  {
    "kind": "directional",
    "id": "directionalflickskin03",
    "label": "Skin 03",
    "atlas": "./assets/skins/directionalflickskin03/DirectionalFlickSprites.png",
    "atlasW": 1024,
    "atlasH": 1024,
    "dirL": [
      {
        "x": 0,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 660,
        "w": 308,
        "h": 120
      }
    ],
    "dirR": [
      {
        "x": 0,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 416,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 294,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 172,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 50,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 660,
        "w": 308,
        "h": 120
      }
    ],
    "flickTopL": {
      "x": 310,
      "y": 487,
      "w": 138,
      "h": 171
    },
    "flickTopR": {
      "x": 310,
      "y": 314,
      "w": 138,
      "h": 171
    },
    "ink": {
      "note_flick_l_2": {
        "left": 29,
        "top": 12,
        "right": 27,
        "bottom": 9
      },
      "note_flick_r_3": {
        "left": 26,
        "top": 13,
        "right": 31,
        "bottom": 8
      },
      "note_flick_r_4": {
        "left": 26,
        "top": 13,
        "right": 28,
        "bottom": 9
      },
      "note_flick_top_r": {
        "left": 5,
        "top": 2,
        "right": 7,
        "bottom": 0
      },
      "note_flick_l_3": {
        "left": 31,
        "top": 13,
        "right": 27,
        "bottom": 9
      },
      "note_flick_r_6": {
        "left": 12,
        "top": 13,
        "right": 25,
        "bottom": 8
      },
      "note_flick_l_6": {
        "left": 32,
        "top": 13,
        "right": 0,
        "bottom": 9
      },
      "note_flick_r_0": {
        "left": 0,
        "top": 13,
        "right": 34,
        "bottom": 9
      },
      "note_flick_top_l": {
        "left": 4,
        "top": 2,
        "right": 8,
        "bottom": 0
      },
      "note_flick_r_2": {
        "left": 16,
        "top": 13,
        "right": 32,
        "bottom": 9
      },
      "note_flick_r_5": {
        "left": 18,
        "top": 12,
        "right": 28,
        "bottom": 9
      },
      "note_flick_l_5": {
        "left": 33,
        "top": 13,
        "right": 7,
        "bottom": 9
      },
      "note_flick_l_4": {
        "left": 32,
        "top": 13,
        "right": 17,
        "bottom": 9
      },
      "note_flick_l_1": {
        "left": 26,
        "top": 12,
        "right": 20,
        "bottom": 9
      },
      "note_flick_l_0": {
        "left": 25,
        "top": 12,
        "right": 12,
        "bottom": 9
      },
      "note_flick_r_1": {
        "left": 6,
        "top": 13,
        "right": 33,
        "bottom": 9
      }
    }
  },
  {
    "kind": "directional",
    "id": "directionalflickskin04",
    "label": "Skin 04",
    "atlas": "./assets/skins/directionalflickskin04/DirectionalFlickSprites.png",
    "atlasW": 1024,
    "atlasH": 1024,
    "dirL": [
      {
        "x": 0,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 904,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 782,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 660,
        "w": 308,
        "h": 120
      }
    ],
    "dirR": [
      {
        "x": 0,
        "y": 538,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 416,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 294,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 172,
        "w": 308,
        "h": 120
      },
      {
        "x": 0,
        "y": 50,
        "w": 308,
        "h": 120
      },
      {
        "x": 310,
        "y": 660,
        "w": 308,
        "h": 120
      },
      {
        "x": 620,
        "y": 660,
        "w": 308,
        "h": 120
      }
    ],
    "flickTopL": {
      "x": 310,
      "y": 487,
      "w": 138,
      "h": 171
    },
    "flickTopR": {
      "x": 310,
      "y": 314,
      "w": 138,
      "h": 171
    },
    "ink": {
      "note_flick_r_6": {
        "left": 12,
        "top": 12,
        "right": 24,
        "bottom": 8
      },
      "note_flick_l_6": {
        "left": 32,
        "top": 12,
        "right": 0,
        "bottom": 8
      },
      "note_flick_l_5": {
        "left": 32,
        "top": 14,
        "right": 7,
        "bottom": 9
      },
      "note_flick_top_r": {
        "left": 6,
        "top": 3,
        "right": 8,
        "bottom": 1
      },
      "note_flick_top_l": {
        "left": 5,
        "top": 3,
        "right": 9,
        "bottom": 1
      },
      "note_flick_l_3": {
        "left": 31,
        "top": 14,
        "right": 27,
        "bottom": 9
      },
      "note_flick_r_1": {
        "left": 6,
        "top": 14,
        "right": 33,
        "bottom": 9
      },
      "note_flick_r_3": {
        "left": 26,
        "top": 12,
        "right": 31,
        "bottom": 8
      },
      "note_flick_r_4": {
        "left": 26,
        "top": 14,
        "right": 30,
        "bottom": 9
      },
      "note_flick_l_0": {
        "left": 25,
        "top": 12,
        "right": 12,
        "bottom": 8
      },
      "note_flick_l_2": {
        "left": 29,
        "top": 12,
        "right": 27,
        "bottom": 9
      },
      "note_flick_l_1": {
        "left": 27,
        "top": 14,
        "right": 20,
        "bottom": 8
      },
      "note_flick_r_0": {
        "left": 0,
        "top": 14,
        "right": 33,
        "bottom": 9
      },
      "note_flick_r_2": {
        "left": 16,
        "top": 13,
        "right": 32,
        "bottom": 9
      },
      "note_flick_r_5": {
        "left": 19,
        "top": 12,
        "right": 28,
        "bottom": 8
      },
      "note_flick_l_4": {
        "left": 32,
        "top": 13,
        "right": 17,
        "bottom": 9
      }
    }
  }
];

/** 默认选择（issue 29 定案 Q10）：六条目各指默认包 */
export const NOTE_SKIN_DEFAULT_SELECTION: Record<string, string> = {
  "tap": "skin00",
  "flick": "skin00",
  "skill": "skin00",
  "dirL": "directionalflickskin00",
  "dirR": "directionalflickskin00",
  "slide": "skin00"
};
