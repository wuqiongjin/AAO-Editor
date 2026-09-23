import { BASE_URL, fetchJson, log } from './bestdori-http.mjs';
import { DIFF_NAMES } from './bestdori-official.mjs';

let allSongsCache = null;

export async function loadAllOfficialSongs() {
  if (allSongsCache) return allSongsCache;
  const url = `${BASE_URL}/api/songs/all.5.json`;
  log(`GET ${url}`);
  allSongsCache = await fetchJson(url);
  return allSongsCache;
}

/**
 * @param {string[]} titles musicTitle 数组（多语言）
 */
function pickDisplayTitle(titles) {
  if (!Array.isArray(titles)) return '';
  return (
    titles.find((t) => t && String(t).trim()) ??
    titles[1] ??
    titles[0] ??
    ''
  );
}

/**
 * @param {Record<string, { playLevel?: number }>} difficulty
 */
function summarizeOfficialDifficulties(difficulty) {
  if (!difficulty || typeof difficulty !== 'object') return [];
  return DIFF_NAMES
    .map((name, i) => {
      const d = difficulty[String(i)];
      if (!d) return null;
      return { diff: name, playLevel: d.playLevel ?? null };
    })
    .filter(Boolean);
}

/**
 * @param {string} query
 * @param {{ limit?: number }} [opts]
 */
export async function searchOfficialSongs(query, opts = {}) {
  const want = Math.max(1, opts.limit ?? 20);
  const q = query.trim().toLowerCase();
  if (!q) return { query, total: 0, count: 0, results: [] };

  const all = await loadAllOfficialSongs();
  const matches = [];

  for (const [songId, meta] of Object.entries(all)) {
    const titles = meta.musicTitle ?? [];
    const haystack = titles
      .filter(Boolean)
      .map((t) => String(t).toLowerCase())
      .join('\0');
    if (!haystack.includes(q)) continue;

    const difficulties = summarizeOfficialDifficulties(meta.difficulty);
    matches.push({
      songId: Number(songId),
      title: pickDisplayTitle(titles),
      titles,
      bandId: meta.bandId ?? null,
      tag: meta.tag ?? '',
      difficulties,
      difficultiesText: difficulties
        .map((d) => `${d.diff[0].toUpperCase()}${d.diff.slice(1)} Lv.${d.playLevel}`)
        .join(', '),
    });
  }

  matches.sort((a, b) => b.songId - a.songId);
  const results = matches.slice(0, want);
  return { query, total: matches.length, count: results.length, results };
}
