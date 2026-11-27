// release-pipeline 02 所有权锁：**主仓不存资源产物、也不带产出它们的工具**。
// 产物（二进制 + 生成物）由外部快照提供，`scripts/assets-sync.mjs` 取件，目录全被 `.gitignore` 忽略。
// 结构事实，DOM 测试抓不住：读源码 / git 索引 / .gitignore。
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { join, relative } from 'node:path';
import { readSource, readStripped, repoRoot, sourceFiles } from '@/tests/support/source';

/**
 * 派生件坐标对照表（`docs/research/gbp-ui-assets.md` §12）。
 * 生成器随快照仓（原图在那边，主仓跑不了它），主仓只留这张表 —— 所以表就是唯一事实源。
 * 返回 `[相对 game-ui 的路径, [宽, 高]]`。
 */
const cropTable = (): Array<[string, [number, number]]> => {
  const doc = readSource('docs/research/gbp-ui-assets.md');
  const section = doc.slice(doc.indexOf('## 12.'));
  return [...section.matchAll(/^\| `((?:result|hud)\/[a-z0-9-]+\.png)` \|.*\| (\d+)×(\d+) \|$/gm)]
    .map((m) => [m[1]!, [Number(m[2]), Number(m[3])]] as [string, [number, number]]);
};
const derivedCrops = () => cropTable().map(([file]) => file);

/** PNG 的 IHDR 宽高（偏移 16 / 20）；不依赖 DOM，直接读文件头 */
const pngSize = (abs: string): [number, number] => {
  const head = readFileSync(abs);
  return [head.readUInt32BE(16), head.readUInt32BE(20)];
};

