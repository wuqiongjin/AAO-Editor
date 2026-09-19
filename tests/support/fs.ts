// 真文件系统测试替身：临时目录。
//
// Electron 侧（dataRoot / windowState / appState）的测试必须跑真 fs 往返，
// 用系统临时目录造数据根，跑完即弃。
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 造一个临时目录，返回其绝对路径（前缀建议以 `-` 结尾，便于排查残留） */
export function tmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}
