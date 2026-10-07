// chart-preview 04 落点锁：归档脚本增两类素材（fieldskin / bgskin）、产物不进运行时目录、
// dev 直读中间件只在 serve 挂载——都是结构事实，DOM 测试抓不住，只能读源码 / 扫目录。
// 手法照 PreviewPageWiring.test.ts：读源码文本 / 正则可视形态断言。
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readStripped, repoRoot } from '@/tests/support/source';

/** dir 下全部文件（相对仓库根的路径，用于"某目录里有没有不该出现的东西"这类断言） */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      out.push(...filesUnder(abs));
    } else {
      out.push(relative(repoRoot, abs).split('\\').join('/'));
    }
  }
  return out;
}

describe('chart-preview 04 · 归档脚本的类别表', () => {
  const script = readStripped('scripts/fetch-bestdori-skins.mjs');

  it('脚本类别表含 fieldskin / bgskin：_info.json 子树 = ingameskin/<id>，产物目录同名', () => {
    for (const id of ['fieldskin', 'bgskin']) {
      expect(script).toMatch(new RegExp(`id: '${id}'`));
      expect(script).toMatch(new RegExp(`dir: '${id}'`));
      expect(script).toMatch(new RegExp(`infoSegments: \\['ingameskin', '${id}'\\]`));
    }
  });

  it('两类素材不进运行时资源目录 public/assets/（防"顺手拷进运行时目录"）', () => {
    const offenders = filesUnder(join(repoRoot, 'public/assets')).filter((p) =>
      /fieldskin|bgskin|bg_line_rhythm|game_play_line|liveBG_/i.test(p),
    );
    expect(offenders).toEqual([]);
  });

  it('dev 直读只在 serve 阶段挂载：apply 为 serve，前缀 /__bestdori-assets/ 指向归档目录', () => {
    const viteConfig = readStripped('vite.config.ts');
    const block =
      viteConfig.match(/name: 'bestdori-preview-assets',[\s\S]*?\n {6}\},\n/)?.[0] ?? '';
    expect(block).toContain("apply: 'serve'");
    expect(block).toContain("'/__bestdori-assets/'");
    expect(block).toContain("'docs/resource/bestdori'");
    expect(block).toContain('configureServer');
  });
});
