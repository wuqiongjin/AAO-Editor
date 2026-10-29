// chart-projects 04：工程管理页锁测。
// 列表排序 / 未命名显示；新增谱面走 Apply 闸门（保真 vs 硬拒绝）；复制工程不带谱面状态。
import { describe, expect, it } from 'vitest';
import { convertNotesToChartCode } from '@/src/chart/editing/ChartConverter';
import {
  addChartToProject,
  chartSwitchLabel,
  diffPillLabel,
  createBlankProject,
  deleteChartFromProject,
  duplicateChartInProject,
  duplicateProject,
  projectDisplayName,
  recordChartUpload,
  sortProjectsByLastOpened,
  toggleChartCompleted,
  updateChartInfo,
  updateChartPublishDraft,
  updateChartTags,
  updateUploadedChartMeta,
} from '@/src/project/projectCatalog';
import { createUnnamedProject } from '@/src/project/workspaceProject';
import type { ChartNote } from '@/src/chart/types';
import { setActiveUiLanguage } from '@/src/i18n';

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

describe('chartSwitchLabel · 切换器当前谱面标题（issue 176 验收回修）', () => {
  const untitled = '未命名工程';
  it('空名回落工程名；有独立谱面名则用谱面名（始终有字，不写难度全称）', () => {
    expect(chartSwitchLabel('FIRE BIRD', { title: null }, untitled)).toBe('FIRE BIRD');
    expect(chartSwitchLabel('FIRE BIRD', { title: '  ' }, untitled)).toBe('FIRE BIRD');
    expect(chartSwitchLabel('FIRE BIRD', { title: 'FIRE BIRD' }, untitled)).toBe('FIRE BIRD');
    expect(chartSwitchLabel(null, { title: null }, untitled)).toBe(untitled);
    expect(chartSwitchLabel('FIRE BIRD', { title: '练习版' }, untitled)).toBe('练习版');
  });
});

