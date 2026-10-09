// architecture-refactor/10（架构评审候选 5 的「时长那一半」）· 谱面时长语义的落点锁。
//
// 默认 30 散在 5 处、夹取散在 5 处（三种口径，其中 `setChartDuration` 的注释还写着 [0.1, MAX]
// 而代码只夹上界）—— 本票收成一处。"又冒出第 6 处硬编码 30 / 又手搓一份夹取"这类回潮，
// 行为测试抓不住，照 ProjectDomainLayout / ChartViewSessionWiring 惯例用静态源码断言看守。
// 口径的**值**由 `tests/unit/audio/chartDuration.test.ts` 锁，这里只锁**归属与调用点**。
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it, expect } from 'vitest';
import { readStripped, repoRoot } from '@/tests/support/source';

const DURATION = 'src/audio/chartDuration.ts';
/** 夹取的调用点（会话 / 记录写 / 播放协调 / 音频页 / 官方曲建工程）—— 多一处即回潮 */
const CALLERS = [
  'src/audio/AudioSession.ts',
  'src/audio/projectAudio.ts',
  'src/playback/usePlaybackCoordinator.ts',
  'src/pages/audio/AudioPage.tsx',
  // bestdori-integration 08：官方曲长是**平台来的外部值**（实测 120.048 这种），
  // 在「建工程」这条边界上夹一次；夹取口径仍是 chartDuration 那一份，没有第二份实现。
  'src/project/projectCatalog.ts',
];

/** src/ 下全部 .ts/.tsx（相对仓库根的路径） */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      out.push(...sourceFiles(abs));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(relative(repoRoot, abs).split('\\').join('/'));
    }
  }
  return out;
}

const files = sourceFiles(join(repoRoot, 'src'));
const duration = readStripped(DURATION);

describe('architecture-refactor 10 · 谱面时长语义的落点', () => {
  it('夹取的口径只在 chartDuration 定义（上限仍取 AppSettings）', () => {
    expect(duration).toMatch(/export function clampChartDuration/);
    expect(duration).toMatch(/MAX_DURATION_SECONDS/);
  });

  it('夹取的调用点只有五处（会话 / 记录写 / 播放协调 / 音频页 / 官方曲建工程）', () => {
    const callSites = files
      .filter((f) => f !== DURATION)
      .filter((f) => /clampChartDuration\s*\(/.test(readStripped(f)));
    expect([...callSites].sort()).toEqual([...CALLERS].sort());
  });

  it('src 内不再有硬编码的时长默认（`?? 30` / `useState(30)` / `chartDuration: 30`）', () => {
    const offenders = files
      .filter((f) => f !== DURATION)
      .filter((f) => /\?\?\s*30\b|useState\(30\)|chartDuration:\s*30\b/.test(readStripped(f)));
    expect(offenders).toEqual([]);
  });

  it('src 内不再有内联的时长夹取（`Math.min(…, MAX_DURATION_SECONDS)` / `Math.max(0.1, …)`）', () => {
    const offenders = files
      .filter((f) => f !== DURATION)
      .filter((f) => /Math\.min\([^)]*MAX_DURATION_SECONDS|Math\.max\(0\.1,/.test(readStripped(f)));
    expect(offenders).toEqual([]);
  });

  it('EMPTY_CHART_DURATION_SECONDS 已随本票消失（语义并入 DEFAULT_CHART_DURATION_SECONDS）', () => {
    const leftovers = files.filter((f) => /EMPTY_CHART_DURATION_SECONDS/.test(readStripped(f)));
    expect(leftovers).toEqual([]);
  });
});
