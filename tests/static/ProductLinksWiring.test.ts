// release-pipeline 18 锁测：产品信息与作者入口。
//
// 锁四件"接线事实"，都是重构时最容易悄悄改坏的：
//   ① 地址只住 `src/app/productLinks.ts` —— 页面与导航不得自拼 URL（与 bestdori 端点同一条纪律）；
//   ② 关于页四行 = 产品主页 / 使用文档 / GitHub 仓库 / 问题反馈，**顺序即产品叙事**；
//   ③ 导航作者块贴底、折叠态只剩一枚图标、tooltip 走原生 title（不养第三套气泡）；
//   ④ 主进程产品白名单与社区白名单**不是同一份** —— 社区那份是网络出口的信任边界。
import { describe, expect, it } from 'vitest';
import { AUTHOR_NAME, PRODUCT_LINKS, shortUrl } from '@/src/app/productLinks';
import { isProductUrl, isSiteUrl } from '@/electron/externalLink.cjs';
import { readSource, readStripped } from '@/tests/support/source';

/** 产品对外的五个入口（改地址只该改 productLinks.ts，所以这里再抄一份当断言） */
const EXPECTED = {
  home: 'https://wuqiongjin.github.io/AAO-Editor/',
  guide: 'https://wuqiongjin.github.io/AAO-Editor/guide/',
  repository: 'https://github.com/wuqiongjin/AAO-Editor',
  issues: 'https://github.com/wuqiongjin/AAO-Editor/issues',
  author: 'https://github.com/wuqiongjin',
};

const PAGE = readStripped('src/pages/settings/SettingsPage.tsx');
const NAV = readStripped('src/layouts/AppNav.tsx');
const CSS = readStripped('src/layouts/AppShell.css');
const LINK_CJS = readSource('electron/externalLink.cjs');
const COMMUNITY_CJS = readSource('electron/communityNet.cjs');

function dict(rel: string): Record<string, string> {
  return JSON.parse(readSource(rel)) as Record<string, string>;
}

describe('票 18 · 地址一处', () => {
  it('五个入口就是产品对外的五个地址', () => {
    expect(PRODUCT_LINKS).toEqual(EXPECTED);
    expect(AUTHOR_NAME).toBe('wuqiongjin');
  });

  it('tooltip 用去掉协议的短形（正文永远不出现 `https://`）', () => {
    expect(shortUrl(EXPECTED.repository)).toBe('github.com/wuqiongjin/AAO-Editor');
    expect(shortUrl(EXPECTED.home)).toBe('wuqiongjin.github.io/AAO-Editor');
    expect(shortUrl(EXPECTED.guide)).toBe('wuqiongjin.github.io/AAO-Editor/guide');
    expect(shortUrl('http://example.com/')).toBe('example.com');
  });
});

