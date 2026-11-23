// chart-preview 42 · 自定义表演背景导入（ADR-0018 §4 / Q9 / Q11 / Q13）
//
// 只收静图。解码后内存 = 宽×高×4，与容器无关：不为体积转 WebP。
// 长边 >2048 才缩小并 JPEG；已 ≤2048 原样写入。
export const LIVE_BG_MAX_BYTES = 20 * 1024 * 1024;
export const LIVE_BG_MAX_EDGE = 2048;
export const LIVE_BG_ACCEPT = 'image/png,image/jpeg,image/webp';
export const LIVE_BG_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
export const LIVE_BG_BIN = 'liveBg.bin';
export const LIVE_BG_JPEG_QUALITY = 0.92;
/** 预览设置网格第一格（票 42 / ADR-0018 §3）；内置包从第二格起 */
export const CUSTOM_LIVE_BG_SLOT_ID = '__custom__';

export type LiveBgFit = 'cover' | 'contain';

export interface LiveBgDecoded {
  width: number;
  height: number;
  source?: CanvasImageSource;
  close?: () => void;
}

export interface LiveBgImportPorts {
  decode(blob: Blob): Promise<LiveBgDecoded>;
  resizeAndEncodeJpeg(decoded: LiveBgDecoded, width: number, height: number): Promise<Blob>;
}

export type LiveBgImportFailure = { ok: false; reason: 'size' | 'type' | 'decode' };
export type LiveBgImportSuccess = {
  ok: true;
  blob: Blob;
  mime: string;
  width: number;
  height: number;
};
export type LiveBgImportResult = LiveBgImportSuccess | LiveBgImportFailure;

const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export function liveBgMimeOf(file: { type: string; name: string }): string | null {
  if (LIVE_BG_MIME.has(file.type)) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIME[ext] ?? null;
}

export function readLiveBgFit(raw: unknown): LiveBgFit {
  return raw === 'contain' ? 'contain' : 'cover';
}

export function projectHasLiveBg(p: { liveBgName?: string | null }): boolean {
  return typeof p.liveBgName === 'string' && p.liveBgName.trim() !== '';
}

export function projectUsesCustomLiveBg(p: {
  liveBgName?: string | null;
  liveBgUseCustom?: boolean;
}): boolean {
  return Boolean(p.liveBgUseCustom) && projectHasLiveBg(p);
}

async function defaultDecode(blob: Blob): Promise<LiveBgDecoded> {
  if (typeof createImageBitmap !== 'function') {
    throw new Error('liveBg: 当前环境不支持 createImageBitmap');
  }
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  return {
    width: bmp.width,
    height: bmp.height,
    source: bmp,
    close: () => bmp.close(),
  };
}

async function defaultResizeAndEncodeJpeg(
  decoded: LiveBgDecoded,
  width: number,
  height: number,
): Promise<Blob> {
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx || !decoded.source) throw new Error('liveBg: 无法缩小图片');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(decoded.source, 0, 0, width, height);
    return canvas.convertToBlob({ type: 'image/jpeg', quality: LIVE_BG_JPEG_QUALITY });
  }
  if (typeof document === 'undefined') throw new Error('liveBg: 无法缩小图片');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx || !decoded.source) throw new Error('liveBg: 无法缩小图片');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(decoded.source, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', LIVE_BG_JPEG_QUALITY);
  });
  if (!blob) throw new Error('liveBg: JPEG 编码失败');
  return blob;
}

const defaultPorts: LiveBgImportPorts = {
  decode: defaultDecode,
  resizeAndEncodeJpeg: defaultResizeAndEncodeJpeg,
};

export async function importLiveBgImage(
  file: File,
  ports: LiveBgImportPorts = defaultPorts,
): Promise<LiveBgImportResult> {
  if (file.size > LIVE_BG_MAX_BYTES) return { ok: false, reason: 'size' };
  const mime = liveBgMimeOf(file);
  if (!mime) return { ok: false, reason: 'type' };
  let decoded: LiveBgDecoded;
  try {
    decoded = await ports.decode(file);
  } catch {
    return { ok: false, reason: 'decode' };
  }
  try {
    const { width, height } = decoded;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
      return { ok: false, reason: 'decode' };
    }
    const longest = Math.max(width, height);
    if (longest <= LIVE_BG_MAX_EDGE) {
      return { ok: true, blob: file, mime, width, height };
    }
    const scale = LIVE_BG_MAX_EDGE / longest;
    const nextW = Math.max(1, Math.round(width * scale));
    const nextH = Math.max(1, Math.round(height * scale));
    const blob = await ports.resizeAndEncodeJpeg(decoded, nextW, nextH);
    return { ok: true, blob, mime: 'image/jpeg', width: nextW, height: nextH };
  } catch {
    return { ok: false, reason: 'decode' };
  } finally {
    decoded.close?.();
  }
}
