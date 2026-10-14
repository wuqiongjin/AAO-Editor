// @vitest-environment jsdom
// 票 39 锁测 1：账号区与登录弹窗（详情视图左栏底部那一块）。
//
// 假出口照 tests/support/communityTransport.ts 的口径：不打网络、不 mock 模块 —— 这里把
// **preload 那三条桥**（communityNet / communitySession / shell）装进 `window.electronAPI`，
// 于是整条链（UI → account.ts → electronTransport → 桥）跑的都是真代码，只有最外那一跳是替身。
//
// 锁的是什么（票内「锁测」第 1 条逐项）：
//   ① 落点：只有详情视图有账号区（启动台没有 —— Q13 / Q24）；没有出口时整块不渲染（Q11）；
//   ② 已登录只显示一个名字（Q30），账号名只在菜单信息头（Q10）；登出只清本机（票 10 的口径）；
//   ③ `user/me` 401 → 就地转「登录状态已失效」（Q17），不弹窗、读能力照留；
//   ④ 登录弹窗六条：不预检（Q33）、提交中禁用、失败内联不 Toast、关掉即忘、六档文案、眼睛（Q38）；
//   ⑤ 账号生命周期入口（注册 / 忘记密码）常驻底栏、都指站点首页、点击走系统浏览器（Q42 / Q45 / Q47）。
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { AppNavProvider, type AppNavValue } from '@/src/layouts/AppNav';
import ProjectsPage from '@/src/pages/projects/ProjectsPage';
import { resetCommunityAccount } from '@/src/community/bestdori/account';
import { siteHomeUrl, userLoginUrl, userMeUrl } from '@/src/community/bestdori/endpoints';
import { openCommunitySite } from '@/src/community/externalLink';
import type { CommunityRequest, CommunityWireResult } from '@/src/community/transport';
import { ChartProjectStore, type ChartProject, type ProjectChart } from '@/src/project/ChartProject';
import { makeMemoryProjectBackend, renderWithProviders } from '@/tests/support/providers';
import { seedZhSettings } from '@/tests/support/storage';

const AT = 1_700_000_000_000;
const LOGIN_URL = userLoginUrl();
const ME_URL = userMeUrl();

function chart(id: string): ProjectChart {
  return {
    id,
    notes: [{ beat: 0, type: 'BPM', bpm: 120 }],
    title: null,
    diff: 3,
    level: null,
    completed: false,
    upload: null,
    lastModified: AT,
    appliedChartCodeText: null,
    chartCodePristine: false,
  };
}

function project(id: string, name: string): ChartProject {
  return {
    id,
    name,
    artist: 'AYA',
    source: { type: 'custom' },
    durationSeconds: 30,
    lastOpened: AT,
    charts: [chart(`c-${id}`)],
    audioName: null,
    coverName: null,
  };
}

const PROJECTS = [project('p1', '甲工程'), project('p2', '乙工程')];

/* ---------------- 假桥 ---------------- */

const okJson = (data: unknown): CommunityWireResult => ({ ok: true, responseType: 'json', status: 200, data });
const wireError = (kind: string, platformCode?: string): CommunityWireResult => ({
  ok: false,
  error: { kind: kind as never, message: `fake ${kind}`, platformCode },
});

const ME_OK = okJson({ result: true, username: 'envy09', nickname: 'Envy' });
const LOGIN_OK = okJson({ result: true });

interface FakeBridges {
  requests: CommunityRequest[];
  openExternal: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  persist: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  releaseLogin(): void;
}

function installBridges(init: {
  restored?: boolean;
  persisted?: boolean;
  me?: CommunityWireResult;
  login?: CommunityWireResult | 'pending';
} = {}): FakeBridges {
  const requests: CommunityRequest[] = [];
  const loginResult: CommunityWireResult | 'pending' = init.login ?? LOGIN_OK;
  let release: (() => void) | null = null;

  const openExternal = vi.fn(async () => true);
  const restore = vi.fn(async () => ({ restored: init.restored === true }));
  const persist = vi.fn(async () => ({ persisted: init.persisted !== false }));
  const clear = vi.fn(async () => true);

  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    communitySession: { restore, persist, clear },
    shell: { openExternal },
    communityNet: {
      request: async (req: CommunityRequest): Promise<CommunityWireResult> => {
        requests.push(req);
        if (req.url === LOGIN_URL) {
          if (loginResult === 'pending') {
            // 提交中那一帧：把响应扣在手里，等用例放行
            return new Promise<CommunityWireResult>((resolve) => { release = () => resolve(LOGIN_OK); });
          }
          return loginResult;
        }
        if (req.url === ME_URL) return init.me ?? ME_OK;
        throw new Error(`未打桩的请求: ${req.url}`);
      },
    },
  };

  return { requests, openExternal, restore, persist, clear, releaseLogin: () => release?.() };
}

