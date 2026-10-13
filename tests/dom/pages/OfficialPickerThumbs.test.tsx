// @vitest-environment jsdom
// 票 15 + 17：选曲目录的行内封面缩略图（定案 B · 48px 圆角；票 17 改取图策略）。
//
// 锁的是**行内行为**，不是像素（尺寸 / 圆角 / 行高归原型对照与真机）：
//   - 惰性：没滚到的行既不发网关请求，也不挂 <img>（jsdom 没有 IntersectionObserver，测试里 stub 它）；
//   - 取图：本机缩略图优先（缓存命中零网络）→ 本机没有落回直链原图 → 都不成才降级成图标；
//   - 后台：行可见时经网关把封面收进缓存（票 17：这条路只负责填缓存，不挡显示）；
//   - 降级：没有封面名的曲子不请求网络、画音符图标；平台没这张图也画音符（不是「失败」）；
//   - 行结构不破：曲名 / 乐队 / 难度芯片还在原位。
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { AppNavProvider, type PageId } from '@/src/layouts/AppNav';
import ProjectsPage from '@/src/pages/projects/ProjectsPage';
import { ChartProjectStore } from '@/src/project/ChartProject';
import { clearSongCatalogCache } from '@/src/community/bestdori/songs';
import { ASSET_SCHEME, ASSET_THUMB_HOST } from '@/src/community/assetUrls';
import { installIntersectionObserverStub } from '@/tests/support/intersection';
import { makeMemoryProjectBackend, renderWithProviders } from '@/tests/support/providers';
import { seedZhSettings, SETTINGS_KEY } from '@/tests/support/storage';

const SONG_TITLE = 'BLACK SHOUT';
const SONG_ARTIST = 'Roselia';
/** 有封面名的曲子（song 29）与没有封面名的曲子（song 5） */
const JACKET_URL = 'https://bestdori.com/assets/jp/musicjacket/musicjacket30_rip/assets-star-forassetbundle-startapp-musicjacket-musicjacket30-blackshout-jacket.png';
const STAGED_COVER_PATH = '/data/cache/community/bbb-blackshout.png';
const NO_JACKET_TITLE = '夏空 SUN! SUN! SEVEN!';

const SONGS_INDEX = {
  '29': {
    tag: 'normal',
    bandId: 5,
    jacketImage: ['blackshout'],
    musicTitle: ['BLACK SHOUT', 'BLACK SHOUT', 'BLACK SHOUT', 'BLACK SHOUT', 'BLACK SHOUT'],
    publishedAt: ['1462071600000', '1462104000000', '1507003200000', '1462075200000', '1462071600000'],
    difficulty: { 3: { playLevel: 25 }, 4: { playLevel: 26 } },
  },
  '5': {
    tag: 'normal',
    bandId: 1,
    jacketImage: [],
    musicTitle: [NO_JACKET_TITLE, NO_JACKET_TITLE, NO_JACKET_TITLE, NO_JACKET_TITLE],
    // 票 31 排序用例：这首比 song 29 早发布，所以「发布时间降序」下 29 在前、id 升序下 5 在前
    publishedAt: ['1442071600000', '1442104000000', null, null],
    difficulty: { 3: { playLevel: 25 } },
  },
};
const BANDS_INDEX = {
  '5': { bandName: ['Roselia', 'Roselia', 'Roselia', 'Roselia', 'Roselia'] },
  '1': { bandName: ["Poppin'Party", "Poppin'Party", "Poppin'Party", "Poppin'Party"] },
};

type RequestPayload = { url: string; responseType?: string };

/** 假桥：json 回曲库索引，binary 回素材缓存路径（照 07 契约），失败形态可直接换成错误 */
function installFakeBridge(): ReturnType<typeof vi.fn> {
  const request = vi.fn(async (payload: RequestPayload) => {
    if (payload.responseType === 'binary') {
      return {
        ok: true,
        responseType: 'binary',
        status: 200,
        path: STAGED_COVER_PATH,
        byteLength: 98_575,
        contentType: 'image/png',
      };
    }
    if (payload.url.endsWith('/api/songs/all.5.json')) return { ok: true, responseType: 'json', status: 200, data: SONGS_INDEX };
    if (payload.url.endsWith('/api/bands/all.1.json')) return { ok: true, responseType: 'json', status: 200, data: BANDS_INDEX };
    return { ok: false, error: { kind: 'request-rejected', message: `未打桩: ${payload.url}` } };
  });
  (window as unknown as { electronAPI?: unknown }).electronAPI = { communityNet: { request } };
  return request;
}

