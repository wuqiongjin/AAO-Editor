// architecture-refactor 16：设置对象 / 片段收藏升顶层能力域的**落点锁**。
//
// 本票是纯搬迁（行为零变化），行为测试抓不住"设置对象又被搬回 src/chart/config/、
// 片段收藏又钻回 src/chart/patterns/"这类回潮 —— 落点是结构事实，只能按源码路径断言。
// 手法照 ProjectDomainLayout.test.ts：扫 src/ 全量源码，不 import 被测模块。
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readStripped, repoRoot } from '@/tests/support/source';

/** src/ 下全部 .ts/.tsx/.css（相对仓库根的路径） */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      out.push(...sourceFiles(abs));
    } else if (/\.(ts|tsx|css)$/.test(entry)) {
      out.push(relative(repoRoot, abs).split('\\').join('/'));
    }
  }
  return out;
}

const files = sourceFiles(join(repoRoot, 'src'));

/** 源码里的 import / re-export 说明符（已去注释） */
function specifiers(src: string): string[] {
  return [...src.matchAll(/(?:from\s+|import\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

describe('architecture-refactor 16 · 设置对象与片段收藏的顶层能力域', () => {
  it('两个新域在 src/ 顶层，旧的 chart/config 与 chart/patterns 目录整体消失', () => {
    expect(files).toContain('src/settings/AppSettings.ts');
    expect(files).toContain('src/settings/ShortcutConfig.ts');
    expect(files).toContain('src/settings/useShortcutDispatch.ts');
    expect(files).toContain('src/settings/shortcutIndexFilter.ts');
    expect(files).toContain('src/patterns/PatternStore.ts');
    expect(files).toContain('src/patterns/types.ts');
    // 点名的 6 件之外，两个域整批搬走也不能靠"留几件代表"蒙混过关
    expect(files.filter((f) => f.startsWith('src/settings/')).length).toBeGreaterThanOrEqual(4);
    expect(files.filter((f) => f.startsWith('src/patterns/')).length).toBeGreaterThanOrEqual(16);
    expect(files.filter((f) => /^src\/chart\/(config|patterns)\//.test(f))).toEqual([]);
  });

  it('src/ 源码不再引用 chart/config 或 chart/patterns 路径', () => {
    const offenders = files.filter((f) => /chart\/(config|patterns)\//.test(readStripped(f)));
    expect(offenders).toEqual([]);
  });

  it('src/patterns/ 对 src/app/ 的依赖只放行 electronBridge（Q3=A 已接受的单向接缝）', () => {
    const offenders = files
      .filter((f) => f.startsWith('src/patterns/'))
      .filter((f) => specifiers(readStripped(f))
        .some((spec) => /(?:^|\/)app\//.test(spec) && !spec.endsWith('app/electronBridge')));
    expect(offenders).toEqual([]);
  });
});
