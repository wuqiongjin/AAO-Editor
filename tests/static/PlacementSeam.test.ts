// issue 133：覆盖落点同一接缝（2026-09-21 架构评审候选 2）。
// 锁接线，不锁 ADR-0001 细则（细则仍在 NoteReplacementRules / NoteDragging 行为测）。
import { describe, it, expect } from 'vitest';
import { readStripped } from '@/tests/support/source';

const nrr = readStripped('src/chart/editing/NoteReplacementRules.ts');
const drag = readStripped('src/chart/editing/NoteDragging.ts');
const matrix = readStripped('src/chart/editing/ToolActionMatrix.ts');
const editing = readStripped('src/app/providers/EditingProvider.tsx');

describe('覆盖落点同一接缝（issue 133）', () => {
  it('覆盖模块公开 applyPlacement(notes, intent)', () => {
    expect(nrr).toMatch(/export function applyPlacement\s*\(/);
    expect(nrr).toMatch(/PlacementIntent/);
  });

  it('点击键型放置走 applyPlacement', () => {
    expect(matrix).toMatch(/applyPlacement\s*\(/);
    expect(matrix).not.toMatch(/handleNoteReplacement\s*\(/);
  });

  it('粘贴重叠与批量键型走 applyPlacement', () => {
    expect(nrr).toMatch(/export function batchApplyKeyType[\s\S]*?applyPlacement\s*\(/);
    expect(nrr).toMatch(/export function pasteChartNotes[\s\S]*?applyPlacement\s*\(/);
  });

  it('planDragMove 只在应用阶段调一次 applyPlacement（无 probe）', () => {
    expect(drag.match(/applyPlacement\s*\(/g)?.length).toBe(1);
    expect(drag).not.toMatch(/handleNoteReplacement/);
    expect(drag).not.toMatch(/\bprobe\b/);
  });

  it('EditingProvider 无 place 浅入口', () => {
    expect(editing).not.toMatch(/\bplace\b/);
    expect(editing).not.toMatch(/handleNoteReplacement/);
    expect(editing).not.toMatch(/applyPlacement/);
  });
});
