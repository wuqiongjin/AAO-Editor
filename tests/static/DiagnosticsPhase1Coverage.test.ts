// 票 05：第一阶段失败路径必须接到 logger / 主进程 sink。
// 不锁「src/ 无裸 console.*」——噪音级 warn 可以仍留 console。
import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

function src(rel: string) {
  return readStripped(rel);
}

describe('票 05 · 表内失败路径调用 logger', () => {
  it('谱面工程保存 / 加载走 logger.warn [chart-project]', () => {
    const hook = src('src/project/useChartProjectPersistence.ts');
    expect(hook).toMatch(/logger\.warn\(\s*['"]\[chart-project\]['"]/);
    expect(hook).toMatch(/谱面工程落盘失败/);
    expect(hook).toMatch(/谱面工程读取失败/);
    expect(hook).not.toMatch(/console\.warn\(\s*['"]\[chart-project\]/);
  });

  it('视频导出失败走 logger.error [preview]（域层 + 未接住的 throw）', () => {
    const domain = src('src/preview/video/encode/exportVideo.ts');
    const hook = src('src/pages/preview/useVideoExport.ts');
    expect(domain).toMatch(/logger\.error\(\s*['"]\[preview\]['"]/);
    expect(domain).toMatch(/导出视频失败/);
    expect(hook).toMatch(/logger\.error\(\s*['"]\[preview\]['"]/);
    expect(hook).toMatch(/导出视频异常/);
    expect(domain).not.toMatch(/console\.error\(\s*['"]\[preview\]/);
    expect(hook).not.toMatch(/console\.error\(\s*['"]\[preview\]/);
  });

  it('静态图导出失败走 logger.error [preview]', () => {
    const page = src('src/pages/preview/PreviewPage.tsx');
    expect(page).toMatch(/logger\.error\(\s*['"]\[preview\]['"]/);
    expect(page).toMatch(/导出宽图失败/);
    expect(page).not.toMatch(/console\.error\(\s*['"]\[preview\]/);
  });

  it('资产保存 / 清除失败走 logger.error；背景皮肤装载失败走 logger.warn', () => {
    const assets = src('src/pages/assets/AssetsPage.tsx');
    const skin = src('src/rendering/skin/backgroundSkin.ts');
    expect(assets).toMatch(/logger\.error\(/);
    expect(assets).toMatch(/背景图保存失败/);
    expect(assets).toMatch(/背景图清除失败/);
    expect(assets).not.toMatch(/console\.error\(\s*['"]\[AssetsPage\]/);
    expect(skin).toMatch(/logger\.warn\(\s*['"]\[backgroundSkin\]['"]/);
    expect(skin).not.toMatch(/console\.warn\(\s*['"]\[backgroundSkin\]/);
  });

  it('社区出口在抛 CommunityError 前调用 logCommunityError', () => {
    const transport = src('src/community/electronTransport.ts');
    expect(transport).toMatch(/logCommunityError\(/);
  });

  it('应用更新 status=error 走 logger.error [app-update]（silent 收 UI 之前）', () => {
    const update = src('src/app/appUpdate.ts');
    expect(update).toMatch(/logger\.error\(\s*['"]\[app-update\]['"]/);
    expect(update).toMatch(/status === 'error'/);
  });
});

describe('票 05 · 主进程工程存储走 appLog sink', () => {
  it('projectStore 三条降级 warn 改调 sink（未注入时才退回 console.warn）', () => {
    const store = src('electron/projectStore.cjs');
    expect(store).toMatch(/storeWarn\('project\.json 解析失败/);
    expect(store).toMatch(/storeWarn\(`\$\{fileName\} 缺失，按无数据处理:/);
    expect(store).toMatch(/function setAppLog/);
    expect(store).toMatch(/appLog\.write\(/);
  });

  it('main.cjs 把 appLog 注入 projectStore', () => {
    const main = src('electron/main.cjs');
    expect(main).toMatch(/setAppLog\(appLog\)/);
  });
});
