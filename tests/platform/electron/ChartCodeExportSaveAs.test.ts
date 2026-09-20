// issue 118：谱面代码「每次另存为、不记路径」。
// issue 102：落盘形态改「每条音符一行」+ 对象视图只导出当前一层。
// 序列化格式由 ChartConverter 既有单测看守；本文件锁
//   ① 导出文本 = 画布 notes 经 convertNotesToChartCode 的权威 JSON（不是弹窗草稿）
//   ② 弹窗接线、Electron dialog、浏览器 a[download]
//   ③ 不记住导出目录（设置对象 / 主进程都不养路径）
import { describe, it, expect } from 'vitest';
import {
  chartCodeExportText, noteCodeExportText, noteCodeExportFilename,
} from '@/src/chart/project/exportChartCode';
import type { ChartNote } from '@/src/chart/types';
import { stripComments, readSource } from '@/tests/support/source';


const modalSrc = stripComments(readSource('src/chart/components/code-editor/ChartCodeEditorModal.tsx'));
const exportSrc = stripComments(readSource('src/chart/project/exportChartCode.ts'));
const mainSrc = stripComments(readSource('electron/main.cjs'));
const preloadSrc = stripComments(readSource('electron/preload.js'));
const settingsSrc = stripComments(readSource('src/chart/config/AppSettings.ts'));

describe('issue 118 · 导出文本来自画布 notes', () => {
  // issue 102：落盘形态改为「每条音符一行」（与弹窗显示一致），覆盖 issue 118 当初的 4 空格口径 ——
  // 理由：下次导入 / 粘贴这份文件时，行数少一个数量级，编辑不卡。
  it('已知 BPM 谱面 → 每条音符一行（与弹窗显示同一份文本，不是 4 空格）', () => {
    const notes: ChartNote[] = [{ type: 'BPM', beat: 0, bpm: 120 }];
    expect(chartCodeExportText(notes)).toBe('[\n{"beat":0,"type":"BPM","bpm":120}\n]');
  });

  it('对象视图（音符代码工具）→ 只导出这一层（裸对象 JSON）', () => {
    const notes: ChartNote[] = [
      { type: 'BPM', beat: 0, bpm: 120 },
      { type: 'Single', beat: 4, lane: 2 },
      { type: 'Single', beat: 8, lane: 5 },
    ];
    // 整条音符
    expect(noteCodeExportText(notes, { noteIndex: 1 }))
      .toBe(JSON.stringify({ beat: 4, lane: 2, type: 'Single' }, null, 4));
    // 滑条结点视图：仍是对象形态（由 buildNoteCode 决定），这里用整条验证"不含其它音符"
    const text = noteCodeExportText(notes, { noteIndex: 2 });
    expect(text).not.toContain('"beat": 4');
    expect(text).toContain('"beat": 8');
    // 目标不存在 → null（调用方静默返回）
    expect(noteCodeExportText(notes, { noteIndex: 99 })).toBeNull();
  });

  it('推荐文件名带音符下标（连续存多条不会互相覆盖）', () => {
    expect(noteCodeExportFilename({ noteIndex: 7 })).toBe('note-7.json');
    expect(noteCodeExportFilename({ noteIndex: 7, connIndex: 2 })).toBe('note-7-2.json');
  });
});

describe('issue 118 · 弹窗接线', () => {
  it('底部有「另存为」，载荷走 exportChartCodeSaveAs(notes[, target]) 而不是 textarea 草稿', () => {
    expect(modalSrc).toContain("t('chartCode.saveAs')");
    expect(modalSrc).toMatch(/exportChartCodeSaveAs\(\s*notes\s*,/);
    expect(modalSrc).not.toMatch(/exportChartCodeSaveAs\(\s*chartCode\s*[,)]/);
  });

  it('范围随档位切换：完整视图存整份、对象视图只存当前这一层', () => {
    expect(modalSrc).toMatch(/exportChartCodeSaveAs\(\s*notes\s*,\s*isChartView \? undefined : target\s*\)/);
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
