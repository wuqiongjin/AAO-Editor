// release-pipeline 07 / 09 / ADR-0022：发布链路的静态锁。
// 锁的是「接线事实」——触发面、镜像挂哪个触发、镜像非 force、门禁三件套、
// GitHub 侧 PR 门禁、素材地址不进公开文档——防止后来人重构 CI 时悄悄改坏口径。
// 行为冒烟（secret 就绪后）见票 07「锁测」节。
import { describe, expect, it } from 'vitest';
import { readSource, textFilesUnder } from '@/tests/support/source';

const cnb = readSource('.cnb.yml');
const release = readSource('.github/workflows/release.yml');
const ci = readSource('.github/workflows/ci.yml');
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
  ['.github/workflows/ci.yml', ci],
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
    // gate / build / notes 三处 checkout 都必须落在 inputs.tag 上
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
    // PR 段走桩驱动（release-pipeline 10：PR 事件不注入密钥仓库，无快照环境）：
    // 正锁 pull_request 段、负锁 main / v* 段——标志误加到常态触发段必须红
    expect(cnbSection('pull_request:', 'crontab:')).toContain('ci-gate.sh --stub-assets');
    expect(cnbSection('main:', 'pull_request:')).not.toContain('--stub-assets');
    expect(cnbSection('v*:')).not.toContain('--stub-assets');
    expect(bashCode(gate)).toContain('ci-stub-gen.mjs');
    // 国内副本脚本被 crontab 与 web_trigger 两条触发共用（同一脚本两个入口）
    expect(cnb.match(/scripts\/ci\/ci-mirror-installers\.mjs/g)?.length).toBe(2);
  });

  it('PR 门禁 workflow 只监听 pull_request → main（不监听 push / tag / 定时 / 手动；不用 pull_request_target）', () => {
    const on = ci.match(/^on:([\s\S]*?)^jobs:/m)?.[1] ?? '';
    expect(on).toMatch(/pull_request:\s*\n\s*branches:\s*\[main\]/);
    // pull_request_target 会在 base 上下文带 secret 跑 fork 代码——凭据外泄面，明令禁止
    expect(ci).not.toContain('pull_request_target');
    expect(on).not.toMatch(/^ {2}push:/m);
    expect(on).not.toMatch(/^ {2}schedule:/m);
    expect(on).not.toContain('workflow_dispatch');
    expect(on).not.toContain('tags:');
  });

  it('PR 门禁复用 CNB 同一脚本（ci-gate.sh），必过检查名 = gate（与分支规则 required check 对齐）', () => {
    expect(ci).toMatch(/^ {2}gate:/m);
    expect(ci).toContain('bash scripts/ci/ci-gate.sh');
  });

  it('PR 门禁取素材凭据走 secret；fork PR 缺 secret 明确失败，不静默跳过（红着比绿着安全）', () => {
    expect(ci).toContain('secrets.ASSETS_SOURCE');
    expect(ci).toMatch(/if \[ -z "\$ASSETS_SOURCE" \]/);
    expect(ci).toContain('exit 1');
    expect(ci).not.toMatch(/continue-on-error/);
  });

  it('发版路径自带门禁兜底：gate job 跑 ci-gate.sh 三件套，构建矩阵 needs: gate（tag 保留管理员直推的对价，用户 2026-10-20 拍板）', () => {
    expect(release).toMatch(/^ {2}gate:/m);
    expect(release).toContain('bash scripts/ci/ci-gate.sh');
    expect(release).toMatch(/needs: gate/);
    // 顺序：门禁步骤在矩阵构建之前（ci-gate.sh 调用文本出现在 build 的 needs 之前）
    expect(release.indexOf('ci-gate.sh')).toBeLessThan(release.indexOf('needs: gate'));
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

  it('.cnb.yml 五种触发俱全：push / pull_request / tag_push / crontab / web_trigger', () => {
    expect(cnb).toMatch(/^ {2}push:/m);
    expect(cnb).toMatch(/^ {2}pull_request:/m);
    expect(cnb).toMatch(/tag_push:/);
    expect(cnb).toMatch(/crontab:/);
    expect(cnb).toMatch(/^ {2}web_trigger:/m);
    // 轮询频率锁每日 22:00（2026-10-19 拍板：*/30 空转 48 次/天，唯一代价是红叉噪音）
    expect(cnb).toContain('crontab: 0 22 * * * *');
    // 票 08 退役件防回归：凭据改走平台个人环境变量注入后，漫游文件挂载 hook
    // （~/.cnb/.env.local → ~/.zshenv）已清理，不许悄悄回来
    expect(cnb).not.toMatch(/env\.local|vscode/);
  });

  it('取素材凭据走 secret，不写明文地址', () => {
    expect(release).toContain('secrets.ASSETS_SOURCE');
    // PR 门禁同型：同样只认 secret 注入的 ASSETS_SOURCE
    expect(ci).toContain('secrets.ASSETS_SOURCE');
    // CNB 侧同型：ASSETS_SOURCE 由 secret 注入（内置 CNB_TOKEN 读不到外部素材源）
    expect(cnb).toContain('ASSETS_SOURCE');
    // workflow / .cnb.yml 里不出现带内联凭据的 URL 形态
    expect(release).not.toMatch(/https?:\/\/[^/\s]*:[^/\s]*@/);
    expect(ci).not.toMatch(/https?:\/\/[^/\s]*:[^/\s]*@/);
    expect(cnb).not.toMatch(/https?:\/\/[^/\s]*:[^/\s]*@/);
  });

  it('CNB secret 走平台 secret 仓库 imports（平台无 GitHub 式仓库 secret），四个流水线各自引用', () => {
    expect(cnb).toMatch(/^ {4}- imports:\s*\n {8}- https:\/\/cnb\.cool\/.+\/-\/blob\/main\/env\.yml/m);
    // main push / tag_push / crontab / web_trigger 四条要 GITHUB_TOKEN 的流水线（只数 YAML 键，注释里的不算）
    expect(cnb.match(/^ {4}- imports:/gm)?.length).toBe(4);
  });

  it('assets-sync 凭据自举：环境 CNB_TOKEN 进候选链，日志剥令牌（CI 侧 ASSETS_SOURCE 走 secret 注入）', () => {
    expect(assetsSync).toMatch(/CNB_TOKEN/);
    expect(assetsSync).toMatch(/stripCredential/); // 令牌连打码形式都不进日志（票 08）
    expect(assetsSync).not.toContain('***@');
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
