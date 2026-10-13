// @vitest-environment jsdom
// 票 15 定案 2/4/8 + 票 22 定案 2/5/6/9：音频页在**作用域**机制下的行为。
//
// 这一页是全站唯一能改工程音频的地方（而不是"当前工程"的音频）：它作用的那个工程，
// 由作用域决定；改的永远是作用域那条记录，当前工程不许被顺手切走、更不许被写坏。
//
// 接线口径：作用域状态归应用壳（AppNav.pageScope），本页只**读**它、并把"用户想改成谁"
// 作为 setActivePage 的请求交回去。所以这里给一个静态 nav（+ spy），不自己维护作用域——
// 壳那条"入口清 scope / 跳转写 scope"的规则由 PageScopeLifecycle 看守。
import '@testing-library/jest-dom/vitest';
import { useMemo, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import AudioPage from '@/src/pages/audio/AudioPage';
import { AppNavProvider, type AppNavValue } from '@/src/layouts/AppNav';
import type { PageScope } from '@/src/layouts/pageScope';
import {
  useCurrentProject,
  type CurrentProjectContextValue,
} from '@/src/app/providers/CurrentProjectProvider';
import { ChartProjectStore, type ChartProject } from '@/src/project/ChartProject';
import { createUnnamedProject } from '@/src/project/workspaceProject';
import { makeMemoryProjectBackend, renderWithProviders, type MemoryProjectBackend } from '@/tests/support/providers';
import { stubPageShellEnv } from '@/tests/support/domEnv';

const NOW = 1_700_000_000_000;

stubPageShellEnv();

function project(id: string, name: string, patch: Partial<ChartProject> = {}): ChartProject {
  return { ...createUnnamedProject({ id, chartId: `c-${id}`, now: NOW }), name, ...patch };
}

/** 有音频的工程：时长跟着音频（ADR-0005 §4） */
function projectWithAudio(id: string, name: string, audioName: string, duration: number): ChartProject {
  return project(id, name, {
    audioName,
    audioBlob: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' }),
    durationSeconds: duration,
  });
}

/** 已上传谱面 → 音频与时长锁定（ADR-0015 §4），锁源点名到具体谱面 */
function lockedProject(id: string, name: string): ChartProject {
  const base = projectWithAudio(id, name, '锁定.mp3', 120);
  return {
    ...base,
    charts: [{ ...base.charts[0], upload: { postId: 7, at: NOW }, diff: 3, level: 27 }],
  };
}

/** 假离线解码：只回答"多长"，不碰共享引擎（生产走 OfflineAudioContext，jsdom 没有） */
function stubOfflineDecode(duration: number) {
  (window as unknown as { OfflineAudioContext: unknown }).OfflineAudioContext = class {
    decodeAudioData(): Promise<{ duration: number }> {
      return Promise.resolve({ duration });
    }
  };
}

function audioFile(name = '新音频.mp3'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'audio/mpeg' });
}

function Harness({ nav, ctx }: { nav: AppNavValue; ctx: { current: CurrentProjectContextValue | null } }) {
  ctx.current = useCurrentProject();
  return (
    <AppNavProvider value={nav}>
      <AudioPage active />
    </AppNavProvider>
  );
}

async function mountPage(
  projects: ChartProject[],
  opts: { scope?: PageScope | null; openId?: string } = {},
) {
  const backend: MemoryProjectBackend = makeMemoryProjectBackend(projects);
  const setActivePage = vi.fn();
  const nav: AppNavValue = {
    activePage: 'audio',
    setActivePage,
    pageScope: opts.scope ?? null,
    navCollapsed: true,
    setNavCollapsed: () => {},
  };
  const ctx: { current: CurrentProjectContextValue | null } = { current: null };
  renderWithProviders(<Harness nav={nav} ctx={ctx} />, { store: new ChartProjectStore(backend) });
  if (opts.openId) {
    await act(async () => { await ctx.current!.open(opts.openId!); });
  }
  return { backend, setActivePage };
}

/** 作用域触发钮（可访问名带作用域工程名） */
const scopeTrigger = () => screen.getByRole('button', { name: /^作用域工程：/ });
const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;

beforeEach(() => {
  // 当前工程指针落在 localStorage：不清会让上一个用例的工程被下一个用例"恢复"
  window.localStorage.clear();
  delete (window as unknown as { OfflineAudioContext?: unknown }).OfflineAudioContext;
});

