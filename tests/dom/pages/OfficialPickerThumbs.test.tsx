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
import { seedZhSettings } from '@/tests/support/storage';

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
    publishedAt: ['1462071600000', '1462104000000', null, null],
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
