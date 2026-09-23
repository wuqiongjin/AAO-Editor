import { describeFilter } from './bestdori-community.mjs';

/** @param {string} s @param {number} max */
function clip(s, max) {
  const t = String(s ?? '');
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + '…';
}

export function printCommunitySearchTable(data) {
  const { query, username, filter, total, scanned, truncated, results } = data;
  const scope = username ? `谱师「${username}」` : `关键字「${query}」`;
  const filterText = describeFilter(filter);
  const scannedText = filterText ? `，筛自 ${scanned} 条${truncated ? '（扫描已达上限）' : ''}` : '';
  process.stderr.write(
    `社区谱（${scope}${filterText ? ` · ${filterText}` : ''}）：共 ${total} 条命中，显示 ${results.length} 条${scannedText}\n\n`,
  );
  const header = [
    'postId',
    'title',
    'artists',
    'author',
    'published',
    'diff',
    'lv',
    'likes',
    'song',
  ];
  const widths = [8, 28, 18, 14, 19, 8, 4, 6, 8];
  const line = (cols) =>
    cols.map((c, i) => clip(c, widths[i]).padEnd(widths[i])).join(' ');
  process.stdout.write(`${line(header)}\n`);
  for (const r of results) {
    process.stdout.write(
      `${line([
        String(r.postId),
        r.title,
        r.artists,
        r.author,
        r.publishedAt,
        r.diffLabel,
        r.level == null ? '' : String(r.level),
        String(r.likes),
        r.songType,
      ])}\n`,
    );
  }
}

export function printOfficialSearchTable(data) {
  const { query, total, results } = data;
  process.stderr.write(`官方曲库搜索「${query}」：共 ${total} 条命中，显示 ${results.length} 条\n\n`);
  const header = ['songId', 'title', 'tag', 'difficulties'];
  const widths = [8, 32, 10, 48];
  const line = (cols) =>
    cols.map((c, i) => clip(c, widths[i]).padEnd(widths[i])).join(' ');
  process.stdout.write(`${line(header)}\n`);
  for (const r of results) {
    process.stdout.write(
      `${line([
        String(r.songId),
        r.title,
        r.tag,
        r.difficultiesText,
      ])}\n`,
    );
  }
}