describe('票 15 · 音频页 = 工程音频的唯一管理入口（作用域版）', () => {
  it('作用域就是当前工程：作用域条说「当前」，显示的是它的音频与时长', async () => {
    const { backend } = await mountPage([
      projectWithAudio('pA', 'Alpha', 'a.mp3', 90),
      project('pB', 'Beta'),
    ], { openId: 'pA' });

    expect(await screen.findByText('a.mp3')).toBeInTheDocument();
    expect(scopeTrigger()).toHaveTextContent('Alpha');
    expect(document.querySelector('.scope-picker__tag')).toHaveTextContent('当前');
    // 一个写动作都没发生（进页面不该动盘）
    expect(backend.disk.get('pA')!.audioName).toBe('a.mp3');
  });

  it('作用域指向别的工程：作用域条说「非当前工程」，看到的是那个工程的音频（不是当前工程的）', async () => {
    await mountPage([
      projectWithAudio('pA', 'Alpha', 'a.mp3', 90),
      projectWithAudio('pB', 'Beta', 'b.mp3', 128),
    ], { scope: { projectId: 'pB' }, openId: 'pA' });

    expect(await screen.findByText('b.mp3')).toBeInTheDocument();
    expect(screen.queryByText('a.mp3')).toBeNull();
    expect(scopeTrigger()).toHaveTextContent('Beta');
    expect(document.querySelector('.scope-picker__tag')).toHaveTextContent('非当前工程');
    expect(document.querySelector('.scope-picker')).toHaveClass('is-other');
    expect(screen.getByDisplayValue('128')).toBeInTheDocument();
  });

  it('作用域工程里的音频与时长都可以改（锁定工程除外），显示的是它的锁状态', async () => {
    await mountPage([
      project('pA', 'Alpha'),
      lockedProject('pB', 'Beta'),
    ], { scope: { projectId: 'pB' }, openId: 'pA' });

    // 锁定横幅点名是哪张谱面（票 15 定案 6）
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('已上传谱面 Beta（Expert 27），音频与时长已锁定');
    expect(screen.getByRole('button', { name: '更换音频' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '清除' })).toBeDisabled();
    expect(screen.getByDisplayValue('120')).toHaveAttribute('readonly');
  });

  it('没有当前工程也没有作用域：区块空态 + 去工程管理，且不因此新建 / 打开工程（票 15 定案 4）', async () => {
    const { backend, setActivePage } = await mountPage([]);

    expect(await screen.findByText('还没有当前工程')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '去工程管理' }));

    expect(setActivePage).toHaveBeenCalledWith('projects');
    expect(backend.disk.size).toBe(0);
  });

  it('选作用域：选别的工程 = 请壳层带 scope 重新激活本页；选当前工程 = 清掉作用域', async () => {
    const { setActivePage } = await mountPage([
      projectWithAudio('pA', 'Alpha', 'a.mp3', 90),
      project('pB', 'Beta'),
    ], { openId: 'pA' });

    fireEvent.click(await screen.findByRole('button', { name: /^作用域工程：/ }));
    fireEvent.click(screen.getByRole('option', { name: /Beta/ }));
    expect(setActivePage).toHaveBeenCalledWith('audio', { scope: { projectId: 'pB' } });

    setActivePage.mockClear();
    fireEvent.click(scopeTrigger());
    fireEvent.click(screen.getByRole('option', { name: /Alpha/ }));
    expect(setActivePage).toHaveBeenCalledWith('audio', { scope: null });
  });

  it('换音频写的是**作用域**那条记录：当前工程记录一个字都不许变（不切当前工程的全部意义）', async () => {
    stubOfflineDecode(145.4);
    const { backend } = await mountPage([
      projectWithAudio('pA', 'Alpha', 'a.mp3', 90),
      project('pB', 'Beta'),
    ], { scope: { projectId: 'pB' }, openId: 'pA' });

    await screen.findByText('尚未导入音频');
    fireEvent.change(fileInput(), { target: { files: [audioFile('新音频.mp3')] } });

    await waitFor(() => expect(backend.disk.get('pB')!.audioName).toBe('新音频.mp3'));
    expect(backend.disk.get('pB')!.durationSeconds).toBeCloseTo(145.4, 3);
    const current = backend.disk.get('pA')!;
    expect(current.audioName).toBe('a.mp3');
    expect(current.durationSeconds).toBe(90);
  });

  it('探不到时长 → 整笔不写，并给出解码失败横幅（不留"有音频但时长还是旧的"半截态）', async () => {
    // 不装 OfflineAudioContext：生产解码器直接抛错
    const { backend } = await mountPage([
      projectWithAudio('pA', 'Alpha', 'a.mp3', 90),
      project('pB', 'Beta'),
    ], { scope: { projectId: 'pB' }, openId: 'pA' });

    await screen.findByText('尚未导入音频');
    fireEvent.change(fileInput(), { target: { files: [audioFile('坏文件.mp3')] } });

    expect(await screen.findByText('音频解码失败')).toBeInTheDocument();
    expect(screen.getByText('坏文件.mp3')).toBeInTheDocument();
    expect(backend.disk.get('pB')!.audioName).toBeNull();
  });

  it('换作用域的那一瞬作用域条也不断档：先说出新工程的名字，正文再跟上', async () => {
    // 这一条要一个**会真的把 scope 落到页面上**的导航（复刻壳那条规则；规则本身由
    // PageScopeLifecycle 看守），否则页面永远停在初始 scope 上。
    function StatefulNav({ children }: { children: React.ReactNode }) {
      const [pageScope, setPageScope] = useState<PageScope | null>(null);
      const value = useMemo<AppNavValue>(() => ({
        activePage: 'audio',
        setActivePage: (_p, request) => setPageScope(request?.scope ?? null),
        pageScope,
        navCollapsed: true,
        setNavCollapsed: () => {},
      }), [pageScope]);
      return <AppNavProvider value={value}>{children}</AppNavProvider>;
    }

    const backend = makeMemoryProjectBackend([
      projectWithAudio('pA', 'Alpha', 'a.mp3', 90),
      projectWithAudio('pB', 'Beta', 'b.mp3', 128),
    ]);
    const ctx: { current: CurrentProjectContextValue | null } = { current: null };
    function Probe() {
      ctx.current = useCurrentProject();
      return null;
    }
    renderWithProviders(
      <StatefulNav>
        <Probe />
        <AudioPage active />
      </StatefulNav>,
      { store: new ChartProjectStore(backend) },
    );
    await act(async () => { await ctx.current!.open('pA'); });
    expect(await screen.findByText('a.mp3')).toBeInTheDocument();

    fireEvent.click(scopeTrigger());
    fireEvent.click(screen.getByRole('option', { name: /Beta/ }));

    // 同步断言：正文还在读新工程，作用域条已经说的是 Beta（名字来自选项，不来自视图）
    expect(scopeTrigger()).toHaveTextContent('Beta');
    expect(document.querySelector('.scope-picker__tag')).toHaveTextContent('非当前工程');
    expect(await screen.findByText('b.mp3')).toBeInTheDocument();
  });

  it('清除自定义音频：无确认弹窗，直接清除', async () => {
    const { backend } = await mountPage([
      projectWithAudio('pCustom', 'CustomSong', 'custom.mp3', 88),
    ], { openId: 'pCustom' });

    expect(await screen.findByText('custom.mp3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清除' }));

    await waitFor(() => expect(backend.disk.get('pCustom')!.audioName).toBeNull());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('清除官方曲目音频：弹出确认弹窗，确认后才清除且转为自定义曲目', async () => {
    const official = {
      ...projectWithAudio('pOfficial', 'OfficialSong', 'official.mp3', 100),
      source: { type: 'bandori' as const, id: 77 },
    };
    const { backend } = await mountPage([official], { openId: 'pOfficial' });

    expect(await screen.findByText('official.mp3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清除' }));

    // 弹窗出现
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('清除官方原版音频')).toBeInTheDocument();

    // 点击取消：未清除
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(backend.disk.get('pOfficial')!.audioName).toBe('official.mp3');
    expect(backend.disk.get('pOfficial')!.source).toEqual({ type: 'bandori', id: 77 });

    // 再次点击清除并确认
    fireEvent.click(screen.getByRole('button', { name: '清除' }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清除并转为自定义' }));

    await waitFor(() => expect(backend.disk.get('pOfficial')!.audioName).toBeNull());
    expect(backend.disk.get('pOfficial')!.source).toEqual({ type: 'custom' });
  });
});
