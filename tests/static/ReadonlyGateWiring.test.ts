import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function readStripped(rel: string): string {
  const p = path.resolve(__dirname, '../../', rel);
  return fs.readFileSync(p, 'utf-8').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
}

describe('chart-projects 06: 只读闸门与音频锁静态装配锁测', () => {
  it('FinalVirtualCanvas: applyOps 拦截 setNotes / openBpmEditor / setSlideBuffer / setCurveBuffer', () => {
    const src = readStripped('src/chart/components/canvas/FinalVirtualCanvas.tsx');
    expect(src).toMatch(/op\.t === 'setNotes'[\s\S]*?if \(readOnly\)[\s\S]*?onReadonlyReject\?.?\(\)/);
    expect(src).toMatch(/op\.t === 'setSlideBuffer'[\s\S]*?if \(readOnly/);
    expect(src).toMatch(/op\.t === 'setCurveBuffer'[\s\S]*?if \(readOnly/);
    expect(src).toMatch(/op\.t === 'openBpmEditor'[\s\S]*?if \(readOnly/);
    expect(src).toMatch(/commitBpmEdit[\s\S]*?if \(readOnly\)[\s\S]*?onReadonlyReject\?.?\(\)/);
  });

  it('FinalVirtualCanvas: 命令式执行键在只读时拦截', () => {
    const src = readStripped('src/chart/components/canvas/FinalVirtualCanvas.tsx');
    expect(src).toMatch(/execBpm:[\s\S]*?if \(readOnly\) \{ onReadonlyReject\?.?\(\); return; \}/);
    expect(src).toMatch(/execSlide:[\s\S]*?if \(readOnly\) \{ onReadonlyReject\?.?\(\); return; \}/);
    expect(src).toMatch(/execCurve:[\s\S]*?if \(readOnly\) \{ onReadonlyReject\?.?\(\); return; \}/);
    expect(src).toMatch(/execPlace:[\s\S]*?if \(readOnly\) \{ onReadonlyReject\?.?\(\); return; \}/);
    expect(src).toMatch(/execPaste:[\s\S]*?if \(readOnly\) \{ onReadonlyReject\?.?\(\); return; \}/);
  });

  it('EditingProvider: setReadonlyGate 拦截所有谱面变更操作', () => {
    const src = readStripped('src/app/providers/EditingProvider.tsx');
    expect(src).toMatch(/handleNotesChange[\s\S]*?readonlyGateRef\.current\?\.isReadOnly\(\)/);
    expect(src).toMatch(/undo[\s\S]*?readonlyGateRef\.current\?\.isReadOnly\(\)/);
    expect(src).toMatch(/redo[\s\S]*?readonlyGateRef\.current\?\.isReadOnly\(\)/);
    expect(src).toMatch(/cut[\s\S]*?readonlyGateRef\.current\?\.isReadOnly\(\)/);
    expect(src).toMatch(/deleteSelected[\s\S]*?readonlyGateRef\.current\?\.isReadOnly\(\)/);
    expect(src).toMatch(/mirror[\s\S]*?readonlyGateRef\.current\?\.isReadOnly\(\)/);
    expect(src).toMatch(/setReadonlyGate/);
  });

  it('ChartCodeEditorModal: handleApply 拦截只读谱面', () => {
    const src = readStripped('src/chart/components/code-editor/ChartCodeEditorModal.tsx');
    expect(src).toMatch(/const handleApply = \(\) => \{\s*if \(readOnly\) \{\s*onReadonlyReject\?\.?\(\);/);
  });

  it('Editor: 接入只读态、注入 FinalVirtualCanvas 与 ChartCodeEditorProvider、挂载提示浮条与复制按钮', () => {
    const src = readStripped('src/chart/Editor.tsx');
    expect(src).toMatch(/isChartReadonly/);
    expect(src).toMatch(/isProjectAudioLocked/);
    expect(src).toMatch(/setReadonlyGate/);
    expect(src).toMatch(/readOnly=\{isReadOnly\}/);
    expect(src).toMatch(/onReadonlyReject=\{triggerReadonlyPrompt\}/);
    expect(src).toMatch(/readonly-toast/);
    expect(src).toMatch(/handleCopyCurrentChart/);
    expect(src).toMatch(/duplicateChartInProject/);
  });

  it('AudioPage: 音频锁定提示横幅与禁用替换/清除/改时长', () => {
    const src = readStripped('src/audio/AudioPage.tsx');
    expect(src).toMatch(/audioLocked/);
    expect(src).toMatch(/audio-locked-banner/);
    expect(src).toMatch(/audio\.lockedPrompt/);
    expect(src).toMatch(/readOnly=\{audioLocked \|\| canPlay\}/);
  });

  it('useChartProjectPersistence: 已上传谱面与锁定工程防抖落盘防篡改', () => {
    const src = readStripped('src/chart/project/useChartProjectPersistence.ts');
    expect(src).toMatch(/if \(c\.upload\) return c;/);
    expect(src).toMatch(/isProjectAudioLocked\(prev\)/);
  });

  it('i18n: 中英文翻译齐备', () => {
    const zh = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../src/i18n/messages/zh-CN.json'), 'utf-8'));
    const en = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../src/i18n/messages/en.json'), 'utf-8'));
    expect(zh['workspace.readonlyPrompt']).toBe('已上传的谱面不能修改，复制这张谱面来改？');
    expect(zh['workspace.readonlyCopyBtn']).toBe('复制这张谱面');
    expect(zh['audio.lockedPrompt']).toBe('复制这个工程或新建工程后再换音频');
    expect(en['workspace.readonlyPrompt']).toBeTruthy();
    expect(en['workspace.readonlyCopyBtn']).toBeTruthy();
    expect(en['audio.lockedPrompt']).toBeTruthy();
  });
});
