// 仿真场素材缺失时的空态看守：空态**必须直接给出取件命令**（而不是一句"素材缺失"）。
// 把这条路径的三处落点钉在一起：空态文案（i18n）/ package.json 别名 / scripts README。
import { describe, expect, it } from 'vitest';
import { readSource } from '@/tests/support/source';

/** 唯一取件入口（素材由外部快照仓库产出，主仓不再自带 fetcher） */
const FETCH_COMMAND = 'npm run assets:sync';

describe('仿真场素材的取件路径（release-pipeline 02）', () => {
  it('空态文案说清缺什么 + 直接给出取件命令', () => {
    const zh = JSON.parse(readSource('src/i18n/messages/zh-CN.json')) as Record<string, string>;
    expect(zh['preview.video.assetsMissing']).toContain('场地');
    expect(zh['preview.video.assetsMissing']).toContain('背景素材');
    expect(zh['preview.video.assetsCommand']).toBe(FETCH_COMMAND);

    const en = JSON.parse(readSource('src/i18n/messages/en.json')) as Record<string, string>;
    expect(en['preview.video.assetsMissing']).toBeTruthy();
    expect(en['preview.video.assetsCommand']).toBe(FETCH_COMMAND);
  });

  it('package.json 的 assets:sync / assets:check 就是取件入口', () => {
    const pkg = JSON.parse(readSource('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['assets:sync']).toBe('node scripts/assets-sync.mjs');
    expect(pkg.scripts['assets:check']).toBe('node scripts/assets-sync.mjs --check');
  });

  it('scripts/README.md 记了取件路径', () => {
    expect(readSource('scripts/README.md')).toContain('assets:sync');
  });
});
