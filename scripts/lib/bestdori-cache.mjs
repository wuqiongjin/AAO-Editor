/**
 * 批量抓取共用：磁盘缓存 + 并发池 + manifest（index.json）。
 *
 * 供 fetch-bestdori-community.mjs 的 `--download-dir` 与 fetch-stress-test-charts.mjs 复用。
 *
 * 缓存语义（重要）：
 * - 谱面**本体**发布后不可再编辑（/api/post/edit 的 body 没有 chart 字段），所以按字节缓存是安全的；
 * - 但 level / diff / rating / tags / likes 可被作者事后修改，缓存里的这些字段只是抓取时刻的快照；
 * - 缓存落的是**完整响应原文**（而非只存谱面数组），保留可复核的字节证据（SHA-256）；
 * - 需要最新元数据时用 refresh: true 重抓。
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runPool, sleep } from './bestdori-http.mjs';
import { fetchCommunityPostPayload } from './bestdori-community.mjs';
import { fetchOfficialChartRaw } from './bestdori-official.mjs';

/** @param {Buffer | string} buf */
export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * target 形状：
 * { kind: 'community'|'official', sourceId, diff?, title?, level?, author?, publishedAt? }
 */

/** @param {{ kind: string; sourceId: string; diff?: string }} target */
export function targetRelPath(target) {
  const file =
    target.kind === 'official'
      ? `official-${target.sourceId}-${target.diff}.json`
      : `community-${target.sourceId}.json`;
  return path.join('raw', file);
}

/** @param {{ kind: string; sourceId: string; diff?: string }} target @param {string} baseUrl */
export function targetUrl(target, baseUrl) {
  return target.kind === 'official'
    ? `${baseUrl}/api/charts/${encodeURIComponent(target.sourceId)}/${target.diff}.json`
    : `${baseUrl}/api/post/details?id=${encodeURIComponent(target.sourceId)}`;
}

/** 缓存命中返回 {bytes, sha256}，未命中或已损坏返回 null。 */
async function readCached(dest) {
  try {
    const buf = await readFile(dest);
    JSON.parse(buf.toString('utf8'));
    return { bytes: buf.length, sha256: sha256(buf) };
  } catch {
    return null;
  }
}

/** @param {{ kind: string; sourceId: string; diff?: string }} target */
async function fetchChartText(target) {
  // fatal=false：单张失败只记进 index，不中断整批
  if (target.kind === 'community') {
    return fetchCommunityPostPayload(target.sourceId, { fatal: false });
  }
  return fetchOfficialChartRaw(target.sourceId, target.diff, { fatal: false });
}

/**
 * 并发抓取 targets 到 outDir，命中缓存则跳过。
 *
 * @param {any[]} targets 会被就地补上 relPath / bytes / sha256 / skipped / error
 * @param {{
 *   outDir: string;
 *   concurrency?: number;
 *   refresh?: boolean;
 *   throttleMs?: number;
 * }} opts
 */
export async function downloadCharts(targets, opts) {
  const {
    outDir,
    concurrency = 6,
    refresh = false,
    throttleMs = 80,
    getDestPath,
    communityChartOnly = false,
  } = opts;
  if (!getDestPath) {
    await mkdir(path.join(outDir, 'raw'), { recursive: true });
  }

  await runPool(targets, concurrency, async (target) => {
    target.label = `${target.kind}/${target.sourceId}/${target.diff || '-'}`;
    const dest = getDestPath
      ? getDestPath(outDir, target)
      : path.join(outDir, targetRelPath(target));
    target.relPath = path.relative(outDir, dest);
    await mkdir(path.dirname(dest), { recursive: true });
    if (!refresh) {
      const cached = await readCached(dest);
      if (cached) {
        target.skipped = true;
        target.bytes = cached.bytes;
        target.sha256 = cached.sha256;
        return;
      }
    }
    let buf;
    if (target.kind === 'community' && communityChartOnly) {
      const payload = await fetchCommunityPostPayload(target.sourceId, { fatal: false });
      if (!payload?.post?.chart) {
        throw new Error('响应缺少 post.chart');
      }
      buf = Buffer.from(`${JSON.stringify(payload.post.chart, null, 2)}\n`, 'utf8');
    } else {
      const { text } = await fetchChartText(target);
      buf = Buffer.from(text, 'utf8');
    }
    await writeFile(dest, buf);
    target.bytes = buf.length;
    target.sha256 = sha256(buf);
    if (throttleMs > 0) await sleep(throttleMs);
  });

  return targets;
}

/**
 * 由 targets 生成 index.json 内容（manifest）。
 * @param {any[]} targets
 * @param {Record<string, unknown>} [extra]
 * @param {string} baseUrl
 */
export function buildCorpusIndex(targets, extra = {}, baseUrl = '') {
  const entries = targets
    .filter((t) => t.relPath)
    .map((t) => ({
      path: t.relPath,
      kind: t.kind,
      sourceId: t.sourceId,
      diff: t.diff || '',
      title: t.title ?? '',
      level: t.level ?? null,
      author: t.author ?? '',
      publishedAt: t.publishedAt ?? '',
      url: targetUrl(t, baseUrl),
      bytes: t.bytes ?? null,
      sha256: t.sha256 ?? null,
      error: t.error ?? null,
    }));
  return {
    retrievedAt: new Date().toISOString(),
    ...extra,
    entries,
    fetched: entries.filter((e) => !e.error).length,
    failed: entries.filter((e) => e.error).length,
  };
}

/** @param {string} outDir @param {Record<string, unknown>} index */
export async function writeCorpusIndex(outDir, index) {
  const dest = path.join(outDir, 'index.json');
  await writeFile(dest, `${JSON.stringify(index, null, 2)}\n`);
  return dest;
}
