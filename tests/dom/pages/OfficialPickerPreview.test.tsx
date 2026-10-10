// @vitest-environment jsdom
// 票 16：选曲面板预览区的素材复用 —— 封面大图与试听音频**本机优先、直链降级**。
//
// 锁的是预览这条通道（目录行缩略图归 OfficialPickerThumbs 那族）：
//   - 封面：先读本机（`aao-asset://raw/`，缓存命中零网络）→ 未缓存协议 404 落回直链 →
//     直链也失败才降级成图标（体感与 16 之前一致）；
//   - 音频：先读本机（导入过的歌才有缓存；协议含 Range，拖进度条不重下）→ 未命中落回直链；
//   - 选中即经网关把封面收进缓存（Q2：导入零下载的保险；行可见时 15/17 已收过，这里兜底去重）。
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { AppNavProvider, type PageId } from '@/src/layouts/AppNav';
import ProjectsPage from '@/src/pages/projects/ProjectsPage';
import { ChartProjectStore } from '@/src/project/ChartProject';
import { clearSongCatalogCache } from '@/src/community/bestdori/songs';
import { assetRawUrl } from '@/src/community/assetUrls';
import { installIntersectionObserverStub } from '@/tests/support/intersection';
import { makeMemoryProjectBackend, renderWithProviders } from '@/tests/support/providers';
import { seedZhSettings } from '@/tests/support/storage';

const SONG_TITLE = 'BLACK SHOUT';
/** 票 20：另一首（song 30），用来对照「换歌」与「重复点同一行」 */
const OTHER_SONG_TITLE = 'LOUDER';
/** 有封面名的曲子（song 29；封面直链与 OfficialPickerThumbs 同一首） */
const JACKET_URL = 'https://bestdori.com/assets/jp/musicjacket/musicjacket30_rip/assets-star-forassetbundle-startapp-musicjacket-musicjacket30-blackshout-jacket.png';
/** 试听音频直链（song 29 · bgm029） */
const AUDIO_URL = 'https://bestdori.com/assets/jp/sound/bgm029_rip/bgm029.mp3';
const STAGED_COVER_PATH = '/data/cache/community/bbb-blackshout.png';

const SONGS_INDEX = {
  '29': {
    tag: 'normal',
    bandId: 5,
    jacketImage: ['blackshout'],
    musicTitle: ['BLACK SHOUT', 'BLACK SHOUT', 'BLACK SHOUT', 'BLACK SHOUT', 'BLACK SHOUT'],
    publishedAt: ['1462071600000', '1462104000000', '1507003200000', '1462075200000', '1462071600000'],
    difficulty: { 3: { playLevel: 25 }, 4: { playLevel: 26 } },
  },
  // 票 20：换歌那一档要照旧重置（与「重复点同一行」对照）
  '30': {
    tag: 'normal',
    bandId: 5,
    jacketImage: ['louder'],
    musicTitle: ['LOUDER', 'LOUDER', 'LOUDER', 'LOUDER', 'LOUDER'],
    publishedAt: ['1462071600000', '1462104000000', '1507003200000', '1462075200000', '1462071600000'],
    difficulty: { 3: { playLevel: 27 } },
  },
};
const BANDS_INDEX = {
  '5': { bandName: ['Roselia', 'Roselia', 'Roselia', 'Roselia', 'Roselia'] },
};
const SONG_DETAIL = { bgmId: 'bgm029', length: 120 };

type RequestPayload = { url: string; responseType?: string };

/** 票 21 验收回修：把单曲详情卡在闸门后，好观察「detail 未到位」那一帧 */
let releaseDetail: (() => void) | null = null;

