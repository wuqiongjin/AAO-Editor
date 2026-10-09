// @vitest-environment jsdom
// 票 12 + 08：新建入口四项归类（空白创建 / 从本地谱面导入 / 从官方谱面导入 / 从社区谱面导入）。
//
// 这一层锁的是**界面接线**，不是能力层：
//   - 有社区平台出口（window.electronAPI.communityNet）：四块 tile、四个 tab、官方面板能选曲建工程；
//   - 静态演示版（没有这条桥）：官方 / 社区两支整体隐藏，只剩前两支（ADR-0011 §1）。
// 曲库 / 详情 / 二进制都走假桥（载荷形状照 07 的跨 IPC 契约），不打网络。
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { AppNavProvider, type PageId } from '@/src/layouts/AppNav';
import ProjectsPage from '@/src/pages/projects/ProjectsPage';
import { ChartProjectStore } from '@/src/project/ChartProject';
import { makeMemoryProjectBackend, renderWithProviders } from '@/tests/support/providers';
import { seedZhSettings } from '@/tests/support/storage';

const setActivePage = vi.fn();
const navValue = {
  activePage: 'projects' as PageId,
  setActivePage,
  pageScope: null,
  navCollapsed: true,
  setNavCollapsed: () => {},
};

const SONG_TITLE = 'BLACK SHOUT';
const SONG_ARTIST = 'Roselia';
const JACKET_URL = 'https://bestdori.com/assets/jp/musicjacket/musicjacket30_rip/assets-star-forassetbundle-startapp-musicjacket-musicjacket30-blackshout-jacket.png';
const AUDIO_URL = 'https://bestdori.com/assets/jp/sound/bgm029_rip/bgm029.mp3';
const STAGED_AUDIO_PATH = '/data/downloads/aaa-bgm029.mp3';
const STAGED_COVER_PATH = '/data/downloads/bbb-blackshout.png';

const SONGS_INDEX = {
  '29': {
    tag: 'normal',
    bandId: 5,
    jacketImage: ['blackshout'],
    musicTitle: ['BLACK SHOUT', 'BLACK SHOUT', 'BLACK SHOUT', 'BLACK SHOUT', 'BLACK SHOUT'],
    publishedAt: ['1462071600000', '1462104000000', '1507003200000', '1462075200000', '1462071600000'],
    difficulty: {
      0: { playLevel: 6 },
      1: { playLevel: 13 },
      2: { playLevel: 18 },
      3: { playLevel: 25 },
      4: { playLevel: 26 },
    },
  },
  '1': {
    tag: 'normal',
    bandId: 1,
    jacketImage: ['yes_bang_dream'],
    musicTitle: ['Yes! BanG_Dream!', 'Yes! BanG_Dream!', 'Yes! BanG_Dream!', 'Yes! BanG_Dream!'],
    publishedAt: ['1462071600000', '1462104000000', null, null],
    difficulty: { 3: { playLevel: 22 } },
  },
};
const BANDS_INDEX = {
  '5': { bandName: ['Roselia', 'Roselia', 'Roselia', 'Roselia', 'Roselia'] },
  '1': { bandName: ["Poppin'Party", "Poppin'Party", "Poppin'Party", "Poppin'Party"] },
};
const OFFICIAL_SPECIAL = JSON.stringify([
  { type: 'BPM', bpm: 185, beat: 0 },
  { type: 'System', data: 'bgm029.wav', beat: 0 },
  { type: 'Single', lane: 5, beat: 10 },
]);

