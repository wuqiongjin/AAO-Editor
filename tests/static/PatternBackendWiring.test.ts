// issue 184 · 片段库后端接线静态锁。
// 单测覆盖不到「主进程 / preload / 渲染侧自动选择」这条跨进程缝，用源码断言钉住（照
// EditorAudioSessionRefactor.test.ts 惯例）。
import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

const storeSrc = readStripped('src/chart/patterns/PatternStore.ts');
const shareFileSrc = readStripped('src/chart/patterns/shareFile.ts');
const shareSrc = readStripped('src/chart/patterns/share.ts');
const dataRootSrc = readStripped('electron/storage/dataRoot.cjs');
const mainSrc = readStripped('electron/main.cjs');
const preloadSrc = readStripped('electron/preload.js');

describe('片段库 · 两条后端都被引用', () => {
  it('autoDetect 按 preload 桥二选一，两个实现类都在用', () => {
    expect(storeSrc).toMatch(/function autoDetectPatternBackend\(\)/);
    expect(storeSrc).toMatch(/new ElectronFilePatternLibraryBackend\(bridge\)/);
    expect(storeSrc).toMatch(/new IndexedDbPatternLibraryBackend\(\)/);
    expect(storeSrc).toMatch(/electronAPI[\s\S]{0,120}patternLibrary/);
  });

  it('片段库自选后端，不依赖设置对象 / localStorage', () => {
    expect(storeSrc).not.toMatch(/localStorage/);
    // 片段数据本身不进设置对象（ADR-0023 §3）；仅视图排序偏好（issue 192）在 patternLibrary.sort
    expect(readStripped('src/chart/config/AppSettings.ts')).not.toMatch(/Pattern\[\]|patterns\.json/);
  });
});

describe('片段库 · Electron 数据根文件', () => {
  it('文件名为 patterns.json，位于 patterns 目录，路径函数挂在数据根布局模块', () => {
    expect(dataRootSrc).toMatch(/PATTERNS_DIRNAME\s*=\s*['"]patterns['"]/);
    expect(dataRootSrc).toMatch(/PATTERNS_FILENAME\s*=\s*['"]patterns\.json['"]/);
    expect(dataRootSrc).toMatch(/function patternsDir\(dataRoot\)/);
    expect(dataRootSrc).toMatch(/function patternLibraryPath\(dataRoot\)/);
    expect(dataRootSrc).toMatch(/patternsDir,/);
    expect(dataRootSrc).toMatch(/patternLibraryPath,/);
  });

  it('主进程注册 load / saveAll 两条 IPC，读写都按当前数据根', () => {
    expect(mainSrc).toMatch(/['"]patternLibrary:load['"]/);
    expect(mainSrc).toMatch(/['"]patternLibrary:saveAll['"]/);
    expect(mainSrc).toMatch(/loadPatternLibrary\(currentDataRoot\(\)\)/);
    expect(mainSrc).toMatch(/savePatternLibrary\(currentDataRoot\(\),\s*patterns\)/);
  });
});

describe('片段库 · preload 第三条数据根桥', () => {
  it('electronAPI.patternLibrary 暴露 load / saveAll', () => {
    expect(preloadSrc).toMatch(/patternLibrary\s*:/);
    expect(preloadSrc).toMatch(/invoke\(\s*['"]patternLibrary:load['"]\s*\)/);
    expect(preloadSrc).toMatch(/invoke\(\s*['"]patternLibrary:saveAll['"],\s*patterns\s*\)/);
  });
});

describe('片段库 · 分享文件另存桥（issue 187）', () => {
  it('渲染侧：有桥走桥，无桥降级 Blob 下载', () => {
    expect(shareFileSrc).toMatch(/electronAPI[\s\S]{0,160}patternLibrary/);
    expect(shareFileSrc).toMatch(/bridge\.saveAs\(/);
    expect(shareFileSrc).toMatch(/createObjectURL/);
  });

  it('主进程：patternLibrary:saveAs 弹系统保存对话框并写回文本', () => {
    expect(mainSrc).toMatch(/['"]patternLibrary:saveAs['"]/);
    expect(mainSrc).toMatch(/dialog\.showSaveDialog/);
    expect(mainSrc).toMatch(/fs\.promises\.writeFile\(result\.filePath,\s*json/);
  });

  it('preload 暴露 patternLibrary.saveAs', () => {
    expect(preloadSrc).toMatch(/invoke\(\s*['"]patternLibrary:saveAs['"],\s*payload\s*\)/);
  });

  it('读文件两环境同一路：input[type=file] + 票面 accept', () => {
    expect(shareFileSrc).toMatch(/input\.type = 'file'/);
    expect(shareFileSrc).toMatch(/PATTERN_FILE_ACCEPT = ['"].json,application\/json['"]/);
  });
});

describe('片段库 · 分享导出剥离本地偏好（issue 191）', () => {
  it('serializePatterns 路径剥掉 pinnedAt，防止置顶随分享外泄', () => {
    expect(shareSrc).toMatch(/stripPatternPinned/);
    expect(shareSrc).toMatch(/serializePatterns[\s\S]{0,250}stripLocalPreferences/);
    expect(readStripped('src/chart/patterns/library.ts')).toMatch(/stripPatternPinned[\s\S]{0,120}pinnedAt/);
  });
});

describe('片段库 · 批量删除与批量导出架构锁（issue 193）', () => {
  it('批量导出仍走同一 serializePatterns 信封，不新增第二种格式', () => {
    expect(shareFileSrc).toMatch(/function saveSelectedPatternsFile/);
    expect(shareFileSrc).toMatch(/savePatternsWithFilename\(\s*patterns,\s*patternSelectedExportFilename/);
    expect(shareFileSrc).toMatch(/serializePatterns\(patterns,\s*now\)/);
  });

  it('批量删除不新增第二个写入口，仍只经 commit', () => {
    const hookSrc = readStripped('src/chart/patterns/usePatternLibrary.ts');
    expect(hookSrc).toMatch(/removeMany\s*=\s*useCallback/);
    expect(hookSrc).toMatch(/removePatternsFromLibrary/);
    expect(hookSrc).toMatch(/commit\(next\)/);
    const removeManyBody = hookSrc.match(/removeMany\s*=\s*useCallback[\s\S]*?\}, \[commit\]\)/)?.[0] ?? '';
    expect(removeManyBody).toContain('commit(next)');
    expect(removeManyBody).not.toContain('resolved.saveAll');
  });
});
