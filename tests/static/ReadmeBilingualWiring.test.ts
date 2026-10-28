import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '@/tests/support/source';

// release-pipeline 05（2026-10-14 用户拍板）：README 中英双文件、全量对等、章节同构、
// 图片共用 docs/media/readme/。本锁测防双语腐烂——任何一侧单独加章节 / 换图 / 删互链即红。
describe('issue 05 · README 双语布线与 LICENSE 锁测', () => {
  const root = repoRoot;
  const read = (p: string) => readFileSync(join(root, p), 'utf-8');
  const zh = read('README.md');
  const en = read('README.en.md');

  const h2Count = (md: string) => (md.match(/^## /gm) ?? []).length;
  const h3Count = (md: string) => (md.match(/^### /gm) ?? []).length;
  const imageRefs = (md: string) =>
    Array.from(md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)).map((m) => m[1]).sort();

  it('README.md 与 README.en.md 同时存在且互为语言入口', () => {
    expect(existsSync(join(root, 'README.md'))).toBe(true);
    expect(existsSync(join(root, 'README.en.md'))).toBe(true);
    expect(zh).toMatch(/(\]\(\.\/README\.en\.md\)|href="\.\/README\.en\.md")/);
    expect(en).toMatch(/(\]\(\.\/README\.md\)|href="\.\/README\.md")/);
  });

  it('两语言版章节数量一致（防单侧漂移）', () => {
    expect(h2Count(zh)).toBe(h2Count(en));
    expect(h2Count(zh)).toBeGreaterThanOrEqual(6);
    expect(h3Count(zh)).toBe(h3Count(en));
    expect(h3Count(zh)).toBeGreaterThanOrEqual(7);
  });

  it('两语言版引用同一批图片，且文件真实存在', () => {
    const zhImgs = imageRefs(zh);
    const enImgs = imageRefs(en);
    expect(zhImgs).toEqual(enImgs);
    expect(zhImgs.length).toBeGreaterThanOrEqual(5);
    for (const rel of zhImgs) {
      expect(existsSync(join(root, rel)), `图片缺失: ${rel}`).toBe(true);
    }
  });

  it('两语言版都带非官方声明三要素（粉丝工具 / 素材版权 / MIT 仅覆盖代码）', () => {
    expect(zh).toContain('非营利');
    expect(zh).toContain('© BanG Dream! Project');
    expect(zh).toContain('MIT 许可仅覆盖 AAO Editor 自身代码');
    expect(en).toContain('fan-made');
    expect(en).toContain('© BanG Dream! Project');
    expect(en).toContain("covers only AAO Editor's own code");
  });

  it('README 不再是 Vite 模板原文', () => {
    expect(zh).not.toContain('@vitejs/plugin-react');
    expect(zh).not.toContain('Expanding the ESLint configuration');
    expect(zh).toContain('AAO Editor');
    expect(en).toContain('AAO Editor');
  });

  it('LICENSE 存在且为 MIT、版权行 AAO Editor', () => {
    expect(existsSync(join(root, 'LICENSE'))).toBe(true);
    const lic = read('LICENSE');
    expect(lic).toContain('MIT License');
    expect(lic).toContain('Copyright (c) 2026 AAO Editor');
    expect(lic).toContain('Permission is hereby granted, free of charge');
  });

  it('两语言版都留有本地补拍占位（Electron 专属画面）', () => {
    expect(zh).toContain('TODO(本地补拍)');
    expect(en).toContain('TODO(local capture)');
  });

  it('开发小节指向 scripts/dev.sh 与 assets:sync（不教用户裸跑 vite）', () => {
    expect(zh).toContain('bash scripts/dev.sh');
    expect(en).toContain('bash scripts/dev.sh');
    expect(zh).toContain('npm run assets:sync');
    expect(en).toContain('npm run assets:sync');
  });
});
