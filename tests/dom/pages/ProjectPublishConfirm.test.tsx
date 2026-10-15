// @vitest-environment jsdom
// 票 11：发布弹窗的交互锁（单测覆盖不到的 DOM 行为，按 tests/README 的 dom/ 约定）。
//   ① 必填预检不过 → 就地点名缺什么，**不开**一次性确认（确认是不可逆动作的门）；
//   ② 全合法 → 点发布先弹「发布后谱面本体不可修改」确认（实底红确认键），确认才真发；
//   ③ 入参形状：标题按站点口径解析（谱面名称 → 工程名称）、song 按曲目来源、
//      谱面代码原样递出（sanitize 在能力层，UI 不碰）；
//   ④ custom 曲目打开时就备上传引用；读不到 = 发布不可用（就地一行，不静默）；
//   ⑤ 失败就地内联在弹窗里（不 Toast、不关窗）；已发布过的谱面直接禁用。
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ChartCodeNote } from '@/src/chart/editing/ChartConverter';
import { getCommunityAccount, resetCommunityAccount } from '@/src/community/bestdori/account';
import { userMeUrl } from '@/src/community/bestdori/endpoints';
import type { PublishInput, PublishOutcome, PublishStage } from '@/src/community/bestdori/publish';
import type { CommunityWireResult } from '@/src/community/transport';
import type { ChartProject, ProjectChart } from '@/src/project/ChartProject';
import type { ProjectUploadRefs } from '@/src/project/ChartProjectRecord';
import { PublishDialog } from '@/src/pages/projects/components/PublishDialog';

const AT = 1_700_000_000_000;

function makeChart(overrides: Partial<ProjectChart> = {}): ProjectChart {
  return {
    id: 'c1',
    notes: [
      { beat: 0, type: 'BPM', bpm: 210 },
      { beat: 220, lane: 1, type: 'Single', charge: true },
      { beat: 0, type: 'System', data: 'bgm1020.wav' },
    ],
    title: 'Expert',
    diff: 3,
    level: 24,
    completed: false,
    upload: null,
    lastModified: AT,
    appliedChartCodeText: null,
    chartCodePristine: false,
    ...overrides,
  };
}

function makeProject(overrides: Partial<ChartProject> = {}): ChartProject {
  return {
    id: 'p1',
    name: ' excite',
    artist: 'RAS',
    source: { type: 'bandori', id: 413 },
    durationSeconds: 100,
    lastOpened: AT,
    charts: [makeChart()],
    audioName: 'official-413- excite.mp3',
    coverName: 'cover.png',
    ...overrides,
  };
}

/** 页面侧递进来的谱面代码（convertNotesToChartCode 的产物形状；弹窗原样透传） */
const CHART_CODE: ChartCodeNote[] = [
  { type: 'BPM', beat: 0, bpm: 210 },
  { type: 'Single', beat: 220, lane: 1, charge: true },
  { type: 'System', beat: 0, data: 'bgm1020.wav' },
];

/** 渲染弹窗；返回 onPublish 的桩（入参断言用它） */
function renderDialog(options: {
  project?: ChartProject;
  chart?: ProjectChart;
  chartCode?: ChartCodeNote[];
  onPublish?: (input: PublishInput, onStage: (stage: PublishStage) => void) => Promise<PublishOutcome>;
  uploadRefs?: ProjectUploadRefs | null;
} = {}) {
  const onPublish = options.onPublish ?? vi.fn(async () => ({ ok: true as const, postId: 1, recordWritten: true }));
  render(
    <PublishDialog
      project={options.project ?? makeProject()}
      chart={options.chart ?? makeChart()}
      chartCode={options.chartCode ?? CHART_CODE}
      onPublish={onPublish}
      {...(options.uploadRefs === undefined
        ? {}
        : { loadUploadRefs: async () => options.uploadRefs as ProjectUploadRefs | null })}
    />,
  );
  return onPublish;
}