const setActivePage = vi.fn();
const navValue = {
  activePage: 'projects' as PageId,
  setActivePage,
  pageScope: null,
  navCollapsed: true,
  setNavCollapsed: () => {},
};

function renderPage() {
  return renderWithProviders(
    <ConfigProvider>
      <AppNavProvider value={navValue}><ProjectsPage /></AppNavProvider>
    </ConfigProvider>,
    { store: new ChartProjectStore(makeMemoryProjectBackend([])) },
  );
}

/** 打开新建弹窗 → 切到「从官方谱面导入」→ 等曲库列表出来 */
async function openOfficialTab() {
  renderPage();
  await screen.findByText('全部工程');
  fireEvent.click(screen.getByRole('button', { name: /空白新建/ }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: /从官方谱面导入/ }));
  await within(dialog).findByText(SONG_TITLE);
  return dialog;
}

/** 请求里所有 binary（= 收封面进缓存）的 URL */
function binaryUrls(request: ReturnType<typeof vi.fn>): string[] {
  return request.mock.calls
    .map(([payload]: [RequestPayload]) => payload)
    .filter((payload) => payload.responseType === 'binary')
    .map((payload) => payload.url);
}

/** 本机缩略图的 URL（行的第一优先） */
function localThumbUrl(): string {
  return `${ASSET_SCHEME}://${ASSET_THUMB_HOST}/?url=${encodeURIComponent(JACKET_URL)}`;
}

/** 列表**行**的 id 小字，按 DOM 顺序（只取 .off-list 里的行 —— 下拉的 <option> 也是 role=option） */
function rowIds(dialog: HTMLElement): (string | null | undefined)[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>('.off-list [role="option"]'))
    .map((row) => row.querySelector('.off-row__id')?.textContent);
}

let request: ReturnType<typeof vi.fn>;
let io: ReturnType<typeof installIntersectionObserverStub>;

beforeEach(() => {
  seedZhSettings();
  setActivePage.mockClear();
  io = installIntersectionObserverStub();
  request = installFakeBridge();
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  io.restore();
  clearSongCatalogCache();
});