/* ---------------- 渲染 ---------------- */

const setActivePage = vi.fn();

function renderPage() {
  const nav: AppNavValue = {
    activePage: 'projects',
    setActivePage: setActivePage as unknown as AppNavValue['setActivePage'],
    pageScope: null,
    navCollapsed: true,
    setNavCollapsed: () => {},
  };
  return renderWithProviders(
    <ConfigProvider>
      <AppNavProvider value={nav}><ProjectsPage /></AppNavProvider>
    </ConfigProvider>,
    { store: new ChartProjectStore(makeMemoryProjectBackend(PROJECTS)) },
  );
}

/** 进工程详情视图（账号区只在那儿）。节点会随会话态换新，所以每处都现取（见 `row()`）。 */
async function enterDetail() {
  renderPage();
  await screen.findByText('全部工程');
  const grid = document.querySelector('.pb-grid') as HTMLElement;
  fireEvent.click(within(grid).getByText('甲工程'));
  await waitFor(() => expect(document.querySelector('.pc-account')).not.toBeNull());
}

const row = () => document.querySelector('.pc-account__row') as HTMLElement;

/** 打开登录弹窗（未登录 / 已失效那一行的唯一动作） */
async function openSignIn() {
  await enterDetail();
  fireEvent.click(row());
  return await screen.findByRole('dialog');
}

/** 填表并提交（点底栏那枚提交键 —— 它经 `form` 关联进弹窗里的 `<form>`） */
function submitCredentials(dialog: HTMLElement, username = 'envy09', secret = 'hunter2') {
  fireEvent.change(within(dialog).getByLabelText('账号'), { target: { value: username } });
  fireEvent.change(within(dialog).getByLabelText('密码'), { target: { value: secret } });
  fireEvent.click(within(dialog).getByRole('button', { name: '登录' }));
}

beforeEach(() => {
  seedZhSettings();
  setActivePage.mockClear();
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  // 会话是模块级单例（唯一真相）：跨用例必须丢掉，否则下一个用例读到上一份会话
  resetCommunityAccount();
  vi.restoreAllMocks();
});

