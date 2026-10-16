// 票 12 + 08：新建入口的文案守卫 —— **「Bestdori」不进用户文案**（用户 2026-10-09 口径）。
//
// 四项来源的说话方式是「空白创建 / 从本地谱面导入 / 从官方谱面导入 / 从社区谱面导入」：
// 用户不关心数据从哪个站来，只关心「官方谱」还是「社区谱」之分。这条是本票用户口径里
// 唯一能机器验的形态，也是防回潮的总闸 —— 人一图省事就会把「从 Bestdori 导入」写回去。
import { describe, expect, it } from 'vitest';
import { readSource, readStripped } from '@/tests/support/source';

/** 新建入口用到的文案键（弹窗四支 + 官方面板 + 社区占位） */
const ENTRY_KEYS = /^projects\.(new|official|community|tab|copyDisabled)/;

function messages(file: string): Record<string, string> {
  return JSON.parse(readSource(file)) as Record<string, string>;
}

const FILES = ['src/i18n/messages/zh-CN.json', 'src/i18n/messages/en.json'];

describe('票 12 · 新建入口文案去站名化', () => {
  for (const file of FILES) {
    it(`${file}：projects.new* / official* / community* 的值里不出现 bestdori`, () => {
      const offenders = Object.entries(messages(file))
        .filter(([key]) => ENTRY_KEYS.test(key))
        .filter(([, value]) => /bestdori/i.test(value));
      expect(offenders).toEqual([]);
    });
  }

  it('四支入口的文案键都在（少一个就是入口断了）', () => {
    const zh = messages('src/i18n/messages/zh-CN.json');
    const en = messages('src/i18n/messages/en.json');
    for (const key of ['projects.newBlank', 'projects.newCopy', 'projects.newOfficial', 'projects.newCommunity']) {
      expect(zh[key], `zh 缺 ${key}`).toBeTruthy();
      expect(en[key], `en 缺 ${key}`).toBeTruthy();
    }
    // 四支的名词都短：desc 才是那句补充说明（票 12「不许写成解释句」）
    for (const key of ['projects.newOfficial', 'projects.newCommunity']) {
      expect(zh[key].length, `${key} 太长`).toBeLessThanOrEqual(10);
    }
  });

  it('弹窗 tab 英文短标签；主页入口英文仍用全称（票 13 Q1b / Q2）', () => {
    const en = messages('src/i18n/messages/en.json');
    const zh = messages('src/i18n/messages/zh-CN.json');
    expect(en['projects.tabBlank']).toBe('Blank');
    expect(en['projects.tabCopy']).toBe('Duplicate');
    expect(en['projects.tabOfficial']).toBe('Official');
    expect(en['projects.tabCommunity']).toBe('Community');
    expect(zh['projects.tabBlank']).toBe('空白新建');
    expect(zh['projects.tabCopy']).toBe('复制工程');
    expect(zh['projects.tabOfficial']).toBe('从官方谱面导入');
    expect(zh['projects.tabCommunity']).toBe('从社区谱面导入');
    // 主页 tile / 分裂菜单不跟着缩短
    expect(en['projects.newBlank']).toBe('Blank project');
    expect(en['projects.newCopy']).toBe('Duplicate project');
    expect(en['projects.newOfficial']).toBe('Import from official charts');
    expect(en['projects.newCommunity']).toBe('Import from community charts');
  });
});

