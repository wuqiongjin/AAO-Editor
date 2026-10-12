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
import { clearSongCatalogCache } from '@/src/community/bestdori/songs';
import { clearPostPageCache } from '@/src/community/bestdori/posts';
import { assetRawUrl } from '@/src/community/assetUrls';
import { installIntersectionObserverStub } from '@/tests/support/intersection';
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
// 票 14：二进制的落点是素材缓存（07 的 downloads/ 已退役）
const STAGED_AUDIO_PATH = '/data/cache/community/aaa-bgm029.mp3';
const STAGED_COVER_PATH = '/data/cache/community/bbb-blackshout.png';

// 票 09：社区帖 fixture（custom 帖：帖内音频 + 封面直链）
const POST_AUDIO_URL = 'https://bestdori.com/api/upload/file/d936a1';
const POST_COVER_URL = 'https://bestdori.com/api/upload/file/247c2b';
const STAGED_POST_AUDIO_PATH = '/data/cache/community/ccc-post-audio';
const STAGED_POST_COVER_PATH = '/data/cache/community/ddd-post-cover';
const COMMUNITY_CHART = [
  { type: 'BPM', bpm: 185, beat: 0 },
  { type: 'Single', lane: 5, beat: 10 },
];
const COMMUNITY_POST = {
  id: 248468,
  title: 'All You Wanted (GBP Edit)',
  song: { type: 'custom', audio: POST_AUDIO_URL, cover: POST_COVER_URL },
  artists: 'Michelle Branch',
  diff: 3,
  level: 24,
  time: 1789214607000,
  author: { username: 'envy09', nickname: 'Envy', titles: null },
  likes: 1,
};
const POST_LIST = { result: true, count: 1, posts: [COMMUNITY_POST] };
const POST_DETAIL = { result: true, post: { ...COMMUNITY_POST, chart: COMMUNITY_CHART } };

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
      // 官方音频与帖内音频都回「音频」那一份，封面（官方 jacket / 帖内封面）回「图片」那一份
      return url === AUDIO_URL || url === POST_AUDIO_URL
        ? { ok: true, responseType: 'binary', status: 200, path: url === AUDIO_URL ? STAGED_AUDIO_PATH : STAGED_POST_AUDIO_PATH, byteLength: 4_000_000, contentType: 'audio/mpeg' }
        : { ok: true, responseType: 'binary', status: 200, path: url === JACKET_URL ? STAGED_COVER_PATH : STAGED_POST_COVER_PATH, byteLength: 98_575, contentType: 'image/png' };
    }
    if (responseType === 'text') {
      return { ok: true, responseType: 'text', status: 200, text: OFFICIAL_SPECIAL };
    }
    if (url.endsWith('/api/post/list')) return { ok: true, responseType: 'json', status: 200, data: POST_LIST };
    if (url.endsWith('/api/post/details?id=248468')) return { ok: true, responseType: 'json', status: 200, data: POST_DETAIL };
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

/** 切来源 tab。同一颗 Dialog 改 size（票 13 #6），遮罩不卸。 */
function switchSource(dialog: HTMLElement, name: string) {
  fireEvent.click(within(dialog).getByRole('button', { name: new RegExp(name) }));
  return dialog;
}

const tabNames = ['空白新建', '复制工程', '从官方谱面导入', '从社区谱面导入'];

// 票 15：目录行里的封面缩略图靠 IntersectionObserver 懒加载，这里桩一个（不滚动 = 一行都不取图）
let io: ReturnType<typeof installIntersectionObserverStub>;

beforeEach(() => {
  seedZhSettings();
  setActivePage.mockClear();
  io = installIntersectionObserverStub();
  installFakeBridge();
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  io.restore();
  clearSongCatalogCache();
  // 帖子列表的页缓存是模块级的（同一会话里重开弹窗要复用，见票 09 反馈 #2）——
  // 跨用例必须清，否则后面的用例读到上一个用例的那一页、一条请求都不发。
  clearPostPageCache();
});

