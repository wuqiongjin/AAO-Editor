// 票 62 · 主进程「统一落盘入口」行为锁测（锁测②）。
// promptSaveDialog 是 preview:saveBinary（宽图 / 视频）、chartCode:saveAs、patternLibrary:saveAs
// 三条通道的共同骨架 —— 在这里清洗 defaultPath，静态图 / 谱面代码同源一并受益。
// 注入假 dialog / BrowserWindow / t（saveDialog.cjs 自行 require 的只有 fs / path，不碰真 electron）。
import { describe, expect, it, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { saveBinaryWithDialog, saveJsonWithDialog } from '@/electron/foundation/saveDialog.cjs';
import { tmpDir } from '@/tests/support/fs';

const BINARY_OPTS = {
  channel: 'preview:saveBinary',
  titleKey: 'electron.exportVideo',
  fallbackName: 'export.mp4',
  filters: [{ name: 'MP4', extensions: ['mp4'] }],
};
const JSON_OPTS = {
  channel: 'chartCode:saveAs',
  titleKey: 'electron.exportChart',
  fallbackName: 'chart.json',
  filters: [{ name: 'JSON', extensions: ['json'] }],
};

/** 收集 showSaveDialog 收到的 defaultPath；`filePath` 给一条真写盘目标 */
function harness(filePath: string, canceled = false) {
  const defaultPaths: string[] = [];
  const deps = {
    BrowserWindow: { fromWebContents: () => ({}) },
    dialog: {
      showSaveDialog: vi.fn(async (_win: unknown, opts: { defaultPath: string }) => {
        defaultPaths.push(opts.defaultPath);
        return { canceled, filePath };
      }),
    },
    t: (key: string) => key,
  };
  return { deps, event: { sender: {} }, defaultPaths, showSaveDialog: deps.dialog.showSaveDialog };
}

/** 跑一次二进制另存，返回建议名（写真的临时文件，随后清掉） */
async function binaryDefaultPath(suggestedName: string): Promise<string> {
  const dir = tmpDir('aao-savedlg-');
  try {
    const filePath = join(dir, 'out.bin');
    const h = harness(filePath);
    const result = await saveBinaryWithDialog(
      h.event,
      { bytes: new Uint8Array([1, 2, 3]), suggestedName },
      BINARY_OPTS,
      h.deps,
    );
    expect(result).toEqual({ cancelled: false });
    return h.defaultPaths[0]!;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('票 62 · 主进程 defaultPath 已清洗', () => {
  it('/ 变 _、名字不悄悄变短（不再被 basename 截掉前缀）', async () => {
    expect(await binaryDefaultPath('曲/名-EZ-回放.mp4')).toBe('曲_名-EZ-回放.mp4');
    expect(await binaryDefaultPath('前缀\\后缀.mp4')).toBe('前缀_后缀.mp4');
  });

  it('Windows 非法字符 / \\ : * ? " < > | 逐个替换为 _', async () => {
    expect(await binaryDefaultPath('a/b\\c:d*e?f"g<h>i|j.mp4')).toBe('a_b_c_d_e_f_g_h_i_j.mp4');
  });

  it('控制字符（含 NUL / DEL）替换为 _', async () => {
    expect(await binaryDefaultPath('a\u0000b\u001fc\u007fd.mp4')).toBe('a_b_c_d.mp4');
  });

  it('♪ ★ # & （）、emoji、中文标点原样保留', async () => {
    expect(await binaryDefaultPath('♪★#&（）🎵，。.mp4')).toBe('♪★#&（）🎵，。.mp4');
  });

  it('末尾点 / 空格去掉；空名 / 只有空白回落 fallbackName', async () => {
    expect(await binaryDefaultPath('末尾点.')).toBe('末尾点');
    expect(await binaryDefaultPath('   ')).toBe('export.mp4');
  });

  it('Windows 保留设备名前置 _（带扩展名按首段判、大小写不敏感）', async () => {
    expect(await binaryDefaultPath('CON.mp4')).toBe('_CON.mp4');
    expect(await binaryDefaultPath('nul')).toBe('_nul');
    expect(await binaryDefaultPath('COM1.json')).toBe('_COM1.json');
  });

  it('缺 suggestedName / 非字符串 → fallbackName', async () => {
    expect(await binaryDefaultPath('')).toBe('export.mp4');
  });

  it('用户改了对话框里的名：落盘目标的 basename 也清洗（真写入清洗后的路径）', async () => {
    const dir = tmpDir('aao-savedlg-edit-');
    try {
      // showSaveDialog 回一条 basename 带非法字符的路径：模拟用户在系统对话框里改名
      const editedPath = join(dir, '曲名:回放?.mp4');
      const h = harness(editedPath);
      const result = await saveBinaryWithDialog(
        h.event,
        { bytes: new Uint8Array([1, 2, 3]), suggestedName: '默认.mp4' },
        BINARY_OPTS,
        h.deps,
      );
      expect(result).toEqual({ cancelled: false });
      // 写盘用的是清洗后的文件名；带非法字符的原路径没被写
      expect(existsSync(join(dir, '曲名_回放_.mp4'))).toBe(true);
      expect(existsSync(editedPath)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('JSON 通道同样清洗（chartCode:saveAs / patternLibrary:saveAs 同源一并受益）', async () => {
    const dir = tmpDir('aao-savedlg-json-');
    try {
      const h = harness(join(dir, 'out.json'));
      const result = await saveJsonWithDialog(
        h.event,
        { json: '{}', suggestedName: '曲/名:谱面.json' },
        JSON_OPTS,
        h.deps,
      );
      expect(result).toEqual({ cancelled: false });
      expect(h.defaultPaths[0]).toBe('曲_名_谱面.json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('票 62 · 取消与写盘失败', () => {
  it('取消对话框 = { cancelled: true }，不当异常、不写盘', async () => {
    const h = harness(join(tmpDir('aao-savedlg-cancel-'), 'out.bin'), true);
    const result = await saveBinaryWithDialog(
      h.event,
      { bytes: new Uint8Array([1]), suggestedName: '曲名.mp4' },
      BINARY_OPTS,
      h.deps,
    );
    expect(result).toEqual({ cancelled: true });
    expect(h.showSaveDialog).toHaveBeenCalledTimes(1);
  });

  it('写盘抛错不被吞：异常冒泡给渲染侧（域层据此回 failure: save 档）', async () => {
    // filePath 指向一个不存在的子目录 → fs.promises.writeFile 真抛 ENOENT，无需 mock fs
    const dir = tmpDir('aao-savedlg-fail-');
    try {
      const h = harness(join(dir, 'no-such-dir', 'out.bin'));
      await expect(
        saveBinaryWithDialog(
          h.event,
          { bytes: new Uint8Array([1]), suggestedName: '曲名.mp4' },
          BINARY_OPTS,
          h.deps,
        ),
      ).rejects.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