describe('票 15 + 17 · 选曲目录的行内缩略图', () => {
  it('没滚到的行不取图（既不请求网关，也不挂 img）；滚到才收缓存 + 出图', async () => {
    const dialog = await openOfficialTab();
    const row = within(dialog).getByRole('option', { name: new RegExp(SONG_TITLE) });

    // 一屏都没滚到：既不发封面请求，也不挂 <img>
    expect(binaryUrls(request)).toEqual([]);
    expect(row.querySelector('img')).toBeNull();

    await io.scrollIntoView();

    // 显示走本机（缓存命中就零网络）；同时后台经网关把封面收进缓存
    await waitFor(() => expect(row.querySelector('img')).not.toBeNull());
    expect(row.querySelector('img')!.getAttribute('src')).toBe(localThumbUrl());
    await waitFor(() => expect(binaryUrls(request)).toEqual([JACKET_URL]));

    // 没有封面名的曲子（合作曲那类）不请求网络，直接画图标
    const noJacketRow = within(dialog).getByRole('option', { name: new RegExp(NO_JACKET_TITLE) });
    expect(noJacketRow.querySelector('img')).toBeNull();
    expect(noJacketRow.querySelector('svg')).not.toBeNull();
  });

  it('本机没有 → 落回直链原图；直链也失败才降级成图标（票 17）', async () => {
    const dialog = await openOfficialTab();
    const row = within(dialog).getByRole('option', { name: new RegExp(SONG_TITLE) });

    await io.scrollIntoView();
    await waitFor(() => expect(row.querySelector('img')).not.toBeNull());
    const img = row.querySelector('img')!;

    // 本机缩略图没取到（协议 404）→ 换直链，不是断图
    fireEvent.error(img);
    expect(row.querySelector('img')!.getAttribute('src')).toBe(JACKET_URL);
    expect(row.querySelector('img')!.classList.contains('is-in')).toBe(false);

    // 直链回来了 → 淡入
    fireEvent.load(row.querySelector('img')!);
    expect(row.querySelector('img')!.classList.contains('is-in')).toBe(true);

    // 直链也失败 → 断图图标
    fireEvent.error(row.querySelector('img')!);
    expect(row.querySelector('img')).toBeNull();
    expect(row.querySelector('svg')).not.toBeNull();
  });

  it('缩略图占位不挡住选中：点行照样选中，行结构（曲名 / 乐队 / 芯片）不破', async () => {
    const dialog = await openOfficialTab();
    const row = within(dialog).getByRole('option', { name: new RegExp(SONG_TITLE) });

    expect(row.textContent).toContain(SONG_TITLE);
    expect(row.textContent).toContain(SONG_ARTIST);
    expect(row.textContent).toMatch(/EX 25/);

    fireEvent.click(row);
    await waitFor(() => expect(row.getAttribute('aria-selected')).toBe('true'));
    // 选中落到预览区（曲名与列表行同名，所以看预览区那个节点）
    await waitFor(() => expect(document.querySelector('.off-preview__title')?.textContent).toBe(SONG_TITLE));
  });

  it('平台没有这张图（回退页）：不挂图，画音符图标（不是「失败」）', async () => {
    request.mockImplementation(async (payload: RequestPayload) => {
      if (payload.responseType === 'binary') {
        return {
          ok: true,
          responseType: 'binary',
          status: 200,
          path: '/data/cache/community/bbb-fallback.html',
          byteLength: 14_000,
          contentType: 'text/html',
        };
      }
      if (payload.url.endsWith('/api/songs/all.5.json')) return { ok: true, responseType: 'json', status: 200, data: SONGS_INDEX };
      return { ok: true, responseType: 'json', status: 200, data: BANDS_INDEX };
    });
    const dialog = await openOfficialTab();
    const row = within(dialog).getByRole('option', { name: new RegExp(SONG_TITLE) });

    await io.scrollIntoView();

    await waitFor(() => expect(row.querySelector('img')).toBeNull());
    const thumb = row.querySelector('.off-row__thumb');
    expect(thumb?.classList.contains('is-empty')).toBe(true);
    expect(row.querySelector('svg')).not.toBeNull();
  });

  it('后台收缓存失败（取不到）不影响显示：行照旧走直链那条路', async () => {
    // 用不可退避的 kind（仓里惯例）：退避重试本身由 rateLimit 那族锁，这里要快 ——
    // 也让这条失败在测试结束前就落地，不把在途 promise 漏给下一条用例
    request.mockImplementation(async (payload: RequestPayload) => {
      if (payload.responseType === 'binary') {
        return { ok: false, error: { kind: 'invalid-response', message: '回退页' } };
      }
      if (payload.url.endsWith('/api/songs/all.5.json')) return { ok: true, responseType: 'json', status: 200, data: SONGS_INDEX };
      return { ok: true, responseType: 'json', status: 200, data: BANDS_INDEX };
    });
    const dialog = await openOfficialTab();
    const row = within(dialog).getByRole('option', { name: new RegExp(SONG_TITLE) });

    await io.scrollIntoView();

    // 本机没有（协议 404）→ 落直链；取数失败不把行推进「断图」态
    await waitFor(() => expect(row.querySelector('img')).not.toBeNull());
    fireEvent.error(row.querySelector('img')!);
    expect(row.querySelector('img')!.getAttribute('src')).toBe(JACKET_URL);
    await waitFor(() => expect(row.querySelector('svg')).toBeNull());
  });

  it('没有 IntersectionObserver 的环境直出（宁可多取一张，不留空框）', async () => {
    io.restore();
    const dialog = await openOfficialTab();
    const row = within(dialog).getByRole('option', { name: new RegExp(SONG_TITLE) });

    await waitFor(() => expect(row.querySelector('img')).not.toBeNull(), { timeout: 3000 });
    await waitFor(() => expect(binaryUrls(request)).toEqual([JACKET_URL]), { timeout: 3000 });
  });
});

