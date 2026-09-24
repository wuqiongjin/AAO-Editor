#!/usr/bin/env node
/**
 * issue 154：拉取压力测试语料到 docs/resource/StressTestChart/
 *
 *   Official/              官方 SPECIAL 全量（{songId}_SP.json，谱面数组）
 *   Community/<username>/  指定谱师、SPECIAL、level>30（{postId}.json，谱面数组）
 *
 * 用法:
 *   node scripts/fetch-stress-test-charts.mjs [选项]
 *
 * 选项:
 *   --out <dir>           默认 docs/resource/StressTestChart
 *   --concurrency <n>     默认 4
 *   --refresh             忽略已存在文件，重新抓取
 *   --only official|community
 *   --dry-run             只枚举，不下载
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BASE_URL, log, sleep } from './lib/bestdori-http.mjs';
import { DIFF_NAMES } from './lib/bestdori-official.mjs';
import { loadAllOfficialSongs } from './lib/bestdori-songs.mjs';
import { listCommunityPostsPage } from './lib/bestdori-community.mjs';
import { buildCorpusIndex, downloadCharts, writeCorpusIndex } from './lib/bestdori-cache.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = path.join(REPO_ROOT, 'docs/resource/StressTestChart');

const SPECIAL_IDX = 4;
/** 筛选条件：level > 30 */
const MIN_LEVEL = 31;

/** 去掉枚举阶段 0 命中的谱师（SPECIAL & level>30） */
const COMMUNITY_AUTHORS = [
  'Merjoex',
  'xzz181511',
  'dzilas',
  '1642495043',
  'JIanHEngHEnry',
  'MoYing2021',
  'SohnFGS306',
  'CityTing',
  'xiwenlejianXLR',
  'Envy09',
  'ParaPa',
  'AndiSaputra',
  'Lightness',
  'yukina375',
  'inansho',
  'YukiYurei',
  'papa202',
  'pazhedeyin',
  'xzkxzjxzcxzlxzr5',
  'MIMIOMIO',
  'ExGPT233',
  'wanshanxiuche',
  'nlhkgxk',
  '17Zp3XiC',
];

function parseArgs(argv) {
  const opts = {
    out: DEFAULT_OUT,
    concurrency: 4,
    refresh: false,
    only: '',
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--out') opts.out = path.resolve(next());
    else if (arg === '--concurrency') opts.concurrency = Math.max(1, Math.min(12, Number(next()) || 4));
    else if (arg === '--refresh') opts.refresh = true;
    else if (arg === '--only') opts.only = next();
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '-h' || arg === '--help') {
      process.stderr.write(
        '用法: node scripts/fetch-stress-test-charts.mjs [--out dir] [--concurrency n] [--refresh] [--only official|community] [--dry-run]\n',
      );
      process.exit(0);
    } else throw new Error(`未知参数: ${arg}`);
  }
  return opts;
}

async function listOfficialSpecial() {
  const songs = await loadAllOfficialSongs();
  const all = [];
  for (const songId of Object.keys(songs).sort((a, b) => Number(a) - Number(b))) {
    const difficulty = songs[songId]?.difficulty ?? {};
    if (!difficulty[String(SPECIAL_IDX)]) continue;
    all.push({ kind: 'official', sourceId: songId, diff: 'special' });
  }
  return all;
}

/** @param {Record<string, any>} post */
function makeCommunityTarget(post, username) {
  return {
    kind: 'community',
    sourceId: String(post.id),
    diff: DIFF_NAMES[post.diff] ?? '',
    title: post.title ?? '',
    level: post.level ?? null,
    author: username,
    publishedAt: post.time ? new Date(post.time).toISOString() : '',
  };
}

async function listCommunityForAuthor(username) {
  const targets = [];
  const first = await listCommunityPostsPage({ offset: 0, username });
  const total = first.total;

  for (let offset = 0; offset < total; ) {
    const page = offset === 0 ? first : await listCommunityPostsPage({ offset, username });
    if (page.posts.length === 0) break;
    for (const post of page.posts) {
      const level = post.level ?? 0;
      if (post.diff !== SPECIAL_IDX || level < MIN_LEVEL) continue;
      targets.push(makeCommunityTarget(post, username));
    }
    offset += page.posts.length;
    if (page.posts.length < 50) break;
    await sleep(150);
  }
  return targets;
}

function officialDestPath(outDir, target) {
  return path.join(outDir, 'Official', `${target.sourceId}_SP.json`);
}

function communityDestPath(outDir, target) {
  const folder = target.author || 'unknown';
  return path.join(outDir, 'Community', folder, `${target.sourceId}.json`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(opts.out);
  const wantOfficial = opts.only !== 'community';
  const wantCommunity = opts.only !== 'official';

  const targets = [];
  if (wantOfficial) {
    log('枚举官方 SPECIAL…');
    const list = await listOfficialSpecial();
    log(`  ${list.length} 张`);
    targets.push(...list);
  }
  if (wantCommunity) {
    log(`枚举社区（${COMMUNITY_AUTHORS.length} 位谱师，Special，level>${MIN_LEVEL - 1}）…`);
    for (const username of COMMUNITY_AUTHORS) {
      const list = await listCommunityForAuthor(username);
      log(`  ${username}: ${list.length}`);
      targets.push(...list);
      await sleep(200);
    }
    log(`  社区合计 ${targets.filter((t) => t.kind === 'community').length} 张`);
  }

  if (opts.dryRun) {
    log(`dry-run：共 ${targets.length} 张，不写盘`);
    return;
  }

  log(`下载 ${targets.length} 张 → ${outDir}（并发 ${opts.concurrency}）`);
  const started = Date.now();
  await downloadCharts(targets, {
    outDir,
    concurrency: opts.concurrency,
    refresh: opts.refresh,
    communityChartOnly: true,
    getDestPath: (base, target) =>
      target.kind === 'official' ? officialDestPath(base, target) : communityDestPath(base, target),
  });

  const index = buildCorpusIndex(
    targets,
    {
      server: 'jp',
      scope: 'stress-test-issue-154',
      filters: {
        official: 'special only',
        community: `special, level>${MIN_LEVEL - 1}, authors=${COMMUNITY_AUTHORS.length}`,
      },
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
    },
    BASE_URL,
  );
  const dest = await writeCorpusIndex(outDir, index);
  log(`完成：${index.fetched} 成功 / ${index.failed} 失败 / ${index.elapsedSeconds}s → ${dest}`);
}

main().catch((error) => {
  log(`错误: ${error.message}`);
  process.exit(1);
});