describe('票 18 · 关于页四行', () => {
  it('四行都引用常量，源码里不出现裸地址', () => {
    for (const key of ['home', 'guide', 'repository', 'issues'] as const) {
      expect(PAGE, key).toMatch(new RegExp(`PRODUCT_LINKS\\.${key}`));
    }
    expect(PAGE).not.toMatch(/https?:\/\/(github\.com|wuqiongjin\.github\.io)/);
    expect(PAGE).not.toMatch(/\bgithub\.com\/wuqiongjin/);
  });

  it('顺序固定为 主页 → 文档 → 仓库 → 反馈', () => {
    const at = (key: string) => PAGE.indexOf(`PRODUCT_LINKS.${key}`);
    expect(at('home')).toBeGreaterThan(-1);
    expect(at('home')).toBeLessThan(at('guide'));
    expect(at('guide')).toBeLessThan(at('repository'));
    expect(at('repository')).toBeLessThan(at('issues'));
  });

  it('tooltip 走 shortUrl，不写死字符串', () => {
    expect(PAGE).toMatch(/shortUrl\(/);
  });
});

describe('票 18 · 站外链接的拦截纪律只有一处实现', () => {
  const ANCHOR = readStripped('src/ui/ExternalLinkAnchor.tsx');

  it('两个调用点都用同一个组件（第三处复制粘贴时，漏 preventDefault 的风险归零）', () => {
    expect(PAGE).toMatch(/<ExternalLinkAnchor/);
    expect(NAV).toMatch(/<ExternalLinkAnchor/);
    // 也不再自己写 onClick 拦默认行为
    expect(PAGE).not.toMatch(/preventDefault/);
    expect(NAV).not.toMatch(/preventDefault/);
  });

  it('组件里确实是「先拦后开」：preventDefault + openExternalUrl(href)', () => {
    expect(ANCHOR).toMatch(/preventDefault\(\)/);
    expect(ANCHOR).toMatch(/openExternalUrl\(href\)/);
  });
});

describe('票 18 · 导航作者块', () => {
  it('作者块引用 author 常量，tooltip 走原生 title 与 i18n 词条', () => {
    expect(NAV).toMatch(/PRODUCT_LINKS\.author/);
    expect(NAV).toMatch(/app-author/);
    expect(NAV).toMatch(/title=\{t\('nav\.author\.title'/);
    // 不引入站内气泡（那套是给"可读的说明文字"用的）
    expect(NAV).not.toMatch(/HelpHint/);
  });

  it('贴底：auto 外边距住分隔线，作者块与折叠钮都不抢', () => {
    const divider = CSS.match(/\.app-nav-divider\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(divider).toMatch(/margin-top:\s*auto/);
    const author = CSS.match(/\.app-author\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(author).not.toMatch(/margin-top:\s*auto/);
    expect(CSS.match(/\.app-nav-toggle\s*\{([^}]*)\}/)?.[1] ?? '').not.toMatch(/margin-top:\s*auto/);
  });

  it('折叠态只剩 GitHub 标记：**不是** User 图标（那会被当成账号/登录入口）', () => {
    // 图标本体：作者块里挂的是 Github，不是 User
    expect(NAV).toMatch(/app-author__mark/);
    expect(NAV).not.toMatch(/\bUser\b/);
    // 标记默认隐藏、折叠态才出现；文本与箭头则在折叠态隐藏（两处口径各一份）
    expect(CSS).toMatch(/\.app-author__mark\s*\{[^}]*display:\s*none/);
    const hidden = CSS.match(/[^{}]*\.app-author__text[^{]*\{[^}]*display:\s*none[^}]*\}/g) ?? [];
    expect(hidden.length).toBeGreaterThanOrEqual(2);
    expect(hidden.some((rule) => rule.includes('is-nav-collapsed'))).toBe(true);
    const mark = CSS.match(/[^{}]*\.app-author__mark[^{]*\{[^}]*display:\s*block[^}]*\}/g) ?? [];
    expect(mark.length).toBeGreaterThanOrEqual(2);
  });

  it('tooltip 说"点了会怎样"，不是"这是谁"', () => {
    const zh = dict('src/i18n/messages/zh-CN.json')['nav.author.title'];
    // 本仓插值是双花括号（`t.ts` 的 interpolate），写成 `{name}` 会原样显示在 tooltip 里
    expect(zh).toContain('{{name}}');
    expect(zh).toMatch(/GitHub/);
  });
});

describe('票 18 · 主进程白名单与社区白名单分开', () => {
  it('产品域名只进 PRODUCT_HOSTS，不进社区那份（否则等于放宽网络出口）', () => {
    expect(LINK_CJS).toMatch(/PRODUCT_HOSTS/);
    expect(LINK_CJS).toMatch(/github\.com/);
    expect(COMMUNITY_CJS).not.toMatch(/github\.com|wuqiongjin\.github\.io/);
  });

  it('两侧判定互不越界：产品地址不是社区地址，社区地址也不是产品地址', () => {
    for (const url of Object.values(EXPECTED)) {
      expect(isProductUrl(url), url).toBe(true);
      expect(isSiteUrl(url), url).toBe(false);
    }
    expect(isSiteUrl('https://bestdori.com/')).toBe(true);
    expect(isProductUrl('https://bestdori.com/')).toBe(false);
  });
});

describe('票 18 · 词条与 README', () => {
  const zh = dict('src/i18n/messages/zh-CN.json');
  const en = dict('src/i18n/messages/en.json');
  const KEYS = [
    'settings.about.links.home',
    'settings.about.links.guide',
    'settings.about.links.repository',
    'settings.about.links.issues',
    'nav.author.role',
    'nav.author.title',
  ];

  it('中英双语都齐（少一条英文就是一句中文混进英文界面）', () => {
    for (const key of KEYS) {
      expect(zh[key], `zh ${key}`).toBeTruthy();
      expect(en[key], `en ${key}`).toBeTruthy();
    }
  });

  it('README 双语的文档站占位符都已回填成 /guide/', () => {
    const zh = readSource('README.md');
    expect(zh).toContain(EXPECTED.guide);
    expect(zh).not.toContain('占位');
    // 双语对等是票 05 的约定：一份回填、另一份留着占位就是新的腐烂点
    const en = readSource('README.en.md');
    expect(en).toContain(EXPECTED.guide);
    expect(en).not.toMatch(/placeholder/i);
  });
});