describe('票 13 · 禁用态样式在位', () => {
  it('弹窗 tab 的 :disabled 是 not-allowed，不是还能点的样子', () => {
    expect(readSource('src/ui/ui.css')).toMatch(/\.dialog-tabs button:disabled[\s\S]{0,200}cursor:\s*not-allowed/);
  });

  it('主页 tile 禁用时图标不再走强调色', () => {
    expect(readSource('src/pages/projects/ProjectsPage.css')).toMatch(/\.pb-tile:disabled svg[\s\S]{0,80}accent-disabled/);
  });

  it('官方曲库重试中的文案键接到了选曲面板（票 13 #4）', () => {
    expect(readSource('src/pages/projects/components/OfficialSongPanel.tsx')).toMatch(/projects\.official\.retrying/);
  });

  it('票 46：首次加载用居中骨架 + 原句「正在拉取…」，不在工具条旁加一行', () => {
    const official = readStripped('src/pages/projects/components/OfficialSongPanel.tsx');
    const community = readStripped('src/pages/projects/components/CommunityPostPanel.tsx');
    expect(official).toContain('off-blank');
    expect(official).toContain("t('projects.official.loading')");
    expect(community).toContain('off-blank');
    expect(community).toContain("t('projects.community.loading')");
    expect(community).toContain("t('projects.community.searching')");
    expect(community).not.toContain('is-searching');
    expect(community).not.toContain("t('projects.community.end')");
    expect(community).toContain("t('projects.community.noMore')");
    expect(official).toContain("t('projects.official.loadFailRetry')");
    expect(official).toContain("t('projects.official.loadingSlow')");
    expect(community).toContain("t('projects.community.loadFailRetry')");
  });

  it('票 47：确认中发布不弹登录', () => {
    const src = readStripped('src/pages/projects/components/ProjectDetail.tsx');
    expect(src).toContain('session.verifying');
    expect(src).toContain('if (verifying) return');
  });

  it('票 44 回修（用户 2026-10-16 反馈）：空台阶梯改口、成功 Toast、死键清理', () => {
    const zh = messages('src/i18n/messages/zh-CN.json');
    const en = messages('src/i18n/messages/en.json');
    // 慢档文案按用户定稿改口；阈值 8s → 15s（跨境慢链正常往返就能到 10s 级，8s 喊慢太早）
    expect(zh['projects.community.loadingSlow']).toBe('网络较慢，努力拉取中…');
    expect(zh['projects.official.loadingSlow']).toBe('网络较慢，努力拉取中…');
    expect(zh['projects.community.retrying']).toBe('网络不稳定，正在重试…');
    expect(zh['projects.official.retrying']).toBe('网络不稳定，正在重试…');
    // 拉取成功也补 Toast（success 档绿底）：让用户等过了（慢 / 重试过）才弹，秒开不弹
    expect(zh['projects.community.loadOk']).toBe('社区谱面拉取成功');
    expect(zh['projects.official.loadOk']).toBe('官方曲库拉取成功');
    expect(en['projects.community.loadOk']).toBeTruthy();
    expect(en['projects.official.loadOk']).toBeTruthy();
    // 上一笔 commit 用居中「请点刷新」替掉错误横幅后，旧标题（"…没拉到"）成了死键 —— 清掉
    for (const key of ['projects.community.loadFail', 'projects.official.loadFail']) {
      expect(zh).not.toHaveProperty(key);
      expect(en).not.toHaveProperty(key);
    }
    for (const file of [
      'src/pages/projects/components/OfficialSongPanel.tsx',
      'src/pages/projects/components/CommunityPostPanel.tsx',
    ]) {
      const src = readStripped(file);
      expect(src).toMatch(/SLOW_AFTER_MS = 15_000/);
      expect(src).not.toContain('8000');
      expect(src).toMatch(/t\('projects\.(official|community)\.loadOk'\), 'success'/);
    }
    // 首屏（浏览）拉取成功必弹；社区侧搜索成功不弹 —— 结果列表本身就是反馈，别每搜一次吵一声
    const community = readStripped('src/pages/projects/components/CommunityPostPanel.tsx');
    expect(community).toMatch(/else if \(q === ''\) showToast\(t\('projects\.community\.loadOk'\), 'success'\)/);
    const official = readStripped('src/pages/projects/components/OfficialSongPanel.tsx');
    expect(official).toMatch(/else showToast\(t\('projects\.official\.loadOk'\), 'success'\)/);
  });

  it('票 45：导入中取消键不禁用', () => {
    const src = readStripped('src/pages/projects/components/ProjectDialogs.tsx');
    expect(src).toMatch(/<ActionBtn onClick=\{close\}>\{t\('projects\.cancel'\)\}<\/ActionBtn>/);
  });

  it('选曲台正文不滚、宽高可过渡（票 13 #6 / #7）', () => {
    const css = readSource('src/ui/ui.css');
    expect(css).toMatch(/\.dialog__body--clip[\s\S]{0,120}overflow:\s*hidden/);
    expect(css).toMatch(/\.dialog\s*\{[^}]*transition:[^}]*width/);
  });
});

