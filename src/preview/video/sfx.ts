// 导出物两端要配的**游戏音效**（chart-preview 52，2026-10-27 用户拍板）。
//
// 三件事在这里定死，别散落到绘制 / 编码里：
//   ① **开场人潮**：开场段第 0 秒起播 `SE_RHYTHM_GAYA`（游戏里就是这样），到开场段结束
//      淡出掐掉 —— 票 74 起后面是**静音前导段**，BGM 在 `simStartSeconds` 才起，人潮不跟着延长。
//   ② **结尾章的声**：两层**同起**在结尾段 `t=0`（章开始入场那一拍）——
//      固定一层 `SE_RHYTHM_CLEAR_VO`（人声），另一层按结算形态选：
//      CLEAR → `SE_RHYTHM_CLEAR`、FC / AP → `SE_RHYTHM_FULLCOMBO`。
//   ③ **音量只走 `se` 那一条**（`settings.audio.seVolume`），不另开"结尾音量"设置
//      （用户 2026-10-27：这两处音量只有导出时有用，不需要可调）。
//
// 素材在 `public/assets/game-ui/audio/`（本地研究件，**不入 git、不进安装包**）：
// 取不到就是**静音降级**（不抛错、不阻断导出），口径同图片缺件。
import type { EndingStamp } from './ending';

/** 游戏 SE 根（`<站点根>/assets/game-ui/audio`） */
export const GAME_SFX_BASE = `${import.meta.env.BASE_URL}assets/game-ui/audio`;

/** 一条待调度的 SE：**整条音轨的绝对秒**（不是段内相对秒） */
export interface SfxCue {
  /** 文件名（不带扩展名）：`<GAME_SFX_BASE>/<name>.mp3` */
  name: string;
  /** 起播秒 */
  at: number;
  /** 峰值音量（1 = 原样，最终还要过 `se` 增益） */
  gain?: number;
  /** 截断秒：给了就在这之后不再发声 */
  endAt?: number;
  /** 淡入 / 淡出时长（秒）；0 = 硬切，缺省按 `0` */
  fadeIn?: number;
  fadeOut?: number;
}

/** 开场人潮（7.11s；开场段 6.75s ⇒ 靠 `endAt` + `fadeOut` 收在开场段末尾） */
export const OPENING_CROWD_SFX = 'SE_RHYTHM_GAYA';
/** 开场人潮的淡入 / 淡出（淡出必须落在开场段末尾：用户要求"快结束时音量递减"） */
export const OPENING_CROWD_FADE_IN = 0.05;
export const OPENING_CROWD_FADE_OUT = 0.8;

/** 结尾章：固定的人声层 */
export const ENDING_VOICE_SFX = 'SE_RHYTHM_CLEAR_VO';
/** 结尾章：按形态选的伴奏层 */
export const ENDING_CLEAR_SFX = 'SE_RHYTHM_CLEAR';
export const ENDING_FULLCOMBO_SFX = 'SE_RHYTHM_FULLCOMBO';
/** 两层同起前的极小淡入（只防爆音，听不出来） */
export const ENDING_SFX_FADE_IN = 0.02;
/** 两层比例（人声盖在伴奏上：伴奏稍退，免得叠满削波） */
export const ENDING_SFX_GAIN_VOICE = 1;
export const ENDING_SFX_GAIN_BED = 0.8;

/** 一个 SE 的 URL（路径形状只在这里拼一次） */
export function gameSfxUrl(name: string): string {
  return `${GAME_SFX_BASE}/${name}.mp3`;
}

/** 开场段的人潮：`openingSeconds <= 0`（开场关掉）⇒ 不出声 */
export function openingSfxCues(openingSeconds: number): SfxCue[] {
  if (!(openingSeconds > 0)) return [];
  return [
    {
      name: OPENING_CROWD_SFX,
      at: 0,
      endAt: openingSeconds,
      fadeIn: OPENING_CROWD_FADE_IN,
      fadeOut: OPENING_CROWD_FADE_OUT,
    },
  ];
}

/** 结尾章的声：`atSeconds` = 结尾段 t=0（票 75 起 = 谱面起点 + 谱面时长 + 末击尾段）；`clear` 也是两层（用户拍板） */
export function endingSfxCues(atSeconds: number, stamp: EndingStamp): SfxCue[] {
  const bed = stamp === 'fc' || stamp === 'ap' ? ENDING_FULLCOMBO_SFX : ENDING_CLEAR_SFX;
  return [
    { name: ENDING_VOICE_SFX, at: atSeconds, gain: ENDING_SFX_GAIN_VOICE, fadeIn: ENDING_SFX_FADE_IN },
    { name: bed, at: atSeconds, gain: ENDING_SFX_GAIN_BED, fadeIn: ENDING_SFX_FADE_IN },
  ];
}
