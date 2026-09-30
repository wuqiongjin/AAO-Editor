// 二进制另存（chart-preview 03；ADR-0016 §7）：Electron 走 `preview:saveBinary` 通道
// （preload 暴露 → main 弹系统保存对话框 + 写字节），浏览器降级 `Blob` + `<a download>`
// （照 `src/project/exportChartCode.ts` 先例）。本票建、07（视频导出）复用。
//
// 桥的接口**在本模块自己声明**（本仓惯例：用到桥的模块各自 inline cast，没有集中 d.ts）。

export interface SaveBinaryRequest {
  bytes: Uint8Array;
  /** 建议文件名（main 侧只取 basename） */
  suggestedName: string;
  /** MIME（`image/png` / 将来的 `video/mp4`…）：浏览器 Blob 类型 + Electron 保存对话框的过滤器 */
  mime: string;
}

export interface PreviewSaveBridge {
  saveBinary(payload: SaveBinaryRequest): Promise<{ cancelled: boolean }>;
}

/** 有桥（Electron）就走桥，否则 null（浏览器降级下载） */
export function getPreviewSaveBridge(): PreviewSaveBridge | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as { electronAPI?: { preview?: PreviewSaveBridge } }).electronAPI;
  return api?.preview ?? null;
}

/** 浏览器降级：Blob + `<a download>`（不记目录、不问路径） */
export function downloadBinary(filename: string, bytes: Uint8Array, mime: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export interface SaveBinaryOutcome {
  /** 用户在系统对话框里取消了（浏览器降级恒 false） */
  cancelled: boolean;
  via: 'bridge' | 'download';
}

/** 统一动作：有桥走桥，无桥走下载；取消对话框是正常返回值，不抛 */
export async function saveBinaryAs(req: SaveBinaryRequest): Promise<SaveBinaryOutcome> {
  const bridge = getPreviewSaveBridge();
  if (bridge) {
    const result = await bridge.saveBinary(req);
    return { cancelled: result?.cancelled === true, via: 'bridge' };
  }
  downloadBinary(req.suggestedName, req.bytes, req.mime);
  return { cancelled: false, via: 'download' };
}
