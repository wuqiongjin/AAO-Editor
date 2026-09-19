// issue 117：Electron 数据根（指针在 userData/app-state.json，工程/背景图在当前根下）。
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { APP_STATE_FILENAME, appStateFilePath } from '../../electron/appState.cjs';
import {
  BACKGROUND_SKIN_RELATIVE,
  assetsDir,
  backgroundSkinPath,
  claimDataRoot,
  defaultDataRoot,
  loadDataRootSync,
  moveDataRoot,
  normalizeDataRootPath,
  projectDir,
  projectsDir,
  resolveMoveDestRoot,
  safeProjectId,
  saveDataRootSync,
} from '../../electron/dataRoot.cjs';
import { loadWindowStateSync, saveWindowStateSync } from '../../electron/windowState.cjs';

const ROOT = join(__dirname, '../..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');
const stripComments = (s: string) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

function tmpDir(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe('issue 117 · 根路径规范化与布局', () => {
  it('缺省指针 → userData/data，并建好 projects/ 与 assets/', () => {
    const userData = tmpDir('tsugu-data-root-');
    try {
      expect(APP_STATE_FILENAME).toBe('app-state.json');
      expect(appStateFilePath(userData)).toBe(join(userData, 'app-state.json'));
      const root = loadDataRootSync(userData);
      expect(root).toBe(defaultDataRoot(userData));
      expect(root).toBe(join(userData, 'data'));
      expect(existsSync(projectsDir(root))).toBe(true);
      expect(existsSync(assetsDir(root))).toBe(true);
      expect(BACKGROUND_SKIN_RELATIVE.replace(/\\/g, '/')).toBe('assets/background-skin.bin');
      expect(backgroundSkinPath(root)).toBe(join(root, 'assets', 'background-skin.bin'));
    } finally {
      rmSync(userData, { recursive: true, force: true });
    }
  });

  it('指针往返写在 app-state.json；非法/空回退 userData/data', () => {
    const userData = tmpDir('tsugu-data-ptr-');
    const custom = tmpDir('tsugu-data-custom-');
    try {
      saveDataRootSync(userData, custom);
      expect(loadDataRootSync(userData)).toBe(normalizeDataRootPath(custom));
      const doc = JSON.parse(readFileSync(appStateFilePath(userData), 'utf-8')) as { dataRoot: string };
      expect(doc.dataRoot).toBe(normalizeDataRootPath(custom));
      writeFileSync(appStateFilePath(userData), 'not json');
      expect(loadDataRootSync(userData)).toBe(defaultDataRoot(userData));
      writeFileSync(appStateFilePath(userData), JSON.stringify({ dataRoot: '   ' }));
      expect(loadDataRootSync(userData)).toBe(defaultDataRoot(userData));
      expect(() => normalizeDataRootPath('')).toThrow('数据根路径无效');
    } finally {
      rmSync(userData, { recursive: true, force: true });
      rmSync(custom, { recursive: true, force: true });
    }
  });

  it('app-state.json 同时记下数据根与窗体字段', () => {
    const userData = tmpDir('tsugu-app-state-both-');
    const custom = tmpDir('tsugu-app-state-root-');
    try {
      saveDataRootSync(userData, custom);
      saveWindowStateSync(userData, { width: 1320, height: 880, isMaximized: true });
      expect(loadDataRootSync(userData)).toBe(normalizeDataRootPath(custom));
      expect(loadWindowStateSync(userData)).toEqual({ width: 1320, height: 880, isMaximized: true });
      const doc = JSON.parse(readFileSync(appStateFilePath(userData), 'utf-8')) as {
        dataRoot: string;
        window: { width: number; height: number; isMaximized: boolean };
      };
      expect(doc.dataRoot).toBe(normalizeDataRootPath(custom));
      expect(doc.window).toEqual({ width: 1320, height: 880, isMaximized: true });
    } finally {
      rmSync(userData, { recursive: true, force: true });
      rmSync(custom, { recursive: true, force: true });
    }
  });

  it('id 白名单仍防穿越；合法 id 才能拼工程目录', () => {
    expect(() => safeProjectId('../evil')).toThrow('非法的谱面工程 id');
    expect(() => projectDir('/data', '..')).toThrow('非法的谱面工程 id');
    expect(projectDir('/data', 'default')).toBe(join('/data', 'projects', 'default'));
  });
});

describe('issue 117 · resolveMoveDestRoot', () => {
  it('所选为空目录 → 新根即所选路径', async () => {
    const empty = tmpDir('tsugu-resolve-empty-');
    const fromParent = tmpDir('tsugu-resolve-from-wrap-');
    const fromRoot = join(fromParent, '123');
    mkdirSync(fromRoot, { recursive: true });
    try {
      await expect(resolveMoveDestRoot(fromRoot, empty)).resolves.toBe(normalizeDataRootPath(empty));
    } finally {
      rmSync(empty, { recursive: true, force: true });
      rmSync(fromParent, { recursive: true, force: true });
    }
  });

  it('所选非空 → 新根为 所选/当前根目录名', async () => {
    const parent = tmpDir('tsugu-resolve-parent-');
    const music = join(parent, 'music');
    const fromRoot = join(parent, '123');
    mkdirSync(music, { recursive: true });
    mkdirSync(join(music, 'data'), { recursive: true });
    mkdirSync(fromRoot, { recursive: true });
    try {
      await expect(resolveMoveDestRoot(fromRoot, music)).resolves.toBe(
        normalizeDataRootPath(join(music, '123')),
      );
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

describe('issue 117 · 搬家失败不切根', () => {
  it('目标下已有同名子文件夹且非空 → 拒绝，指针不变', async () => {
    const userData = tmpDir('tsugu-mv-occ-ud-');
    const fromRoot = tmpDir('tsugu-mv-occ-from-');
    const toParent = tmpDir('tsugu-mv-occ-to-');
    try {
      const leaf = fromRoot.replace(/[/\\]+$/, '').split(/[/\\]/).pop()!;
      mkdirSync(join(toParent, leaf, 'projects'), { recursive: true });
      writeFileSync(join(toParent, leaf, 'projects', 'x.json'), '{}');
      saveDataRootSync(userData, fromRoot);
      const r = await moveDataRoot({ userData, fromRoot, toRoot: toParent });
      expect(r.ok).toBe(false);
      expect(r.code).toBe('dest-occupied');
      expect(loadDataRootSync(userData)).toBe(normalizeDataRootPath(fromRoot));
    } finally {
      rmSync(userData, { recursive: true, force: true });
      rmSync(fromRoot, { recursive: true, force: true });
      rmSync(toParent, { recursive: true, force: true });
    }
  });

  it('根名为 data、父目录已有 data/ → 解析到同路径，搬家因占用拒绝', async () => {
    const userData = tmpDir('tsugu-mv-data-clash-ud-');
    const parent = tmpDir('tsugu-mv-data-clash-parent-');
    const music = join(parent, 'music');
    const fromRoot = join(parent, 'data');
    mkdirSync(music, { recursive: true });
    mkdirSync(fromRoot, { recursive: true });
    try {
      mkdirSync(join(music, 'data', 'projects', 'keep'), { recursive: true });
      writeFileSync(join(music, 'data', 'projects', 'keep', 'project.json'), '{"keep":true}');
      mkdirSync(join(fromRoot, 'projects', 'src'), { recursive: true });
      writeFileSync(join(fromRoot, 'projects', 'src', 'project.json'), '{"src":true}');
      saveDataRootSync(userData, fromRoot);

      await expect(resolveMoveDestRoot(fromRoot, music)).resolves.toBe(
        normalizeDataRootPath(join(music, 'data')),
      );
      const r = await moveDataRoot({ userData, fromRoot, toRoot: music });
      expect(r.ok).toBe(false);
      expect(r.code).toBe('dest-occupied');
      expect(loadDataRootSync(userData)).toBe(normalizeDataRootPath(fromRoot));
      expect(readFileSync(join(music, 'data', 'projects', 'keep', 'project.json'), 'utf-8')).toBe('{"keep":true}');
    } finally {
      rmSync(userData, { recursive: true, force: true });
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('父目录已有其他子目录：落到 父目录/当前根名，互不影响', async () => {
    const userData = tmpDir('tsugu-mv-sibling-ud-');
    const parent = tmpDir('tsugu-mv-sibling-parent-');
    const music = join(parent, 'music');
    const fromRoot = join(parent, '123');
    mkdirSync(music, { recursive: true });
    mkdirSync(fromRoot, { recursive: true });
    try {
      mkdirSync(join(music, 'data', 'projects', 'keep'), { recursive: true });
      writeFileSync(join(music, 'data', 'projects', 'keep', 'project.json'), '{"keep":true}');
      mkdirSync(join(fromRoot, 'projects', 'moved'), { recursive: true });
      writeFileSync(join(fromRoot, 'projects', 'moved', 'project.json'), '{"moved":true}');
      saveDataRootSync(userData, fromRoot);

      const r = await moveDataRoot({ userData, fromRoot, toRoot: music });
      const destRoot = join(music, '123');
      expect(r.ok).toBe(true);
      expect(loadDataRootSync(userData)).toBe(normalizeDataRootPath(destRoot));
      expect(readFileSync(join(destRoot, 'projects', 'moved', 'project.json'), 'utf-8')).toBe('{"moved":true}');
      expect(readFileSync(join(music, 'data', 'projects', 'keep', 'project.json'), 'utf-8')).toBe('{"keep":true}');
      expect(existsSync(fromRoot)).toBe(false);
    } finally {
      rmSync(userData, { recursive: true, force: true });
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('目标落在当前根子目录 → 拒绝', async () => {
    const userData = tmpDir('tsugu-mv-in-ud-');
    const fromRoot = tmpDir('tsugu-mv-in-from-');
    const toRoot = join(fromRoot, 'nested');
    mkdirSync(toRoot);
    try {
      saveDataRootSync(userData, fromRoot);
      const r = await moveDataRoot({ userData, fromRoot, toRoot });
      expect(r.ok).toBe(false);
      expect(r.code).toBe('dest-inside-source');
      expect(loadDataRootSync(userData)).toBe(normalizeDataRootPath(fromRoot));
    } finally {
      rmSync(userData, { recursive: true, force: true });
      rmSync(fromRoot, { recursive: true, force: true });
    }
  });

  it('拷贝失败 → 不切根，目标侧不留下半套 data/', async () => {
    const userData = tmpDir('tsugu-mv-fail-ud-');
    const fromRoot = tmpDir('tsugu-mv-fail-from-');
    const toRoot = tmpDir('tsugu-mv-fail-to-');
    try {
      mkdirSync(join(fromRoot, 'projects', 'default'), { recursive: true });
      writeFileSync(join(fromRoot, 'projects', 'default', 'project.json'), '{}');
      saveDataRootSync(userData, fromRoot);
      const r = await moveDataRoot({
        userData,
        fromRoot,
        toRoot,
        copyDir: async (src: string, dest: string) => {
          const { cp } = await import('fs/promises');
          await cp(src, dest, { recursive: true });
          throw new Error('disk full after write');
        },
      });
      expect(r.ok).toBe(false);
      expect(r.code).toBe('copy-failed');
      expect(loadDataRootSync(userData)).toBe(normalizeDataRootPath(fromRoot));
      expect(existsSync(join(fromRoot, 'projects', 'default', 'project.json'))).toBe(true);
      expect(existsSync(join(toRoot, 'projects'))).toBe(false);
    } finally {
      rmSync(userData, { recursive: true, force: true });
      rmSync(fromRoot, { recursive: true, force: true });
      rmSync(toRoot, { recursive: true, force: true });
    }
  });

  it('成功搬家：数据拷到所选文件夹本身，指针指向该路径，旧目录删除', async () => {
    const userData = tmpDir('tsugu-mv-ok-ud-');
    const fromRoot = tmpDir('tsugu-mv-ok-from-');
    const toRoot = tmpDir('tsugu-mv-ok-to-');
    try {
      mkdirSync(join(fromRoot, 'projects', 'default'), { recursive: true });
      writeFileSync(join(fromRoot, 'projects', 'default', 'project.json'), '{"schemaVersion":1}');
      mkdirSync(join(fromRoot, 'assets'), { recursive: true });
      writeFileSync(join(fromRoot, 'assets', 'background-skin.bin'), Buffer.from([1, 2, 3]));
      saveDataRootSync(userData, fromRoot);

      const r = await moveDataRoot({ userData, fromRoot, toRoot });
      expect(r.ok).toBe(true);
      expect(loadDataRootSync(userData)).toBe(normalizeDataRootPath(toRoot));
      expect(readFileSync(join(toRoot, 'projects', 'default', 'project.json'), 'utf-8')).toBe(
        '{"schemaVersion":1}',
      );
      expect(readFileSync(join(toRoot, 'assets', 'background-skin.bin'))).toEqual(Buffer.from([1, 2, 3]));
      expect(existsSync(fromRoot)).toBe(false);
    } finally {
      rmSync(userData, { recursive: true, force: true });
      rmSync(fromRoot, { recursive: true, force: true });
      rmSync(toRoot, { recursive: true, force: true });
    }
  });
});

describe('issue 117 · 认领已有数据根', () => {
  it('已有 projects/ 的目录：只改指针，不复制', async () => {
    const userData = tmpDir('tsugu-claim-ud-');
    const fromRoot = tmpDir('tsugu-claim-from-');
    const toRoot = tmpDir('tsugu-claim-to-');
    try {
      mkdirSync(join(fromRoot, 'projects', 'a'), { recursive: true });
      writeFileSync(join(fromRoot, 'projects', 'a', 'project.json'), '{"from":true}');
      mkdirSync(join(toRoot, 'projects', 'b'), { recursive: true });
      writeFileSync(join(toRoot, 'projects', 'b', 'project.json'), '{"to":true}');
      saveDataRootSync(userData, fromRoot);
      const r = await claimDataRoot({ userData, toRoot });
      expect(r.ok).toBe(true);
      expect(loadDataRootSync(userData)).toBe(normalizeDataRootPath(toRoot));
      expect(readFileSync(join(fromRoot, 'projects', 'a', 'project.json'), 'utf-8')).toBe('{"from":true}');
      expect(readFileSync(join(toRoot, 'projects', 'b', 'project.json'), 'utf-8')).toBe('{"to":true}');
      expect(existsSync(join(toRoot, 'assets'))).toBe(true);
    } finally {
      rmSync(userData, { recursive: true, force: true });
      rmSync(fromRoot, { recursive: true, force: true });
      rmSync(toRoot, { recursive: true, force: true });
    }
  });

  it('空目录：初始化 projects/、assets/ 并切指针', async () => {
    const userData = tmpDir('tsugu-claim-empty-ud-');
    const fromRoot = tmpDir('tsugu-claim-empty-from-');
    const toRoot = tmpDir('tsugu-claim-empty-to-');
    try {
      saveDataRootSync(userData, fromRoot);
      const r = await claimDataRoot({ userData, toRoot });
      expect(r.ok).toBe(true);
      expect(loadDataRootSync(userData)).toBe(normalizeDataRootPath(toRoot));
      expect(existsSync(join(toRoot, 'projects'))).toBe(true);
      expect(existsSync(join(toRoot, 'assets'))).toBe(true);
    } finally {
      rmSync(userData, { recursive: true, force: true });
      rmSync(fromRoot, { recursive: true, force: true });
      rmSync(toRoot, { recursive: true, force: true });
    }
  });
});

describe('issue 117 · 不进设置 / 导出；入口仅 Electron 门控', () => {
  it('AppSettings 无数据根字段', () => {
    const settingsSrc = stripComments(read('src/chart/config/AppSettings.ts'));
    expect(settingsSrc).not.toMatch(/dataRoot|data-root|保存位置/);
  });

  it('设置页导出仍是 settings 对象；搬家与认领在 electronAPI 门控之后', () => {
    const settingsPageSrc = stripComments(read('src/settings/SettingsPage.tsx'));
    expect(settingsPageSrc).toMatch(/JSON\.stringify\(settings/);
    expect(settingsPageSrc).toMatch(/settings\.export/);
    expect(settingsPageSrc).toMatch(/settings\.import/);
    expect(settingsPageSrc).toMatch(/settings\.data\.intro/);
    expect(settingsPageSrc).toMatch(/settings\.dataRoot/);
    expect(settingsPageSrc).toMatch(/settings\.prefs/);
    expect(settingsPageSrc).not.toMatch(/不含/);
    expect(settingsPageSrc).toMatch(/dataRootApi\s*&&[\s\S]*settings\.dataRoot/);
    expect(settingsPageSrc).toMatch(/dataRootApi\s*&&[\s\S]*settings\.dataRoot\.change/);
    expect(settingsPageSrc).toMatch(/dataRootApi\s*&&[\s\S]*settings\.dataRoot\.claim/);
    expect(settingsPageSrc).not.toMatch(/JSON\.stringify\([^)]*dataRoot/);
    expect(settingsPageSrc).not.toMatch(/导出全部配置/);
  });

  it('主进程/preload 接线：搬家与认领分开；背景图走数据根固定文件', () => {
    const mainSrc = stripComments(read('electron/main.cjs'));
    const preloadSrc = stripComments(read('electron/preload.js'));
    expect(preloadSrc).toMatch(/dataRoot\s*:/);
    expect(preloadSrc).toMatch(/invoke\(\s*['"]dataRoot:change['"]/);
    expect(preloadSrc).toMatch(/invoke\(\s*['"]dataRoot:claim['"]/);
    expect(preloadSrc).toMatch(/backgroundSkin\s*:/);
    expect(mainSrc).toMatch(/moveDataRoot/);
    expect(mainSrc).toMatch(/claimDataRoot/);
    expect(mainSrc).toMatch(/['"]dataRoot:change['"]/);
    expect(mainSrc).toMatch(/['"]dataRoot:claim['"]/);
    expect(mainSrc).toMatch(/['"]backgroundSkin:get['"]/);
    expect(mainSrc).toMatch(/backgroundSkinPath/);
  });
});