describe('票 28 · 工程管理页面文案整改与去冗余', () => {
  for (const file of FILES) {
    it(`${file}：projects.* 全部文案中零 Bestdori（去站名化收口）`, () => {
      const offenders = Object.entries(messages(file))
        .filter(([key]) => key.startsWith('projects.'))
        .filter(([, value]) => /bestdori/i.test(value));
      expect(offenders).toEqual([]);
    });
  }

  it('两个工程弹窗与谱面弹窗不再引用冗余 hint / 流程性说明', () => {
    const dialogsSrc = readStripped('src/pages/projects/components/ProjectDialogs.tsx');
    const chartDialogSrc = readStripped('src/project/ui/ChartInfoDialog.tsx');
    expect(dialogsSrc).not.toContain('projects.newHint');
    expect(dialogsSrc).not.toContain('projects.coverHint');
    expect(chartDialogSrc).not.toContain('projects.chartNameHint');
    expect(chartDialogSrc).not.toContain('projects.chartCodeHint');
  });

  it('字典中已废弃全局与冗余 hint 键', () => {
    const zh = messages('src/i18n/messages/zh-CN.json');
    const en = messages('src/i18n/messages/en.json');
    for (const key of ['projects.newHint', 'projects.coverHint', 'projects.chartNameHint', 'projects.chartCodeHint']) {
      expect(zh).not.toHaveProperty(key);
      expect(en).not.toHaveProperty(key);
    }
  });

  it('复制说明文案精炼，说明音频、封面、谱面与状态重置', () => {
    const zh = messages('src/i18n/messages/zh-CN.json');
    const en = messages('src/i18n/messages/en.json');
    expect(zh['projects.copyHint']).toBe('完整复制音频、封面及谱面；谱面状态重置为未完成。');
    expect(en['projects.copyHint']).toBe('Copies audio, cover, and all charts. Chart status resets to incomplete.');
  });

  it('主页新建四项副文本精炼对仗，不提流程琐碎废话', () => {
    const zh = messages('src/i18n/messages/zh-CN.json');
    expect(zh['projects.newBlankDesc']).toBe('创建全新的空白谱面工程');
    expect(zh['projects.newCopyDesc']).toBe('以已有工程为模板创建');
    expect(zh['projects.newOfficialDesc']).toBe('从官方曲库中选曲，并同步导入音频与封面');
    expect(zh['projects.newCommunityDesc']).toBe('从游戏社区中选曲，并同步导入音频与封面');
  });

  it('两支选曲的搜索框 placeholder 匹配领域事实（标题 + 歌手 / 乐队 + ID）', () => {
    const zh = messages('src/i18n/messages/zh-CN.json');
    const en = messages('src/i18n/messages/en.json');
    // 搜索命中标题与乐队 / 歌手（实测：官方走乐队索引，社区帖走 post.artists）；
    // 票 32/33 起纯数字还按 id 搜（官方 songId 本地匹配、社区 postId 走详情直查）→ placeholder 一并说清
    expect(zh['projects.official.searchPlaceholder']).toBe('搜索曲名、乐队或曲库 ID');
    expect(en['projects.official.searchPlaceholder']).toBe('Search song titles, bands, or catalog IDs');
    expect(zh['projects.community.searchPlaceholder']).toBe('搜索歌曲标题或帖 ID');
    expect(en['projects.community.searchPlaceholder']).toBe('Search song titles or post IDs');
  });

  it('上传记录空态与删除提示去 Bestdori 化', () => {
    const zh = messages('src/i18n/messages/zh-CN.json');
    expect(zh['projects.uploadsEmpty']).toBe('暂无上传记录。');
    expect(zh['projects.confirmDeleteUploaded']).toContain('已上传至社区');
    expect(zh['projects.empty.description']).toBe('从空白新建开始，创建你的第一个谱面工程。');
  });
});
