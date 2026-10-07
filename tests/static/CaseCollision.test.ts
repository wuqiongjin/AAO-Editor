// 跨平台守卫：源码目录下严禁存在同目录下仅大小写不同或同名不同脚本扩展名的文件。
// 背景：Windows (NTFS) 与 macOS (APFS) 默认大小写不敏感，若同一目录下存在 Foo.tsx 与 foo.ts，
// 打包器在无后缀 import 解析时会因扩展名优先级在不同平台表现不一致，导致本地构建或预打包失败。
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '@/tests/support/source';

interface CollisionEntry {
  dir: string;
  collisionBase: string;
  files: string[];
}

function findScriptCaseCollisions(dir: string): CollisionEntry[] {
  const collisions: CollisionEntry[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const scriptMap = new Map<string, string[]>();

  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!['node_modules', '.git', 'dist'].includes(ent.name)) {
        collisions.push(...findScriptCaseCollisions(full));
      }
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(ent.name)) {
      const base = ent.name.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '').toLowerCase();
      if (!scriptMap.has(base)) {
        scriptMap.set(base, []);
      }
      scriptMap.get(base)!.push(ent.name);
    }
  }

  for (const [base, list] of scriptMap.entries()) {
    if (list.length > 1) {
      collisions.push({
        dir: relative(repoRoot, dir).split('\\').join('/'),
        collisionBase: base,
        files: list,
      });
    }
  }

  return collisions;
}

describe('跨平台兼容性守卫 · 文件名大小写防撞', () => {
  it('src 目录各子文件夹下不得存在同名（仅大小写不同或仅脚本扩展名不同）的脚本文件', () => {
    const collisions = findScriptCaseCollisions(join(repoRoot, 'src'));
    expect(
      collisions,
      `发现同目录下存在大小写冲突的脚本文件，会导致 Windows/macOS 下打包或构建异常：\n${JSON.stringify(collisions, null, 2)}`
    ).toEqual([]);
  });
});
