/**
 * Bestdori 只读拉取共用：重试、超时、JSON/二进制下载。
 * 供 fetch-bestdori-community.mjs / fetch-bestdori-official.mjs 使用。
 */

export const BASE_URL = 'https://bestdori.com';
export const USER_AGENT =
  'tsugu-bestdori-fetch/1.0 (local research fetch for a fan chart editor; low-rate fetching)';
export const JSON_TIMEOUT_MS = 30_000;
export const BINARY_TIMEOUT_MS = 120_000;
export const MAX_ATTEMPTS = 3;
export const RETRY_BASE_DELAY_MS = 800;

export const log = (msg) => process.stderr.write(`${msg}\n`);

export function die(msg, code = 1) {
  log(`错误: ${msg}`);
  process.exit(code);
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 固定并发跑 worker。单个 item 抛错不中断其余（错误落到 item.error），
 * 供批量抓取复用（见 lib/bestdori-cache.mjs）。
 *
 * @param {any[]} items 每项需带 label 字段用于报错
 * @param {number} concurrency
 * @param {(item: any) => Promise<void>} worker
 */
export async function runPool(items, concurrency, worker) {
  let cursor = 0;
  let done = 0;
  const width = Math.max(1, Math.min(concurrency, items.length || 1));
  const workers = Array.from({ length: width }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      const item = items[index];
      try {
        await worker(item);
      } catch (error) {
        item.error = error?.message ?? String(error);
        log(`  ✗ ${item.label ?? item.sourceId}: ${item.error}`);
      }
      done++;
      if (done % 50 === 0) log(`  进度 ${done}/${items.length}`);
    }
  });
  await Promise.all(workers);
}

/**
 * @param {string} url
 * @param {{
 *   accept?: string;
 *   timeoutMs?: number;
 *   method?: string;
 *   body?: string;
 *   headers?: Record<string, string>;
 * }} [opts]
 */
export async function fetchWithRetry(url, opts = {}) {
  const {
    accept = 'application/json',
    timeoutMs = JSON_TIMEOUT_MS,
    method = 'GET',
    body,
    headers = {},
  } = opts;

  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error(`请求超时（${timeoutMs}ms）`)),
      timeoutMs,
    );
    try {
      const res = await fetch(url, {
        method,
        body,
        signal: controller.signal,
        headers: {
          'user-agent': USER_AGENT,
          accept,
          ...headers,
        },
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

/**
 * 取原始响应文本（**不解析**），批量抓取要按字节落盘时用这个。
 *
 * @param {string} url
 * @param {Parameters<typeof fetchWithRetry>[1] & { fatal?: boolean }} [opts]
 *   fatal=false 时改为 throw（批量抓取里单张失败不该中断整批）
 */
export async function fetchText(url, opts) {
  const { fatal = true, ...fetchOpts } = opts ?? {};
  const res = await fetchWithRetry(url, fetchOpts);
  if (!res.ok) {
    const msg = `HTTP ${res.status}: ${url}`;
    if (fatal) die(msg);
    throw new Error(msg);
  }
  return res.text();
}

/**
 * @param {string} url
 * @param {Parameters<typeof fetchWithRetry>[1]} [opts]
 */
export async function fetchJson(url, opts) {
  const text = await fetchText(url, opts);
  try {
    return JSON.parse(text);
  } catch {
    die('响应不是合法 JSON（疑似 SPA 回退页）');
  }
}

/**
 * @param {string} url
 * @param {string} destPath
 */
export async function downloadToFile(url, destPath) {
  log(`GET ${url}`);
  const res = await fetchWithRetry(url, {
    accept: '*/*',
    timeoutMs: BINARY_TIMEOUT_MS,
  });
  if (!res.ok) die(`下载失败 HTTP ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const { writeFile } = await import('node:fs/promises');
  await writeFile(destPath, buf);
  log(`已写入 ${destPath}（${buf.length} 字节）`);
}
