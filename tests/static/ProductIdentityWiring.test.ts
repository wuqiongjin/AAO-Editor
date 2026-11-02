import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot, readSource, stripComments } from '@/tests/support/source';

describe('issue 04 · AAO Editor 产品品牌与元数据整改锁测', () => {
  const root = repoRoot;

  it('package.json 元数据更新为 AAO Editor 与 com.aao.editor，无 mocacoffee 残留', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
    expect(pkg.name).toBe('aao-editor');
    expect(pkg.description).toBe('Advanced Arrangement Organizer');
    expect(pkg.author).toBe('AAO Editor');
    expect(pkg.build?.productName).toBe('AAO Editor');
    expect(pkg.build?.appId).toBe('com.aao.editor');
    expect(JSON.stringify(pkg)).not.toMatch(/mocacoffee/i);
  });

  it('index.html 标题与 favicon 指向更新，且不引用 vite.svg', () => {
    const html = readSource('index.html');
    expect(html).toContain('<title>AAO Editor · Advanced Arrangement Organizer</title>');
    expect(html).toContain('href="/favicon.ico"');
    expect(html).toContain('href="/icon.png"');
    expect(html).not.toContain('vite.svg');
    expect(html).not.toContain('bangdream-editor');
  });

  it('多语言字典中 app.name, app.markAria 与 app.fullName 规范统一', () => {
    const zh = JSON.parse(readSource('src/i18n/messages/zh-CN.json'));
    const en = JSON.parse(readSource('src/i18n/messages/en.json'));

    expect(zh['app.name']).toBe('AAO Editor');
    expect(en['app.name']).toBe('AAO Editor');
    expect(zh['app.markAria']).toBe('AAO Editor');
    expect(en['app.markAria']).toBe('AAO Editor');
    expect(zh['app.fullName']).toBe('AAO Editor · Advanced Arrangement Organizer');
    expect(en['app.fullName']).toBe('AAO Editor · Advanced Arrangement Organizer');
  });

  it('核心持久化键与数据库名称统一收敛为 aao.* 命名空间', () => {
    const appSettingsSrc = stripComments(readSource('src/chart/config/AppSettings.ts'));
    expect(appSettingsSrc).toContain("STORAGE_KEY = 'aao.settings.v1'");
    expect(appSettingsSrc).not.toContain("STORAGE_KEY = 'bangdream.settings.v1'");

    const shortcutSrc = stripComments(readSource('src/chart/config/ShortcutConfig.ts'));
    expect(shortcutSrc).toContain("STORAGE_KEY = 'aao.shortcuts.v1'");
    expect(shortcutSrc).not.toContain("STORAGE_KEY = 'bangdream.shortcuts.v1'");

    const projectSrc = stripComments(readSource('src/project/ChartProject.ts'));
    expect(projectSrc).toContain("DB_NAME = 'aao.chartproject'");
    expect(projectSrc).not.toContain("DB_NAME = 'bangdream.chartproject'");

    const pointerSrc = stripComments(readSource('src/project/currentProjectPointer.ts'));
    expect(pointerSrc).toContain("CURRENT_PROJECT_POINTER_KEY = 'aao.currentProject.v1'");
    expect(pointerSrc).not.toContain("CURRENT_PROJECT_POINTER_KEY = 'bangdream.currentProject.v1'");

    const bgSkinSrc = stripComments(readSource('src/rendering/skin/backgroundSkin.ts'));
    expect(bgSkinSrc).toContain("DB_NAME = 'aao.assets'");
    expect(bgSkinSrc).not.toContain("DB_NAME = 'bangdream.assets'");

    const testStorageSrc = stripComments(readSource('tests/support/storage.ts'));
    expect(testStorageSrc).toContain("SETTINGS_KEY = 'aao.settings.v1'");

    const settingsPageSrc = readSource('src/pages/settings/SettingsPage.tsx');
    expect(settingsPageSrc).toContain("a.download = 'aao-settings.json'");
    expect(settingsPageSrc).not.toContain("a.download = 'bangdream-settings.json'");
  });

  it('AppNav 使用品牌图形图标与全称 Tooltip，移除文字 BD', () => {
    const navSrc = readSource('src/layouts/AppNav.tsx');
    expect(navSrc).toMatch(/import\s+appLogo\s+from\s+['"]\.\.\/assets\/brand\/app-logo\.png['"]/);
    expect(navSrc).toContain('app-mark-img');
    expect(navSrc).not.toContain('>BD<');
  });

  it('Electron 主进程设置窗口标题与多平台图标路径', () => {
    const mainSrc = readSource('electron/main.cjs');
    expect(mainSrc).toContain("title: 'AAO Editor'");
    expect(mainSrc).toContain('resolveAppIcon');
    expect(mainSrc).toContain('favicon.ico');
    expect(mainSrc).toContain('icon.png');
    expect(mainSrc).not.toContain('vite.svg');
  });

  it('关键图标资产文件全部实际存在，且根目录不创建冗余 build 夹', () => {
    expect(existsSync(join(root, 'public/favicon.ico'))).toBe(true);
    expect(existsSync(join(root, 'public/icon.png'))).toBe(true);
    expect(existsSync(join(root, 'src/assets/brand/app-logo.png'))).toBe(true);
    expect(existsSync(join(root, 'build'))).toBe(false);
  });

  it('package.json 显式配置 electron-builder 各平台图标指向 public 目录', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
    expect(pkg.build?.win?.icon).toBe('public/favicon.ico');
    expect(pkg.build?.mac?.icon).toBe('public/icon.png');
    expect(pkg.build?.linux?.icon).toBe('public/icon.png');
  });
});

