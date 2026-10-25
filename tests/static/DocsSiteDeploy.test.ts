// docs-site 票 02 · Pages 发布流水线的静态锁。
// 锁的是「接线事实」——触发面、权限、concurrency、job 图、合并落点、门禁边界，
// 防止后来人改 CI 时悄悄把发布 workflow 改成「也跑测试的双边 CI」或把两边产物写串。
// 部署行为冒烟（secret 就绪、Pages 开了 Actions 源之后）见票 02「锁测」节的手工验收。
import { describe, expect, it } from 'vitest';
import { readSource, stripYamlComments, yamlBlock } from '@/tests/support/source';

const deploy = stripYamlComments(readSource('.github/workflows/deploy-site.yml'));
const releasePipeline = readSource('tests/static/ReleasePipeline.test.ts');
const gitignore = readSource('.gitignore');

/** on: 段（到 jobs: 之前） */
const on = deploy.match(/^on:([\s\S]*?)^jobs:/m)?.[1] ?? '';

/** jobs: 正文 */
const jobs = yamlBlock(deploy, 'jobs:');

/** build job 正文（到同级 deploy job 之前） */
const buildJob = yamlBlock(jobs, '  build:');

/** deploy job 正文（同级最后一个，吃到段尾） */
const deployJob = yamlBlock(jobs, '  deploy:');

describe('docs-site 02 · Pages 发布流水线静态锁（构建与托管解耦）', () => {
  it('workflow 文件存在', () => {
    expect(deploy.length).toBeGreaterThan(0);
  });

  it('触发只有 push main 与手动 dispatch（不监听 PR——PR 门禁在 ci.yml，不构成 ADR-0022 §8 双边 CI）', () => {
    expect(on).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
    expect(on).toContain('workflow_dispatch');
    expect(on).not.toContain('pull_request');
    expect(on).not.toMatch(/tags:/);
  });

  it('Pages 三件套权限 + pages 并发组不取消（进行中的部署不被后来者掐掉）', () => {
    expect(deploy).toMatch(/contents:\s*read/);
    expect(deploy).toMatch(/pages:\s*write/);
    expect(deploy).toMatch(/id-token:\s*write/);
    expect(deploy).toMatch(/concurrency:\s*\n\s*group:\s*pages/);
    expect(deploy).toMatch(/cancel-in-progress:\s*false/);
  });

  it('build job 接线：node22+npm 缓存 → npm ci → 取素材（secret）→ app 构建 → docs-site 构建 → 合并 → 上传产物', () => {
    expect(buildJob).toMatch(/actions\/checkout@/);
    expect(buildJob).toMatch(/actions\/setup-node@/);
    expect(buildJob).toMatch(/node-version:\s*22/);
    expect(buildJob).toMatch(/cache:\s*npm/);
    expect(buildJob).toMatch(/run:\s*npm ci/);
    // 素材凭据只走 secret 注入（与 release.yml / ci.yml 同一口径），不写明文地址
    expect(buildJob).toContain('secrets.ASSETS_SOURCE');
    expect(buildJob).toContain('bash scripts/ci/ci-assets.sh');
    // app（base: './' 不动）与 docs-site 两次构建
    expect(buildJob).toMatch(/run:\s*npm run build/);
    expect(buildJob).toMatch(/cd docs-site[\s\S]*npm ci[\s\S]*npm run build/);
    expect(buildJob).toMatch(/actions\/upload-pages-artifact@/);
  });

  it('合并落点：app 产物进 site-dist/app/、docs 产物进 site-dist/ 根（两边都叫 dist，暂存目录不共用）', () => {
    // 正锁两个去向都在合并步骤里
    expect(buildJob).toContain('site-dist/app');
    expect(buildJob).toContain('docs-site/.vitepress/dist');
    // 负锁：不许把任一侧的 dist 直接当暂存根（会互相覆盖）
    expect(buildJob).not.toMatch(/mv\s+dist\s+site-dist\/?$/m);
    expect(buildJob).not.toMatch(/mv\s+docs-site\/\.vitepress\/dist\s+site-dist\/?$/m);
  });

  it('本 workflow 只发布不门禁：不跑 npm test / ci-gate.sh（门禁在 CNB 与 ci.yml）', () => {
    expect(buildJob).not.toMatch(/npm test|vitest/);
    expect(deploy).not.toContain('ci-gate.sh');
    // `assets:check` 不在这条负锁里——它不是测试门禁，是构建自身的产物完整性断言。
    // 票 02 原本一并禁掉了它，票 03 按「缺二进制 → 画布空白，不许静默发出空态站」把它加回；
    // 正锁在 tests/static/DocsSiteWebAppBuild.test.ts，要再砍掉先看那边的口径。
  });

  it('取素材不许让步：无 continue-on-error（锁测 3——坏源必须红，不能静默发出空态站；与 ci.yml 同口径）', () => {
    expect(deploy).not.toContain('continue-on-error');
  });

  it('本 workflow 不进 ReleasePipeline 的 PIPELINE_FILES（票 02 锁测 1 拍定：不在发版链路，不纳入；若纳入须先满足「链路无 Bestdori 引用」断言）', () => {
    const pipelineFiles = releasePipeline.match(/const PIPELINE_FILES[\s\S]*?\n\]/)?.[0] ?? '';
    expect(pipelineFiles.length).toBeGreaterThan(0);
    expect(pipelineFiles).not.toContain('deploy-site.yml');
  });

  it('deploy job：needs build、github-pages 环境、actions/deploy-pages（唯一与托管绑定的 job）', () => {
    expect(deployJob).toMatch(/needs:\s*build/);
    expect(deployJob).toMatch(/environment:\s*github-pages/);
    expect(deployJob).toMatch(/actions\/deploy-pages@/);
    // 迁 Cloudflare Pages = 换掉本 job（wrangler pages deploy site-dist），build 一字不改
    // 负锁：deploy job 自己不跑 shell（没有 run: 步骤），只调托管动作
    expect(deployJob).not.toMatch(/run:/);
    expect(deployJob.match(/uses:/g)?.length).toBe(1);
  });

  it('.gitignore 覆盖 CI 合并目录 site-dist/（本地手工复现构建也不误入库）', () => {
    expect(gitignore.split('\n').map((l) => l.trim())).toContain('/site-dist/');
  });
});
