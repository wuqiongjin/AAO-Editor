// @vitest-environment jsdom
// 票 69 复验整改 · PreviewPage 级端到端 DOM 联动锁：
// 覆盖保活在动态形态时工作台改谱直切回来的完整时序：
//   T0（checking，flush+store.get 在飞）→ T1（store.get 返回但 buildSimChartInChunks 仍在分片，seek(0) 已触发）→ T2（分片派生完并 pb.setFrame 推帧）
// 确认 `.preview-stage__paint-pending` 在 T0..T1 全程盖住舞台，直到 T2 推帧完成后才撤罩。
import '@testing-library/jest-dom/vitest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SIM_BAND_MATERIAL, SIM_BAND_MATERIAL_SP } from '@/src/preview/video/sim/simGeometry';
import {
  SIM_BAND_RASTER_MATERIAL,
  SIM_BAND_RASTER_MATERIAL_SP,
} from '@/src/preview/video/sim/simBandRaster';

const h = vi.hoisted(() => ({
  setFrame: vi.fn(),
  seek: vi.fn(),
  holdYield: false,
  releaseYield: null as (() => void) | null,
}));

vi.mock('@/src/preview/video/sim/prepareSimNoteSprites', () => ({
  prepareSimNoteSprites: vi.fn(async () => undefined),
}));

vi.mock('@/src/preview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/preview')>();
  return {
    ...actual,
    yieldToMainThread: vi.fn(async () => {
      if (h.holdYield) {
        await new Promise<void>((resolve) => {
          h.releaseYield = resolve;
        });
      }
      return actual.yieldToMainThread();
    }),
    loadSimAssets: vi.fn(async () => ({
      background: null,
      field: null,
      playLine: null,
      bandColor: '#5fd68a',
      bandColorSp: '#8fe6c0',
      bandMaterial: { ...SIM_BAND_MATERIAL },
      bandMaterialSp: { ...SIM_BAND_MATERIAL_SP },
      bandRaster: SIM_BAND_RASTER_MATERIAL,
      bandRasterSp: SIM_BAND_RASTER_MATERIAL_SP,
      sprites: null,
      missing: false,
      server: 'jp',
    })),
    createSimPlayback: vi.fn((opts?: { onTick?: (seconds: number, playing: boolean) => void }) => ({
      setFrame: h.setFrame,
      setOptions: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      seek: (s: number) => {
        h.seek(s);
        opts?.onTick?.(s, false);
      },
      toggle: vi.fn(),
      setDuration: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    })),
  };
});

import PreviewPage from '@/src/pages/preview/PreviewPage';
import { AppNavProvider, type AppNavValue } from '@/src/layouts/AppNav';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { UIProvider } from '@/src/app/providers/UIProvider';
import {
  CurrentProjectProvider,
  useCurrentProject,
  type CurrentProjectContextValue,
} from '@/src/app/providers/CurrentProjectProvider';
import { ChartProjectStore, type ChartProject } from '@/src/project/ChartProject';
import { createUnnamedProject } from '@/src/project/workspaceProject';
import type { ChartNote } from '@/src/chart/types';
import { t } from '@/src/i18n';
import { makeMemoryProjectBackend, type MemoryProjectBackend } from '@/tests/support/providers';
import { makeRecordingCtx } from '@/tests/support/canvas';
import { stubPageShellEnv } from '@/tests/support/domEnv';
import { seedZhSettings } from '@/tests/support/storage';

const NOW = 1_700_000_000_000;
const INITIAL_NOTES: ChartNote[] = [
  { type: 'BPM', beat: 0, bpm: 120 },
  { type: 'Single', beat: 1, lane: 0 },
];
const EDITED_LONG_NOTES: ChartNote[] = Array.from({ length: 2400 }, (_, i) => ({
  type: 'Single',
  beat: i * 0.25,
  lane: i % 7,
}) as ChartNote);

stubPageShellEnv();

const ORIGINAL_GET_CONTEXT = HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  const { proxy } = makeRecordingCtx();
  HTMLCanvasElement.prototype.getContext = (() => proxy) as typeof HTMLCanvasElement.prototype.getContext;
  for (const [prop, value] of [['clientWidth', 960], ['clientHeight', 540]] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, value });
  }
});
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = ORIGINAL_GET_CONTEXT;
});