/** 假桥：按 URL 回 07 契约里的三种形态（json / text / binary） */
function installFakeBridge(): void {
  const request = vi.fn(async (payload: { url: string; responseType?: string }) => {
    const { url, responseType } = payload;
    if (responseType === 'binary') {
      return url === AUDIO_URL
        ? { ok: true, responseType: 'binary', status: 200, path: STAGED_AUDIO_PATH, byteLength: 4_000_000, contentType: 'audio/mpeg' }
        : { ok: true, responseType: 'binary', status: 200, path: STAGED_COVER_PATH, byteLength: 98_575, contentType: 'image/png' };
    }
    if (responseType === 'text') {
      return { ok: true, responseType: 'text', status: 200, text: OFFICIAL_SPECIAL };
    }
    if (url.endsWith('/api/songs/all.5.json')) return { ok: true, responseType: 'json', status: 200, data: SONGS_INDEX };
    if (url.endsWith('/api/bands/all.1.json')) return { ok: true, responseType: 'json', status: 200, data: BANDS_INDEX };
    if (url.endsWith('/api/songs/29.json')) {
      return { ok: true, responseType: 'json', status: 200, data: { bgmId: 'bgm029', length: 120.048 } };
    }
    return { ok: false, error: { kind: 'request-rejected', message: `未打桩: ${url}` } };
  });
  (window as unknown as { electronAPI?: unknown }).electronAPI = { communityNet: { request } };
}

function renderPage() {
  const backend = makeMemoryProjectBackend([]);
  const result = renderWithProviders(
    <ConfigProvider>
      <AppNavProvider value={navValue}><ProjectsPage /></AppNavProvider>
    </ConfigProvider>,
    { store: new ChartProjectStore(backend) },
  );
  return { ...result, backend };
}

/** 打开新建弹窗（点「空白新建」那块 tile，落地到空白那一支），返回弹窗节点 */
async function openNewDialog() {
  await screen.findByText('全部工程');
  fireEvent.click(screen.getByRole('button', { name: /空白新建/ }));
  return await screen.findByRole('dialog');
}

const tabNames = ['空白新建', '从本地谱面导入', '从官方谱面导入', '从社区谱面导入'];

beforeEach(() => {
  seedZhSettings();
  setActivePage.mockClear();
  installFakeBridge();
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('票 12 · 新建入口四项归类', () => {
  it('启动台四块 tile、弹窗四个 tab（顺序 = 空白 / 本地 / 官方 / 社区）', async () => {
    renderPage();
    await screen.findByText('全部工程');

    for (const name of tabNames) {
      expect(screen.getByRole('button', { name: new RegExp(name) })).toBeInTheDocument();
    }

    const dialog = await openNewDialog();
    const tabs = within(dialog).getAllByRole('button').filter((b) => tabNames.includes(b.textContent ?? ''));
    expect(tabs.map((b) => b.textContent)).toEqual(tabNames);
  });

  it('静态演示版（没有社区出口）：官方 / 社区两支整体隐藏', async () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    renderPage();
    await screen.findByText('全部工程');

    expect(screen.queryByRole('button', { name: /从官方谱面导入/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /从社区谱面导入/ })).toBeNull();

    const dialog = await openNewDialog();
    expect(within(dialog).queryByRole('button', { name: /从官方谱面导入/ })).toBeNull();
  });

  it('社区那一支只摆位：切过去看到占位说明，且没有「创建」键', async () => {
    renderPage();
    const dialog = await openNewDialog();

    fireEvent.click(within(dialog).getByRole('button', { name: /从社区谱面导入/ }));

    expect(await within(dialog).findByText(/社区谱面浏览还在开发中/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: '创建' })).toBeNull();
  });
});

