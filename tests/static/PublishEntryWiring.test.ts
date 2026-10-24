// 票 11：发布对话框的接线事实 —— 走既有弹窗壳、不自绘 scrim、一次性确认复用
// ConfirmDialog（实底红确认键 = 危险键分寸）；能力层不 import 工程域（src/community
// 零 project / pages 依赖，与票 10 凭据边界同族的纪律）。
import { readdirSync, statSync } from 'node:fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { readStripped, repoRoot } from '@/tests/support/source';

const publishDialog = readStripped('src/pages/projects/components/PublishDialog.tsx');
const projectDetail = readStripped('src/pages/projects/components/ProjectDetail.tsx');
const projectsPage = readStripped('src/pages/projects/ProjectsPage.tsx');
const publishEntry = readStripped('src/pages/projects/usePublishEntry.ts');

describe('票 11 · 发布弹窗走既有弹窗壳', () => {
  it('壳是 ui/Dialog：import 它，自己不画 scrim', () => {
    expect(publishDialog).toMatch(/import Dialog from '\.\.\/\.\.\/\.\.\/ui\/Dialog'/);
    expect(publishDialog).not.toMatch(/scrim/);
  });

  it('一次性「发布后不可改」确认复用 ConfirmDialog（确认键实底红）', () => {
    expect(publishDialog).toMatch(/import ConfirmDialog from '\.\.\/\.\.\/\.\.\/ui\/ConfirmDialog'/);
    expect(publishDialog).toMatch(/<ConfirmDialog/);
    expect(readStripped('src/ui/ConfirmDialog.tsx')).toMatch(/danger-solid/);
  });
});

describe('票 11 · 发布入口的接线', () => {
  it('入口在工程详情（ADR-0015 §4：上传链路不归工程管理页管，它作入口）', () => {
    expect(projectDetail).toMatch(/onPublishChart/);
    expect(projectDetail).toMatch(/t\('projects\.publish\.action'\)/);
    // 已上传的谱面没有发布入口（至多一条上传记录）
    expect(projectDetail).toMatch(/publishEntry && !up/);
    // 票 41：灰化 why 不占列表行；未登录要点得开（aria-disabled，不是原生 disabled）
    expect(projectDetail).not.toMatch(/<CapabilityStatusLine/);
    expect(projectDetail).toMatch(/aria-disabled=\{signedOut/);
  });

  it('弹窗由页面编排挂载；发布动作与记录写入在页面目录的 hook 里（页面只挂 hook）', () => {
    expect(projectsPage).toMatch(/<PublishDialog/);
    expect(projectsPage).toMatch(/usePublishEntry\(/);
    expect(publishEntry).toMatch(/publishChart\(/);
    // 上传记录走唯一写入口（mutateProject）+ 只写一次的把门（recordChartUpload）
    expect(publishEntry).toMatch(/mutateProject\(/);
    expect(publishEntry).toMatch(/recordChartUpload\(/);
    // 票 43 Q2：关窗后在飞写入按 prev 判断，不把弹窗 target 设回来
    expect(publishEntry).toMatch(/setTarget\(\(prev\) => \(prev == null \? null/);
    // 票 43 Q5：发布弹窗难度下拉不再铺 DIFF_COLORS
    expect(publishDialog).not.toMatch(/DIFF_COLORS/);
  });

  it('能力层（src/community）不 import 工程域与页面（分层纪律）', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(repoRoot, dir))) {
        const rel = `${dir}/${entry}`;
        if (statSync(join(repoRoot, rel)).isDirectory()) walk(rel);
        else if (/\.ts$/.test(entry) && /from '[^']*\/(project|pages)\//.test(readStripped(rel))) offenders.push(rel);
      }
    };
    walk('src/community');
    expect(offenders).toEqual([]);
  });
});

describe('issue 49 · 谱面域预检的接线', () => {
  it('弹窗认 chart-invalid 档并渲染点名明细（formatValidationError），域外值不发请求才报得出', () => {
    expect(publishDialog).toMatch(/'chart-invalid': 'projects\.publish\.err\.chartInvalid'/);
    expect(publishDialog).toMatch(/formatValidationError/);
    expect(publishDialog).toMatch(/outcome\.chartIssues/);
  });

  it('预检的 chartIssues 与 ok / missing 分道：按钮不因警告禁用（点发布时才硬拦）', () => {
    const precheck = readStripped('src/community/bestdori/publish.ts');
    expect(precheck).toMatch(/chartIssues/);
    // hard 拦在 publishChart 里、先于必填上报；precheckPublish 的 ok 只看 missing
    expect(precheck).toMatch(/precheck\.chartIssues\.length > 0/);
    expect(precheck).toMatch(/ok: missing\.length === 0/);
  });
});
