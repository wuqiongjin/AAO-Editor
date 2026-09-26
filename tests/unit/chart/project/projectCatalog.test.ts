// chart-projects 04：工程管理页锁测。
// 列表排序 / 未命名显示；新增谱面走 Apply 闸门（保真 vs 硬拒绝）；复制工程不带谱面状态。
import { describe, expect, it } from 'vitest';
import { convertNotesToChartCode } from '@/src/chart/editing/ChartConverter';
import {
  addChartToProject,
  chartSwitchLabel,
  createBlankProject,
  deleteChartFromProject,
  duplicateChartInProject,
  duplicateProject,
  projectDisplayName,
  sortProjectsByLastOpened,
} from '@/src/chart/project/projectCatalog';
import { createUnnamedProject } from '@/src/chart/project/workspaceProject';
import type { ChartNote } from '@/src/chart/types';

const untitled = '未命名工程';

describe('projectDisplayName · 未命名工程显示', () => {
  it('name 为空或只含空白时显示「未命名工程」，有名称则原样', () => {
    expect(projectDisplayName(null, untitled)).toBe('未命名工程');
    expect(projectDisplayName('   ', untitled)).toBe('未命名工程');
    expect(projectDisplayName('FIRE BIRD', untitled)).toBe('FIRE BIRD');
  });
});

describe('sortProjectsByLastOpened · 按最近打开', () => {
  it('lastOpened 新的在前', () => {
    const listed = sortProjectsByLastOpened([
      { id: 'old', lastOpened: 10 },
      { id: 'mid', lastOpened: 20 },
      { id: 'new', lastOpened: 50 },
    ]);
    expect(listed.map((p) => p.id)).toEqual(['new', 'mid', 'old']);
  });
});

describe('addChartToProject · 谱面代码 Apply 闸门', () => {
  const base = () => createUnnamedProject({ id: 'pSong1', chartId: 'cEx1', now: 1 });

  it('贴合法代码：建出一张谱面且源数据保真', () => {
    const code = [
      { beat: 0, type: 'BPM', bpm: 120 },
      { beat: 1, lane: 0, type: 'Single', charge: true, foo: 'bar' },
    ];
    const src = base();
    const result = addChartToProject(src, {
      title: '练习',
      diff: 2,
      level: 21,
      codeText: JSON.stringify(code),
    }, { chartId: 'cHd1', now: 9 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(src.charts).toHaveLength(1);
    expect(result.project.charts).toHaveLength(2);
    expect(result.chart.id).toBe('cHd1');
    expect(result.chart.diff).toBe(2);
    expect(result.chart.level).toBe(21);
    expect(result.chart.title).toBe('练习');
    expect(result.chart.completed).toBe(false);
    expect(result.chart.upload).toBeNull();
    expect(convertNotesToChartCode(result.chart.notes)[1]).toMatchObject({
      type: 'Single', charge: true, foo: 'bar',
    });
  });

  it('硬拒绝的代码不产生新谱面（未知 type）', () => {
    const src = base();
    const result = addChartToProject(src, {
      title: null,
      diff: 3,
      level: null,
      codeText: JSON.stringify([
        { beat: 0, type: 'BPM', bpm: 120 },
        { beat: 1, type: 'Mystery', foo: 1 },
      ]),
    }, { chartId: 'cBad', now: 9 });

    expect(result.ok).toBe(false);
    expect(src.charts).toHaveLength(1);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === 'type')).toBe(true);
  });

  it('非法 JSON 不产生新谱面', () => {
    const src = base();
    const result = addChartToProject(src, {
      title: null,
      diff: 3,
      level: null,
      codeText: 'not-json',
    }, { chartId: 'cBad', now: 9 });
    expect(result.ok).toBe(false);
    expect(src.charts).toHaveLength(1);
  });
});

describe('chartSwitchLabel · 工作台切换器当前谱面那段', () => {
  it('名称为空或等于工程名称时只显示难度；不同则「难度 · 名称」', () => {
    expect(chartSwitchLabel('FIRE BIRD', { title: null, diff: 3 })).toBe('Expert');
    expect(chartSwitchLabel('FIRE BIRD', { title: '  ', diff: 3 })).toBe('Expert');
    expect(chartSwitchLabel('FIRE BIRD', { title: 'FIRE BIRD', diff: 3 })).toBe('Expert');
    expect(chartSwitchLabel('FIRE BIRD', { title: '  FIRE BIRD  ', diff: 3 })).toBe('Expert');
    expect(chartSwitchLabel('FIRE BIRD', { title: '练习版', diff: 3 })).toBe('Expert · 练习版');
  });

  it('同难度两张：空名只显示难度，另一张带自己的名称', () => {
    expect(chartSwitchLabel('FIRE BIRD', { title: null, diff: 3 })).toBe('Expert');
    expect(chartSwitchLabel('FIRE BIRD', { title: 'FIRE BIRD 练习版', diff: 3 })).toBe('Expert · FIRE BIRD 练习版');
  });
});

