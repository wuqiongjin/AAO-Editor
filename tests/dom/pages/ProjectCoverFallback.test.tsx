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
import { screen, waitFor } from '@testing-library/react';
import { AppNavProvider, type PageId } from '@/src/layouts/AppNav';
import ProjectsPage from '@/src/pages/ProjectsPage';
import {
  ChartProjectStore, type ChartProject, type ProjectChart,
} from '@/src/chart/project/ChartProject';
import { makeMemoryProjectBackend, renderWithProviders } from '@/tests/support/providers';

const AT = 1_700_000_000_000;

const navValue = {
  activePage: 'projects' as PageId,
  setActivePage: () => {},
  navCollapsed: true,
  setNavCollapsed: () => {},
};

/** jsdom 不实现 objectURL：给每个 Blob 发一个可辨认的假 URL，并记住发过几个。 */
let created: { blob: Blob; url: string }[] = [];
let revoked: string[] = [];

beforeEach(() => {
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

function renderHub(projects: ChartProject[]) {
  return renderWithProviders(
    <AppNavProvider value={navValue}><ProjectsPage /></AppNavProvider>,
    { store: new ChartProjectStore(makeMemoryProjectBackend(projects)) },
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

  it('有 coverBlob：backgroundImage 用该 Blob 的 objectURL，不发渐变', async () => {
    const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
    renderHub([makeProject('pCover', 'Has Cover', blob)]);
    await screen.findByText('继续创作');

    // 每个 Cover 实例各自持有一份 objectURL（同一 Blob 也会被建多次）
    await waitFor(() => expect(created.length).toBe(covers().length));
    expect(created.every((entry) => entry.blob === blob)).toBe(true);
    await waitFor(() => {
      for (const c of covers()) expect(c.style.backgroundImage).toMatch(/^url\("blob:probe\/\d+"\)$/);
    });
    for (const c of covers()) expect(c.style.backgroundImage).not.toContain('linear-gradient');
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

  it('封面不允许再出现 background 简写（简写 + 空长手会把渐变整条抹掉）', async () => {
    renderHub([makeProject('pNoCover2', 'No Cover')]);
    await screen.findByText('继续创作');

    for (const c of covers()) {
      // 简写一出现就会有第二条赋值把它清掉；只留长手才安全
      expect(c.style.cssText).not.toMatch(/(^|;)\s*background\s*:/);
    }
  });
});
