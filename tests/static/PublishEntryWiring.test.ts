// 票 11：发布对话框的接线事实 —— 走既有弹窗壳、不自绘 scrim、一次性确认复用
// ConfirmDialog（实底红确认键 = 危险键分寸）；能力层不 import 工程域（src/community
// 零 project / pages 依赖，与票 10 凭据边界同族的纪律）。
import { readdirSync, statSync } from 'node:fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { readSource, readStripped, repoRoot, sourceFiles } from '@/tests/support/source';

const publishDialog = readStripped('src/pages/projects/components/PublishDialog.tsx');
const publishDialogCss = readStripped('src/pages/projects/components/PublishDialog.css');
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
    // 票 54：已发态按钮给动作词「更新」，不给状态词
    expect(projectDetail).toMatch(/t\(up \? 'projects\.publish\.update' : 'projects\.publish\.action'\)/);
    // 票 51：已发谱面仍有入口，不再卸掉
    expect(projectDetail).toMatch(/\{publishEntry && \(/);
    expect(projectDetail).not.toMatch(/publishEntry && !up/);
    // 票 41：灰化 why 不占列表行；未登录要点得开（aria-disabled，不是原生 disabled）
    expect(projectDetail).not.toMatch(/<CapabilityStatusLine/);
    expect(projectDetail).toMatch(/aria-disabled=\{signedOut/);
  });

  it('弹窗由页面编排挂载；发布动作与记录写入在页面目录的 hook 里（页面只挂 hook）', () => {
    expect(projectsPage).toMatch(/<PublishDialog/);
    expect(projectsPage).toMatch(/usePublishEntry\(/);
    expect(publishEntry).toMatch(/publishChart\(/);
    expect(publishEntry).toMatch(/editChartPost\(/);
    expect(publishEntry).toMatch(/updateUploadedChartMeta\(/);
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

describe('票 54 · 已发布态的文案口径', () => {
  it('弹窗标题：未发「发布谱面」、已发「更新谱面」（标题说这张窗干什么）', () => {
    expect(publishDialog).toMatch(/t\(published \? 'projects\.publish\.updateTitle' : 'projects\.publish\.title'\)/);
    expect(publishDialog).not.toMatch(/projects\.publish\.communityPost/);
  });

  it('communityPost 键退役：全仓 src 与两份字典里都不再有它（键名与文案两头不靠）', () => {
    // 全仓扫源文件：任何一个再引用这个键都红（不只这两个组件）
    const hits = sourceFiles('src').filter((rel) => /communityPost/.test(readSource(rel)));
    expect(hits).toEqual([]);
    const zh = JSON.parse(readSource('src/i18n/messages/zh-CN.json')) as Record<string, string>;
    const en = JSON.parse(readSource('src/i18n/messages/en.json')) as Record<string, string>;
    expect(Object.keys(zh)).not.toContain('projects.publish.communityPost');
    expect(Object.keys(en)).not.toContain('projects.publish.communityPost');
    // 文案值也锁住：字典漂移（改成别的词）要红
    expect(zh['projects.publish.updateTitle']).toBe('更新谱面');
    expect(en['projects.publish.updateTitle']).toBe('Update chart');
  });

  it('「已发布就不能改」的说法不能回潮：README / 文档站与 already 文案都说「谱面本体只读、元数据可改」', () => {
    const zh = JSON.parse(readSource('src/i18n/messages/zh-CN.json')) as Record<string, string>;
    const en = JSON.parse(readSource('src/i18n/messages/en.json')) as Record<string, string>;
    // already 文案：点明 diff / level / tags 还能改（票 51 起的口径）
    expect(zh['projects.publish.err.already']).toContain('更新');
    expect(en['projects.publish.err.already']).toContain('Update');

    // 四份对外文档：旧说法一律不许再出现
    const docs: Array<[string, string[]]> = [
      ['README.md', ['已发布的谱面只读', '已上传谱面只读']],
      ['README.en.md', ['published charts are read-only', 'Uploaded charts are read-only']],
      ['docs-site/guide/features.md', ['已上传的谱面只读']],
      ['docs-site/en/guide/features.md', ['Uploaded charts are read-only']],
    ];
    for (const [file, stale] of docs) {
      const text = readSource(file);
      for (const phrase of stale) expect(text, `${file} 仍写着旧口径「${phrase}」`).not.toContain(phrase);
    }
    // 反向：新口径要在场（否则等于把这段说明删了）
    expect(readSource('README.md')).toContain('更新');
    expect(readSource('README.en.md')).toContain('Update');
    expect(readSource('docs-site/guide/features.md')).toContain('更新');
    expect(readSource('docs-site/en/guide/features.md')).toContain('Update');
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

describe('发布弹窗 · 描述框按正文撑开', () => {
  it('随行数变高；空稿也比旧的 88px 盒子高一截', () => {
    expect(publishDialogCss).toMatch(/field-sizing:\s*content/);
    expect(publishDialogCss).toMatch(/min-height:\s*9em/);
    expect(publishDialogCss).not.toMatch(/min-height:\s*88px/);
    expect(publishDialog).toMatch(/rows=\{6\}/);
  });

  it('整张内容卡可竖向拉伸，右下角有角标', () => {
    expect(publishDialogCss).toMatch(/\.ppc-resize\s*\{[^}]*cursor:\s*ns-resize/);
    expect(publishDialog).toMatch(/className="ppc-resize"/);
  });
});
