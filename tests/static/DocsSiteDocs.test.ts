// docs-site 票 06 · 文档核心集的静态锁。
//
// 锁三件「文档站自己也容易悄悄坏掉」的事：
// 1. 目录完整——每个 guide 页都能从侧栏到达，且侧栏不指向不存在的页（两边一一对应）。
// 2. 站内链接可达——相对链接与 `/guide/...` 根路径都要落到真实文件，别在正文里留下死链。
// 3. 口径唯一——在线版章节逐字引用应用消息表里的三条 `web.note.*`：
//    应用改了文案而文档没跟，这条会红（票 06 验收要求「逐条对得上，不各写一套」）。
//
// 另外两条是内容承诺：快速上手必须给一段可直接粘贴、能过 Apply 闸门的样例谱面
// （票 05 关票后「首访有东西可看」由这段 JSON 承担）；排障必须指向诊断包入口。
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSource, repoRoot, textFilesUnder } from '@/tests/support/source';

const ZH_DIR = 'docs-site/guide';
const EN_DIR = 'docs-site/en/guide';
const CONFIG = 'docs-site/.vitepress/config.ts';

const pageFiles = textFilesUnder([ZH_DIR, EN_DIR], /\.md$/);

/** 页面文件 → 站点路由（叶子页走 cleanUrls，索引页是目录 URL） */
function routeOf(file: string): string {
  const isEn = file.startsWith(`${EN_DIR}/`);
  const prefix = isEn ? '/en/guide' : '/guide';
  const name = file.slice((isEn ? EN_DIR : ZH_DIR).length + 1).replace(/\.md$/, '');
  return name === 'index' ? `${prefix}/` : `${prefix}/${name}`;
}

/** 站点路由 → 页面文件（相对仓库根）；非 guide 路由返回 null */
function fileOfRoute(route: string): string | null {
  for (const [prefix, dir] of [['/en/guide/', EN_DIR], ['/guide/', ZH_DIR]] as const) {
    if (!route.startsWith(prefix)) continue;
    const rest = route.slice(prefix.length);
    return rest === '' ? `${dir}/index.md` : `${dir}/${rest}.md`;
  }
  return null;
}

const config = readSource(CONFIG);
const sidebarRoutes = [...new Set(
  [...config.matchAll(/link:\s*'(\/(?:en\/)?guide\/[^']*)'/g)].map((match) => match[1]!),
)].sort();

describe('docs-site 06 · 文档核心集', () => {
  it('中英 guide 的页面与侧栏一一对应（没有孤儿页，也没有指向空页的导航）', () => {
    const routes = pageFiles.map(routeOf).sort();
    expect(routes.length).toBeGreaterThan(0);
    expect(sidebarRoutes).toEqual(routes);
  });

  it('正文里的站内链接全部可达（无死链）', () => {
    for (const file of pageFiles) {
      const source = readSource(file);
      for (const match of source.matchAll(/\]\(([^)\s]+)\)/g)) {
        const href = match[1]!;
        // 外链与纯锚点不归这条锁
        if (/^(https?:|#)/.test(href)) continue;
        const target = href.split('#')[0]!;
        if (target === '') continue;

        if (!target.startsWith('/')) {
          expect(existsSync(resolve(repoRoot, dirname(file), target)), `${file} → ${href}`).toBe(true);
          continue;
        }
        // 根路径只查 guide 路由；落地页锚点（`/#features` 之类）由站点自身负责
        if (!/^\/(en\/)?guide\//.test(target)) continue;
        const routeFile = fileOfRoute(target);
        expect(routeFile, `${file} → ${href} 不是 guide 路由`).not.toBeNull();
        expect(existsSync(resolve(repoRoot, routeFile!)), `${file} → ${href} 不存在`).toBe(true);
      }
    }
  });

  it('在线版章节逐字引用应用里的三条说明（改了消息表就必须回来改文档）', () => {
    const keys = ['web.note.platform', 'web.note.data', 'web.note.desktop'] as const;
    const zhMessages = JSON.parse(readSource('src/i18n/messages/zh-CN.json')) as Record<string, string>;
    const enMessages = JSON.parse(readSource('src/i18n/messages/en.json')) as Record<string, string>;

    const zhPage = readSource('docs-site/guide/web-version.md');
    const enPage = readSource('docs-site/en/guide/web-version.md');
    for (const key of keys) {
      expect(zhPage, `缺 ${key} 原文`).toContain(zhMessages[key]);
      expect(enPage, `缺 ${key} 原文`).toContain(enMessages[key]);
    }
  });

  it('不再使用「演示版」与 /demo/ 这类已废弃口径', () => {
    const pages = [...pageFiles, 'docs-site/index.md', 'docs-site/en/index.md'];
    for (const file of pages) {
      const source = readSource(file);
      expect(source, `${file} 仍写着「演示版」`).not.toContain('演示版');
      expect(source, `${file} 仍指向 /demo/`).not.toContain('/demo/');
    }
  });

  it('快速上手给的样例谱面能直接粘贴，且第 0 拍有 BPM（票 05 关票后的替代方案）', () => {
    const types = ['BPM', 'Single', 'Directional', 'Slide', 'Long', 'System'];
    for (const file of ['docs-site/guide/getting-started.md', 'docs-site/en/guide/getting-started.md']) {
      const block = readSource(file).match(/```json\n([\s\S]*?)```/)?.[1];
      expect(block, `${file} 缺 json 代码块`).toBeTruthy();

      const notes = JSON.parse(block!) as Array<Record<string, unknown>>;
      expect(Array.isArray(notes)).toBe(true);
      expect(notes[0]).toMatchObject({ beat: 0, type: 'BPM' });

      for (const note of notes) {
        expect(types, `${file} 出现不可应用的 type`).toContain(note.type);
        // 与 Apply 闸门同一口径：lane 0–6，滑条 / 长条的结点也逐个查
        const lanes = note.type === 'Slide' || note.type === 'Long'
          ? (note.connections as Array<{ lane: number }>).map((conn) => conn.lane)
          : note.lane == null ? [] : [note.lane as number];
        for (const lane of lanes) {
          expect(Number.isInteger(lane) && lane >= 0 && lane <= 6, `${file} lane 越界: ${lane}`).toBe(true);
        }
      }
    }
  });

  it('排障页把读者送到应用内的诊断包入口（ADR-0019）', () => {
    const zh = readSource('docs-site/guide/troubleshooting.md');
    expect(zh).toContain('设置 › 关于');
    expect(zh).toContain('诊断包');
    expect(zh).toContain('github.com/wuqiongjin/AAO-Editor/issues');

    const en = readSource('docs-site/en/guide/troubleshooting.md');
    expect(en).toContain('Settings › About');
    expect(en).toContain('Diagnostic bundle');
    expect(en).toContain('github.com/wuqiongjin/AAO-Editor/issues');
  });
});
