// chart-preview 42 · 自定义表演背景导入管道（ADR-0018 §4 / Q9 / Q11 / Q13）
//
// 解码后内存 = 宽×高×4，与容器无关。长边 >2048 才缩小并 JPEG；已 ≤2048 的 PNG 保持 PNG。
import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  LIVE_BG_MAX_BYTES,
  LIVE_BG_MAX_EDGE,
  importLiveBgImage,
  type LiveBgImportPorts,
} from '@/src/project/liveBgImport';

function fileOf(bytes: number, type: string, name: string): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function ports(size: { width: number; height: number }, jpegBytes = [0xff, 0xd8]): LiveBgImportPorts & {
  decode: Mock;
  resizeAndEncodeJpeg: Mock;
} {
  const decode = vi.fn(async () => ({ ...size, close: vi.fn() }));
  const resizeAndEncodeJpeg = vi.fn(async () => new Blob([new Uint8Array(jpegBytes)], { type: 'image/jpeg' }));
  return { decode, resizeAndEncodeJpeg };
}

describe('importLiveBgImage · 拒收', () => {
  it('超过 20 MiB 拒收，不解码', async () => {
    const p = ports({ width: 100, height: 100 });
    const got = await importLiveBgImage(fileOf(LIVE_BG_MAX_BYTES + 1, 'image/png', 'huge.png'), p);
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.reason).toBe('size');
    expect(p.decode).not.toHaveBeenCalled();
  });

  it('HEIC / 未知类型拒收，不解码', async () => {
    const p = ports({ width: 100, height: 100 });
    const heic = await importLiveBgImage(fileOf(16, 'image/heic', 'a.heic'), p);
    expect(heic.ok).toBe(false);
    if (heic.ok) return;
    expect(heic.reason).toBe('type');
    expect(p.decode).not.toHaveBeenCalled();
  });

  it('解码失败拒收，不落盘', async () => {
    const p: LiveBgImportPorts = {
      decode: async () => { throw new Error('broken'); },
      resizeAndEncodeJpeg: async () => new Blob(),
    };
    const got = await importLiveBgImage(fileOf(16, 'image/png', 'bad.png'), p);
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.reason).toBe('decode');
  });
});

describe('importLiveBgImage · 长边与容器', () => {
  it('已 ≤2048 的 PNG 原样写入，MIME 仍是 PNG（不转 WebP / JPEG）', async () => {
    const p = ports({ width: 1334, height: 750 });
    const file = fileOf(64, 'image/png', 'stage.png');
    const got = await importLiveBgImage(file, p);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.mime).toBe('image/png');
    expect(got.blob).toBe(file);
    expect(got.width).toBe(1334);
    expect(got.height).toBe(750);
    expect(p.resizeAndEncodeJpeg).not.toHaveBeenCalled();
  });

  it('长边 >2048 缩小后重编码 JPEG；4096×2048 → 2048×1024', async () => {
    const p = ports({ width: 4096, height: 2048 }, [1, 2, 3]);
    const file = fileOf(80, 'image/png', '8k.png');
    const got = await importLiveBgImage(file, p);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.mime).toBe('image/jpeg');
    expect(got.width).toBe(LIVE_BG_MAX_EDGE);
    expect(got.height).toBe(1024);
    expect(got.blob.type).toBe('image/jpeg');
    expect(p.resizeAndEncodeJpeg).toHaveBeenCalledOnce();
    const [, w, h] = p.resizeAndEncodeJpeg.mock.calls[0];
    expect(w).toBe(2048);
    expect(h).toBe(1024);
  });
});