describe('diffPillLabel · 切换器色块', () => {
  it('无等级只短码，有等级为「短码 等级」', () => {
    expect(diffPillLabel(0, null)).toBe('EZ');
    expect(diffPillLabel(0, 1)).toBe('EZ 1');
    expect(diffPillLabel(3, 27)).toBe('EX 27');
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

  it('复制谱面副本：叠加「（副本）（副本）」，不剥旧后缀（issue 19 #6 修订）', () => {
    const src = createBlankProject({ id: 'pSong1', chartId: 'cEx1', now: 10, name: 'FIRE BIRD', diff: 3 });
    src.charts[0] = { ...src.charts[0], title: '练习版' };
    const once = duplicateChartInProject(src, 'cEx1', { chartId: 'cCopy1', now: 11 }, untitled)!;
    const copyOfCopy = duplicateChartInProject(once, 'cCopy1', { chartId: 'cCopy2', now: 12 }, untitled)!;
    expect(copyOfCopy.charts.map((c) => c.title)).toEqual(['练习版', '练习版（副本）', '练习版（副本）（副本）']);
  });
});

describe('duplicateProject · 副本命名（issue 19 #6）', () => {
  const named = (name: string) => createBlankProject({ id: `p-${name}`, chartId: `c-${name}`, now: 10, name });

  it('重名递增：同源复制两次 →（副本）/（副本 2）', () => {
    const first = duplicateProject(named('FIRE BIRD'), { id: 'p1', chartIds: ['c1'], now: 1 }, untitled, ['FIRE BIRD']);
    expect(first.name).toBe('FIRE BIRD（副本）');
    const second = duplicateProject(named('FIRE BIRD'), {
      id: 'p2', chartIds: ['c2'], now: 2,
    }, untitled, ['FIRE BIRD', 'FIRE BIRD（副本）']);
    expect(second.name).toBe('FIRE BIRD（副本 2）');
  });

  it('复制副本：叠加「（副本）（副本）」，不剥旧后缀（2026-09-28 修订）', () => {
    const copyOfCopy = duplicateProject(named('FIRE BIRD（副本）'), {
      id: 'p3', chartIds: ['c3'], now: 3,
    }, untitled, ['FIRE BIRD', 'FIRE BIRD（副本）']);
    expect(copyOfCopy.name).toBe('FIRE BIRD（副本）（副本）');
  });

  it('复制副本重名：只在叠加后的标记内递增 →（副本）（副本 2）', () => {
    const copy = duplicateProject(named('FIRE BIRD（副本）'), {
      id: 'p3', chartIds: ['c3'], now: 3,
    }, untitled, ['FIRE BIRD（副本）', 'FIRE BIRD（副本）（副本）']);
    expect(copy.name).toBe('FIRE BIRD（副本）（副本 2）');
  });

  it('未命名工程按显示名编号；不给 taken 时保持（副本）', () => {
    const anon = duplicateProject(createUnnamedProject({ id: 'pA', chartId: 'cA', now: 1 }), {
      id: 'pB', chartIds: ['cB'], now: 2,
    }, untitled, [untitled]);
    expect(anon.name).toBe('未命名工程（副本）');
    const bare = duplicateProject(named('FIRE BIRD'), { id: 'p4', chartIds: ['c4'], now: 4 });
    expect(bare.name).toBe('FIRE BIRD（副本）');
  });

  it('未命名工程的副本再复制：叠加为「未命名工程（副本）（副本）」（用户报障原例）', () => {
    const copyOfCopy = duplicateProject(named('未命名工程（副本）'), {
      id: 'pC', chartIds: ['cC'], now: 5,
    }, untitled, [untitled, '未命名工程（副本）']);
    expect(copyOfCopy.name).toBe('未命名工程（副本）（副本）');
  });

  it('标记随界面语言：en →「 (Copy)」/「 (Copy 2)」半角；工程与谱面共用（2026-09-28 拍板）', () => {
    setActiveUiLanguage('en');
    try {
      const copy = duplicateProject(named('FIRE BIRD'), {
        id: 'pEn', chartIds: ['cEn'], now: 6,
      }, 'Untitled project', ['FIRE BIRD']);
      expect(copy.name).toBe('FIRE BIRD (Copy)');
      const numbered = duplicateProject(named('FIRE BIRD'), {
        id: 'pEn2', chartIds: ['cEn2'], now: 7,
      }, 'Untitled project', ['FIRE BIRD', 'FIRE BIRD (Copy)']);
      expect(numbered.name).toBe('FIRE BIRD (Copy 2)');
      const anon = duplicateProject(createUnnamedProject({ id: 'pAnonEn', chartId: 'cAnonEn', now: 8 }), {
        id: 'pAnonEn2', chartIds: ['cAnonEn2'], now: 9,
      }, 'Untitled project', ['Untitled project']);
      expect(anon.name).toBe('Untitled project (Copy)');
      const chartCopy = duplicateChartInProject(
        createBlankProject({ id: 'pSongEn', chartId: 'cEn0', now: 10, name: 'FIRE BIRD', diff: 3 }),
        'cEn0', { chartId: 'cEnCopy', now: 11 }, 'Untitled project',
      )!;
      expect(chartCopy.charts[1].title).toBe('FIRE BIRD (Copy)');
    } finally {
      setActiveUiLanguage('zh-CN');
    }
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

describe('票 42 Q3 · 发布描述草稿持久化', () => {
  it('updateChartPublishDraft：更新指定谱面的草稿，空白串归一为 null', () => {
    const p = createUnnamedProject({ id: 'p1', chartId: 'c1', now: 100 });
    const withDraft = updateChartPublishDraft(p, 'c1', '这是草稿内容');
    expect(withDraft.charts[0].publishDraft).toBe('这是草稿内容');

    const cleared = updateChartPublishDraft(withDraft, 'c1', '   ');
    expect(cleared.charts[0].publishDraft).toBeNull();
  });

  it('duplicateChartInProject：复制谱面一并带上草稿', () => {
    const base = createUnnamedProject({ id: 'p1', chartId: 'c1', now: 100 });
    const withDraft = updateChartPublishDraft(base, 'c1', '带上我');
    const duplicated = duplicateChartInProject(withDraft, 'c1', { chartId: 'c2', now: 101 }, untitled);
    expect(duplicated).not.toBeNull();
    expect(duplicated!.charts.find((c) => c.id === 'c2')?.publishDraft).toBe('带上我');
  });

  it('recordChartUpload：发布成功写上传记录时保留草稿（票 51 Q13）', () => {
    const base = createUnnamedProject({ id: 'p1', chartId: 'c1', now: 100 });
    const withDraft = updateChartPublishDraft(base, 'c1', '发后只读展示');
    const uploaded = recordChartUpload(withDraft, 'c1', { postId: 12345, at: 200 });
    expect(uploaded).not.toBeNull();
    expect(uploaded!.charts[0].upload).toEqual({ postId: 12345, at: 200 });
    expect(uploaded!.charts[0].publishDraft).toBe('发后只读展示');
  });

  it('recordChartUpload：支持带 username 记录所有者，重复调用被拒', () => {
    const base = createUnnamedProject({ id: 'p1', chartId: 'c1', now: 100 });
    const uploaded = recordChartUpload(base, 'c1', { postId: 12345, at: 200, username: 'moca_coffee' });
    expect(uploaded).not.toBeNull();
    expect(uploaded!.charts[0].upload).toEqual({ postId: 12345, at: 200, username: 'moca_coffee' });

    // 重复调用被拒（只写一次）
    const second = recordChartUpload(uploaded!, 'c1', { postId: 99999, at: 300 });
    expect(second).toBeNull();
  });
});

describe('票 51 · 标签落在谱面记录上', () => {
  const tags = [
    { type: 'text' as const, data: '結束バンド' },
    { type: 'text' as const, data: 'gimmick' },
  ];

  it('updateChartTags：写入 / 空数组合法 / 去空白与重复；已发谱面不动', () => {
    const p = createUnnamedProject({ id: 'p1', chartId: 'c1', now: 100 });
    const written = updateChartTags(p, 'c1', tags);
    expect(written.charts[0].tags).toEqual(tags);
    const uploaded = recordChartUpload(written, 'c1', { postId: 1, at: 1 })!;
    const blocked = updateChartTags(uploaded, 'c1', [{ type: 'text', data: 'nope' }]);
    expect(blocked.charts[0].tags).toEqual(tags);

    const emptied = updateChartTags(written, 'c1', []);
    expect(emptied.charts[0].tags).toEqual([]);

    const messy = updateChartTags(p, 'c1', [
      { type: 'text', data: '  a  ' },
      { type: 'text', data: '' },
      { type: 'text', data: 'a' },
      { type: 'text', data: 'b' },
    ]);
    expect(messy.charts[0].tags).toEqual([
      { type: 'text', data: 'a' },
      { type: 'text', data: 'b' },
    ]);
  });

  it('复制谱面 / 复制工程带走标签；发布成功不清', () => {
    const base = updateChartTags(createUnnamedProject({ id: 'p1', chartId: 'c1', now: 100 }), 'c1', tags);
    const duplicated = duplicateChartInProject(base, 'c1', { chartId: 'c2', now: 101 }, untitled);
    expect(duplicated!.charts.find((c) => c.id === 'c2')?.tags).toEqual(tags);

    const projectCopy = duplicateProject(base, { id: 'pCopy', chartIds: ['cCopy'], now: 99 });
    expect(projectCopy.charts[0].tags).toEqual(tags);
    expect(projectCopy.charts[0].upload).toBeNull();

    const uploaded = recordChartUpload(base, 'c1', { postId: 9, at: 200 });
    expect(uploaded!.charts[0].tags).toEqual(tags);
  });

  it('updateChartInfo 对已发谱面仍然拒绝改 diff/level（Q2）', () => {
    const uploaded = recordChartUpload(
      createUnnamedProject({ id: 'p1', chartId: 'c1', now: 100 }),
      'c1',
      { postId: 1, at: 1 },
    )!;
    const blocked = updateChartInfo(uploaded, 'c1', { title: 'X', diff: 0, level: 1 }, 300);
    expect(blocked.charts[0].diff).toBe(3);
    expect(blocked.charts[0].level).toBeNull();
    expect(blocked.charts[0].title).toBeNull();
  });

  it('updateUploadedChartMeta：只改已发谱面的 diff/level/tags，未发的不动', () => {
    const uploaded = recordChartUpload(
      createUnnamedProject({ id: 'p1', chartId: 'c1', now: 100 }),
      'c1',
      { postId: 1, at: 1 },
    )!;
    const next = updateUploadedChartMeta(uploaded, 'c1', { diff: 4, level: 30, tags });
    expect(next.charts[0].diff).toBe(4);
    expect(next.charts[0].level).toBe(30);
    expect(next.charts[0].tags).toEqual(tags);

    const unpublished = createUnnamedProject({ id: 'p1', chartId: 'c1', now: 100 });
    const ignored = updateUploadedChartMeta(unpublished, 'c1', { diff: 0, level: 1, tags });
    expect(ignored.charts[0].diff).toBe(3);
    expect(ignored.charts[0].level).toBeNull();
  });
});

describe('updateChartInfo · 谱面信息更新与 lastModified 守卫', () => {
  it('未做实际修改时不更新 lastModified', () => {
    const p = createUnnamedProject({ id: 'p1', chartId: 'c1', now: 100 });
    // 原谱面：title null, diff 3, level null, lastModified 100
    const unchanged = updateChartInfo(p, 'c1', { title: null, diff: 3, level: null }, 200);
    expect(unchanged.charts[0].lastModified).toBe(100);

    const withSpaces = updateChartInfo(p, 'c1', { title: '   ', diff: 3, level: null }, 200);
    expect(withSpaces.charts[0].lastModified).toBe(100);
  });

  it('做实际修改时更新 lastModified', () => {
    const p = createUnnamedProject({ id: 'p1', chartId: 'c1', now: 100 });
    const changed = updateChartInfo(p, 'c1', { title: 'Special', diff: 4, level: 28 }, 200);
    expect(changed.charts[0].title).toBe('Special');
    expect(changed.charts[0].diff).toBe(4);
    expect(changed.charts[0].level).toBe(28);
    expect(changed.charts[0].lastModified).toBe(200);
  });
});

describe('toggleChartCompleted · 完成标记切换与已上传只读（票 41 锁测）', () => {
  it('未完成 → 已完成 → 未完成，lastModified 跟着切换走', () => {
    const p = createUnnamedProject({ id: 'p1', chartId: 'c1', now: 100 });

    const done = toggleChartCompleted(p, 'c1', 200);
    expect(done.charts[0].completed).toBe(true);
    expect(done.charts[0].lastModified).toBe(200);

    const back = toggleChartCompleted(done, 'c1', 300);
    expect(back.charts[0].completed).toBe(false);
    expect(back.charts[0].lastModified).toBe(300);
  });

  it('已上传谱面拒绝切换：同一张谱面原样返回（completed / lastModified / upload 不动）', () => {
    const p = createUnnamedProject({ id: 'p1', chartId: 'c1', now: 100 });
    const uploaded = recordChartUpload(p, 'c1', { postId: 7, at: 150 })!;

    const after = toggleChartCompleted(uploaded, 'c1', 200);

    expect(after.charts[0]).toBe(uploaded.charts[0]); // 守卫命中：这张谱面根本没被换掉
    expect(after.charts[0].completed).toBe(false);
    expect(after.charts[0].lastModified).toBe(100);
    expect(after.charts[0].upload).toEqual({ postId: 7, at: 150 });
  });

  it('同工程其它谱面不受目标谱面切换影响', () => {
    const p = createBlankProject({ id: 'p1', chartId: 'c1', now: 100, name: 'FIRE BIRD', diff: 3 });
    const two = duplicateChartInProject(p, 'c1', { chartId: 'c2', now: 100 }, untitled);

    const after = toggleChartCompleted(two!, 'c1', 200);
    expect(after.charts[0].completed).toBe(true);
    expect(after.charts[1].completed).toBe(false);
  });
});

