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
