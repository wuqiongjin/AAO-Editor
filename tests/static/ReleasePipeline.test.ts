// release-pipeline 07 / ADR-0022：发布链路的静态锁。
// 锁的是「接线事实」——触发面、镜像挂哪个触发、镜像非 force、门禁三件套、
// 素材地址不进公开文档——防止后来人重构 CI 时悄悄改坏口径。
// 行为冒烟（secret 就绪后）见票 07「锁测」节。
import { describe, expect, it } from 'vitest';
import { readSource, textFilesUnder } from '@/tests/support/source';

const cnb = readSource('.cnb.yml');
const release = readSource('.github/workflows/release.yml');
const gitignore = readSource('.gitignore');
const gate = readSource('scripts/ci/ci-gate.sh');
const mirror = readSource('scripts/ci/ci-mirror-github.sh');
const installersMirror = readSource('scripts/ci/ci-mirror-installers.mjs');
const assets = readSource('scripts/ci/ci-assets.sh');
const assetsSync = readSource('scripts/assets-sync.mjs');
const pkg = JSON.parse(readSource('package.json')) as {
  scripts: Record<string, string>;
};

/** shell 行注释（# 开头整行剥掉，断言不被注释里的示例文字干扰） */
const bashCode = (src: string) => src.replace(/^#[^\n]*/gm, '');

/** 参与「发版链路无 Bestdori 引用」扫描的文件（01 既有口径的延伸） */
const PIPELINE_FILES: [string, string][] = [
  ['.cnb.yml', cnb],
  ['.github/workflows/release.yml', release],
  ['scripts/ci/ci-assets.sh', assets],
  ['scripts/ci/ci-gate.sh', gate],
  ['scripts/ci/ci-mirror-github.sh', mirror],
  ['scripts/ci/ci-mirror-installers.mjs', installersMirror],
];

/** 素材快照仓名关键字（拼接防自匹配：本文件自身不算命中） */
const ASSETS_SLUG_NEEDLE = 'AAO-Editor-' + 'Assets';

/** .cnb.yml 顶层段切分（`main:` 段 = 到下一个顶层键之前） */
const cnbSection = (from: string, to?: string) => {
  const start = cnb.indexOf(from);
  expect(start, `.cnb.yml 缺少顶层段 ${from}`).toBeGreaterThanOrEqual(0);
  const end = to ? cnb.indexOf(to) : cnb.length;
  return cnb.slice(start, end === -1 ? cnb.length : end);
};

describe('release-pipeline 07 · 发布链路静态锁（ADR-0022）', () => {
  it('两侧 CI 配置都在位', () => {
    expect(cnb.length).toBeGreaterThan(0);
    expect(release.length).toBeGreaterThan(0);
  });

  it('release workflow 只由 v* tag push 与手动 dispatch 触发（门禁在 CNB，不监听分支 / PR）', () => {
    const on = release.match(/^on:([\s\S]*?)^jobs:/m)?.[1] ?? '';
    expect(on).toMatch(/push:\s*\n\s*tags:\s*\['v\*'\]/);
    expect(on).toContain('workflow_dispatch');
    expect(on).not.toContain('pull_request');
    expect(on).not.toMatch(/branches:/);
  });

  it('手动 dispatch 走 tag 输入并构建该 tag 的代码（GITHUB_REF_NAME 在手动触发下是分支名）', () => {
    expect(release).toMatch(/workflow_dispatch:[\s\S]*?inputs:[\s\S]*?tag:/);
    // verify / build / notes 三处 checkout 都必须落在 inputs.tag 上
    expect(release.match(/ref: \$\{\{ github\.event\.inputs\.tag \|\| github\.ref \}\}/g)?.length).toBe(3);
  });

  it('发版链路无 Bestdori 引用（发版与 Bestdori 在线状态解耦，01 既有口径）', () => {
    for (const [name, src] of PIPELINE_FILES) {
      expect(src.toLowerCase(), name).not.toContain('bestdori');
    }
  });

  it('镜像 job 同时挂在 main push 与 v* tag_push 上（ADR-0022 §2：每次 main push、每次 tag push）', () => {
    const mainSection = cnbSection('main:', 'v*:');
    const tagSection = cnbSection('v*:');
    expect(mainSection).toContain('scripts/ci/ci-mirror-github.sh');
    expect(tagSection).toContain('scripts/ci/ci-mirror-github.sh');
  });

  it('镜像脚本非 force：不带 --force / +refspec，只推 main + tags', () => {
    const code = bashCode(mirror);
    expect(code).not.toMatch(/--force/);
    expect(code).not.toMatch(/\+refs/);
    // push 源是 remotes 追踪 ref（不能 fetch 进已检出的 refs/heads/main，见脚本注释）
    expect(code).toMatch(/refs\/remotes\/origin\/main:refs\/heads\/main/);
    expect(code).toMatch(/fetch[^\n]*refs\/heads\/main:refs\/remotes\/origin\/main/);
    expect(code).toMatch(/refs\/tags\/\*:refs\/tags\/\*/);
  });

  it('门禁三件套：test + build + assets:check，且取件在测试之前', () => {
    const code = bashCode(gate);
    expect(code).toMatch(/npm test/);
    expect(code).toMatch(/npm run build/);
    expect(code).toMatch(/npm run assets:check/);
    expect(code.indexOf('ci-assets.sh')).toBeLessThan(code.indexOf('npm test'));
  });

  it('门禁步骤与 package.json scripts 对齐，且 .cnb.yml 三种触发都真的调用门禁脚本', () => {
    for (const name of ['test', 'build', 'assets:check', 'electron:build']) {
      expect(pkg.scripts, `package.json 缺 script: ${name}`).toHaveProperty(name);
    }
    expect(cnbSection('main:', 'v*:')).toContain('scripts/ci/ci-gate.sh');
    expect(cnbSection('v*:')).toContain('scripts/ci/ci-gate.sh');
    // push / pull_request / tag_push 三处门禁
    expect(cnb.match(/scripts\/ci\/ci-gate\.sh/g)?.length).toBe(3);
    // 国内副本脚本被 crontab 与 web_trigger 两条触发共用（同一脚本两个入口）
    expect(cnb.match(/scripts\/ci\/ci-mirror-installers\.mjs/g)?.length).toBe(2);
  });

  it('发布后补未签名告知 + 发行说明进 release notes（ADR-0022 §6：README 与 release notes 双落地）', () => {
    expect(release).toMatch(/gh release edit/);
    expect(release).toMatch(/未签名/);
    expect(release).toMatch(/needs: build/);
    // 版本描述单一来源：RELEASE_NOTES.md（页面正文 + latest.yml → 产品内更新弹窗，ADR-0021 §2）
    expect(release).toContain('RELEASE_NOTES.md');
  });

  it('.gitignore 覆盖根目录 release/ 输出目录', () => {
    expect(gitignore.split('\n').map((l) => l.trim())).toContain('/release/');
  });

  it('.cnb.yml 六种触发俱全：push / pull_request / tag_push / crontab / web_trigger / vscode', () => {
    expect(cnb).toMatch(/^ {2}push:/m);
    expect(cnb).toMatch(/^ {2}pull_request:/m);
    expect(cnb).toMatch(/tag_push:/);
    expect(cnb).toMatch(/crontab:/);
    expect(cnb).toMatch(/^ {2}web_trigger:/m);
    // 云开发环境挂载：漫游个人环境变量（~/.cnb/.env.local）接进新环境（token 不走仓库）
    expect(cnb).toMatch(/^ {2}vscode:/m);
    expect(cnb).toContain('.cnb/.env.local');
    // 轮询频率锁每日 22:00（2026-10-19 拍板：*/30 空转 48 次/天，唯一代价是红叉噪音）
    expect(cnb).toContain('crontab: 0 22 * * * *');
  });

  it('取素材凭据走 secret，不写明文地址', () => {
    expect(release).toContain('secrets.ASSETS_SOURCE');
    // CNB 侧同型：ASSETS_SOURCE 经密钥仓 env.yml 注入（内置 CNB_TOKEN 读不到私有快照仓）
    expect(cnb).toContain('ASSETS_SOURCE');
    // workflow / .cnb.yml 里不出现带内联凭据的 URL 形态
    expect(release).not.toMatch(/https?:\/\/[^/\s]*:[^/\s]*@/);
    expect(cnb).not.toMatch(/https?:\/\/[^/\s]*:[^/\s]*@/);
  });

  it('CNB secret 走密钥仓库 imports（平台无 GitHub 式仓库 secret），四个流水线各自引用', () => {
    expect(cnb).toMatch(/^ {4}- imports:\s*\n {8}- https:\/\/cnb\.cool\/.+\/-\/blob\/main\/env\.yml/m);
    // main push / tag_push / crontab / web_trigger 四条要 GITHUB_TOKEN 的流水线（只数 YAML 键，注释里的不算）
    expect(cnb.match(/^ {4}- imports:/gm)?.length).toBe(4);
  });

  it('assets-sync 内置 CNB_TOKEN 时自动拼凭据，且日志打码（CI 侧 ASSETS_SOURCE 走密钥仓注入）', () => {
    expect(assetsSync).toMatch(/CNB_TOKEN/);
    expect(assetsSync).toMatch(/redact/);
  });

  it('素材快照仓名不出现在任何公开文档 / 配置里（地址走 secret 与脚本内置编码）', () => {
    const scanDirs = ['docs', '.scratch', 'scripts', 'tests', 'src', 'electron', '.github'];
    const TEXT = /\.(md|yml|yaml|ts|mjs|js|cjs|sh|json)$/;
    const hits: string[] = [];
    for (const rel of textFilesUnder(scanDirs, TEXT)) {
      if (readSource(rel).includes(ASSETS_SLUG_NEEDLE)) hits.push(rel);
    }
    for (const rootFile of ['AGENTS.md', 'CLAUDE.md', 'CONTEXT.md', 'README.md', 'README.en.md', 'package.json', '.cnb.yml']) {
      if (readSource(rootFile).includes(ASSETS_SLUG_NEEDLE)) hits.push(rootFile);
    }
    expect(hits).toEqual([]);
  });
});
