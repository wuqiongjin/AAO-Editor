// 片段库分享文件（issue 187 / ADR-0023 §3「分享」）：文件名、另存、选文件入口。
//
// 写：照 `src/project/exportChartCode.ts` / `src/preview/static/saveBinary.ts` 先例 ——
//     Electron 走 preload 桥（系统保存对话框，**取消 = 什么都不发生**），
//     浏览器降级 Blob + `<a download>`。
// 读：两环境同一路 `<input type="file">`（`accept=".json,application/json"`）。
// 解析 / 合并语义在 184 的 `share.ts` 与 `usePatternLibrary` 的导入两段
// （`prepareImport` 解析预览 / `applyImport` 按策略落盘），这里只管文件。
import { serializePatterns } from './share';
import type { Pattern } from './types';

/** 文件选择框的 accept：扩展名 + MIME 两套写法都带上（不同系统认不同一套） */
export const PATTERN_FILE_ACCEPT = '.json,application/json';

/**
 * 整库导出的文件名：`aao-patterns-YYYYMMDD-HHmmss.json`。
 * 日期 + 时间都按**本地**时钟（用户看到的是自己那一刻，不是 UTC 的明天 / 昨天）；
 * 带时间是为了同一天多次导出有不同文件名，不靠浏览器的「(1)」或系统覆盖确认来区分快照。
 */
export function patternLibraryExportFilename(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `aao-patterns-${date}-${time}.json`;
}

/** 各平台文件名的非法字符。控制字符按码点判（照 `community/bestdori/assetNames` 先例，不进正则） */
const ILLEGAL_FILENAME_CHARS: ReadonlySet<string> = new Set(['\\', '/', ':', '*', '?', '"', '<', '>', '|']);

/** 非法字符替换为 `_`（替换不删除：「A/B」删掉斜杆会粘成「AB」） */
function replaceIllegalFileNameChars(name: string): string {
  let out = '';
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    out += ILLEGAL_FILENAME_CHARS.has(ch) || code <= 0x1f || code === 0x7f ? '_' : ch;
  }
  return out;
}

/**
 * 单条导出的文件名：`<片段名>.aao-pattern.json`。
 * 名字里的非法文件名字符替换为 `_`；**不改库里存的名字**（清洗只发生在拼文件名这一刻）。
 * 末尾的点 / 空格也去掉（Windows 不接受这类文件名）；清洗后为空则回落 `pattern`。
 */
export function patternExportFilename(name: string): string {
  const stem = replaceIllegalFileNameChars(name.trim()).replace(/[. ]+$/, '');
  return `${stem || 'pattern'}.aao-pattern.json`;
}

/* ------------------------------------------------------------------ */
/* 写文件                                                              */
/* ------------------------------------------------------------------ */

/** preload 注入的片段库另存桥（`electronAPI.patternLibrary.saveAs`） */
export interface PatternFileSaveBridge {
  saveAs(payload: { json: string; suggestedName: string }): Promise<{ cancelled: boolean }>;
}

function getPatternSaveBridge(): PatternFileSaveBridge | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as { electronAPI?: { patternLibrary?: Partial<PatternFileSaveBridge> } }).electronAPI;
  const bridge = api?.patternLibrary;
  return typeof bridge?.saveAs === 'function' ? (bridge as PatternFileSaveBridge) : null;
}

/** 浏览器降级：Blob + `<a download>`（不记目录、不问路径） */
function downloadJson(filename: string, json: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 统一另存动作：有桥走桥，无桥走下载。
 * 取消对话框是正常返回值，**静默返回**（上层不区分「已保存 / 已取消」，都不打扰用户）。
 */
async function savePatternsWithFilename(
  patterns: readonly Pattern[],
  filename: string,
  now: Date,
): Promise<void> {
  const json = serializePatterns(patterns, now);
  const bridge = getPatternSaveBridge();
  if (bridge) {
    await bridge.saveAs({ json, suggestedName: filename });
    return;
  }
  downloadJson(filename, json);
}

/** 整库导出：文件名由本地日期定，`exportedAt` 与文件名同一时刻。 */
export function savePatternLibraryFile(
  patterns: readonly Pattern[],
  now: Date = new Date(),
): Promise<void> {
  return savePatternsWithFilename(patterns, patternLibraryExportFilename(now), now);
}

/** 单条导出：文件名由片段名清洗而来（信封里仍是原名字）。 */
export function saveSinglePatternFile(
  pattern: Pattern,
  now: Date = new Date(),
): Promise<void> {
  return savePatternsWithFilename([pattern], patternExportFilename(pattern.name), now);
}

/* ------------------------------------------------------------------ */
/* 读文件                                                              */
/* ------------------------------------------------------------------ */

/**
 * 打开系统文件选择框并取回用户选的文件；取消 → null（什么都不发生）。
 * 用动态 `<input type="file">` 而不是组件内常驻 input：两个环境同一路，也不需要给抽屉加壳。
 */
export function pickPatternFile(): Promise<File | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = PATTERN_FILE_ACCEPT;
    input.style.display = 'none';

    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };

    input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true });
    // 现代浏览器的取消事件；不认这条的老浏览器最多留一个看不见的 input，不影响下一次导入
    input.addEventListener('cancel', () => finish(null), { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

/** File → 文本。FileReader 比 `Blob.text()` 更早可用，两个环境都稳。 */
export function readPatternFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('pattern file read failed'));
    reader.readAsText(file);
  });
}
