#!/usr/bin/env node
/**
 * fetch-bestdori-community.mjs —— Bestdori 社区自制谱：搜索 / 按帖 ID 拉谱（+ 可选音频）。
 *
 * 搜索：POST /api/post/list（见 docs/research/bestdori-api.md §2）
 * 拉取：GET /api/post/details?id=<postId>
 */
import { promises as fs } from 'node:fs';
import { audioUrlForCommunityPost } from './lib/bestdori-audio.mjs';
import { fetchCommunityPost, searchCommunityCharts } from './lib/bestdori-community.mjs';
import { die, downloadToFile, log } from './lib/bestdori-http.mjs';
import { printCommunitySearchTable } from './lib/bestdori-print.mjs';

const HELP = `用法:
  node scripts/fetch-bestdori-community.mjs --search <关键词> [选项]
  node scripts/fetch-bestdori-community.mjs <postId> [选项]

搜索（不知道帖 id 时用）:
  --search <q>     按标题/曲名等关键字搜社区谱（Bestdori 服务端搜索）
  --limit <n>      最多显示 n 条（默认 20，单次请求上限 100）
  --json           搜索结果以 JSON 输出到 stdout（默认人类可读表格）

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
  node scripts/fetch-bestdori-community.mjs 150030 -o chart.json --audio`;

function parseArgs(argv) {
  const opts = {
    mode: 'fetch',
    id: '',
    search: '',
    limit: 20,
    json: false,
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
    } else if (arg === '--limit') {
      const raw = argv[++i] ?? die('--limit 需要整数');
      opts.limit = Number(raw);
      if (!Number.isInteger(opts.limit) || opts.limit < 1 || opts.limit > 500) {
        die('--limit 需要 1–500 的整数');
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

  if (opts.mode === 'search') {
    if (positional.length > 0) die('搜索模式不需要 postId 位置参数');
    if (opts.audio || opts.audioOnly || opts.output) {
      die('搜索模式不支持 -o / --audio（先搜到 postId 再拉取）');
    }
    return opts;
  }

  if (positional.length === 0) die('缺少 postId，或使用 --search（--help）');
  if (positional.length > 1) die(`一次只取一个 ID，收到 ${positional.length} 个`);
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
  const data = await searchCommunityCharts(opts.search, { limit: opts.limit });
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  } else {
    printCommunitySearchTable(data);
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
