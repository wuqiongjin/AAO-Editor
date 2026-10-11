// release-pipeline 02 所有权锁：**主仓不存资源产物、也不带产出它们的工具**。
// 产物（二进制 + 生成物）由外部快照提供，`scripts/assets-sync.mjs` 取件，目录全被 `.gitignore` 忽略。
// 结构事实，DOM 测试抓不住：读源码 / git 索引 / .gitignore。
import { execSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { readSource, readStripped, repoRoot, sourceFiles } from '@/tests/support/source';

describe('release-pipeline 02 · 资源取件与所有权', () => {
  it('产物与生成物都不在 git 索引（防再入库）', () => {
    const tracked = execSync(
      'git ls-files -- public/assets/skins public/assets/sim src/assets/audio/keysounds src/rendering/skin/gen src/audio/gen',
      { cwd: repoRoot, encoding: 'utf8' },
    )
      .trim()
      .split('\n')
      .filter((f) => /\.(png|mp3|gen\.ts)$/.test(f));
    expect(tracked).toEqual([]);
  });

  it('.gitignore 覆盖取件目录（二进制 + 生成物）', () => {
    const gitignore = readSource('.gitignore');
    for (const entry of [
      '/public/assets/skins/',
      '/public/assets/sim/',
      '/src/assets/audio/keysounds/',
      '/src/rendering/skin/gen/',
      '/src/audio/gen/',
    ]) {
      expect(gitignore).toContain(entry);
    }
  });

  it('主仓不存资源记账（没有清单文件）', () => {
    expect(() => readSource('assets-mirror/manifest.json')).toThrow();
  });

  it('取件脚本：来源不写明文、按根整取、可用 ASSETS_SOURCE 覆盖', () => {
    const sync = readSource('scripts/assets-sync.mjs');
    expect(sync).not.toMatch(/https?:\/\//); // 源码里不出现明文地址
    expect(sync).toContain('ASSETS_SOURCE'); // 可换来源
    for (const root of [
      'public/assets/skins',
      'public/assets/sim',
      'src/assets/audio/keysounds',
      'src/rendering/skin/gen',
      'src/audio/gen',
    ]) {
      expect(sync).toContain(`'${root}'`);
    }
  });

  it('仿真场素材走运行时素材树 assets/sim；dev 直读中间件已退役', () => {
    const simAssets = readStripped('src/preview/video/sim/simAssets.ts');
    expect(simAssets).toContain('assets/sim');
    // 前缀必须跟着构建 base：写死站点根在 Electron 的 file:// 下解析不到包里的素材
    expect(simAssets).toMatch(/SIM_ASSET_BASE[^\n]*import\.meta\.env\.BASE_URL/);
    expect(simAssets).not.toMatch(/['"`]\/assets\/sim/);
    expect(simAssets).not.toContain('/__bestdori-assets');

    const viteConfig = readStripped('vite.config.ts');
    expect(viteConfig).not.toContain('bestdori-preview-assets');
    expect(viteConfig).not.toContain('/__bestdori-assets/');
  });

  it('运行时素材 URL 一律跟构建 base：src/ 下不许出现站点根绝对路径', () => {
    // 打包态是 file://，没有站点根 —— 写死 `/assets/…` 会解析到磁盘根（票 03）。
    // 单条用例点名管得住一处，这条锁的是"整棵树都不许再出现"这个口径。
    const offenders = sourceFiles(join(repoRoot, 'src')).filter((f) =>
      /['"`]\/assets\//.test(readStripped(f)),
    );
    expect(offenders).toEqual([]);
  });
});
