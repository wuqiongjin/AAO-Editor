// issue 118：谱面代码「每次另存为、不记路径」。
// 序列化格式由 ChartConverter 既有单测看守；本文件锁
//   ① 导出文本 = 画布 notes 经 convertNotesToChartCode 的权威 JSON（不是弹窗草稿）
//   ② 弹窗接线、Electron dialog、浏览器 a[download]
//   ③ 不记住导出目录（设置对象 / 主进程都不养路径）
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { chartCodeExportText } from '../../src/chart/project/exportChartCode';
import type { ChartNote } from '../../src/chart/types';

const ROOT = join(__dirname, '../..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');
const stripComments = (s: string) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

const modalSrc = stripComments(read('src/chart/components/code-editor/ChartCodeEditorModal.tsx'));
const exportSrc = stripComments(read('src/chart/project/exportChartCode.ts'));
const mainSrc = stripComments(read('electron/main.cjs'));
const preloadSrc = stripComments(read('electron/preload.js'));
const settingsSrc = stripComments(read('src/chart/config/AppSettings.ts'));

describe('issue 118 · 导出文本来自画布 notes', () => {
  it('已知 BPM 谱面 → 权威 4 空格 JSON（与复制弹窗草稿无关）', () => {
    const notes: ChartNote[] = [{ type: 'BPM', beat: 0, bpm: 120 }];
    expect(chartCodeExportText(notes)).toBe(
      '[\n    {\n        "beat": 0,\n        "type": "BPM",\n        "bpm": 120\n    }\n]',
    );
  });
});

describe('issue 118 · 弹窗接线', () => {
  it('底部有「另存为」，载荷走 exportChartCodeSaveAs(notes) 而不是 textarea 草稿', () => {
    expect(modalSrc).toContain('另存为');
    expect(modalSrc).toMatch(/exportChartCodeSaveAs\(\s*notes\s*\)/);
    expect(modalSrc).not.toMatch(/exportChartCodeSaveAs\(\s*chartCode\s*\)/);
  });
});

describe('issue 118 · Electron 每次 dialog、不记路径', () => {
  it('preload 暴露 chartCodeExport.saveAs', () => {
    expect(preloadSrc).toMatch(/chartCodeExport\s*:/);
    expect(preloadSrc).toMatch(/invoke\(\s*['"]chartCode:saveAs['"]/);
  });

  it('主进程 showSaveDialog；defaultPath 只用 basename（渲染侧不能塞目录）', () => {
    expect(mainSrc).toMatch(/dialog\.showSaveDialog/);
    expect(mainSrc).toMatch(/['"]chartCode:saveAs['"]/);
    expect(mainSrc).toMatch(/path\.basename\(/);
    expect(mainSrc).toMatch(/writeFile/);
  });

  it('主进程不把选中路径写回设置 / userData 记忆文件', () => {
    const saveAsChunk = mainSrc.slice(mainSrc.indexOf('chartCode:saveAs'));
    expect(saveAsChunk).not.toMatch(/localStorage|exportDir|lastExport|saveAsPath|exportPath/);
    expect(saveAsChunk).not.toMatch(/writeFile\([^)]*userData/);
  });
});

describe('issue 118 · 浏览器下载回退', () => {
  it('无 Electron 桥时走 a.download，文件名固定、不记目录', () => {
    expect(exportSrc).toMatch(/a\.download\s*=/);
    expect(exportSrc).toMatch(/chart\.json/);
  });
});

describe('issue 118 · 设置对象不养导出路径', () => {
  it('AppSettings 无导出目录字段', () => {
    expect(settingsSrc).not.toMatch(/exportDir|exportPath|lastExport|saveAsPath|chartCodeExport/i);
  });

  it('渲染侧导出路径不写 localStorage', () => {
    expect(exportSrc).not.toMatch(/localStorage/);
    expect(modalSrc).not.toMatch(/localStorage/);
  });
});
