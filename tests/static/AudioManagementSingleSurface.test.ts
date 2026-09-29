// 票 15 定案 2/8：音频只有一个管理面（音频页），只有一条写路径（projectAudio）。
//
// 两条都是"重构时会被悄悄改回去、而行为测试抓不住"的接线约定：
//
// 1. 工程管理页只许**跳转**到音频页，不许就地做音频管理（导入 / 清除 / 改时长）。
//    就地开一个管理面 = 一致性与双写路径的税（09-28 早间定案的账）。
// 2. 音频页不再直连 `AudioSession.importAudio / clearAudio / setChartDuration`。
//    session 手里是全站唯一那个共享 AudioEngine（工作台解码后的那份），按作用域去改**别的**
//    工程时借它 load 一次就会把工作台那份顶掉。改动只能走按 projectId 的接缝。
//    键音素材包 / SE 音量仍归 session（它们是全局素材，不属于任何工程），所以这里只锁这三个方法。
import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

/** 音频的三个写动作（会话侧的名字与接缝侧的名字） */
const AUDIO_WRITES = [
  'importAudio',
  'clearAudio',
  'setChartDuration',
  'importProjectAudio',
  'clearProjectAudio',
  'setProjectAudioDuration',
];

describe('票 15 · 音频管理的唯一面与唯一写路径', () => {
  /** 工程管理页整页 = 页面 + 两个视图组件（architecture-refactor 01 拆解后） */
  const PROJECT_PAGE_FILES = [
    'src/pages/projects/ProjectsPage.tsx',
    'src/pages/projects/components/ProjectDetail.tsx',
    'src/pages/projects/components/ProjectHub.tsx',
  ];

  it('工程管理页只跳转、不管理：不出现任何音频写动作', () => {
    for (const rel of PROJECT_PAGE_FILES) {
      const src = readStripped(rel);
      const hit = AUDIO_WRITES.filter((name) => src.includes(name));
      expect(hit, `${rel} 里出现了音频写动作`).toEqual([]);
    }
    // 只剩"带作用域跳过去"这一个音频相关动作：作用域对象仍由页面构造，详情视图只负责触发
    expect(readStripped('src/pages/projects/ProjectsPage.tsx'))
      .toMatch(/setActivePage\('audio', \{ scope: \{ projectId: sel\.id \} \}\)/);
    expect(readStripped('src/pages/projects/components/ProjectDetail.tsx'))
      .toMatch(/onClick=\{onOpenAudio\}/);
  });

  it('工作台也只能跳过去（菜单项），不在工作台里改音频', () => {
    const src = readStripped('src/pages/WorkspacePage/ChartSwitcher.tsx');
    const hit = AUDIO_WRITES.filter((name) => src.includes(name));
    expect(hit).toEqual([]);
    expect(src).toMatch(/setActivePage\('audio'\)/);
  });

  it('音频页的三个动作全部走 projectAudio 接缝，不直连会话', () => {
    const src = readStripped('src/audio/AudioPage.tsx');
    expect(src).toMatch(/importProjectAudio\(deps, scopeId/);
    expect(src).toMatch(/clearProjectAudio\(deps, scopeId/);
    expect(src).toMatch(/setProjectAudioDuration\(deps, scopeId/);
    // 会话侧的同名动作一个都不许出现（键音包 / SE 音量不在此列）
    expect(src).not.toMatch(/session\.importAudio/);
    expect(src).not.toMatch(/session\.clearAudio/);
    expect(src).not.toMatch(/session\.setChartDuration/);
  });

  it('音频的读路径也不来自会话快照，来自作用域的那条工程记录', () => {
    const src = readStripped('src/audio/AudioPage.tsx');
    expect(src).toMatch(/useAudioScope/);
    expect(src).toMatch(/const locked = view\.locked;/);
    expect(src).not.toMatch(/snap\.audioName/);
    expect(src).not.toMatch(/snap\.audioLocked/);
    expect(src).not.toMatch(/snap\.chartDuration/);
  });
});
