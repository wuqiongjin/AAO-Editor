// 票 62：视频导出文件名清洗（锁测①）。
// 口径对齐 tests/unit/patterns/PatternFileName.test.ts：非法字符换 `_`、去尾点空格、空名回落；
// 再加 Windows 保留设备名（CON/PRN/NUL…）前置 `_`，`♪ ★` / emoji / 中文标点原样保留。
// 测的是纯函数 videoExportBasename —— 扩展名补在清洗之后，i18n 插值与系统对话框另由别处锁。
import { describe, expect, it } from 'vitest';
import { videoExportBasename } from '@/src/preview/video/encode/exportSpec';

describe('视频导出文件名 · 非法字符清洗（票 62）', () => {
  const ext = 'mp4';

  it('普通名字 + 扩展名按当选容器补（回归：不破坏原有行为）', () => {
    expect(videoExportBasename('曲-EZ-回放', 'webm')).toBe('曲-EZ-回放.webm');
    expect(videoExportBasename('曲-EZ-回放', 'mp4')).toBe('曲-EZ-回放.mp4');
    // 扩展名带前导点也归一（调用侧只给纯扩展名，这里顺手兜一层）
    expect(videoExportBasename('曲-EZ-回放', '.mp4')).toBe('曲-EZ-回放.mp4');
  });

  it('Windows 非法字符 / \\ : * ? " < > | 逐个替换为下划线（替换不删除）', () => {
    expect(videoExportBasename('a/b\\c:d*e?f"g<h>i|j', ext)).toBe('a_b_c_d_e_f_g_h_i_j.mp4');
  });

  it('控制字符（含 NUL 与 DEL）替换为下划线', () => {
    expect(videoExportBasename('坏\n名字\t', ext)).toBe('坏_名字.mp4');
    expect(videoExportBasename('a\u0000b\u001fc\u007fd', ext)).toBe('a_b_c_d.mp4');
  });

  it('♪ ★ # & （）、emoji、中文标点、中文原样保留', () => {
    const rich = '♪★#&（）🎵，。曲名';
    expect(videoExportBasename(rich, ext)).toBe(`${rich}.mp4`);
  });

  it('末尾的点 / 空格去掉；开头空格 trim 掉（对齐 PatternFileName 口径）', () => {
    expect(videoExportBasename('末尾点.', ext)).toBe('末尾点.mp4');
    expect(videoExportBasename('末尾空格 ', ext)).toBe('末尾空格.mp4');
    expect(videoExportBasename('  曲名  ', ext)).toBe('曲名.mp4');
    // 整行点 / 空格洗后为空 → 回落
    expect(videoExportBasename('. . .', ext)).toBe('video.mp4');
  });

  it('空名 / 只有空白 → 回落常量 stem', () => {
    expect(videoExportBasename('', ext)).toBe('video.mp4');
    expect(videoExportBasename('   ', ext)).toBe('video.mp4');
  });

  it('Windows 保留设备名 CON/PRN/AUX/NUL/COM1/LPT9 前置 _（按首段判断，大小写不敏感）', () => {
    expect(videoExportBasename('CON', ext)).toBe('_CON.mp4');
    expect(videoExportBasename('con', ext)).toBe('_con.mp4');
    expect(videoExportBasename('nul.foo', ext)).toBe('_nul.foo.mp4');
    expect(videoExportBasename('PRN', ext)).toBe('_PRN.mp4');
    expect(videoExportBasename('COM1', ext)).toBe('_COM1.mp4');
    expect(videoExportBasename('LPT9', ext)).toBe('_LPT9.mp4');
    // 不是整段命中就不动：带后缀的普通名保留
    expect(videoExportBasename('CON惹的祸', ext)).toBe('CON惹的祸.mp4');
  });

  it('$& / $1 不被正则替换串展开（t 插值与清洗都不吃替换串）', () => {
    expect(videoExportBasename('曲$&-回放', ext)).toBe('曲$&-回放.mp4');
    expect(videoExportBasename('$1$&', ext)).toBe('$1$&.mp4');
  });
});
