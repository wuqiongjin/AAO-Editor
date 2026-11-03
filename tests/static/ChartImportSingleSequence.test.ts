// 11 票（架构评审 2026-11-03 候选 1）：谱面导入只能有一个序列。
//
// 这是接线事实（static/ 的正当用途）：core 的序列行为由 ChartImport.test.ts 看守，
// 两个来源的行为由 OfficialImport.test.ts / CommunityImport.test.ts 看守；
// 这里只钉住「没人再在源文件里手搓 trail / save / probe / Apply」。
import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

const CORE = 'src/pages/projects/chartImport.ts';
const SOURCES = [
  'src/pages/projects/officialImport.ts',
  'src/pages/projects/communityImport.ts',
];

describe('11 · 导入编排只有一个序列', () => {
  it('importChart 只在 core 定义', () => {
    expect(readStripped(CORE)).toMatch(/export async function importChart/);
    for (const file of SOURCES) {
      expect(readStripped(file), file).not.toMatch(/\bimportChart\b/);
    }
  });

  it('trail / probe / Apply / store.save 只归 core；源模块只做源适配', () => {
    const core = readStripped(CORE);
    expect(core).toMatch(/trail\.record/);
    expect(core).toMatch(/probeProjectDuration/);
    expect(core).toMatch(/createOfficialProject/);

    for (const file of SOURCES) {
      const src = readStripped(file);
      expect(src, file).not.toMatch(/trail\.record/);
      expect(src, file).not.toMatch(/probeProjectDuration/);
      expect(src, file).not.toMatch(/createOfficialProject/);
      expect(src, file).not.toMatch(/store\.save/);
      expect(src, file).not.toMatch(/OfficialImportStage|CommunityImportStage/);
    }
  });

  it('两个源模块导出源工厂 + 各自 error text', () => {
    expect(readStripped(SOURCES[0]!)).toMatch(/export function createOfficialImportSource/);
    expect(readStripped(SOURCES[0]!)).toMatch(/export function officialErrorText/);
    expect(readStripped(SOURCES[1]!)).toMatch(/export function createCommunityImportSource/);
    expect(readStripped(SOURCES[1]!)).toMatch(/export function communityErrorText/);
  });

  it('ProjectsPage 从 core 取 importChart，从两个源模块取工厂', () => {
    const page = readStripped('src/pages/projects/ProjectsPage.tsx');
    expect(page).toMatch(/from '\.\/chartImport'/);
    expect(page).toMatch(/\bimportChart\b/);
    expect(page).toMatch(/createOfficialImportSource/);
    expect(page).toMatch(/createCommunityImportSource/);
    expect(page).not.toMatch(/importOfficialSong|importCommunityPost/);
  });

  it('ProjectDialogs 只走统一的 ImportStage', () => {
    const dialogs = readStripped('src/pages/projects/components/ProjectDialogs.tsx');
    expect(dialogs).toMatch(/import type \{ ImportStage \} from '\.\.\/chartImport'/);
    expect(dialogs).not.toMatch(/OfficialImportStage|CommunityImportStage/);
  });
});
