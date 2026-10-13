// 仿真场素材读不到时的空态看守：只陈述"加载失败 + 缺什么"，不摆开发者命令
// （空态面向打包应用的使用者，`npm run assets:sync` 他跑不了）。
// 把这条路径的三处落点钉在一起：空态文案（i18n）/ package.json 别名 / scripts README。
import { describe, expect, it } from 'vitest';
import { readSource, readStripped } from '@/tests/support/source';

describe('仿真场素材的取件路径（release-pipeline 02）', () => {
  it('空态文案说清缺什么，且不承诺成因', () => {
    const zh = JSON.parse(readSource('src/i18n/messages/zh-CN.json')) as Record<string, string>;
    expect(zh['preview.video.assetsMissing']).toContain('加载失败');
    expect(zh['preview.video.assetsMissing']).toContain('场地');
    expect(zh['preview.video.assetsMissing']).toContain('背景素材');

    const en = JSON.parse(readSource('src/i18n/messages/en.json')) as Record<string, string>;
    expect(en['preview.video.assetsMissing']).toContain('failed to load');
  });

  it('空态不给取件命令：使用者跑不了 npm，入口只在 scripts/README', () => {
    const zh = JSON.parse(readSource('src/i18n/messages/zh-CN.json')) as Record<string, string>;
    const en = JSON.parse(readSource('src/i18n/messages/en.json')) as Record<string, string>;
    expect(zh['preview.video.assetsCommand']).toBeUndefined();
    expect(en['preview.video.assetsCommand']).toBeUndefined();
    expect(zh['preview.video.assetsMissing']).not.toContain('npm');
    expect(en['preview.video.assetsMissing']).not.toContain('npm');

    const stage = readStripped('src/pages/preview/PreviewVideoStage.tsx');
    expect(stage).not.toContain('assetsCommand');
  });

  it('package.json 的 assets:sync / assets:check 就是取件入口', () => {
    const pkg = JSON.parse(readSource('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['assets:sync']).toBe('node scripts/assets-sync.mjs');
    expect(pkg.scripts['assets:check']).toBe('node scripts/assets-sync.mjs --check');
  });

  it('scripts/README.md 记了取件路径', () => {
    expect(readSource('scripts/README.md')).toContain('assets:sync');
  });

  it('打包态的解析前提：loadFile + 相对 base（素材前缀跟着 base 才落得到包里的素材）', () => {
    // 这条只锁**环境前提**（源码正则，不在 file:// 下真读图）：Electron 是 loadFile 出来的 file:// 页面，
    // vite 又打相对 base —— 两者一起决定素材前缀必须跟 base（票 03）。
    // 前缀本身怎么写由 AssetsSync / SimRendererWiring 那两条锁；这里不重复断言，免得两套口径打架。
    expect(readStripped('electron/main.cjs')).toMatch(/loadFile\(/);
    expect(readStripped('vite.config.ts')).toMatch(/base:\s*'\.\/'/);
  });
});