describe('issue 19 · macOS 未签名与 Apple Silicon ad-hoc 签名及指引锁测', () => {
  const root = repoRoot;

  it('package.json 显式配置 macOS ad-hoc 签名与关闭加固运行时，满足 Apple Silicon 原生架构要求', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
    expect(pkg.build?.mac?.identity).toBe('-');
    expect(pkg.build?.mac?.hardenedRuntime).toBe(false);
    expect(pkg.build?.mac?.gatekeeperAssess).toBe(false);
  });

  it('README.md, README.en.md, RELEASE_NOTES.md 与文档站中的 macOS 安装提示包含 xattr / quarantine 引导，且无已失效的右键打开残留', () => {
    const read = (p: string) => readFileSync(join(root, p), 'utf-8');
    const zhReadme = read('README.md');
    const enReadme = read('README.en.md');
    const releaseNotes = read('RELEASE_NOTES.md');
    const zhDocsInstall = read('docs-site/guide/install.md');
    const enDocsInstall = read('docs-site/en/guide/install.md');

    for (const [name, content] of [
      ['README.md', zhReadme],
      ['README.en.md', enReadme],
      ['RELEASE_NOTES.md', releaseNotes],
      ['docs-site/guide/install.md', zhDocsInstall],
      ['docs-site/en/guide/install.md', enDocsInstall],
    ] as const) {
      expect(content, `${name} 必须包含 xattr 指引`).toContain('xattr');
      expect(content, `${name} 必须包含 com.apple.quarantine 属性名`).toContain('com.apple.quarantine');
    }

    // 负锁：macOS 引导段落中不得出现已失效的「右键」或「Ctrl / Control」打开提示
    const macRegex = /右键.*打开|right-click.*open|ctrl-click.*open|control-click.*open/i;

    const zhReadmeMac = zhReadme.slice(zhReadme.indexOf('macOS'));
    expect(zhReadmeMac.slice(0, zhReadmeMac.indexOf('\n\n'))).not.toMatch(macRegex);

    const enReadmeMac = enReadme.slice(enReadme.indexOf('on macOS'));
    expect(enReadmeMac.slice(0, enReadmeMac.indexOf('\n\n'))).not.toMatch(macRegex);

    const releaseNotesMac = releaseNotes.slice(releaseNotes.indexOf('macOS'));
    expect(releaseNotesMac.slice(0, releaseNotesMac.indexOf('\n'))).not.toMatch(macRegex);

    const zhDocsMac = (zhDocsInstall.match(/### macOS([\s\S]*?)### Linux/)?.[1] ?? '') +
      (zhDocsInstall.match(/- \*\*macOS\*\*：[^\n]*/)?.[0] ?? '');
    expect(zhDocsMac).not.toMatch(macRegex);

    const enDocsMac = (enDocsInstall.match(/### macOS([\s\S]*?)### Linux/)?.[1] ?? '') +
      (enDocsInstall.match(/- \*\*macOS\*\*:[^\n]*/)?.[0] ?? '');
    expect(enDocsMac).not.toMatch(macRegex);
  });
});