describe('票 39 · 账号区落在哪儿（Q13 / Q24 / Q11）', () => {
  it('详情视图：未登录 → 账号行写「登录」，点它开登录弹窗', async () => {
    installBridges();
    resetCommunityAccount();

    await enterDetail();
    expect(row()).toHaveTextContent(/^登录$/);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(row());
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('启动台视图：账号区整块不存在（0 工程时登录不可达是已接受的后果）', async () => {
    installBridges();
    resetCommunityAccount();

    renderPage();
    await screen.findByText('全部工程');

    expect(document.querySelector('.pc-account')).toBeNull();
  });

  it('没有社区出口（静态演示版）→ 账号区整块不渲染（Q11）', async () => {
    resetCommunityAccount();
    renderPage();
    await screen.findByText('全部工程');
    const grid = document.querySelector('.pb-grid') as HTMLElement;
    fireEvent.click(within(grid).getByText('甲工程'));

    await screen.findByText('上传记录');
    expect(document.querySelector('.pc-account')).toBeNull();
  });
});

describe('票 39 · 已登录那一态（Q10 / Q30 / Q31 / Q37）', () => {
  it('栏上只显示昵称；账号名只在菜单信息头；次要动作靠渐进披露', async () => {
    installBridges({ restored: true });
    resetCommunityAccount();

    await enterDetail();
    await waitFor(() => expect(row()).toHaveTextContent('Envy'));

    // 一个名字：账号名与邮箱都不在栏上（Q10 / Q30）
    expect(row()).not.toHaveTextContent('envy09');
    expect(row().querySelectorAll('.pc-account__text > *')).toHaveLength(1);
    // 静止时不常驻任何动作（Q37）：没有「退出登录」、也没有 caret
    expect(row()).not.toHaveTextContent('退出登录');

    fireEvent.click(row());
    const panel = document.querySelector('.pp-menu__panel') as HTMLElement;
    expect(panel).toHaveTextContent('账号：envy09');
    expect(within(panel).getByRole('button', { name: /退出登录/ })).toBeInTheDocument();
    // 贴左缘（用户 2026-10-14 回修）：右对齐会让收缩宽度的面板朝左长出去压住导航条
    expect(panel.style.left).not.toBe('');
    expect(panel.style.right).toBe('');
    // 信息头是展示不是动作：点昵称 / 账号名不该把菜单收掉（面板对"点任意处"一律关闭是
    // 给"面板里全是动作项"的菜单定的规矩，在这儿是误伤）
    fireEvent.click(within(panel).getByText('账号：envy09'));
    fireEvent.click(within(panel).getByText('Envy'));
    expect(document.querySelector('.pp-menu__panel')).toBeInTheDocument();
    // 这次是恢复来的会话（本机记住了）⇒ 没有「记不住」那句
    expect(panel).not.toHaveTextContent('本机无法安全保存登录状态');
  });

  it('昵称没填时退到账号名，且**没有第二行**（Q30）', async () => {
    installBridges({ restored: true, me: okJson({ result: true, username: 'envy09' }) });
    resetCommunityAccount();

    await enterDetail();
    await waitFor(() => expect(row()).toHaveTextContent('envy09'));

    expect(row().querySelectorAll('.pc-account__text > *')).toHaveLength(1);
  });

  it('点行 → 菜单（信息头 + 退出登录）；点退出 → 回未登录、只清本机', async () => {
    const bridges = installBridges({ restored: true });
    resetCommunityAccount();

    await enterDetail();
    await waitFor(() => expect(row()).toHaveTextContent('Envy'));
    fireEvent.click(row());
    const panel = document.querySelector('.pp-menu__panel') as HTMLElement;
    const before = bridges.requests.length;

    fireEvent.click(within(panel).getByRole('button', { name: /退出登录/ }));

    await waitFor(() => expect(row()).toHaveTextContent(/^登录$/));
    expect(document.querySelector('.pp-menu__panel')).toBeNull();
    // 登出 = 清本机（票 10 的 logout 不打服务端 logout）：会话那条通道被清，网络一条都没多发
    expect(bridges.clear).toHaveBeenCalled();
    expect(bridges.requests).toHaveLength(before);
  });

  it('本机记不住登录状态（安全存储不可用）→ 菜单里说一句（Q6）', async () => {
    const bridges = installBridges({ persisted: false });
    resetCommunityAccount();

    const dialog = await openSignIn();
    submitCredentials(dialog);
    await waitFor(() => expect(row()).toHaveTextContent('Envy'));
    expect(bridges.persist).toHaveBeenCalled();

    fireEvent.click(row());
    const panel = document.querySelector('.pp-menu__panel') as HTMLElement;
    expect(panel).toHaveTextContent('本机无法安全保存登录状态，下次启动需要重新登录');
  });
});

describe('票 39 · 会话失效（Q17 / Q20）', () => {
  it('user/me 401 → 就地「登录状态已失效」、不弹窗、读能力（官方 / 社区入口）仍在', async () => {
    installBridges({ restored: true, me: wireError('unauthorized', 'LOGIN_REQUIRED') });
    resetCommunityAccount();

    await enterDetail();

    await waitFor(() => expect(row()).toHaveTextContent('登录状态已失效，请重新登录'));
    // 不弹窗打断（issue 06 Q3）：失效是"一行文字"，不是对话框
    expect(screen.queryByRole('dialog')).toBeNull();
    // 账号行还是那一行（就地转态，没有整块重挂）
    expect(document.querySelectorAll('.pc-account__row')).toHaveLength(1);

    // 读能力保留：回主页，官方 / 社区两支新建入口照旧在（它们走读能力）
    fireEvent.click(screen.getByRole('button', { name: /主页/ }));
    await screen.findByText('全部工程');
    expect(screen.getByRole('button', { name: /从官方谱面导入/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /从社区谱面导入/ })).toBeInTheDocument();
  });
});

describe('票 39 · 登录弹窗（Q15 / Q26 / Q33 / Q38）', () => {
  it('打开弹窗一条请求都不发（Q33：不做网络预检）', async () => {
    const bridges = installBridges();
    resetCommunityAccount();

    const dialog = await openSignIn();

    expect(bridges.requests).toEqual([]);
    expect(within(dialog).getByLabelText('账号')).toHaveValue('');
  });

  it('提交中：两框 + 按钮一并禁用、按钮写「登录中…」', async () => {
    const bridges = installBridges({ login: 'pending' });
    resetCommunityAccount();

    const dialog = await openSignIn();
    submitCredentials(dialog);

    const busy = await within(dialog).findByRole('button', { name: '登录中…' });
    expect(busy).toBeDisabled();
    expect(within(dialog).getByLabelText('账号')).toBeDisabled();
    expect(within(dialog).getByLabelText('密码')).toBeDisabled();

    bridges.releaseLogin();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('成功：弹窗自动关、账号区就地变（不 Toast）', async () => {
    const bridges = installBridges();
    resetCommunityAccount();

    const dialog = await openSignIn();
    submitCredentials(dialog);

    await waitFor(() => expect(row()).toHaveTextContent('Envy'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.toast')).toBeNull();
    expect(bridges.persist).toHaveBeenCalled();
  });

  it('失败：错误内联在弹窗内（不是 Toast），弹窗留在场', async () => {
    installBridges({ login: wireError('unauthorized', 'CREDENTIALS_INVALID') });
    resetCommunityAccount();

    const dialog = await openSignIn();
    submitCredentials(dialog, 'envy09', 'wrong');

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('账号或密码错误');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Toast 会自己消失，登录失败必须留在场 —— 这里连 Toast 节点都不该有
    expect(document.querySelector('.toast')).toBeNull();
  });

  it('关闭即忘：重开时两个框都是空的（凭据不留内存）', async () => {
    installBridges();
    resetCommunityAccount();

    const first = await openSignIn();
    fireEvent.change(within(first).getByLabelText('账号'), { target: { value: 'envy09' } });
    fireEvent.change(within(first).getByLabelText('密码'), { target: { value: 'hunter2' } });
    fireEvent.click(within(first).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(row());
    const second = await screen.findByRole('dialog');
    expect(within(second).getByLabelText('账号')).toHaveValue('');
    expect(within(second).getByLabelText('密码')).toHaveValue('');
  });

  it('密码框的眼睛：默认遮蔽，点一下变明文并换 aria（不写进任何持久化）', async () => {
    installBridges();
    resetCommunityAccount();

    const dialog = await openSignIn();
    const secret = within(dialog).getByLabelText('密码');
    expect(secret).toHaveAttribute('type', 'password');
    const stored = localStorage.length;

    const eye = within(dialog).getByRole('button', { name: '显示密码' });
    expect(eye).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(eye);

    expect(secret).toHaveAttribute('type', 'text');
    const off = within(dialog).getByRole('button', { name: '隐藏密码' });
    expect(off).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(off);
    expect(secret).toHaveAttribute('type', 'password');
    // 只活在这一次挂载里：一个字节都没落进 localStorage（凭据落盘那条路见静态锁测）
    expect(localStorage.length).toBe(stored);
  });
});

const FAILURE_CASES: [string, CommunityWireResult, string][] = [
  ['平台说账密错', wireError('unauthorized', 'CREDENTIALS_INVALID'), '账号或密码错误'],
  ['401 没带平台码', wireError('unauthorized'), '账号或密码错误'],
  ['连不上', wireError('offline'), '网络不可用，请稍后重试'],
  ['超时', wireError('timeout'), '网络不可用，请稍后重试'],
  ['平台在限流', wireError('rate-limited', 'TOO_MANY_REQUESTS'), '尝试过于频繁，请稍后再试'],
  ['账号本身不可用', wireError('unauthorized', 'USER_INVALID'), '该账号暂时无法登录，请稍后再试或换一个账号'],
  ['没有出口', wireError('unsupported-runtime'), '社区功能当前不可用'],
  ['其它（5xx）', wireError('http'), '登录失败，请稍后重试'],
];

describe('票 39 · 六档失败文案（Q43 / Q44）', () => {
  it.each(FAILURE_CASES)('%s → 就地说那一句，不发 user/me', async (_label, result, text) => {
    const bridges = installBridges({ login: result });
    resetCommunityAccount();

    const dialog = await openSignIn();
    submitCredentials(dialog, 'envy09', 'wrong');

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(text);
    // 界面文案里不出现平台码（那是平台实现细节，只活在能力层的映射件里）
    expect(alert.textContent).not.toMatch(/CREDENTIALS_INVALID|TOO_MANY|USER_INVALID|RATE_LIMITED/);
    // 只打了登录那一条：不预检、失败后也不再多问一次 user/me
    expect(bridges.requests.map((req) => req.url)).toEqual([LOGIN_URL]);
  });
});

describe('票 39 · 账号生命周期入口（Q42 / Q45 / Q47 / Q48）', () => {
  it('正常态就有两枚外链，都指站点首页（不是失败之后才出现）', async () => {
    installBridges();
    resetCommunityAccount();

    const dialog = await openSignIn();
    const links = within(dialog).getAllByRole('link');

    expect(links.map((link) => link.textContent)).toEqual(['注册', '忘记密码']);
    for (const link of links) expect(link).toHaveAttribute('href', siteHomeUrl());
  });

  it('点入口：拦掉默认导航、走桥开系统浏览器一次（不开应用内窗口）', async () => {
    const bridges = installBridges();
    resetCommunityAccount();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const before = window.location.href;

    const dialog = await openSignIn();
    fireEvent.click(within(dialog).getAllByRole('link')[0]);

    await waitFor(() => expect(bridges.openExternal).toHaveBeenCalledTimes(1));
    expect(bridges.openExternal).toHaveBeenCalledWith(siteHomeUrl());
    // 站内不导航、也不开新窗口（Electron 里 `target=_blank` 会开无地址栏的应用内窗口 = 错形态）
    expect(openSpy).not.toHaveBeenCalled();
    expect(window.location.href).toBe(before);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('没有桥（静态演示版）时出口只是「没开成」，不抛错', async () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;

    await expect(openCommunitySite()).resolves.toBe(false);
  });
});