describe('release-pipeline 02 · 资源取件与所有权', () => {
  it('产物与生成物都不在 git 索引（防再入库）', () => {
    const tracked = execSync(
      'git ls-files -- public/assets/skins public/assets/sim public/assets/game-ui src/assets/audio/keysounds src/rendering/skin/gen src/audio/gen src/preview/video/sim/gen',
      { cwd: repoRoot, encoding: 'utf8' },
    )
      .trim()
      .split('\n')
      .filter((f) => /\.(png|mp3|gen\.ts)$/.test(f));
    expect(tracked).toEqual([]);
  });

  it('.gitignore 覆盖取件目录（二进制 + 生成物）', () => {
    const gitignore = readSource('.gitignore');
    for (const entry of [
      '/public/assets/skins/',
      '/public/assets/sim/',
      '/public/assets/game-ui/',
      '/src/assets/audio/keysounds/',
      '/src/rendering/skin/gen/',
      '/src/audio/gen/',
      '/src/preview/video/sim/gen/',
    ]) {
      expect(gitignore).toContain(entry);
    }
  });

  it('主仓不存资源记账（没有清单文件）', () => {
    expect(() => readSource('assets-mirror/manifest.json')).toThrow();
  });

  it('派生清单与绘制侧引用一致（票 83：改名 / 漏生成必须红）', () => {
    // 裁切表是派生件的唯一事实源；它产出的每一张都必须有人引用，否则就是漏改名或漏接线
    const crops = derivedCrops();
    expect(crops).toHaveLength(11);
    expect(new Set(crops).size).toBe(crops.length); // 无重名（重名会互相覆盖）

    // 只看生产绘制侧：模板串 `${…}/result/x.png` 归一成 `result/x.png`。
    // 原型是调参页、不入库，测试不得依赖它。
    const refs = new Set(
      ['src/preview/video/ending/endingAssets.ts', 'src/preview/video/sim/simAssets.ts'].flatMap((rel) =>
        [...readSource(rel).matchAll(/\/(?:result|hud)\/[a-z0-9-]+\.png/g)].map((m) => m[0].slice(1)),
      ),
    );
    for (const out of crops) expect(refs, `${out} 已派生但无人引用`).toContain(out);
  });

  it('派生件只落在 result/ 与 hud/（票 83 硬约束：不得把整张图集当产物）', () => {
    for (const out of derivedCrops()) expect(out).toMatch(/^(result|hud)\//);
  });

  it('取件根覆盖对照表里的每一个落点（票 83：取件后派生件不能凭空消失）', () => {
    // `assets-sync` 整根替换：对照表里的路径必须都在被整取的根之下，否则拉回来就没了
    expect(readSource('scripts/assets-sync.mjs')).toContain("'public/assets/game-ui'");
    for (const file of derivedCrops()) expect(file).toMatch(/^(result|hud)\//);
  });

  it('坐标对照表与派生件实际像素一致（票 83：表入仓，尺寸不许漂移）', () => {
    const root = join(repoRoot, 'public/assets/game-ui');
    if (!existsSync(root)) return;
    const table = cropTable();
    expect(table).toHaveLength(11);
    for (const [file, size] of table) {
      const abs = join(root, file);
      expect(existsSync(abs), `${file} 没生成`).toBe(true);
      expect(pngSize(abs), `${file} 与对照表尺寸不一致`).toEqual(size);
    }
  });

  it('产物里不得再有整张图集（票 83 体积门禁；未取件的环境跳过）', () => {
    const root = join(repoRoot, 'public/assets/game-ui');
    if (!existsSync(root)) return;
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const abs = join(dir, entry);
        return statSync(abs).isDirectory() ? walk(abs) : [relative(repoRoot, abs).split('\\').join('/')];
      });
    expect(walk(root).filter((f) => /MenuAtlas|RhythmGameUI|tex_parSet_fever/.test(f))).toEqual([]);
  });

  it('绘制侧尺寸常量与派生件实际像素一致（票 83：同源，不许漂移）', () => {
    // 绘制侧要拿"素材像素宽高"算宽高比，所以尺寸会写一份常量；这里把它钉在真图尺寸上，
    // 裁切表改了尺寸而常量没跟上时直接红（`pause` 那次就是框与常量一起错）。
    const root = join(repoRoot, 'public/assets/game-ui');
    if (!existsSync(root)) return;
    const frame = readSource('src/preview/video/ending/endingFrame.ts');
    const hud = readSource('src/preview/video/sim/simHud.ts');
    const locks: Array<[string, RegExp, string]> = [
      ['RANK_DISC', /const RANK_DISC = \[(\d+), (\d+)\] as const/, 'result/rank-disc.png'],
      ['RANK_LETTER', /const RANK_LETTER = \[(\d+), (\d+)\] as const/, 'result/rank-letter-ss.png'],
      ['RANK_RIBBON', /const RANK_RIBBON = \[(\d+), (\d+)\] as const/, 'result/rank-ribbon.png'],
      ['SCORE_MEDAL', /const SCORE_MEDAL = \[(\d+), (\d+)\] as const/, 'result/score-medal.png'],
      ['barA', /barA: \[0, 0, (\d+), (\d+)\]/, 'hud/score-fill.png'],
      ['pause', /pause: \[0, 0, (\d+), (\d+)\]/, 'hud/pause.png'],
      ['star', /star: \[0, 0, (\d+), (\d+)\]/, 'hud/star-flow.png'],
    ];
    for (const [name, re, file] of locks) {
      const m = (re.test(frame) ? frame : hud).match(re);
      expect(m, `${name} 常量没找到`).toBeTruthy();
      expect(pngSize(join(root, file)), `${name} 与 ${file} 尺寸不一致`)
        .toEqual([Number(m![1]), Number(m![2])]);
    }
  });

  it('取件脚本：来源不写明文、按根整取、可用 ASSETS_SOURCE 覆盖', () => {
    const sync = readSource('scripts/assets-sync.mjs');
    expect(sync).not.toMatch(/https?:\/\//); // 源码里不出现明文地址
    expect(sync).toContain('ASSETS_SOURCE'); // 可换来源
    for (const root of [
      'public/assets/skins',
      'public/assets/sim',
      'public/assets/game-ui',
      'src/assets/audio/keysounds',
      'src/rendering/skin/gen',
      'src/audio/gen',
      'src/preview/video/sim/gen',
    ]) {
      expect(sync).toContain(`'${root}'`);
    }
  });

  it('取件脚本：凭据候选链自举（shell 配置不漫游的兜底）+ clone 失败逐个换候选', () => {
    // 票 08：平台注入的 CNB_TOKEN 作用域仅限当前仓，读不了外部素材源；rc 不漫游、
    // /etc/profile 每次重建覆盖本地令牌。脚本必须不依赖 shell 配置，按优先级自举。
    const sync = readSource('scripts/assets-sync.mjs');
    // 凭据链优先级：环境 ASSETS_TOKEN / CNB_ASSETS_TOKEN > 漫游文件 ~/.cnb/.env.local > 环境 CNB_TOKEN
    expect(sync).toContain('ASSETS_TOKEN');
    expect(sync).toContain('CNB_ASSETS_TOKEN');
    expect(sync).toContain('CNB_TOKEN');
    expect(sync).toContain('.cnb/.env.local'); // ~/.cnb/ 按用户漫游，环境重建后仍在
    expect(sync).toContain('CNB_TOKEN_FILE'); // 漫游文件路径可换
    // 多候选重试：clone 失败自动换下一个凭据
    expect(sync).toMatch(/for\s*\(const \[\w+, \w+\] of candidates\.entries\(\)\)/);
    // 全部失败时给出三种修复口径（写漫游文件 / ASSETS_TOKEN 注入 / 换 ASSETS_SOURCE）
    expect(sync).toContain('ASSETS_SOURCE');
    // 日志剥令牌：凭据只进内部 URL，源行不再出现令牌（连打码形式也不要）
    expect(sync).toContain('stripCredential');
    expect(sync).not.toContain('***@');
  });

  it('仿真场素材走运行时素材树 assets/sim；dev 直读中间件已退役', () => {
    const simAssets = readStripped('src/preview/video/sim/simAssets.ts');
    expect(simAssets).toContain('assets/sim');
    // 前缀必须跟着构建 base：写死站点根在 Electron 的 file:// 下解析不到包里的素材
    expect(simAssets).toMatch(/SIM_ASSET_BASE[^\n]*import\.meta\.env\.BASE_URL/);
    expect(simAssets).not.toMatch(/['"`]\/assets\/sim/);
    expect(simAssets).not.toContain('/__bestdori-assets');

    const viteConfig = readStripped('vite.config.ts');
    expect(viteConfig).not.toContain('bestdori-preview-assets');
    expect(viteConfig).not.toContain('/__bestdori-assets/');
  });

  it('运行时素材 URL 一律跟构建 base：src/ 下不许出现站点根绝对路径', () => {
    // 打包态是 file://，没有站点根 —— 写死 `/assets/…` 会解析到磁盘根（票 03）。
    // 单条用例点名管得住一处，这条锁的是"整棵树都不许再出现"这个口径。
    const offenders = sourceFiles(join(repoRoot, 'src')).filter((f) =>
      /['"`]\/assets\//.test(readStripped(f)),
    );
    expect(offenders).toEqual([]);
  }, 30_000);
});
