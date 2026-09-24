#!/usr/bin/env node
/**
 * fetch-bestdori-community.mjs —— Bestdori 社区自制谱：列表 / 按帖 ID 拉谱 / 批量下载。
 *
 * 列表：POST /api/post/list（见 docs/research/bestdori-api.md §2）
 * 拉取：GET /api/post/details?id=<postId>
 * 批量：走 lib/bestdori-cache.mjs（与 fetch-stress-test-charts.mjs 共用并发 + 磁盘缓存）
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { audioUrlForCommunityPost } from './lib/bestdori-audio.mjs';
import {
  COMMUNITY_DIFF_LABELS,
  fetchCommunityPost,
  normalizeDiffFilter,
  searchCommunityCharts,
} from './lib/bestdori-community.mjs';
import { BASE_URL, die, downloadToFile, log } from './lib/bestdori-http.mjs';
import { buildCorpusIndex, downloadCharts, writeCorpusIndex } from './lib/bestdori-cache.mjs';
import { printCommunitySearchTable } from './lib/bestdori-print.mjs';

const HELP = `用法:
  node scripts/fetch-bestdori-community.mjs --search <关键词> [选项]
  node scripts/fetch-bestdori-community.mjs --username <谱师账号名> [选项]
  node scripts/fetch-bestdori-community.mjs <postId> [选项]

列表（不知道帖 id 时用）:
  --search <q>     按标题/曲名等关键字搜社区谱（Bestdori 服务端搜索）
  --username <u>   只列该谱师的作品（账号名，大小写不敏感；昵称无效）
  --limit <n|all>  最多显示 n 条（默认 20，单次请求上限 50）；all = 全部
  --json           列表结果以 JSON 输出到 stdout（默认人类可读表格）

等级/难度过滤（**客户端**过滤：Bestdori 无服务端字段，实测见 bestdori-api.md §2.2）:
  --min-level <n>  只保留 level ≥ n
  --max-level <n>  只保留 level ≤ n
  --diff <list>    难度，逗号分隔：easy|normal|hard|expert|special 或 0–4
  --scan-limit <n> 带过滤时最多扫描多少条帖子（默认 5000）

批量下载（列表模式下可选，**显式开启**，不做按数量自动切换）:
  --download-dir <dir>  把列表里的谱面全部抓到 dir（并发 + 磁盘缓存 + index.json）
  --concurrency <n>     并发数（默认 6）
  --refresh             忽略已缓存文件，重新抓取

拉取谱面:
  <postId>         社区谱帖 id，例: 150030
  -o, --output <f> 谱面 JSON 写入文件（默认 stdout）
  --audio [<f>]    同时下载音频（custom / bandori）
  --audio-only     只下载音频
  --server <s>     bandori 曲库音频资源服（默认 jp）
  --indent <n>     缩进 0–8（默认 2）
  --compact        紧凑单行谱面 JSON
  -h, --help       显示本帮助

示例:
  node scripts/fetch-bestdori-community.mjs --search Henceforth --limit 15
  node scripts/fetch-bestdori-community.mjs --username Envy09 --limit all
  node scripts/fetch-bestdori-community.mjs --username Envy09 --search GYARI --json
  node scripts/fetch-bestdori-community.mjs --username Envy09 --min-level 30 --diff special
  node scripts/fetch-bestdori-community.mjs 150030 -o chart.json --audio

# 批量下载：把列表里的谱面全部抓下来
node scripts/fetch-bestdori-community.mjs --username Envy09 --limit all --download-dir .cache/charts-Envy09

--download-dir 与 fetch-stress-test-charts.mjs 共用 lib/bestdori-cache.mjs：
并发 + 磁盘缓存（命中即跳过）+ index.json（含 SHA-256）。
谱面本体发布后不可改，可安全缓存；level / diff / likes 会变，需最新时用 --refresh。`;

function parseArgs(argv) {
  const opts = {
    mode: 'fetch',
    id: '',
    search: '',
    username: '',
    limit: 20,
    json: false,
    downloadDir: '',
    concurrency: 6,
    refresh: false,
    minLevel: null,
    maxLevel: null,
    diff: [],
    scanLimit: 5000,
    output: '',
    indent: 2,
    audio: false,
    audioPath: '',
    audioOnly: false,
    server: 'jp',
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      process.stderr.write(`${HELP}\n`);
      process.exit(0);
    }
    if (arg === '--compact') {
      opts.indent = 0;
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--search') {
      opts.mode = 'search';
      opts.search = argv[++i] ?? die('--search 需要关键词');
    } else if (arg === '--username') {
      opts.mode = 'search';
      opts.username = (argv[++i] ?? die('--username 需要谱师账号名')).trim();
    } else if (arg === '--min-level' || arg === '--max-level') {
      const raw = argv[++i] ?? die(`${arg} 需要等级数值`);
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 99) die(`${arg} 需要 1–99 的整数`);
      if (arg === '--min-level') opts.minLevel = n;
      else opts.maxLevel = n;
    } else if (arg === '--diff') {
      opts.diff = normalizeDiffFilter(argv[++i] ?? die('--diff 需要难度列表'));
    } else if (arg === '--scan-limit') {
      const n = Number(argv[++i] ?? die('--scan-limit 需要整数'));
      if (!Number.isInteger(n) || n < 1) die('--scan-limit 需要正整数');
      opts.scanLimit = n;
    } else if (arg === '--download-dir') {
      opts.downloadDir = argv[++i] ?? die('--download-dir 需要一个目录路径');
    } else if (arg === '--concurrency') {
      const raw = Number(argv[++i] ?? die('--concurrency 需要整数'));
      if (!Number.isInteger(raw) || raw < 1 || raw > 16) die('--concurrency 需要 1–16 的整数');
      opts.concurrency = raw;
    } else if (arg === '--refresh') {
      opts.refresh = true;
    } else if (arg === '--limit') {
      const raw = argv[++i] ?? die('--limit 需要整数或 all');
      if (raw === 'all') {
        opts.limit = Infinity;
      } else {
        opts.limit = Number(raw);
        if (!Number.isInteger(opts.limit) || opts.limit < 1 || opts.limit > 5000) {
          die('--limit 需要 1–5000 的整数或 all');
        }
      }
    } else if (arg === '--audio-only') {
      opts.audioOnly = true;
      opts.audio = true;
    } else if (arg === '--audio') {
      opts.audio = true;
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        opts.audioPath = next;
        i++;
      }
    } else if (arg === '-o' || arg === '--output') {
      opts.output = argv[++i] ?? die(`${arg} 需要一个文件路径`);
    } else if (arg === '--indent') {
      const raw = argv[++i] ?? die('--indent 需要一个整数');
      opts.indent = Number(raw);
      if (!Number.isInteger(opts.indent) || opts.indent < 0 || opts.indent > 8) {
        die('--indent 需要 0-8 的整数');
      }
    } else if (arg === '--server') {
      opts.server = argv[++i] ?? die('--server 需要一个值');
      if (!['jp', 'en', 'tw', 'kr', 'cn'].includes(opts.server)) {
        die(`--server 无效: ${opts.server}`);
      }
    } else if (arg.startsWith('-')) {
      die(`未知参数: ${arg}（使用 --help 查看用法）`);
    } else {
      positional.push(arg);
    }
  }

  // 给了等级/难度过滤就等同于列表模式（全库过滤也是合法用法，靠 scanLimit 兜底）
  const hasLevelFilter =
    opts.minLevel != null || opts.maxLevel != null || opts.diff.length > 0;

  if (opts.mode === 'search' || hasLevelFilter) {
    opts.mode = 'search';
    if (positional.length > 0) die('列表模式不需要 postId 位置参数');
    if (opts.audio || opts.audioOnly || opts.output) {
      die('列表模式不支持 -o / --audio（先拿到 postId 再拉取）');
    }
    if (!opts.search && !opts.username && !hasLevelFilter) {
      die('列表模式需要 --search / --username / 等级或难度过滤之一');
    }
    if (opts.minLevel != null && opts.maxLevel != null && opts.minLevel > opts.maxLevel) {
      die(`--min-level(${opts.minLevel}) 不能大于 --max-level(${opts.maxLevel})`);
    }
    if (opts.limit === Infinity && !opts.username) {
      if (hasLevelFilter) {
        die('--limit all 与等级过滤在全库范围内要翻完 4.7 万条，代价太大；请显式给 --limit n 或加 --username');
      }
      log(`提示: --limit all 配关键字会翻完「${opts.search}」的全部命中，可能很多页`);
    }
    return opts;
  }

  if (positional.length === 0) die('缺少 postId，或使用 --search / --username（--help）');
  if (positional.length > 1) die(`一次只取一个 ID，收到 ${positional.length} 个`);
  if (opts.downloadDir || opts.refresh) die('--download-dir / --refresh 只在列表模式可用');
  opts.id = positional[0];
  if (!/^\d+$/.test(opts.id)) die(`ID 必须是纯数字，收到 "${opts.id}"`);
  if (opts.audioOnly && opts.output) die('--audio-only 与 -o 不能同时使用');
  if (opts.audio && !opts.audioPath && !opts.output && !opts.audioOnly) {
    die('谱面写 stdout 时，--audio 必须带显式路径');
  }
  return opts;
}

function defaultAudioPath(opts) {
  if (opts.audioPath) return opts.audioPath;
  if (opts.output) return opts.output.replace(/\.json$/i, '') + '-audio.mp3';
  return `bestdori-post-${opts.id}-audio.mp3`;
}

const opts = parseArgs(process.argv.slice(2));

if (opts.mode === 'search') {
  const data = await searchCommunityCharts(opts.search, {
    limit: opts.limit,
    username: opts.username,
    minLevel: opts.minLevel ?? undefined,
    maxLevel: opts.maxLevel ?? undefined,
    diff: opts.diff,
    scanLimit: opts.scanLimit,
  });
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  } else {
    printCommunitySearchTable(data);
  }

  if (opts.downloadDir) {
    const outDir = path.resolve(opts.downloadDir);
    const targets = data.results.map((r) => ({
      kind: 'community',
      sourceId: String(r.postId),
      diff: COMMUNITY_DIFF_LABELS[r.diff] ?? '',
      title: r.title,
      level: r.level,
      author: r.authorUsername,
      publishedAt: r.publishedAtMs ? new Date(r.publishedAtMs).toISOString() : '',
    }));
    log(`批量下载 ${targets.length} 张 → ${path.join(outDir, 'raw')}（并发 ${opts.concurrency}）`);
    await downloadCharts(targets, {
      outDir,
      concurrency: opts.concurrency,
      refresh: opts.refresh,
    });
    const index = buildCorpusIndex(
      targets,
      { server: 'jp', scope: opts.username ? `author:${opts.username}` : `search:${opts.search}` },
      BASE_URL,
    );
    const dest = await writeCorpusIndex(outDir, index);
    log(`完成：${index.fetched} 张成功 / ${index.failed} 张失败 → ${dest}`);
  }
} else {
  const post = await fetchCommunityPost(opts.id);

  if (opts.audio) {
    try {
      const audioUrl = await audioUrlForCommunityPost(post, opts.server);
      await downloadToFile(audioUrl, defaultAudioPath(opts));
    } catch (error) {
      die(error.message);
    }
  }

  if (!opts.audioOnly) {
    const json = `${JSON.stringify(post.chart, null, opts.indent)}\n`;
    if (opts.output) {
      await fs.writeFile(opts.output, json, 'utf8');
      log(`已写入 ${opts.output}（${Buffer.byteLength(json)} 字节）`);
    } else {
      process.stdout.write(json);
    }
  }
}
