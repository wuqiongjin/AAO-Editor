// @vitest-environment jsdom
// issue 11：无封面工程的封面背景色（占位渐变）不能被抹掉。
//
// 判据口径（重要）：断言一律打在 **backgroundImage 长手**上，不打 `style` 属性字符串。
// 原因：jsdom 的 cssstyle 对 `background` 简写的序列化不忠实——先写简写再写空长手时它仍
// 把渐变留在 cssText 里，断言属性串会得到假绿。真实浏览器（Chromium 实测）里同样的两步
// 会让 computed background-image 变成 `none`：
//   el.style.background = 'linear-gradient(...)'; el.style.backgroundImage = '';
//   → getComputedStyle(el).backgroundImage === 'none'
// 而 `el.style.backgroundImage` 长手在两边一致（都变成 ''），故用它作判据。
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { AppNavProvider, type PageId } from '@/src/layouts/AppNav';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import ProjectsPage from '@/src/pages/projects/ProjectsPage';
import {
  ChartProjectStore, type ChartProject, type ProjectChart,
} from '@/src/project/ChartProject';
import { makeMemoryProjectBackend, renderWithProviders } from '@/tests/support/providers';
import { seedZhSettings } from '@/tests/support/storage';

const AT = 1_700_000_000_000;

const navValue = {
  activePage: 'projects' as PageId,
  setActivePage: () => {},
  pageScope: null,
  navCollapsed: true,
  setNavCollapsed: () => {},
};

/** jsdom 不实现 objectURL：给每个 Blob 发一个可辨认的假 URL，并记住发过几个。 */
let created: { blob: Blob; url: string }[] = [];
let revoked: string[] = [];

