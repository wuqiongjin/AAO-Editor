#!/usr/bin/env node
/**
 * fetch-bestdori-chart.mjs —— 按帖子 ID 拉取 Bestdori 社区谱面，只输出谱面代码本体。
 *
 * 端点：GET https://bestdori.com/api/post/details?id=<id>（匿名可读，见 docs/bestdori-api.md §4）
 * 谱面代码在响应的 post.chart 字段里，即 BestdoriChart（对象数组）。
 *
 * 设计约束：
 *  - stdout **只有**谱面代码的 JSON，不含任何日志，可直接管道给 jq / 重定向落盘；
 *  - 日志、错误、进度一律写 stderr；
 *  - 业务错误也是 HTTP 200 + result:false（docs/bestdori-api.md §5），必须校验 result 字段。
 *
 * 用法：
 *   node scripts/fetch-bestdori-chart.mjs <id> [-o <file>] [--indent <n>] [--compact]
 *
 * 示例：
 *   node scripts/fetch-bestdori-chart.mjs 150030
 *   node scripts/fetch-bestdori-chart.mjs 150030 -o chart.json --indent 4
 *   node scripts/fetch-bestdori-chart.mjs 150030 --compact > chart.json
 */
import { promises as fs } from 'node:fs';

const BASE_URL = 'https://bestdori.com';
const USER_AGENT =
  'bestdori-chart-fetch/1.0 (local research fetch for a fan chart editor; low-rate fetching)';
const JSON_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 800;

const HELP = `用法: node scripts/fetch-bestdori-chart.mjs <id> [选项]

  <id>             社区谱面（帖子）ID，必填，例: 150030
  -o, --output <f> 写入文件（默认写 stdout）
  --indent <n>     缩进空格数，0-8（默认: 2）
  --compact        紧凑单行输出，等价于 --indent 0
  -h, --help       显示本帮助`;

const log = (msg) => process.stderr.write(`${msg}\n`);

function die(msg, code = 1) {
  log(`错误: ${msg}`);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = { id: '', output: '', indent: 2 };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      process.stderr.write(`${HELP}\n`);
      process.exit(0);
    }
    if (arg === '--compact') {
      opts.indent = 0;
    } else if (arg === '-o' || arg === '--output') {
      opts.output = argv[++i] ?? die(`${arg} 需要一个文件路径`);
    } else if (arg === '--indent') {
      const raw = argv[++i] ?? die('--indent 需要一个整数');
      opts.indent = Number(raw);
      if (!Number.isInteger(opts.indent) || opts.indent < 0 || opts.indent > 8) {
        die('--indent 需要 0-8 的整数');
      }
    } else if (arg.startsWith('-')) {
      die(`未知参数: ${arg}（使用 --help 查看用法）`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length === 0) die('缺少谱面 ID（使用 --help 查看用法）');
  if (positional.length > 1) die(`一次只取一个 ID，收到 ${positional.length} 个`);
  opts.id = positional[0];
  if (!/^\d+$/.test(opts.id)) die(`ID 必须是纯数字，收到 "${opts.id}"`);
  return opts;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 带有限重试的 GET。仅对网络错误 / 5xx / 429 重试；
 * 4xx 直接返回交给调用方定性。
 */
async function fetchWithRetry(url) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error(`请求超时（${JSON_TIMEOUT_MS}ms）`)),
      JSON_TIMEOUT_MS,
    );
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      });
      if (res.status >= 500 || res.status === 429) {
        throw new Error(`HTTP ${res.status}（服务端/限流，可重试）`);
      }
      return res;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 250;
        log(`第 ${attempt} 次请求失败（${error.message}），${Math.round(delay)}ms 后重试`);
        await sleep(delay);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function fetchChart(id) {
  const url = `${BASE_URL}/api/post/details?id=${encodeURIComponent(id)}`;
  log(`GET ${url}`);
  const res = await fetchWithRetry(url);
  if (!res.ok) die(`HTTP ${res.status}`);

  const text = await res.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    die('响应不是合法 JSON（疑似 SPA 回退页）');
  }

  // 业务失败同样是 HTTP 200：必须看 result / code
  if (payload?.result !== true) {
    die(`接口返回失败: code=${payload?.code ?? '(无 code)'} id=${id}`);
  }
  const post = payload.post;
  if (!post) die(`响应缺少 post 字段: id=${id}`);
  if (post.categoryId !== 'chart') {
    die(`id=${id} 不是谱面帖（categoryId=${post.categoryId}）`);
  }
  if (!Array.isArray(post.chart)) die(`post.chart 不是数组: id=${id}`);

  log(
    `标题: ${post.title ?? '(无标题)'} / diff=${post.diff} level=${post.level} / 共 ${post.chart.length} 个对象`,
  );
  return post.chart;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
const opts = parseArgs(process.argv.slice(2));
const chart = await fetchChart(opts.id);
const json = `${JSON.stringify(chart, null, opts.indent)}\n`;

if (opts.output) {
  await fs.writeFile(opts.output, json, 'utf8');
  log(`已写入 ${opts.output}（${Buffer.byteLength(json)} 字节）`);
} else {
  process.stdout.write(json);
}