/** 假桥：json 回曲库 / 单曲详情，binary 回素材缓存路径（照 07 契约） */
function installFakeBridge(opts: { holdDetail?: boolean } = {}): ReturnType<typeof vi.fn> {
  const gate = opts.holdDetail ? new Promise<void>((resolve) => { releaseDetail = resolve; }) : null;
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
    if (payload.url.endsWith('/api/songs/29.json')) {
      if (gate) await gate;
      return { ok: true, responseType: 'json', status: 200, data: SONG_DETAIL };
    }
    if (payload.url.endsWith('/api/songs/30.json')) return { ok: true, responseType: 'json', status: 200, data: { bgmId: 'bgm030', length: 100 } };
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

/** 只开到「从官方谱面导入」这一档，不选中任何曲子（票 21 的收起态） */
async function openOfficialTab() {
  renderPage();
  await screen.findByText('全部工程');
  fireEvent.click(screen.getByRole('button', { name: /空白新建/ }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: /从官方谱面导入/ }));
  await within(dialog).findByRole('option', { name: new RegExp(SONG_TITLE) });
  return { dialog };
}

/** 打开「从官方谱面导入」→ 选中 song 29 → 预览区出现（不滚列表：行取图不掺和这条降级链） */
async function openPreview() {
  const { dialog } = await openOfficialTab();
  const row = await within(dialog).findByRole('option', { name: new RegExp(SONG_TITLE) });
  fireEvent.click(row);
  // 曲名与列表行同名：认预览区标题那个节点（ OfficialPickerThumbs 同款做法）
  await waitFor(() => expect(dialog.querySelector('.off-preview__title')?.textContent).toBe(SONG_TITLE));
  const preview = dialog.querySelector('.off-preview');
  if (!(preview instanceof HTMLElement)) throw new Error('预览区没渲染');
  return { dialog, preview };
}

/** 请求里所有 binary（= 收封面进缓存）的 URL */
function binaryUrls(request: ReturnType<typeof vi.fn>): string[] {
  return (request.mock.calls as RequestPayload[][])
    .map((call) => call[0])
    .filter((payload) => payload.responseType === 'binary')
    .map((payload) => payload.url);
}

let request: ReturnType<typeof vi.fn>;
let io: ReturnType<typeof installIntersectionObserverStub>;

beforeEach(() => {
  seedZhSettings();
  setActivePage.mockClear();
  releaseDetail = null;
  io = installIntersectionObserverStub();
  request = installFakeBridge();
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  io.restore();
  clearSongCatalogCache();
});

describe('票 16 · 预览区的素材复用（本机优先、直链降级）', () => {
  it('封面先读本机大图；未缓存（协议 404）落回直链；直链也失败才降级成图标', async () => {
    const { preview } = await openPreview();

    // 第一落点：本机原始字节（raw 支），不是直链
    await waitFor(() => expect(preview.querySelector('.off-cover img')).not.toBeNull());
    expect(preview.querySelector('.off-cover img')!.getAttribute('src')).toBe(assetRawUrl(JACKET_URL));

    // 本机没有（未缓存）→ 直链；直链也失败 → 图标（与 16 之前的终态一致）
    fireEvent.error(preview.querySelector('.off-cover img')!);
    expect(preview.querySelector('.off-cover img')!.getAttribute('src')).toBe(JACKET_URL);
    fireEvent.error(preview.querySelector('.off-cover img')!);
    expect(preview.querySelector('.off-cover img')).toBeNull();
    expect(preview.querySelector('.off-cover svg')).not.toBeNull();
  });

  it('试听先读本机（导入过的歌才有缓存）；未命中落回直链', async () => {
    const { preview } = await openPreview();

    // 详情到位后 CompactAudio 出现，第一落点是本机音频
    await waitFor(() => expect(preview.querySelector('audio')).not.toBeNull());
    expect(preview.querySelector('audio')!.getAttribute('src')).toBe(assetRawUrl(AUDIO_URL));

    // 本机没有（这歌没导入过）→ 直链边下边播
    fireEvent.error(preview.querySelector('audio')!);
    expect(preview.querySelector('audio')!.getAttribute('src')).toBe(AUDIO_URL);
  });

  it('选中即经网关把封面收进缓存（Q2：这次导入就零下载；行没滚到也兜底）', async () => {
    await openPreview();

    // 行没滚到、行的后台取图没跑：这一枪来自「选中」本身
    await waitFor(() => expect(binaryUrls(request)).toEqual([JACKET_URL]));
  });
});

