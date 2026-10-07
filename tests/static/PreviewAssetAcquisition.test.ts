// chart-preview 04 副作用看守（ADR-0016 §6）：素材不进仓库、不进安装包 ⇒ 没跑过归档脚本的
// 机器上仿真场只有空态。空态**必须直接给出获取命令**（而不是一句"素材缺失"）。
// 本测试把这条获取路径的四处落点钉在一起：空态文案（i18n）/ package.json 别名 / scripts 与
// docs 两份 README——防"空态只说素材缺失、不说怎么拿"。
import { describe, expect, it } from 'vitest';
import { readSource } from '@/tests/support/source';

/** 唯一获取入口（不另造第二套下载器）：空态、别名、文档必须是同一条命令 */
const FETCH_COMMAND = 'node scripts/fetch-bestdori-skins.mjs --category fieldskin,bgskin';

describe('chart-preview 04 · 仿真场素材的获取路径', () => {
  it('空态文案说清缺什么 + 直接给出获取命令', () => {
    const zh = JSON.parse(readSource('src/i18n/messages/zh-CN.json')) as Record<string, string>;
    expect(zh['preview.video.assetsMissing']).toContain('场地');
    expect(zh['preview.video.assetsMissing']).toContain('背景素材');
    expect(zh['preview.video.assetsCommand']).toBe(FETCH_COMMAND);

    const en = JSON.parse(readSource('src/i18n/messages/en.json')) as Record<string, string>;
    expect(en['preview.video.assetsMissing']).toBeTruthy();
    expect(en['preview.video.assetsCommand']).toBe(FETCH_COMMAND);
  });

  it('package.json 的别名 script 指向同一条命令', () => {
    const pkg = JSON.parse(readSource('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['fetch:preview-assets']).toBe(FETCH_COMMAND);
  });

  it('scripts/README.md 与 docs/resource/bestdori/README.md 都记了这条获取路径', () => {
    for (const rel of ['scripts/README.md', 'docs/resource/bestdori/README.md']) {
      expect(readSource(rel)).toContain('fetch-bestdori-skins.mjs --category fieldskin,bgskin');
    }
  });
});