const DESCRIPTION = '说说这张谱面（必填，不超过 5000 字）';

function fillDescription(value = 'notes: 413') {
  fireEvent.change(screen.getByPlaceholderText(DESCRIPTION), { target: { value } });
}

/** 等发布键就绪（custom 要等上传引用到位）后点发布 → 等确认窗 → 点确认发布 */
async function confirmAndPublish(onPublish: ReturnType<typeof renderDialog>) {
  const publishBtn = screen.getByRole('button', { name: '发布' });
  await waitFor(() => expect(publishBtn).toBeEnabled());
  fireEvent.click(publishBtn);
  fireEvent.click(await screen.findByRole('button', { name: '确认发布' }));
  await waitFor(() => expect(onPublish).toHaveBeenCalledOnce());
  return (onPublish as ReturnType<typeof vi.fn>).mock.calls[0][0] as PublishInput;
}

describe('票 11 · 发布弹窗：必填预检与确认门', () => {
  it('缺字段时实时点名（不用等点发布），确认门压根不开', async () => {
    renderDialog({
      project: makeProject({ name: null, artist: null }),
      chart: makeChart({ title: null, level: null }),
    });

    const box = await screen.findByRole('alert');
    expect(box).toHaveTextContent('还缺以下信息，补齐后才能发布：');
    expect(box).toHaveTextContent('标题');
    expect(box).toHaveTextContent('歌手');
    expect(box).toHaveTextContent('等级');
    expect(box).toHaveTextContent('描述');
    // 确认是不可逆动作的门，不是报错的门 —— 预检不过时发布键点不动
    expect(screen.getByRole('button', { name: '发布' })).toBeDisabled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('谱面只有 System（没有可发布的音符）也点名', async () => {
    // chartCode 与谱面对齐：页面递进来的就是全 System 的转换结果
    renderDialog({
      chart: makeChart({ notes: [{ beat: 0, type: 'System', data: 'bgm1020.wav' }] as never }),
      chartCode: [{ type: 'System', beat: 0, data: 'bgm1020.wav' }],
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('这张谱面还没有可发布的音符');
    expect(screen.getByRole('button', { name: '发布' })).toBeDisabled();
  });

  it('全合法 → 先弹「发布后谱面本体不可修改」确认，确认后才调用发布', async () => {
    const onPublish = renderDialog();

    fillDescription();
    fireEvent.click(screen.getByRole('button', { name: '发布' }));

    const confirm = await screen.findByRole('alertdialog', { name: '发布后谱面本体不可修改' });
    expect(confirm).toHaveTextContent('谱面本身不能改、也不能删除');
    expect(confirm).toHaveTextContent('确定发布「Expert」？');
    expect(onPublish).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '确认发布' }));
    await waitFor(() => expect(onPublish).toHaveBeenCalledOnce());
  });

  it('确认窗上取消：不发布，主弹窗留着', async () => {
    const onPublish = renderDialog();
    fillDescription();
    fireEvent.click(screen.getByRole('button', { name: '发布' }));
    const confirm = await screen.findByRole('alertdialog');

    // 主弹窗也有一枚「取消」—— 取消要点在确认窗上那枚
    fireEvent.click(within(confirm).getByRole('button', { name: '取消' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onPublish).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('已发布过的谱面：发布键禁用 + 就地说明出路（复制谱面再发）', async () => {
    renderDialog({ chart: makeChart({ upload: { postId: 254203, at: AT } }) });
    fillDescription();
    expect(screen.getByRole('button', { name: '发布' })).toBeDisabled();
    expect(screen.getByText(/这张谱面已经发布过了；要改就复制这张谱面/)).toBeInTheDocument();
  });
});

describe('票 11 · 发布弹窗：递出去的入参', () => {
  it('bandori：标题取谱面名称、song 带曲库 id、谱面代码原样（不清洗）', async () => {
    const onPublish = renderDialog();
    fillDescription('  notes: 413  ');
    const input = await confirmAndPublish(onPublish);

    expect(input).toMatchObject({
      published: false,
      title: 'Expert',
      artists: 'RAS',
      diff: 3,
      level: 24,
      content: '  notes: 413  ',
      song: { kind: 'bandori', songId: 413 },
    });
    // 谱面代码透传：System 与 charge 还在（静默 sanitize 是能力层的事，UI 不碰）
    expect(input.chartCode).toEqual(CHART_CODE);
  });

  it('谱面名缺省时标题退工程名称（发出去的标题是 trim 过的）', async () => {
    const onPublish = renderDialog({ chart: makeChart({ title: null }) });
    fillDescription('x');
    const input = await confirmAndPublish(onPublish);
    expect(input.title).toBe('excite');
  });

  it('custom：上传引用打开时就备好，song 带音频与封面引用', async () => {
    const onPublish = renderDialog({
      project: makeProject({ source: { type: 'custom' } }),
      uploadRefs: {
        audio: { path: '/data/projects/p1/audio.bin', size: 1024, hash: 'a'.repeat(40) },
        cover: { path: '/data/projects/p1/cover.bin', size: 512, hash: 'b'.repeat(40) },
      },
    });
    fillDescription('x');
    const input = await confirmAndPublish(onPublish);

    expect(input.song).toEqual({
      kind: 'custom',
      audio: { path: '/data/projects/p1/audio.bin', size: 1024, hash: 'a'.repeat(40), fileName: 'official-413- excite.mp3' },
      cover: { path: '/data/projects/p1/cover.bin', size: 512, hash: 'b'.repeat(40), fileName: 'cover.png' },
    });
  });

  it('custom 上传引用读不到：发布键禁用 + 就地一行（不静默放行）', async () => {
    renderDialog({ project: makeProject({ source: { type: 'custom' } }), uploadRefs: null });
    fillDescription('x');
    expect(await screen.findByText('本机文件读取失败，发布未完成。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发布' })).toBeDisabled();
  });
});

describe('票 11 · 发布弹窗：失败就地内联', () => {
  it('平台拒了：错误行留在弹窗里，不关窗', async () => {
    renderDialog({ onPublish: async () => ({ ok: false, failure: 'rejected' }) });
    fillDescription('x');
    fireEvent.click(screen.getByRole('button', { name: '发布' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认发布' }));

    expect(await screen.findByText('社区平台拒绝了这次发布，请检查谱面与各项信息后重试。')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('连不上：错误行就地内联', async () => {
    renderDialog({ onPublish: async () => ({ ok: false, failure: 'offline' }) });
    fillDescription('x');
    fireEvent.click(screen.getByRole('button', { name: '发布' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认发布' }));
    expect(await screen.findByText('连不上社区平台，检查网络后重试。')).toBeInTheDocument();
  });
});

describe('票 41 · 发布弹窗只读身份', () => {
  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    resetCommunityAccount();
  });

  it('有会话时画出「将以 … 发布」和账号名', async () => {
    const me = userMeUrl();
    const ok = (data: unknown): CommunityWireResult => ({ ok: true, responseType: 'json', status: 200, data });
    (window as unknown as { electronAPI?: unknown }).electronAPI = {
      communitySession: {
        restore: async () => ({ restored: true }),
        persist: async () => ({ persisted: true }),
        clear: async () => true,
      },
      communityNet: {
        request: async (req: { url: string }) => {
          if (req.url === me) return ok({ result: true, username: 'envy09', nickname: 'Envy' });
          throw new Error(`未打桩的请求: ${req.url}`);
        },
      },
    };
    resetCommunityAccount();
    await getCommunityAccount().start();
    renderDialog();
    expect(screen.getByText('将以 Envy 发布')).toBeInTheDocument();
    expect(screen.getByText('账号：envy09')).toBeInTheDocument();
  });
});