function Probe({ ctx }: { ctx: { current: CurrentProjectContextValue | null } }) {
  ctx.current = useCurrentProject();
  return null;
}

const navValue: AppNavValue = {
  activePage: 'preview',
  setActivePage: () => {},
  pageScope: { projectId: 'pA' },
  navCollapsed: true,
  setNavCollapsed: () => {},
};

beforeEach(() => {
  window.localStorage.clear();
  seedZhSettings();
  h.setFrame.mockClear();
  h.seek.mockClear();
  h.holdYield = false;
  h.releaseYield = null;
});

describe('票 69 复验整改 · PreviewPage 动态形态重入遮罩贯通 T0..T2', () => {
  it('checking（T0）经 store.get 返回后的分片派生与 seek(0)（T1）到 pb.setFrame 推帧完成（T2）全程遮罩不断档', async () => {
    const initial: ChartProject = {
      ...createUnnamedProject({ id: 'pA', chartId: 'c1', now: NOW }),
      name: 'Alpha',
      charts: [{
        id: 'c1',
        notes: INITIAL_NOTES,
        title: 'Alpha 1',
        diff: 3,
        level: null,
        completed: false,
        upload: null,
        lastModified: NOW,
        appliedChartCodeText: null,
        chartCodePristine: false,
      }],
    };
    const backend = makeMemoryProjectBackend([initial]);
    let holdGet = false;
    let releaseGet: (() => void) | null = null;
    const rawGet = backend.get.bind(backend);
    const controlled: MemoryProjectBackend = {
      ...backend,
      get: async (id) => {
        if (holdGet) {
          await new Promise<void>((resolve) => {
            releaseGet = resolve;
          });
        }
        return rawGet(id);
      },
    };
    const ctx: { current: CurrentProjectContextValue | null } = { current: null };

    const ui = (active: boolean) => (
      <CurrentProjectProvider store={new ChartProjectStore(controlled)}>
        <Probe ctx={ctx} />
        <ConfigProvider>
          <UIProvider>
            <AppNavProvider value={navValue}>
              <PreviewPage active={active} />
            </AppNavProvider>
          </UIProvider>
        </ConfigProvider>
      </CurrentProjectProvider>
    );

    const view = render(ui(true));
    await waitFor(() => expect(screen.getByRole('button', { name: '动态预览' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '动态预览' }));
    await waitFor(() => expect(h.setFrame).toHaveBeenCalled());
    expect(document.querySelector('.preview-stage__paint-pending')).toBeNull();

    // 切离预览页（工作台改谱）：开启 get 与分片让出双闸门
    view.rerender(ui(false));
    const prev = backend.disk.get('pA')!;
    backend.disk.set('pA', {
      ...prev,
      charts: [{ ...prev.charts[0], notes: EDITED_LONG_NOTES }],
    });
    h.setFrame.mockClear();
    h.seek.mockClear();
    holdGet = true;
    h.holdYield = true;
    ctx.current!.notifyProjectEdited('pA');

    // T0：直切回动态预览，checking 在飞期间遮罩已盖上
    view.rerender(ui(true));
    const overlayT0 = document.querySelector('.preview-stage__paint-pending');
    expect(overlayT0).not.toBeNull();
    expect(overlayT0).toHaveTextContent(t('preview.video.updating'));

    // T1：store.get 返回、checking 退场，但异步分片派生尚未完成，此时 seek(0) 已跑，遮罩由 videoSyncDeferred 继续接力撑住
    await waitFor(() => expect(releaseGet).toBeTypeOf('function'));
    holdGet = false;
    await act(async () => {
      releaseGet!();
    });
    await waitFor(() => expect(h.seek).toHaveBeenCalledWith(0));
    expect(h.setFrame).not.toHaveBeenCalled();
    expect(document.querySelector('.preview-stage__paint-pending')).not.toBeNull();

    // T2：放行分片让出 → pb.setFrame 推入新帧并完成同步 → 遮罩撤下
    await waitFor(() => expect(h.releaseYield).toBeTypeOf('function'));
    h.holdYield = false;
    await act(async () => {
      h.releaseYield!();
    });
    await waitFor(() => expect(h.setFrame).toHaveBeenCalled());
    await waitFor(() => expect(document.querySelector('.preview-stage__paint-pending')).toBeNull());
  });
});
