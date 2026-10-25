import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeFileAtomic, writeFileAtomicSync } from '@/electron/atomicWrite.cjs';
import { tmpDir } from '@/tests/support/fs';

/** 目标文件旁边遗留的临时文件（`.tmp-<pid>-<ts>`） */
function tmpSiblings(dir: string, target: string): string[] {
  return readdirSync(dir).filter((name) => name.startsWith(`${target.split('/').pop()}.tmp-`));
}

describe('atomicWrite · 临时文件 + rename', () => {
  it('异步写成功：内容落靶，不留临时文件', async () => {
    const dir = tmpDir('aao-atomic-');
    try {
      const target = join(dir, 'state.json');
      await writeFileAtomic(target, '{"a":1}');
      expect(readFileSync(target, 'utf8')).toBe('{"a":1}');
      expect(tmpSiblings(dir, target)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('同步写成功：内容落靶，不留临时文件', () => {
    const dir = tmpDir('aao-atomic-sync-');
    try {
      const target = join(dir, 'state.json');
      writeFileAtomicSync(target, '{"b":2}');
      expect(readFileSync(target, 'utf8')).toBe('{"b":2}');
      expect(tmpSiblings(dir, target)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('Windows 锁冲突路径：源码含 EPERM 重试（cover.bin 被预览占用时的替换）', () => {
    const src = readFileSync(join(process.cwd(), 'electron/atomicWrite.cjs'), 'utf8');
    expect(src).toMatch(/EPERM/);
    expect(src).toMatch(/renameOver/);
    expect(src).toMatch(/WIN_RENAME_TRIES/);
  });

  it('覆盖已存在的目标文件', async () => {
    const dir = tmpDir('aao-atomic-overwrite-');
    try {
      const target = join(dir, 'state.json');
      writeFileSync(target, 'old');
      await writeFileAtomic(target, 'new');
      expect(readFileSync(target, 'utf8')).toBe('new');
      expect(tmpSiblings(dir, target)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rename 失败（目标位置被目录占了）：抛错且清掉临时文件', async () => {
    const dir = tmpDir('aao-atomic-fail-');
    try {
      const target = join(dir, 'occupied');
      mkdirSync(target);
      await expect(writeFileAtomic(target, 'x')).rejects.toThrow();
      expect(tmpSiblings(dir, target)).toEqual([]);
      expect(statSync(target).isDirectory()).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('同步口径 rename 失败同样清掉临时文件', () => {
    const dir = tmpDir('aao-atomic-fail-sync-');
    try {
      const target = join(dir, 'occupied');
      mkdirSync(target);
      expect(() => writeFileAtomicSync(target, 'x')).toThrow();
      expect(tmpSiblings(dir, target)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('目标目录不存在：写临时文件就失败，同样不留残留', async () => {
    const dir = tmpDir('aao-atomic-nodir-');
    try {
      const target = join(dir, 'missing', 'state.json');
      await expect(writeFileAtomic(target, 'x')).rejects.toThrow();
      expect(existsSync(join(dir, 'missing'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