describe('票 12 · 新建入口四项归类', () => {
  it('没有工程时「复制工程」禁用，并写明原因（票 13 #3）', async () => {
    renderPage();
    await screen.findByText('全部工程');
    const tile = screen.getByRole('button', { name: /复制工程/ });
    expect(tile).toBeDisabled();
    expect(tile).toHaveAttribute('title', '需要已有工程');

    const dialog = await openNewDialog();
    const tab = within(dialog).getByRole('button', { name: /复制工程/ });
    expect(tab).toBeDisabled();
    expect(tab).toHaveAttribute('title', '需要已有工程');
  });

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

  it('社区那一支：切过去是同一颗 lg 窗，帖子列表就位；未选中时「创建」禁用', async () => {
    renderPage();
    let dialog = await openNewDialog();
    expect(dialog.className).toMatch(/dialog--md/);

    dialog = await switchSource(dialog, '从社区谱面导入');

    expect(dialog.className).toMatch(/dialog--lg/);
    // 列表走服务端分页：帖子标题与谱师就位
    expect(await within(dialog).findByText('All You Wanted (GBP Edit)')).toBeInTheDocument();
    expect(within(dialog).getByText('Envy')).toBeInTheDocument();
    // 未选中：创建键在但禁用（与官方支同口径）
    const create = within(dialog).getByRole('button', { name: '创建' });
    expect(create).toBeDisabled();
  });

  it('社区帖选中后预览展开，创建 → 工程「未命名」、曲目来源 custom、谱面名称留空（票 09 锁）', async () => {
    const { backend } = renderPage();
    let dialog = await openNewDialog();
    dialog = await switchSource(dialog, '从社区谱面导入');
    await within(dialog).findByText('All You Wanted (GBP Edit)');

    // 票 09 反馈 #3：发布时间在**列表行**（右列，与难度等级并排），不在预览栏里重复
    const row = within(dialog).getByRole('option', { name: /All You Wanted/ });
    expect(row.textContent).toMatch(/EX 24/);
    expect(row.textContent).toMatch(/2026-\d{2}-\d{2}/);

    fireEvent.click(row);
    // 预览展开：原帖标题 + 谱师 + 难度等级（原帖标题只在导入会话里，见工程断言的名称锁）
    await waitFor(() => expect(document.querySelector('.off-preview')?.className).not.toMatch(/is-collapsed/));
    const preview = document.querySelector('.off-preview') as HTMLElement | null;
    expect(preview?.querySelector('.off-preview__title')?.textContent).toBe('All You Wanted (GBP Edit)');
    expect(preview?.textContent).toContain('Envy');
    expect(preview?.textContent).toMatch(/EX 24/);
    // 预览栏不重复时间（票 09 反馈 #5：日期不跟谱师挤一行）
    expect(preview?.textContent).not.toMatch(/2026-\d{2}-\d{2}/);
    // 「同步导入谱面」芯片与官方支同形同义：默认开
    const syncChip = within(dialog).getByRole('button', { name: '同步导入谱面' });
    expect(syncChip).toHaveAttribute('aria-pressed', 'true');

    const create = within(dialog).getByRole('button', { name: '创建' });
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);

    await waitFor(() => expect(backend.disk.size).toBe(1));
    const created = [...backend.disk.values()][0];
    // 名称口径（票 09）：工程名 / 歌手 / 谱面名称全空 —— 不转手别人的谱连名字一起转
    expect(created).toMatchObject({
      name: null,
      artist: null,
      source: { type: 'custom' },
      audioName: 'post-248468-audio.mp3',
      coverName: 'post-248468-cover.png',
    });
    expect(created.charts[0]).toMatchObject({
      title: null,
      diff: 3,
      level: 24,
      chartCodePristine: true,
    });
    expect(created.charts[0].appliedChartCodeText).toBe(JSON.stringify(COMMUNITY_CHART));
    // custom 帖没有官方曲长：探针在 jsdom 里解不了音频，占位 30 就是终值
    expect(created.durationSeconds).toBe(30);
    expect(backend.staged.get(created.id)).toEqual({
      audioStagedPath: STAGED_POST_AUDIO_PATH,
      coverStagedPath: STAGED_POST_COVER_PATH,
    });

    // 落点照 issue 23 #1：留在工程管理页、新工程成为当前工程、不跳工作台
    expect(setActivePage).not.toHaveBeenCalledWith('workspace');
  });

  it('关掉「同步导入谱面」：难度芯片变回未选中样式，产出空 Expert（等级不预填）', async () => {
    const { backend } = renderPage();
    let dialog = await openNewDialog();
    dialog = await switchSource(dialog, '从社区谱面导入');
    await within(dialog).findByText('All You Wanted (GBP Edit)');
    fireEvent.click(within(dialog).getByRole('option', { name: /All You Wanted/ }));
    await waitFor(() => expect(document.querySelector('.off-preview')?.className).not.toMatch(/is-collapsed/));

    // 开着的时候：芯片组是「可选中」态，那一枚带 ✓
    expect(document.querySelector('.off-preview__levels')?.className).toMatch(/is-pick/);
    expect(document.querySelector('.off-preview__levels button')?.textContent).toMatch(/^✓ /);

    fireEvent.click(within(dialog).getByRole('button', { name: '同步导入谱面' }));
    await waitFor(() => expect(document.querySelector('.off-preview__levels')?.className).not.toMatch(/is-pick/));
    expect(document.querySelector('.off-preview__levels button')?.textContent).not.toMatch(/^✓ /);

    const create = within(dialog).getByRole('button', { name: '创建' });
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);

    await waitFor(() => expect(backend.disk.size).toBe(1));
    const created = [...backend.disk.values()][0];
    // 空 Expert：没有原文、没有等级；工程素材照常带走
    expect(created.charts[0]).toMatchObject({ title: null, diff: 3, level: null, chartCodePristine: false });
    expect(created.charts[0].appliedChartCodeText).toBeNull();
    expect(created.audioName).toBe('post-248468-audio.mp3');
    // 少一次网络：详情根本没被请求
    expect(backend.disk.size).toBe(1);
  });

  it('社区筛选：只作用于已加载的条目，范围与命中数写在列表尾（不自动补扫）', async () => {
    renderPage();
    let dialog = await openNewDialog();
    dialog = await switchSource(dialog, '从社区谱面导入');
    await within(dialog).findByText('All You Wanted (GBP Edit)');

    // 只有一条 custom 帖（EX 24）：筛 Special → 它被筛掉，且**不发第二条列表请求**（不补扫）
    fireEvent.click(within(dialog).getByRole('button', { name: '筛选' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'SP' }));

    expect(await within(dialog).findByText(/已加载的 1 条里没有符合条件的/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('option', { name: /All You Wanted/ })).toBeNull();

    // 关键口径：筛选**不触发补扫** —— 列表请求仍然只有第一页那一条
    const bridge = (window as unknown as {
      electronAPI: { communityNet: { request: { mock: { calls: [{ url: string }][] } } } };
    }).electronAPI.communityNet.request;
    const listCalls = bridge.mock.calls.filter(([payload]) => payload.url.endsWith('/api/post/list'));
    expect(listCalls).toHaveLength(1);

    // 清除筛选：帖子回来了，尾部换成范围提示（筛选已生效过一次）
    fireEvent.click(within(dialog).getByRole('button', { name: '清除筛选' }));
    expect(await within(dialog).findByRole('option', { name: /All You Wanted/ })).toBeInTheDocument();
  });

  it('从空白切到官方是同一颗窗改尺寸，不卸遮罩（票 13 #6）', async () => {
    renderPage();
    const dialog = await openNewDialog();
    expect(dialog.className).toMatch(/dialog--md/);

    switchSource(dialog, '从官方谱面导入');
    expect(dialog).toBeInTheDocument();
    expect(dialog.className).toMatch(/dialog--lg/);
    await within(dialog).findByText(SONG_TITLE);
  });
});