describe('票 31 + 33 · 排序控件与曲库 ID', () => {
  it('票 33：曲库 id 只放列表行（预览栏不再重复一遍）', async () => {
    const dialog = await openOfficialTab();
    const row = within(dialog).getByRole('option', { name: new RegExp(SONG_TITLE) });

    expect(row.querySelector('.off-row__id')?.textContent).toBe('#29');

    fireEvent.click(row);
    await waitFor(() => expect(document.querySelector('.off-preview__title')?.textContent).toBe(SONG_TITLE));
    // 验收回修：预览栏那行 ID 撤了（列表就在左边，重复）
    expect(document.querySelector('.off-preview__id')).toBeNull();
    expect(document.querySelector('.off-preview')?.textContent).not.toContain('曲库 ID');
  });

  it('票 31：默认发布时间降序；换键 / 换方向都改列表顺序，pill 上写着当前状态', async () => {
    const dialog = await openOfficialTab();
    // song 29 的日服发布时间比 song 5 晚 → 最新在前
    expect(rowIds(dialog)).toEqual(['#29', '#5']);
    const pill = within(dialog).getByRole('button', { name: /排序：发布时间 降序/ });

    fireEvent.click(pill);
    // 四把键 + 升 / 降序都在
    for (const name of ['发布时间', '曲库 ID', '曲名', '乐队', '升序', '降序']) {
      expect(within(dialog).getByRole('button', { name })).toBeInTheDocument();
    }

    // 换键 = 采用该键的自然方向（曲库 ID 升序 → 5 在前）
    fireEvent.click(within(dialog).getByRole('button', { name: '曲库 ID' }));
    expect(rowIds(dialog)).toEqual(['#5', '#29']);
    expect(within(dialog).getByRole('button', { name: /排序：曲库 ID 升序/ })).toBeInTheDocument();

    // 同一把键换方向：降序 → 29 在前
    fireEvent.click(within(dialog).getByRole('button', { name: '降序' }));
    expect(rowIds(dialog)).toEqual(['#29', '#5']);
    expect(within(dialog).getByRole('button', { name: /排序：曲库 ID 降序/ })).toBeInTheDocument();

    // 升序 chip 是「已选中」态，降序不是（aria-pressed 给读屏与测试同一个事实）
    expect(within(dialog).getByRole('button', { name: '升序' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(dialog).getByRole('button', { name: '降序' })).toHaveAttribute('aria-pressed', 'true');

    // 落 settings（票 31 验收回修：排序的设置要保存）—— 面板里改一次就写回 localStorage
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    expect(saved.projects.songSort).toEqual({ key: 'id', dir: 'desc' });
  });

  it('票 31：面板开门就用上次存的键与方向（跨会话记住）', async () => {
    // 故意选一个与默认（发布时间降序 → 29 在前）**顺序不同**的档：id 升序 → 5 在前
    seedZhSettings({ projects: { songSort: { key: 'id', dir: 'asc' } } });

    const dialog = await openOfficialTab();

    expect(within(dialog).getByRole('button', { name: /排序：曲库 ID 升序/ })).toBeInTheDocument();
    expect(rowIds(dialog)).toEqual(['#5', '#29']);
  });

  it('票 31：筛选与排序两排芯片互斥（同一块地方，一起开会叠成两段）', async () => {
    const dialog = await openOfficialTab();

    fireEvent.click(within(dialog).getByRole('button', { name: /^排序/ }));
    expect(within(dialog).getByRole('button', { name: '曲名' })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: '筛选' }));
    expect(within(dialog).queryByRole('button', { name: '曲名' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'SP' })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /^排序/ }));
    expect(within(dialog).queryByRole('button', { name: 'SP' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: '曲名' })).toBeInTheDocument();
  });

  it('票 33：纯数字查询按曲库 id 命中（本地过滤，零额外网络）', async () => {
    const dialog = await openOfficialTab();
    const search = within(dialog).getByPlaceholderText('搜索曲名、乐队或曲库 ID');
    const jsonCallsBefore = request.mock.calls.length;

    fireEvent.change(search, { target: { value: '5' } });

    expect(rowIds(dialog)).toEqual(['#5']);
    expect(request.mock.calls.length).toBe(jsonCallsBefore);
  });
});