describe('票 08 · 从官方谱面导入', () => {
  it('选曲 → 预览（封面 / 难度等级表 / 试听）→ 建工程 → 留在工程管理页', async () => {
    const { backend } = renderPage();
    const dialog = await openNewDialog();

    fireEvent.click(within(dialog).getByRole('button', { name: /从官方谱面导入/ }));
    // 曲库一次拉全：两首曲子都在
    await within(dialog).findByText(SONG_TITLE);
    expect(within(dialog).getByText('Yes! BanG_Dream!')).toBeInTheDocument();

    // 搜索命中歌手（票 08 锁测：标题与歌手都要能搜到）
    fireEvent.change(screen.getByLabelText('搜索曲名或歌手'), { target: { value: 'roselia' } });
    expect(within(dialog).getByText(SONG_TITLE)).toBeInTheDocument();
    expect(within(dialog).queryByText('Yes! BanG_Dream!')).toBeNull();

    // 选中 → 就地预览：封面直链 + 五个难度等级 + 试听直链
    fireEvent.click(within(dialog).getByRole('option', { name: new RegExp(SONG_TITLE) }));
    await waitFor(() => expect(document.querySelector('.off-cover img')).not.toBeNull());
    expect(document.querySelector('.off-cover img')?.getAttribute('src')).toBe(JACKET_URL);
    // 难度等级表：五个难度都在，等级取自曲库
    expect([...document.querySelectorAll('.off-levels li')].map((li) => li.querySelector('b')?.textContent))
      .toEqual(['6', '13', '18', '25', '26']);
    await waitFor(() => expect(document.querySelector('.off-audio')).not.toBeNull());
    expect(document.querySelector('.off-audio')?.getAttribute('src')).toBe(AUDIO_URL);

    // 勾 B：把官方谱面一起导入（默认关，勾了才出现难度选择）
    expect(within(dialog).queryByText('导入哪张难度')).toBeNull();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /把官方谱面一起导入/ }));
    fireEvent.change(within(dialog).getByRole('combobox', { name: /导入哪张难度/ }), { target: { value: 'special' } });
    expect(within(dialog).getByRole('option', { name: /等级 26/ })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: '创建' }));

    await waitFor(() => expect(backend.disk.size).toBe(1));
    const created = [...backend.disk.values()][0];
    expect(created).toMatchObject({
      name: SONG_TITLE,
      artist: SONG_ARTIST,
      source: { type: 'bandori', id: 29 },
      durationSeconds: 120.048,
    });
    expect(created.charts).toHaveLength(1);
    expect(created.charts[0]).toMatchObject({ diff: 4, level: 26, chartCodePristine: true, title: null });
    expect(created.charts[0].notes).toHaveLength(3);
    // 音频 / 封面的名字落进工程记录（详情行与音频页靠它认出「有音频」）
    expect(created.audioName).toBe('bgm029.mp3');
    expect(created.coverName).toBe('blackshout.png');
    // 二进制走暂存：只递路径，字节不过 IPC
    expect(backend.staged.get(created.id)).toEqual({
      audioStagedPath: STAGED_AUDIO_PATH,
      coverStagedPath: STAGED_COVER_PATH,
    });

    // 落点照 issue 23 #1：留在工程管理页、新工程成为当前工程、详情切过去、不跳工作台
    expect(setActivePage).not.toHaveBeenCalledWith('workspace');
    await waitFor(() => expect(document.querySelector('.pc-detail__head h2')?.textContent).toBe(SONG_TITLE));
    await waitFor(() => expect(document.querySelector('.pc-item .pp-current-tag')).not.toBeNull());
  });

  // 用不可退避的 kind：退避重试本身由 rateLimit 那族锁，这里要快（不白等 3 次退避），
  // 离线 / 限流那几句文案的映射在 tests/unit/project/OfficialImport.test.ts 里直接锁。
  it('曲库拉不到：出错误横幅与重试键，而不是白屏', async () => {
    (window as unknown as { electronAPI: { communityNet: { request: unknown } } }).electronAPI.communityNet.request =
      vi.fn(async () => ({ ok: false, error: { kind: 'invalid-response', message: '回退页' } }));
    renderPage();
    const dialog = await openNewDialog();

    fireEvent.click(within(dialog).getByRole('button', { name: /从官方谱面导入/ }));

    expect(await within(dialog).findByText('曲库没拉到')).toBeInTheDocument();
    expect(within(dialog).getByText('读取官方曲库失败，请重试。')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '重试' })).toBeInTheDocument();
    // 不循环报错：一次打开只打两条请求（曲库索引 + 乐队索引），失败不自动重试 —— 重试要用户点
    expect((window as unknown as { electronAPI: { communityNet: { request: ReturnType<typeof vi.fn> } } })
      .electronAPI.communityNet.request).toHaveBeenCalledTimes(2);
  });
});
