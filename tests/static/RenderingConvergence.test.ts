// architecture-refactor 03：渲染层收敛为 src/rendering 的**落点锁**。
//
// 本票是纯搬迁（行为零变化），行为测试抓不住"src/visual/ 或 src/chart/rendering/ 又长回来、
// 渲染层反手 import 页面 / 播放 / 工程层、生成脚本把注册表写回旧位置"这类回潮 ——
// 落点是结构事实，只能按源码路径 / import 形态断言。
// 手法照 PagesConvergence.test.ts：扫全仓源码 + 解析 import specifier。
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSource, readStripped, repoRoot } from '@/tests/support/source';

/** dir 下全部源码文件（相对仓库根的路径） */
function sourceFiles(dir: string, re = /\.(ts|tsx|css)$/): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      out.push(...sourceFiles(abs, re));
    } else if (re.test(entry)) {
      out.push(relative(repoRoot, abs).split('\\').join('/'));
    }
  }
  return out;
}

/** 目录下直接子项（文件 + 目录）名，排序后返回 */
function entries(dir: string): string[] {
  return readdirSync(join(repoRoot, dir)).sort();
}

const srcFiles = sourceFiles(join(repoRoot, 'src'));
const allCodeFiles = [
  ...srcFiles,
  ...sourceFiles(join(repoRoot, 'tests'), /\.(ts|tsx)$/),
  ...sourceFiles(join(repoRoot, 'scripts'), /\.(mjs|cjs)$/),
];

/** 本票取消的两个旧渲染目录。多处引用，且下面的旧路径扫描会把整串当违规，故只在常量里出现一次 */
const OLD_DIRS = ['src/visual', 'src/chart/rendering'];
const isOldPath = (target: string) => OLD_DIRS.some((d) => target === d || target.startsWith(`${d}/`));

/** 单个源码文件里的 import specifier（含 `from '…'`、`import('…')`） */
function importSpecifiers(src: string): string[] {
  return [...src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

/** 把 specifier 解析成仓库相对路径（裸包名返回 null） */
function resolveSpec(spec: string, file: string): string | null {
  if (spec.startsWith('@/')) return spec.slice(2);
  if (spec.startsWith('.')) {
    return relative(repoRoot, resolve(dirname(join(repoRoot, file)), spec)).split('\\').join('/');
  }
  return null;
}

describe('architecture-refactor 03 · 渲染层收敛为 src/rendering 的落点', () => {
  it('两个旧渲染目录整体消失，25 件按 primitives/pipeline/skin/hitTest 四方归位且不再分桶', () => {
    expect(srcFiles.filter(isOldPath)).toEqual([]);
    // 顶层只留票面点名的 9 个散文件 + 四个桶 —— 多一个目录（再分桶）即红
    expect(entries('src/rendering')).toEqual([
      'coords.ts',
      'gridStyle.ts',
      'gutterLabels.ts',
      'hitTest',
      'index.ts',
      'pipeline',
      'playbackMarker.ts',
      'primitives',
      'render.ts',
      'selectionStyle.ts',
      'skin',
      'slideBandGeometry.ts',
      'types.ts',
    ]);
    // 四个桶逐文件点名（skin/gen 是脚本产物目录，`skin/gen/.gitignore` 必须跟着搬）
    expect(entries('src/rendering/primitives')).toEqual(['NoteIconGlyph.tsx', 'noteGlyph.ts', 'noteMetrics.ts']);
    expect(entries('src/rendering/pipeline')).toEqual(['noteLayerCache.ts', 'staticLayerCache.ts']);
    expect(entries('src/rendering/hitTest')).toEqual(['hitTest.ts']);
    expect(entries('src/rendering/skin')).toEqual([
      'NoteSkinPresetThumbnail.tsx',
      'NoteSkinPreview.tsx',
      'backgroundSkin.ts',
      'gen',
      'noteSkin.ts',
      'noteSkinPresetThumbnail.ts',
      'noteSkinPreviewDraw.ts',
      'noteSkinPreviewLayout.ts',
      'useBackgroundSkin.ts',
    ]);
    expect(entries('src/rendering/skin/gen')).toContain('noteSkinRegistry.gen.ts');
    expect(existsSync(join(repoRoot, 'src/rendering/skin/gen/.gitignore'))).toBe(true);
  });

  it('全仓（src + tests + scripts）不再有指向旧路径的 import / 字面路径', () => {
    // 字面路径（readSource('src/…')）：必须带引号且带尾斜杠 —— 不误伤 settings.visual
    const OLD_LITERAL = new RegExp(`['"\`](${OLD_DIRS.join('|')})\\/`);
    const offenders = allCodeFiles.filter((f) => {
      const src = readStripped(f);
      if (OLD_LITERAL.test(src)) return true;
      // import 形态按 specifier 解析判定：旧 barrel 写法（尾无斜杠）与深路径一并覆盖
      return importSpecifiers(src).some((spec) => {
        const target = resolveSpec(spec, f);
        return target !== null && isOldPath(target);
      });
    });
    expect(offenders).toEqual([]);
  });

  it('渲染层只回指 chart 的数据 / 几何 / 编辑 / 配置与两个既有叶子依赖，不反依 UI 组件层', () => {
    // 白名单 = src/rendering 自身 + chart（数据类型 / 几何 / 编辑算法 / 配置 / 计时，
    // **不含 chart/components 的画布 React 组件**）+ 画图标（ui/CanvasSpriteIcon）+ 出文案（i18n）。
    // 后两者是搬迁前就存在的叶子依赖；本票零行为改动，反转它们留给后续特性票。
    const ALLOWED_OUTSIDE = [
      /^src\/chart\/(types|perf)$/,
      /^src\/chart\/(geometry|editing|config)\//,
      /^src\/ui\/CanvasSpriteIcon$/,
      /^src\/i18n(\/index)?$/,
    ];
    const offenders: string[] = [];
    for (const file of srcFiles.filter((f) => f.startsWith('src/rendering/'))) {
      for (const spec of importSpecifiers(readStripped(file))) {
        const target = resolveSpec(spec, file)?.replace(/\.tsx?$/, '');
        if (target == null || target.startsWith('src/rendering/')) continue;
        if (!ALLOWED_OUTSIDE.some((re) => re.test(target))) offenders.push(`${file} → ${target}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('单测目录镜像 src/rendering（四子目录保留结构），注册表生成路径跟着搬（写丢即红）', () => {
    expect(entries('tests/unit')).toContain('rendering');
    expect(entries('tests/unit')).not.toContain('visual');
    expect(entries('tests/unit/rendering')).toEqual(['cache', 'hitTest', 'render', 'skin']);
    // 生成脚本与产物位置必须一致，否则下一次 node scripts/build-note-skins.mjs 会写丢
    expect(readSource('scripts/build-note-skins.mjs')).toContain(
      "const REGISTRY_OUT = 'src/rendering/skin/gen/noteSkinRegistry.gen.ts';"
    );
  });
});
