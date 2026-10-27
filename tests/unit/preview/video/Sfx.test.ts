// chart-preview 52：导出物两端要配的游戏音效（`src/preview/video/sfx.ts`）。
//
// 锁的是用户 2026-10-27 拍板的三条：开场人潮**0 秒起**且**收在 BGM 起点**、
// 结尾章**两层同起**（人声固定 + 按形态选伴奏，clear 也是两层）、音量**只有一条 se 口径**。
import { describe, expect, it } from 'vitest';
import {
  ENDING_CLEAR_SFX,
  ENDING_FULLCOMBO_SFX,
  ENDING_SFX_GAIN_BED,
  ENDING_SFX_GAIN_VOICE,
  ENDING_VOICE_SFX,
  OPENING_CROWD_FADE_OUT,
  OPENING_CROWD_SFX,
  endingSfxCues,
  gameSfxUrl,
  openingSfxCues,
} from '@/src/preview/video/sfx';

describe('chart-preview 52 · 开场人潮', () => {
  it('第 0 秒起播（游戏里就是这样），收在开场段末尾并淡出', () => {
    const cues = openingSfxCues(5);
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({
      name: OPENING_CROWD_SFX,
      at: 0,
      endAt: 5,
      fadeOut: OPENING_CROWD_FADE_OUT,
    });
  });

  it('开场关掉（段长 0）⇒ 不出声', () => {
    expect(openingSfxCues(0)).toEqual([]);
    expect(openingSfxCues(Number.NaN)).toEqual([]);
  });
});

describe('chart-preview 52 · 结尾章的两层', () => {
  it('AP / FC：人声 + FULLCOMBO，两层同起在章入场那一拍', () => {
    for (const stamp of ['ap', 'fc'] as const) {
      const cues = endingSfxCues(120.5, stamp);
      expect(cues.map((c) => c.name)).toEqual([ENDING_VOICE_SFX, ENDING_FULLCOMBO_SFX]);
      expect(cues.map((c) => c.at)).toEqual([120.5, 120.5]);
      expect(cues.map((c) => c.gain)).toEqual([ENDING_SFX_GAIN_VOICE, ENDING_SFX_GAIN_BED]);
    }
  });

  it('普通 Clear **也出声**，只是伴奏换成 CLEAR', () => {
    const cues = endingSfxCues(0, 'clear');
    expect(cues.map((c) => c.name)).toEqual([ENDING_VOICE_SFX, ENDING_CLEAR_SFX]);
    expect(cues.map((c) => c.at)).toEqual([0, 0]);
  });

  it('结尾的声不截断（三层素材都比结尾段短，交给素材自然收尾）', () => {
    for (const cue of endingSfxCues(10, 'ap')) expect(cue.endAt).toBeUndefined();
  });
});

describe('chart-preview 52 · 素材路径', () => {
  it('走 `BASE_URL` + `assets/game-ui/audio`（Electron 打包态是 file://）', () => {
    expect(gameSfxUrl('SE_X')).toMatch(/assets\/game-ui\/audio\/SE_X\.mp3$/);
  });
});