describe('duplicateChartInProject · 同工程复制谱面', () => {
  it('源数据逐字段相等（名称除外）、状态清空、新 id、名称 = 原显示名（副本）', () => {
    const notes: ChartNote[] = [
      { beat: 0, type: 'BPM', bpm: 160 },
      { beat: 4, lane: 2, type: 'Single', charge: true, foo: 'keep' } as ChartNote,
    ];
    const src = createBlankProject({ id: 'pSong1', chartId: 'cEx1', now: 10, name: 'FIRE BIRD', diff: 3 });
    src.charts[0] = {
      ...src.charts[0],
      notes,
      title: null,
      level: 27,
      completed: true,
      upload: { postId: 254301, at: 3 },
      lastModified: 10,
      appliedChartCodeText: '[{"beat":0,"type":"BPM","bpm":160}]',
      chartCodePristine: true,
    };

    const next = duplicateChartInProject(src, 'cEx1', { chartId: 'cCopy1', now: 99 }, untitled);
    expect(next).not.toBeNull();
    if (!next) return;
    expect(src.charts).toHaveLength(1);
    expect(next.charts).toHaveLength(2);
    const copy = next.charts[1];
    expect(copy.id).toBe('cCopy1');
    expect(copy.id).not.toBe(src.charts[0].id);
    expect(copy.title).toBe('FIRE BIRD（副本）');
    expect(copy.diff).toBe(3);
    expect(copy.level).toBe(27);
    expect(copy.completed).toBe(false);
    expect(copy.upload).toBeNull();
    expect(copy.lastModified).toBe(99);
    expect(copy.appliedChartCodeText).toBe(src.charts[0].appliedChartCodeText);
    expect(copy.chartCodePristine).toBe(true);
    expect(copy.notes).toEqual(notes);
    expect(copy.notes).not.toBe(notes);
    expect(src.charts[0].completed).toBe(true);
    expect(src.charts[0].upload).toEqual({ postId: 254301, at: 3 });
    expect(src.charts[0].title).toBeNull();
  });

  it('已有同名则（副本 2）；自定义名称用原显示名', () => {
    const src = createBlankProject({ id: 'pSong1', chartId: 'cEx1', now: 10, name: 'FIRE BIRD', diff: 3 });
    src.charts[0] = { ...src.charts[0], title: '练习版' };
    const once = duplicateChartInProject(src, 'cEx1', { chartId: 'cCopy1', now: 11 }, untitled)!;
    expect(once.charts[1].title).toBe('练习版（副本）');
    const twice = duplicateChartInProject(once, 'cEx1', { chartId: 'cCopy2', now: 12 }, untitled)!;
    expect(twice.charts.map((c) => c.title)).toEqual(['练习版', '练习版（副本 2）', '练习版（副本）']);
  });
});

describe('deleteChartFromProject · 至少一张谱面', () => {
  it('删最后一张被拒，工程不变', () => {
    const src = createUnnamedProject({ id: 'pSong1', chartId: 'cEx1', now: 1 });
    const result = deleteChartFromProject(src, 'cEx1');
    expect(result).toEqual({ ok: false, reason: 'last' });
    expect(src.charts).toHaveLength(1);
  });

  it('两张里删一张留下另一张', () => {
    const src = createUnnamedProject({ id: 'pSong1', chartId: 'cEx1', now: 1 });
    const added = addChartToProject(src, { title: null, diff: 2, level: null, codeText: '' }, { chartId: 'cHd1', now: 2 });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const result = deleteChartFromProject(added.project, 'cEx1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.charts.map((c) => c.id)).toEqual(['cHd1']);
  });
});

describe('duplicateProject · 照搬工程、谱面状态不带', () => {
  it('工程信息 / 音频 / 封面 / 谱面照搬，完成标记与上传记录清空', () => {
    const notes: ChartNote[] = [
      { beat: 0, type: 'BPM', bpm: 160 },
      { beat: 4, lane: 2, type: 'Single', charge: true, foo: 'keep' } as ChartNote,
    ];
    const src = createBlankProject({
      id: 'pSrc',
      chartId: 'cSrc',
      now: 10,
      name: 'FIRE BIRD',
      artist: 'Roselia',
      diff: 3,
    });
    src.source = { type: 'bandori', id: 243 };
    src.audioName = 'fb.mp3';
    src.coverName = 'fb.png';
    src.audioBlob = new Blob([new Uint8Array([1, 2])]);
    src.coverBlob = new Blob([new Uint8Array([9])]);
    src.durationSeconds = 236;
    src.charts[0] = {
      ...src.charts[0],
      notes,
      title: '练习版',
      level: 27,
      completed: true,
      upload: { postId: 254301, at: 3 },
      lastModified: 10,
    };

    const copy = duplicateProject(src, { id: 'pCopy', chartIds: ['cCopy'], now: 99 });
    expect(copy.id).toBe('pCopy');
    expect(copy.name).toBe('FIRE BIRD（副本）');
    expect(copy.artist).toBe('Roselia');
    expect(copy.source).toEqual({ type: 'bandori', id: 243 });
    expect(copy.audioName).toBe('fb.mp3');
    expect(copy.coverName).toBe('fb.png');
    expect(copy.audioBlob).toBe(src.audioBlob);
    expect(copy.coverBlob).toBe(src.coverBlob);
    expect(copy.durationSeconds).toBe(236);
    expect(copy.lastOpened).toBe(99);
    expect(copy.charts).toHaveLength(1);
    expect(copy.charts[0].id).toBe('cCopy');
    expect(copy.charts[0].title).toBe('练习版');
    expect(copy.charts[0].diff).toBe(3);
    expect(copy.charts[0].level).toBe(27);
    expect(copy.charts[0].completed).toBe(false);
    expect(copy.charts[0].upload).toBeNull();
    expect(copy.charts[0].lastModified).toBe(99);
    expect(copy.charts[0].notes).toEqual(notes);
    expect(copy.charts[0].notes).not.toBe(notes);
    expect(src.charts[0].completed).toBe(true);
    expect(src.charts[0].upload).toEqual({ postId: 254301, at: 3 });
  });
});