describe('票 20 · 重复点击已选曲目不该清空预览', () => {
  it('收起再展开同一首：内容不重建 —— 详情不重取、封面不重载', async () => {
    const { dialog, preview } = await openPreview();

    // jsdom 不会自己发 load：先手动把封面点亮（真机上就是那次 onLoad）
    await waitFor(() => expect(preview.querySelector('.off-cover img')).not.toBeNull());
    const img = preview.querySelector('.off-cover img')!;
    fireEvent.load(img);
    await waitFor(() => expect(img.classList.contains('is-in')).toBe(true));
    const detailUrls = () => (request.mock.calls as RequestPayload[][])
      .map((call) => call[0].url)
      .filter((url) => url.includes('/api/songs/29.json'));
    const row = () => within(dialog).getByRole('option', { name: new RegExp(SONG_TITLE) });

    // 票 20 的病根是「src 不变 → 不会再有 onLoad → 半截封面永久停在 opacity:0」。
    // 收起现在只关窗、不清内容，所以那种半截状态压根不会被制造出来。
    fireEvent.click(row());
    await waitFor(() => expect(dialog.querySelector('.off-split')?.classList.contains('is-collapsed')).toBe(true));
    fireEvent.click(row());
    await waitFor(() => expect(dialog.querySelector('.off-split')?.classList.contains('is-collapsed')).toBe(false));

    expect(detailUrls()).toHaveLength(1); // 详情只取过一次
    expect(dialog.querySelector('.off-cover img')).toBe(img); // 同一个元素，没被重建
    expect(img.classList.contains('is-in')).toBe(true); // 封面没被打回 opacity: 0
  });

  it('换一首歌照旧重置封面（不把换歌路径一起短路）', async () => {
    const { dialog, preview } = await openPreview();

    await waitFor(() => expect(preview.querySelector('.off-cover img')).not.toBeNull());
    const img = preview.querySelector('.off-cover img')!;
    fireEvent.load(img);
    await waitFor(() => expect(img.classList.contains('is-in')).toBe(true));
    const srcBefore = img.getAttribute('src');

    fireEvent.click(within(dialog).getByRole('option', { name: new RegExp(OTHER_SONG_TITLE) }));

    await waitFor(() => expect(preview.querySelector('.off-preview__title')?.textContent).toBe(OTHER_SONG_TITLE));
    const after = preview.querySelector('.off-cover img');
    expect(after).not.toBeNull();
    expect(after!.getAttribute('src')).not.toBe(srcBefore);
    // 新歌的封面要重新淡入
    expect(after!.classList.contains('is-in')).toBe(false);
  });
});

