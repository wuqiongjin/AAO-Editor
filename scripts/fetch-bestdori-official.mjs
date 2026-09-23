#!/usr/bin/env node
/**
 * fetch-bestdori-official.mjs —— Bestdori 游戏内官方曲：搜索 / 拉谱（+ 可选 BGM）。
 */
import { promises as fs } from 'node:fs';
import { audioUrlForOfficialSongId } from './lib/bestdori-audio.mjs';
import { die, downloadToFile, log } from './lib/bestdori-http.mjs';
import { fetchOfficialChart, normalizeDiff } from './lib/bestdori-official.mjs';
import { printOfficialSearchTable } from './lib/bestdori-print.mjs';
import { searchOfficialSongs } from './lib/bestdori-songs.mjs';

const HELP = `用法:
  node scripts/fetch-bestdori-official.mjs --search <关键词> [选项]
  node scripts/fetch-bestdori-official.mjs <songId> <diff> [选项]

搜索（不知道 songId 时用）:
  --search <q>     在官方曲库 all.5.json 中匹配曲名（多语言子串）
  --limit <n>      最多显示 n 条（默认 20）
  --json           搜索结果 JSON 输出

拉取谱面:
  <songId>         官方曲库 id，非社区帖 id
  <diff>           easy | normal | hard | expert | special（或 0–4）
  -o, --output <f> 谱面 JSON（默认 stdout）
  --audio [<f>]    同时下载 BGM
  --audio-only     只下载音频
  --server <s>     jp | en | tw | kr | cn（默认 jp）
  --indent <n>     0–8（默认 2）
  --compact        紧凑单行 JSON
  -h, --help

示例:
  node scripts/fetch-bestdori-official.mjs --search hekiten
  node scripts/fetch-bestdori-official.mjs 515 expert -o chart.json --audio`;

function parseArgs(argv) {
  const opts = {
    mode: 'fetch',
    songId: '',
    diff: '',
    search: '',
    limit: 20,
    json: false,
    output: '',
    audio: false,
    audioPath: '',
    audioOnly: false,
    server: 'jp',
    indent: 2,
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
      if (!Number.isInteger(opts.limit) || opts.limit < 1 || opts.limit > 200) {
        die('--limit 需要 1–200 的整数');
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
    if (positional.length > 0) die('搜索模式不需要 songId / diff');
    if (opts.audio || opts.audioOnly || opts.output) {
      die('搜索模式不支持 -o / --audio');
    }
    return opts;
  }

  if (positional.length < 2) die('缺少 songId 与 diff，或使用 --search');
  if (positional.length > 2) die(`多余参数: ${positional.slice(2).join(' ')}`);
  opts.songId = positional[0];
  opts.diff = normalizeDiff(positional[1]);
  if (!/^\d+$/.test(opts.songId)) die(`songId 必须是纯数字，收到 "${opts.songId}"`);
  if (opts.audioOnly && opts.output) die('--audio-only 与 -o 不能同时使用');
  if (opts.audio && !opts.audioPath && !opts.output && !opts.audioOnly) {
    die('谱面写 stdout 时，--audio 必须带显式路径');
  }
  return opts;
}

function defaultAudioPath(opts) {
  if (opts.audioPath) return opts.audioPath;
  if (opts.output) return opts.output.replace(/\.json$/i, '') + '-audio.mp3';
  return `bestdori-official-${opts.songId}-${opts.diff}-audio.mp3`;
}

const opts = parseArgs(process.argv.slice(2));

if (opts.mode === 'search') {
  const data = await searchOfficialSongs(opts.search, { limit: opts.limit });
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  } else {
    printOfficialSearchTable(data);
  }
} else {

  if (opts.audio) {
    const audioUrl = await audioUrlForOfficialSongId(opts.songId, opts.server);
    await downloadToFile(audioUrl, defaultAudioPath(opts));
  }

  if (!opts.audioOnly) {
    const chart = await fetchOfficialChart(opts.songId, opts.diff);
    const json = `${JSON.stringify(chart, null, opts.indent)}\n`;
    if (opts.output) {
      await fs.writeFile(opts.output, json, 'utf8');
      log(`已写入 ${opts.output}（${Buffer.byteLength(json)} 字节）`);
    } else {
      process.stdout.write(json);
    }
  }
}
