// @vitest-environment jsdom
// issue 19 #2：详情页「难度+等级」徽标就地编辑 —— 点开浮层、点色块即时提交、等级回车提交；
// 已上传谱面只 toast（复用 projects.uploadedReadonly），不弹浮层、不改数据。
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { AppNavProvider, type PageId } from '@/src/layouts/AppNav';
import ProjectsPage from '@/src/pages/projects/ProjectsPage';
import ToastHost from '@/src/ui/Toast';
import { ChartProjectStore, type ChartProject, type ProjectChart } from '@/src/project/ChartProject';
import {
  makeMemoryProjectBackend, renderWithProviders, type MemoryProjectBackend,
} from '@/tests/support/providers';
import { seedZhSettings } from '@/tests/support/storage';

const AT = 1_700_000_000_000;

const navValue = {
  activePage: 'projects' as PageId,
  setActivePage: () => {},
  pageScope: null,
  navCollapsed: true,
  setNavCollapsed: () => {},
};

function makeChart(id: string, over: Partial<ProjectChart> = {}): ProjectChart {
  return {
    id,
    notes: [{ beat: 0, type: 'BPM', bpm: 120 }],
    title: null, diff: 3, level: 27, completed: false, upload: null,
    lastModified: AT, appliedChartCodeText: null, chartCodePristine: false,
    ...over,
  };
}

function makeProject(id: string, charts: ProjectChart[]): ChartProject {
  return {
    id, name: '甲工程', artist: null, source: { type: 'custom' },
    durationSeconds: 30, lastOpened: AT,
    charts,
    audioName: null, coverName: null,
  };
}

const EDITABLE = makeChart('cEdit');
const UPLOADED = makeChart('cUp', { diff: 1, level: 10, upload: { postId: 254301, at: AT } });

let backend: MemoryProjectBackend;

beforeEach(() => {
  seedZhSettings();
  backend = makeMemoryProjectBackend([makeProject('p1', [{ ...EDITABLE }, { ...UPLOADED }])]);
});

async function renderDetail() {
  renderWithProviders(
    <ConfigProvider>
      <AppNavProvider value={navValue}>
        <ToastHost />
        <ProjectsPage />
      </AppNavProvider>
    </ConfigProvider>,
    { store: new ChartProjectStore(backend) },
  );
  // 等目录就绪（真实卡片出现）再点——「全部工程」标题在骨架屏态也渲染，等它 ≠ 就绪（test-infra 01）
  await waitFor(() => expect(document.querySelector('.pb-card[data-project-id]')).not.toBeNull());
  fireEvent.click(document.querySelector('.pb-card') as HTMLElement);
  await screen.findByRole('heading', { name: '甲工程' });
}

/** 两枚徽标按谱面行顺序：可编辑在前、已上传在后 */
const badges = () => screen.getAllByTitle('点击改难度 / 等级');
const storedChart = (id: string) => backend.disk.get('p1')!.charts.find((c) => c.id === id)!;

describe('issue 19 #2 · 难度+等级徽标就地编辑', () => {
  it('点徽标弹浮层；点难度色块即时落库，等级照旧', async () => {
    await renderDetail();
    fireEvent.click(badges()[0]);

    const panel = await screen.findByRole('dialog', { name: '点击改难度 / 等级' });
    expect(within(panel).getByText('等级')).toBeInTheDocument();

    fireEvent.click(within(panel).getByTitle('Hard'));

    await waitFor(() => expect(storedChart('cEdit').diff).toBe(2));
    expect(storedChart('cEdit').level).toBe(27); // 改难度不动等级
  });

  it('等级输入回车提交并收起浮层', async () => {
    await renderDetail();
    fireEvent.click(badges()[0]);

    const panel = await screen.findByRole('dialog', { name: '点击改难度 / 等级' });
    const input = within(panel).getByRole('textbox');
    fireEvent.change(input, { target: { value: '30' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(storedChart('cEdit').level).toBe(30));
    expect(storedChart('cEdit').diff).toBe(3); // 改等级不动难度
    expect(screen.queryByRole('dialog', { name: '点击改难度 / 等级' })).toBeNull();
  });

  it('越界等级回车不落库（票 43）', async () => {
    await renderDetail();
    fireEvent.click(badges()[0]);
    const panel = await screen.findByRole('dialog', { name: '点击改难度 / 等级' });
    const input = within(panel).getByRole('textbox');
    fireEvent.change(input, { target: { value: '99' } });
    expect(input).toHaveClass('is-missing');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '点击改难度 / 等级' })).toBeNull());
    expect(storedChart('cEdit').level).toBe(27);
  });

  it('Esc 收起但不提交', async () => {
    await renderDetail();
    fireEvent.click(badges()[0]);
    const panel = await screen.findByRole('dialog', { name: '点击改难度 / 等级' });
    const input = within(panel).getByRole('textbox');
    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '点击改难度 / 等级' })).toBeNull());
    expect(storedChart('cEdit').level).toBe(27);
  });

  it('已上传谱面的徽标：只 toast 提示，不弹浮层、不改数据', async () => {
    await renderDetail();
    fireEvent.click(badges()[1]);

    expect(await screen.findByText('已上传的谱面只读。要改就先复制这张谱面。')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '点击改难度 / 等级' })).toBeNull();
    expect(storedChart('cUp').diff).toBe(1);
    expect(storedChart('cUp').level).toBe(10);
  });
});