describe('票 21 · 预览栏手风琴折叠', () => {
  it('没选曲时预览区收起：预览栏不出内容，列表独占一列', async () => {
    const { dialog } = await openOfficialTab();

    expect(dialog.querySelector('.off-preview__title')).toBeNull();
    expect(dialog.querySelector('.off-preview')?.classList.contains('is-collapsed')).toBe(true);
    expect(dialog.querySelector('.off-split')?.classList.contains('is-collapsed')).toBe(true);
    // 收起即取消选中 → 底部「创建」不可用
    expect(within(dialog).getByRole('button', { name: '创建' })).toBeDisabled();
  });

  it('选中一首 → 展开；再点同一首 → 收起并取消选中', async () => {
    const { dialog } = await openOfficialTab();
    const row = () => within(dialog).getByRole('option', { name: new RegExp(SONG_TITLE) });

    fireEvent.click(row());
    await waitFor(() => expect(dialog.querySelector('.off-preview__title')?.textContent).toBe(SONG_TITLE));
    expect(dialog.querySelector('.off-split')?.classList.contains('is-collapsed')).toBe(false);
    expect(row().getAttribute('aria-selected')).toBe('true');
    // 上抛给弹窗的 selection 要等详情到位（票 08 契约）：`.off-sync` 的 disabled 就是这条路标
    await waitFor(() => expect(dialog.querySelector('.off-sync')).not.toBeDisabled());
    expect(within(dialog).getByRole('button', { name: '创建' })).toBeEnabled();

    // 再点一次 = 收起（= 取消选中）。收起只关窗、不清内容：内容留着，收起动画才有东西可滑
    fireEvent.click(row());
    await waitFor(() => expect(dialog.querySelector('.off-split')?.classList.contains('is-collapsed')).toBe(true));
    expect(dialog.querySelector('.off-preview')?.classList.contains('is-collapsed')).toBe(true);
    expect(row().getAttribute('aria-selected')).toBe('false');
    expect(within(dialog).getByRole('button', { name: '创建' })).toBeDisabled();
  });

  it('收起后预览栏 aria-hidden 且试听掐掉 src（内容留着，但不再出声）', async () => {
    const { dialog } = await openOfficialTab();
    const row = () => within(dialog).getByRole('option', { name: new RegExp(SONG_TITLE) });

    fireEvent.click(row());
    await waitFor(() => expect(dialog.querySelector('.off-compact-audio audio')).not.toBeNull());

    fireEvent.click(row());
    await waitFor(() => expect(dialog.querySelector('.off-split')?.classList.contains('is-collapsed')).toBe(true));
    expect(dialog.querySelector('.off-preview')?.getAttribute('aria-hidden')).toBe('true');
    // src 掐掉 → `<audio>` 元素卸载 → 试听立刻停
    expect(dialog.querySelector('.off-compact-audio audio')).toBeNull();

    fireEvent.click(row());
    await waitFor(() => expect(dialog.querySelector('.off-compact-audio audio')).not.toBeNull());
    expect(dialog.querySelector('.off-preview')?.getAttribute('aria-hidden')).toBe('false');
  });

  it('detail 未到位：试听条是等高骨架、同步开关是加载态；到位后原地替换', async () => {
    request = installFakeBridge({ holdDetail: true });
    const { dialog } = await openOfficialTab();
    const row = () => within(dialog).getByRole('option', { name: new RegExp(SONG_TITLE) });

    fireEvent.click(row());
    await waitFor(() => expect(dialog.querySelector('.off-preview__title')?.textContent).toBe(SONG_TITLE));

    // 不依赖 detail 的几块先出来（封面 / 标题 / 歌手 / 难度 chip）
    expect(dialog.querySelector('.off-cover')).not.toBeNull();
    expect(dialog.querySelector('.off-preview__levels')?.children).toHaveLength(2);
    // 依赖 detail 的两块：骨架在位，真试听条还没挂载
    expect(dialog.querySelector('.off-compact-audio.is-skeleton')).not.toBeNull();
    expect(dialog.querySelector('.off-compact-audio audio')).toBeNull();
    expect(dialog.querySelector('.off-sync')?.classList.contains('is-loading')).toBe(true);
    expect(dialog.querySelector('.off-sync')).toBeDisabled();

    releaseDetail?.();
    // 原地替换：还是那一块 `.off-compact-audio`（32px 定高），只是骨架撤掉、真控件挂上
    await waitFor(() => expect(dialog.querySelector('.off-compact-audio audio')).not.toBeNull());
    expect(dialog.querySelector('.off-compact-audio.is-skeleton')).toBeNull();
    expect(dialog.querySelector('.off-sync')?.classList.contains('is-loading')).toBe(false);
    expect(dialog.querySelector('.off-sync')).toBeEnabled();
  });
});
