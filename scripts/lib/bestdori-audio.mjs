import { BASE_URL, fetchJson } from './bestdori-http.mjs';

/** @param {string} server jp | en | tw | kr | cn */
export function officialBgmUrl(bgmId, server = 'jp') {
  return `${BASE_URL}/assets/${server}/sound/${bgmId}_rip/${bgmId}.mp3`;
}

/**
 * @param {number | string} songId Bestdori 官方曲库 id（非社区帖 id）
 * @param {string} [server]
 */
export async function audioUrlForOfficialSongId(songId, server = 'jp') {
  const song = await fetchJson(`${BASE_URL}/api/songs/${encodeURIComponent(String(songId))}.json`);
  const bgmId = song?.bgmId;
  if (!bgmId || typeof bgmId !== 'string') {
    throw new Error(`歌曲 ${songId} 的元数据缺少 bgmId`);
  }
  return officialBgmUrl(bgmId, server);
}

/**
 * 社区谱帖 `post`（来自 post/details）。
 * @param {{ song?: { type?: string; audio?: string; id?: number } }} post
 * @param {string} [server]
 */
export async function audioUrlForCommunityPost(post, server = 'jp') {
  const song = post?.song;
  if (!song?.type) throw new Error('帖子缺少 post.song');

  if (song.type === 'custom') {
    if (!song.audio) throw new Error('custom 谱面缺少 song.audio');
    return song.audio;
  }
  if (song.type === 'bandori') {
    const id = song.id;
    if (id == null) throw new Error('bandori 谱面缺少 song.id');
    return audioUrlForOfficialSongId(id, server);
  }
  throw new Error(`暂不支持 song.type="${song.type}" 的音频（仅 custom / bandori）`);
}
