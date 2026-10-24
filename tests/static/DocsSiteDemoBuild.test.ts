// docs-site 票 03 · 浏览器演示版构建接入的静态锁。
// 锁的是「demo 产物进站这件事不会被悄悄改坏」这一类**接线事实**：
//   - 素材完整性在构建里有独立一步，缺件时红在素材上（不许静默发出空态站）；
//   - 最终产物（合并后的 site-dist）里 demo 的两个运行时素材根必须真的在；
//   - demo 仍靠 `base: './'` 吃子路径、仍是单入口无 SPA fallback（加 react-router 会直接推翻这两条）。
// 运行时部分（/demo/ 下的素材路径解析、首屏体积）是无头浏览器 + curl 的一次件，
// 结论记在票 03 的 Comments 里，没法常驻跑，故这里只锁能常驻验证的部分。
import { describe, expect, it } from 'vitest';
import { repoRoot, readSource, readStripped, sourceFiles, stripYamlComments, yamlBlock } from '@/tests/support/source';
import { join } from 'node:path';

const deploy = stripYamlComments(readSource('.github/workflows/deploy-site.yml'));
const jobs = yamlBlock(deploy, 'jobs:');
const buildJob = yamlBlock(jobs, '  build:');
const landing = readSource('docs-site/.vitepress/theme/components/Landing.vue');

describe('docs-site 03 · 浏览器演示版构建接入静态锁', () => {
  it('构建期有独立的素材完整性一步 `assets:check`：位置在取件之后、app 构建之前', () => {
    expect(buildJob).toContain('assets:check');
    // 早于构建红：别等产物都出来了才发现是素材的锅
    expect(buildJob.indexOf('assets:check')).toBeGreaterThan(buildJob.indexOf('ci-assets.sh'));
    expect(buildJob.indexOf('assets:check')).toBeLessThan(buildJob.indexOf('npm run build'));
  });

  it('最终产物里 demo 的两个运行时素材根都断言非空，且断言在**合并步骤之后**执行', () => {
    // 顺序要按**步骤**锁（`- name:` 的先后），不能只按字符串出现位置——后者只要把
    // 断言塞进合并步骤之前的一句注释题外话里就能蒙混过去。
    const mergeStepAt = buildJob.indexOf('- name: 合并到 site-dist/');
    const assertStepAt = buildJob.indexOf('- name: 校验演示版素材落位');
    expect(mergeStepAt).toBeGreaterThan(-1);
    expect(assertStepAt).toBeGreaterThan(mergeStepAt);

    // 断言正文查的是**合并后的产物**而不是 app 的 dist：对着 dist 断言等于没查
    // （合并路径写错 / assetsDir 改名时照样绿），这一步正是为那类组合留的。
    const assertStep = buildJob.slice(assertStepAt);
    expect(assertStep).toContain('site-dist/demo/assets/sim');
    expect(assertStep).toContain('site-dist/demo/assets/skins');
    expect(assertStep).not.toContain('dist/assets/sim');
  });

  it('演示版仍靠相对 base 吃子路径：app 构建 `base: ./`', () => {
    // 「运行时素材 URL 一律跟构建 base」那条全树锁在 AssetsSync.test.ts，
    // 这里只补锁它的前提（base 本身），两边一起才闭环。
    expect(readStripped('vite.config.ts')).toMatch(/base:\s*'\.\/'/);
  });

  it('仍是单入口、无 SPA fallback 需求：src/ 下不许 import react-router', () => {
    // 「base: './' + 子路径直接可用」的前提是没有前端路由；一旦 src 里真引了
    // react-router，/demo/ 下刷新就要靠托管配 fallback，而本站 Pages 没有这一层。
    // 按源码 import 锁（不是按 package.json 里有没有这个字符串——那样既防不住真实引用，
    // 撞上一个名字里含该子串的依赖也会误红）。
    const offenders = sourceFiles(join(repoRoot, 'src')).filter((f) =>
      /from\s+['"]react-router/.test(readStripped(f)),
    );
    expect(offenders).toEqual([]);
  });

  it('落地页「在线试用」指向 demo/ 并经 withBase 带站点 base（换 DOCS_BASE 不必改各处链接）', () => {
    expect(landing).toContain("withBase('/demo/')");
    expect(landing).toContain('t.ctaTry');
  });

  it('「在线试用」必须绕开 VitePress 客户端路由（否则点了是它的 404、且回退键失效）', () => {
    // VitePress 会把**同源同前缀**的站内 <a> 一律拦成 SPA 跳转。它的 click 监听挂在
    // window 的 **capture 阶段**（dist/client/app/router.js 末尾 `{ capture: true }`），
    // 比元素上的 @click 更早执行——所以「@click + preventDefault」抢不过它，别再试那套。
    // /demo/ 不是它的一页 → 找不到路由 → 渲染自己的 404，而且**一个文档请求都不发**，
    // 表现为「点了 404、刷新才正常」；历史里那条是 pushState 出来的假条目，回退键也失效。
    // 唯一稳的逃生是它自己的 bail 条件（target / download / .vp-raw）。这里锁 target。
    const demoAnchor = landing.match(/<a\b[\s\S]*?demoHref[\s\S]*?>/)?.[0] ?? '';
    expect(demoAnchor.length).toBeGreaterThan(0);
    expect(demoAnchor).toMatch(/\btarget=/);
  });
});