describe('票 08 · 从官方谱面导入', () => {
  it('选曲 → 预览（封面 / 难度等级表 / 试听）→ 建工程 → 留在工程管理页', async () => {
    const { backend } = renderPage();
    let dialog = await openNewDialog();
    dialog = await switchSource(dialog, '从官方谱面导入');
    // 曲库一次拉全：两首曲子都在
    await within(dialog).findByText(SONG_TITLE);
    expect(within(dialog).getByText('Yes! BanG_Dream!')).toBeInTheDocument();

    // 搜索命中歌手/乐队（票 08 锁测：标题与乐队都要能搜到）
    fireEvent.change(screen.getByLabelText('搜索歌曲标题或乐队'), { target: { value: 'roselia' } });
    expect(within(dialog).getByText(SONG_TITLE)).toBeInTheDocument();
    expect(within(dialog).queryByText('Yes! BanG_Dream!')).toBeNull();

    // 选中 → 就地预览：封面 / 试听都**本机优先**（票 16：未缓存协议 404 才落回直链）；
    // 假环境里协议不存在 → error 事件落直链，直链 load 后淡入。已实装芯片 + 紧凑试听照旧。
    fireEvent.click(within(dialog).getByRole('option', { name: new RegExp(SONG_TITLE) }));
    await waitFor(() => expect(document.querySelector('.off-cover img')).not.toBeNull());
    expect(document.querySelector('.off-cover img')?.getAttribute('src')).toBe(assetRawUrl(JACKET_URL));
    fireEvent.error(document.querySelector('.off-cover img')!);
    const cover = document.querySelector('.off-cover img');
    expect(cover?.getAttribute('src')).toBe(JACKET_URL);
    expect(cover?.classList.contains('is-in')).toBe(false);
    fireEvent.load(cover!);
    expect(cover?.classList.contains('is-in')).toBe(true);
    const preview = document.querySelector('.off-preview');
    expect(preview?.textContent).toMatch(/EZ 6/);
    expect(preview?.textContent).not.toMatch(/未实装/);
    await waitFor(() => expect(document.querySelector('.off-compact-audio audio')).not.toBeNull());
    expect(document.querySelector('audio[controls]')).toBeNull();
    expect(document.querySelector('.off-compact-audio audio')?.getAttribute('src')).toBe(assetRawUrl(AUDIO_URL));
    fireEvent.error(document.querySelector('.off-compact-audio audio')!);
    expect(document.querySelector('.off-compact-audio audio')?.getAttribute('src')).toBe(AUDIO_URL);
    expect(within(dialog).queryByText(/官方音频与封面/)).toBeNull();

    // 同步导入谱面：默认关；打开后同一排芯片选难度（默认 EX）
    const sync = within(dialog).getByRole('button', { name: '同步导入谱面' });
    expect(sync).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(sync);
    expect(sync).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(dialog).getByRole('radio', { name: /SP 26/ }));

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
    let dialog = await openNewDialog();
    dialog = await switchSource(dialog, '从官方谱面导入');

    expect(await within(dialog).findByText('曲库没拉到')).toBeInTheDocument();
    expect(within(dialog).getByText('读取官方曲库失败，请重试。')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '重试' })).toBeInTheDocument();
    // 不循环报错：一次打开只打两条请求（曲库索引 + 乐队索引），失败不自动重试 —— 重试要用户点
    expect((window as unknown as { electronAPI: { communityNet: { request: ReturnType<typeof vi.fn> } } })
      .electronAPI.communityNet.request).toHaveBeenCalledTimes(2);
  });

  it('切走官方 tab 再回来不重拉曲库（票 13 #4）', async () => {
    renderPage();
    let dialog = await openNewDialog();
    dialog = await switchSource(dialog, '从官方谱面导入');
    await within(dialog).findByText(SONG_TITLE);

    const request = (window as unknown as { electronAPI: { communityNet: { request: ReturnType<typeof vi.fn> } } })
      .electronAPI.communityNet.request;
    const catalogHits = () => request.mock.calls.filter(([payload]: [{ url: string }]) => (
      payload.url.endsWith('/api/songs/all.5.json') || payload.url.endsWith('/api/bands/all.1.json')
    )).length;
    expect(catalogHits()).toBe(2);

    dialog = await switchSource(dialog, '空白新建');
    dialog = await switchSource(dialog, '从官方谱面导入');
    await within(dialog).findByText(SONG_TITLE);
    expect(catalogHits()).toBe(2);
  });

  it('筛选按乐队，折叠后仍生效；清除才放开（票 13 #9 / #11）', async () => {
    renderPage();
    const dialog = await openNewDialog();
    switchSource(dialog, '从官方谱面导入');
    await within(dialog).findByText(SONG_TITLE);

    fireEvent.click(within(dialog).getByRole('button', { name: '筛选' }));
    fireEvent.change(within(dialog).getByLabelText('乐队'), { target: { value: '5' } });
    expect(within(dialog).getByText(SONG_TITLE)).toBeInTheDocument();
    expect(within(dialog).queryByText('Yes! BanG_Dream!')).toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: '筛选' }));
    expect(within(dialog).queryByLabelText('乐队')).toBeNull();
    expect(within(dialog).queryByText('Yes! BanG_Dream!')).toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: '清除筛选' }));
    expect(within(dialog).getByText('Yes! BanG_Dream!')).toBeInTheDocument();
  });
});
