import { BASE_URL, die, fetchText, log } from './bestdori-http.mjs';

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
 * 取官方谱面原始响应。返回 { text, chart }：text 用于按字节落盘（官方谱面是静态资源，可安全缓存）。
 *
 * @param {string | number} songId
 * @param {string} diff normalized
 * @param {{ fatal?: boolean }} [opts] fatal=false 时改为 throw（批量抓取用）
 */
export async function fetchOfficialChartRaw(songId, diff, opts = {}) {
  const fatal = opts.fatal !== false;
  const fail = (msg) => {
    if (fatal) die(msg);
    throw new Error(msg);
  };
  const url = `${BASE_URL}/api/charts/${encodeURIComponent(String(songId))}/${diff}.json`;
  log(`GET ${url}`);
  const text = await fetchText(url, { timeoutMs: 60_000, fatal });
  let chart;
  try {
    chart = JSON.parse(text);
  } catch {
    fail(`官方谱面响应不是合法 JSON（疑似 SPA 回退页）: songId=${songId} diff=${diff}`);
  }
  if (!Array.isArray(chart)) fail(`官方谱面响应不是数组: songId=${songId} diff=${diff}`);
  log(`官方曲 ${songId} / ${diff}：共 ${chart.length} 个对象`);
  return { text, chart };
}

/**
 * @param {string | number} songId
 * @param {string} diff normalized
 */
export async function fetchOfficialChart(songId, diff) {
  return (await fetchOfficialChartRaw(songId, diff)).chart;
}
