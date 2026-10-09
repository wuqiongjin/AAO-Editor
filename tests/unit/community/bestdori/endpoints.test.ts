// 票 07：端点常量文件（全仓唯一持有社区平台域名的文件）。
// 这里锁「URL 形状」与「网络口径数值」；域名白名单本身由
// tests/static/CommunityDomainWhitelist.test.ts 扫源码看守。
import { describe, expect, it } from 'vitest';
import {
  BESTDORI_BINARY_TIMEOUT_MS,
  BESTDORI_HOST,
  BESTDORI_JSON_TIMEOUT_MS,
  BESTDORI_ORIGIN,
  BESTDORI_RETRY_POLICY,
  BESTDORI_USER_AGENT,
  OFFICIAL_DIFFICULTIES,
  bandsIndexUrl,
  bestdoriHeaders,
  isPlatformFallbackPage,
  officialAudioUrl,
  officialChartUrl,
  officialJacketUrl,
  postDetailUrl,
  postListUrl,
  postUrl,
  songDetailUrl,
  songsIndexUrl,
} from '@/src/community/bestdori/endpoints';

describe('票 07 · 端点 URL', () => {
  it('含域名的 URL 都从唯一源拼出来', () => {
    expect(BESTDORI_HOST).toBe('bestdori.com');
    expect(BESTDORI_ORIGIN).toBe('https://bestdori.com');
  });

  it('只读端点形状（与 docs/research/bestdori-api.md 一致）', () => {
    expect(songsIndexUrl()).toBe(`${BESTDORI_ORIGIN}/api/songs/all.5.json`);
    expect(songDetailUrl(1)).toBe(`${BESTDORI_ORIGIN}/api/songs/1.json`);
    expect(officialChartUrl(1, 'special')).toBe(`${BESTDORI_ORIGIN}/api/charts/1/special.json`);
    expect(postListUrl()).toBe(`${BESTDORI_ORIGIN}/api/post/list`);
    expect(postDetailUrl(248468)).toBe(`${BESTDORI_ORIGIN}/api/post/details?id=248468`);
  });

  it('postUrl 是帖子的页面地址（上传记录外链的落点，不是 API）', () => {
    expect(postUrl(248468)).toBe(`${BESTDORI_ORIGIN}/community/charts/248468`);
  });

  it('难度路径段 = 官方 0..4 的五个名字', () => {
    expect(OFFICIAL_DIFFICULTIES).toEqual(['easy', 'normal', 'hard', 'expert', 'special']);
  });

  it('官方素材 URL（票 08 实测口径）：封面包 ceil(id/10)*10、音频按 bgmId、服务器按曲挑', () => {
    expect(bandsIndexUrl()).toBe(`${BESTDORI_ORIGIN}/api/bands/all.1.json`);

    // song 29 → 桶 30（相邻桶回的是 SPA 回退页，实测）
    expect(officialJacketUrl(29, 'blackshout')).toBe(
      `${BESTDORI_ORIGIN}/assets/jp/musicjacket/musicjacket30_rip/assets-star-forassetbundle-startapp-musicjacket-musicjacket30-blackshout-jacket.png`,
    );
    // 合作曲：桶继续按 id 算（1004 → 1010），但素材只在首发服
    expect(officialJacketUrl(1004, '1004_see_the_world_eng', 'en')).toBe(
      `${BESTDORI_ORIGIN}/assets/en/musicjacket/musicjacket1010_rip/assets-star-forassetbundle-startapp-musicjacket-musicjacket1010-1004_see_the_world_eng-jacket.png`,
    );
    expect(officialAudioUrl('bgm001')).toBe(`${BESTDORI_ORIGIN}/assets/jp/sound/bgm001_rip/bgm001.mp3`);
    expect(officialAudioUrl('bgm1004', 'en')).toBe(`${BESTDORI_ORIGIN}/assets/en/sound/bgm1004_rip/bgm1004.mp3`);
  });

  it('回退页判定：平台对不存在的资源回 200 + text/html（不是 404）', () => {
    expect(isPlatformFallbackPage('text/html; charset=utf-8')).toBe(true);
    expect(isPlatformFallbackPage('audio/mpeg')).toBe(false);
    expect(isPlatformFallbackPage(null)).toBe(false);
  });
});

describe('票 07 · 网络口径', () => {
  it('自报身份写清用途与低速率', () => {
    expect(BESTDORI_USER_AGENT).toContain('low-rate');
    expect(bestdoriHeaders()).toEqual({
      'user-agent': BESTDORI_USER_AGENT,
      accept: 'application/json',
    });
    expect(bestdoriHeaders('*/*').accept).toBe('*/*');
  });

  it('超时与退避重试数值照 scripts/lib/bestdori-http.mjs 的口径', () => {
    expect(BESTDORI_JSON_TIMEOUT_MS).toBe(30_000);
    expect(BESTDORI_BINARY_TIMEOUT_MS).toBe(120_000);
    expect(BESTDORI_RETRY_POLICY).toEqual({ maxAttempts: 3, baseDelayMs: 800, jitterMs: 250 });
  });
});
