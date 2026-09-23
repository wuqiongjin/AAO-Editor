import { BASE_URL, die, fetchJson, log } from './bestdori-http.mjs';

export const DIFF_NAMES = ['easy', 'normal', 'hard', 'expert', 'special'];

/**
 * @param {string} raw 0–4 或难度英文名
 */
export function normalizeDiff(raw) {
  if (/^[0-4]$/.test(raw)) {
    return DIFF_NAMES[Number(raw)];
  }
  const lower = String(raw).toLowerCase();
  if (!DIFF_NAMES.includes(lower)) {
    die(`未知难度 "${raw}"（可用：${DIFF_NAMES.join(' | ')} 或 0–4）`);
  }
  return lower;
}

/**
 * @param {string | number} songId
 * @param {string} diff normalized
 */
export async function fetchOfficialChart(songId, diff) {
  const url = `${BASE_URL}/api/charts/${encodeURIComponent(String(songId))}/${diff}.json`;
  log(`GET ${url}`);
  const chart = await fetchJson(url);
  if (!Array.isArray(chart)) die(`官方谱面响应不是数组: songId=${songId} diff=${diff}`);
  log(`官方曲 ${songId} / ${diff}：共 ${chart.length} 个对象`);
  return chart;
}