beforeEach(() => {
  seedZhSettings();
  created = [];
  revoked = [];
  let seq = 0;
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: (blob: Blob) => {
      seq += 1;
      const url = `blob:probe/${seq}`;
      created.push({ blob, url });
      return url;
    },
    revokeObjectURL: (url: string) => {
      revoked.push(url);
    },
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeChart(id: string): ProjectChart {
  return {
    id,
    notes: [{ beat: 0, type: 'BPM', bpm: 120 }],
    title: null, diff: 3, level: null, completed: false, upload: null,
    lastModified: AT, appliedChartCodeText: null, chartCodePristine: false,
  };
}

function makeProject(id: string, name: string, coverBlob?: Blob): ChartProject {
  return {
    id, name, artist: null, source: { type: 'custom' },
    durationSeconds: 30, lastOpened: AT,
    charts: [makeChart('c1')],
    audioName: null, coverName: null,
    ...(coverBlob ? { coverBlob } : {}),
  };
}

function renderHub(projects: ChartProject[], opts: { cloneBlobsOnRead?: boolean } = {}) {
  return renderWithProviders(
    <ConfigProvider>
      <AppNavProvider value={navValue}><ProjectsPage /></AppNavProvider>
    </ConfigProvider>,
    { store: new ChartProjectStore(makeMemoryProjectBackend(projects, opts)) },
  );
}

function covers(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.pp-cover'));
}

describe('issue 11 · 无封面工程的封面背景色', () => {
  it('无 coverBlob：每个封面都有占位渐变，且显示工程名首字母', async () => {
    renderHub([makeProject('pNoCover', 'Fire Bird')]);
    await screen.findByText('继续创作');

    const all = covers();
    expect(all.length).toBeGreaterThan(0);
    for (const c of all) {
      // 长手必须真的挂上渐变；写成 '' 就等于浏览器里的「无背景」
      expect(c.style.backgroundImage).toContain('linear-gradient');
      expect(c.textContent).toBe('F');
    }
  });

  it('无 coverBlob 且工程名为空：渐变仍在，改为音符图标占位', async () => {
    renderHub([makeProject('pNoName', '   ')]);
    await screen.findByText('继续创作');

    for (const c of covers()) {
      expect(c.style.backgroundImage).toContain('linear-gradient');
    }
  });

  it('有 coverBlob：同一 Blob 只建一个 objectURL，所有封面实例复用，不发渐变', async () => {
    const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
    renderHub([makeProject('pCover', 'Has Cover', blob)]);
    await screen.findByText('继续创作');

    // issue 19 #3：同一 Blob 的 hero + 卡片实例共享同一 URL（不再"每挂载建一份"）
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0].blob).toBe(blob);
    await waitFor(() => {
      for (const c of covers()) expect(c.style.backgroundImage).toBe(`url("${created[0].url}")`);
    });
    for (const c of covers()) expect(c.style.backgroundImage).not.toContain('linear-gradient');
  });

  it('进详情：封面复用同一 URL，不新建、不落回占位（issue 19 #3 的"闪一下"回归网）', async () => {
    const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
    renderHub([makeProject('pCover', 'Has Cover', blob)]);
    await screen.findByText('继续创作');
    await waitFor(() => expect(created).toHaveLength(1));
    const url = created[0].url;

    // 进详情：hub 整棵卸载、详情新挂载，同一 Blob 的封面必须仍用旧 URL（浏览器可复用已解码图）
    fireEvent.click(document.querySelector('.pb-card') as HTMLElement);
    await waitFor(() => {
      const all = covers();
      expect(all.length).toBeGreaterThan(0);
      for (const c of all) expect(c.style.backgroundImage).toBe(`url("${url}")`);
    });
    expect(created).toHaveLength(1);
    expect(revoked).toHaveLength(0);
  });

  it('空 Blob（0 字节）：回退渐变，且根本不建 objectURL —— 直接锁住本 bug', async () => {
    const empty = new Blob([], { type: 'image/png' });
    expect(empty.size).toBe(0);

    renderHub([makeProject('pEmpty', 'Empty Blob', empty)]);
    await screen.findByText('继续创作');

    await waitFor(() => expect(covers().length).toBeGreaterThan(0));
    expect(created).toHaveLength(0); // 空 Blob 不配 objectURL
    for (const c of covers()) {
      expect(c.style.backgroundImage).toContain('linear-gradient');
      expect(c.style.backgroundImage).not.toContain('url(');
    }
  });

  it('编辑操作后所有封面 URL 不变（chart-projects 21：reload 不许换 Blob 身份）', async () => {
    const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
    // cloneBlobsOnRead 复现真后端的读回语义：每次 list() 都是新 Blob 对象
    renderHub([makeProject('pCover', 'Has Cover', blob)], { cloneBlobsOnRead: true });
    await screen.findByText('继续创作');
    await waitFor(() => expect(created).toHaveLength(1));
    const url = created[0].url;

    // 进详情，再从难度徽标改一次难度：mutate → reload 是"一编辑全封面闪"的触发路径
    fireEvent.click(document.querySelector('.pb-card') as HTMLElement);
    await screen.findByRole('heading', { name: 'Has Cover' });
    fireEvent.click(screen.getAllByTitle('点击改难度 / 等级')[0]);
    const panel = await screen.findByRole('dialog', { name: '点击改难度 / 等级' });
    fireEvent.click(within(panel).getByTitle('Hard'));

    // 等编辑真的落库（数据变了）之后再断言封面：同一 URL、没有新建
    await waitFor(() => expect(document.querySelector('.pc-chart__diff')).toHaveTextContent('Hard'));
    for (const c of covers()) expect(c.style.backgroundImage).toBe(`url("${url}")`);
    expect(created).toHaveLength(1);
    expect(revoked).toHaveLength(0);
  });

  it('网格卡封面走流式档（宽 100%），hero 封面保持固定尺寸（issue 19 #5）', async () => {
    renderHub([makeProject('pFluid', 'Fluid')]);
    await screen.findByText('继续创作');

    const cardCover = document.querySelector('.pb-card .pp-cover') as HTMLElement;
    expect(cardCover).toHaveClass('pp-cover--fluid');
    expect(cardCover.style.width).toBe('100%');

    const heroCover = document.querySelector('.pb-hero .pp-cover') as HTMLElement;
    expect(heroCover).not.toHaveClass('pp-cover--fluid');
    expect(heroCover.style.width).toBe('120px');
  });

  it('封面不允许再出现 background 简写（简写 + 空长手会把渐变整条抹掉）', async () => {
    renderHub([makeProject('pNoCover2', 'No Cover')]);
    await screen.findByText('继续创作');

    for (const c of covers()) {
      // 简写一出现就会有第二条赋值把它清掉；只留长手才安全
      expect(c.style.cssText).not.toMatch(/(^|;)\s*background\s*:/);
    }
  });
});
