// @vitest-environment jsdom
// 票 11：发布弹窗的交互锁（单测覆盖不到的 DOM 行为，按 tests/README 的 dom/ 约定）。
//   ① 必填预检不过 → 就地点名缺什么，**不开**一次性确认（确认是不可逆动作的门）；
//   ② 全合法 → 点发布先弹「发布后谱面本体不可修改」确认（实底红确认键），确认才真发；
//   ③ 入参形状：标题按站点口径解析（谱面名称 → 工程名称）、song 按曲目来源、
//      谱面代码原样递出（sanitize 在能力层，UI 不碰）；
//   ④ custom 曲目打开时就备上传引用；读不到 = 发布不可用（就地一行，不静默）；
//   ⑤ 失败就地内联在弹窗里（不 Toast、不关窗）；**已发布过的谱面不再禁用**，而是进「更新」态
//      （标题「更新谱面」、主按钮「更新」、无二次确认）——票 51 起的口径。
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ChartCodeNote } from '@/src/chart/editing/ChartConverter';
import { getCommunityAccount, resetCommunityAccount } from '@/src/community/bestdori/account';
import { userMeUrl } from '@/src/community/bestdori/endpoints';
import type { EditChartOutcome, PublishInput, PublishOutcome, PublishStage } from '@/src/community/bestdori/publish';
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
  onEdit?: (input: { diff: number; level: number; tags: { type: 'text'; data: string }[] }) => Promise<EditChartOutcome>;
  onRecover?: (postId?: number) => Promise<boolean>;
  onClose?: () => void;
  onUpdateProject?: (updater: (project: ChartProject) => ChartProject | null) => Promise<void> | void;
  onOpenAudio?: () => void;
  uploadRefs?: ProjectUploadRefs | null;
  /** 需要观察「封面写回后重取引用」时给函数桩；优先于 uploadRefs */
  loadUploadRefs?: () => Promise<ProjectUploadRefs | null>;
} = {}) {
  const onPublish = options.onPublish ?? vi.fn(async () => ({ ok: true as const, postId: 1, recordWritten: true }));
  render(
    <PublishDialog
      project={options.project ?? makeProject()}
      chart={options.chart ?? makeChart()}
      chartCode={options.chartCode ?? CHART_CODE}
      onPublish={onPublish}
      onEdit={options.onEdit}
      onRecover={options.onRecover}
      onClose={options.onClose}
      onUpdateProject={options.onUpdateProject}
      onOpenAudio={options.onOpenAudio}
      {...(options.loadUploadRefs
        ? { loadUploadRefs: options.loadUploadRefs }
        : options.uploadRefs === undefined
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
  it('缺字段时实时就地标红与呈现缺项（票 42），确认门压根不开', async () => {
    renderDialog({
      project: makeProject({ name: null, artist: null }),
      chart: makeChart({ title: null, level: null }),
    });

    // 票 42 Q2：缺口画在对应条目上，空槽代替伪值，灰盒删除；发布键禁用
    expect(screen.getByPlaceholderText('未命名工程')).toHaveClass('is-missing');
    expect(screen.getByPlaceholderText('未知歌手')).toHaveClass('is-missing');
    expect(screen.getByPlaceholderText('未填')).toHaveClass('is-missing');
    expect(screen.getByPlaceholderText(DESCRIPTION).closest('.ppc-content')).toHaveClass('is-missing');
    // 确认是不可逆动作的门，不是报错的门 —— 预检不过时发布键点不动
    expect(screen.getByRole('button', { name: '发布' })).toBeDisabled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it.each(['28.5', '0', '-1', '36'])('等级 %s：就地缺项，发布键禁用（票 43）', (value) => {
    renderDialog();
    fillDescription('x');
    const level = screen.getByLabelText('等级');
    fireEvent.change(level, { target: { value } });
    expect(level).toHaveClass('is-missing');
    expect(screen.getByRole('button', { name: '发布' })).toBeDisabled();
  });

  it('越界等级不防抖写入工程（票 43）', () => {
    vi.useFakeTimers();
    const onUpdateProject = vi.fn();
    render(
      <PublishDialog
        project={makeProject()}
        chart={makeChart()}
        chartCode={CHART_CODE}
        onPublish={vi.fn()}
        onUpdateProject={onUpdateProject}
      />,
    );
    fireEvent.change(screen.getByLabelText('等级'), { target: { value: '0' } });
    vi.advanceTimersByTime(400);
    expect(onUpdateProject).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('谱面只有 System（没有可发布的音符）也点名', async () => {
    // chartCode 与谱面对齐：页面递进来的就是全 System 的转换结果
    renderDialog({
      chart: makeChart({ notes: [{ beat: 0, type: 'System', data: 'bgm1020.wav' }] as never }),
      chartCode: [{ type: 'System', beat: 0, data: 'bgm1020.wav' }],
    });
    const stat = screen.getByText('0', { selector: '.ppc-stat__v' }).closest('.ppc-stat');
    expect(stat).toHaveClass('is-missing');
    expect(stat).toHaveAttribute('title', '这张谱面还没有可发布的音符');
    expect(screen.getByRole('button', { name: '发布' })).toBeDisabled();
  });

  it('全合法 → 先弹「发布后谱面本体不可修改」确认，确认后才调用发布', async () => {
    const onPublish = renderDialog();

    fillDescription();
    fireEvent.click(screen.getByRole('button', { name: '发布' }));

    const confirm = await screen.findByRole('alertdialog', { name: '发布后谱面本体不可修改' });
    expect(confirm).toHaveTextContent('谱面本身不能改、也不能删除');
    expect(confirm).toHaveTextContent('确定发布「Expert」？');
    // 票 50 #1：后果说明与问句拆两个键、\n 拼接，问句「确定发布…」独占一行
    const message = confirm.querySelector('.dialog__message');
    expect(message?.textContent).toContain('也不能删除。\n确定发布「Expert」？');
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

  it('已发布过的谱面：标题改「更新谱面」，主按钮是「更新」，不再挡成已发布错误', async () => {
    renderDialog({ chart: makeChart({ upload: { postId: 254203, at: AT } }) });
    // 票 54：标题说「这张窗干什么」（更新谱面），不拿状态词当标题
    expect(screen.getByRole('heading', { name: '更新谱面' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '已发布' })).toBeNull();
    expect(screen.getByRole('button', { name: '更新' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '发布' })).toBeNull();
    expect(screen.queryByText(/这张谱面已经发布过了/)).toBeNull();
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

  it('custom 缺封面：封面卡标必填缺失，发布键禁用', async () => {
    renderDialog({
      project: makeProject({ source: { type: 'custom' } }),
      onUpdateProject: vi.fn(),
      uploadRefs: {
        audio: { path: '/data/projects/p1/audio.bin', size: 1024, hash: 'a'.repeat(40) },
        cover: null,
      },
    });
    fillDescription('x');
    expect(screen.getByText('添加封面')).toBeInTheDocument();
    expect(screen.getByText('自定义曲目必填')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '发布' })).toBeDisabled());
  });

  it('custom 可就地设置封面：选图后写回工程', async () => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:cover' });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} });
    const onUpdateProject = vi.fn(async (updater: (p: ChartProject) => ChartProject | null) => {
      updater(makeProject({ source: { type: 'custom' } }));
    });
    renderDialog({
      project: makeProject({ source: { type: 'custom' } }),
      onUpdateProject,
      uploadRefs: {
        audio: { path: '/data/projects/p1/audio.bin', size: 1024, hash: 'a'.repeat(40) },
        cover: null,
      },
    });
    const file = new File([new Uint8Array([1])], 'cover.png', { type: 'image/png' });
    const input = document.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { files: [file] } });
    await waitFor(() => expect(onUpdateProject).toHaveBeenCalledTimes(1));

    const updater = onUpdateProject.mock.calls[0][0];
    const next = updater(makeProject({ source: { type: 'custom' } }));
    expect(next?.coverBlob).toBe(file);
    expect(next?.coverName).toBe('cover.png');
  });

  it('就地设置封面后重取上传引用：发帖载荷带上新封面', async () => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:cover' });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} });
    const audio = { path: '/data/projects/p1/audio.bin', size: 1024, hash: 'a'.repeat(40) };
    const cover = { path: '/data/projects/p1/cover.bin', size: 512, hash: 'b'.repeat(40) };
    const onUpdateProject = vi.fn(async (updater: (p: ChartProject) => ChartProject | null) => {
      updater(makeProject({ source: { type: 'custom' } }));
    });
    // 第一次（打开弹窗）没有封面；写回后第二次才读得到——载荷若吃旧 refs 就会漏封面
    const loadUploadRefs = vi.fn(async () => ({
      audio,
      cover: loadUploadRefs.mock.calls.length > 1 ? cover : null,
    }));
    const onPublish = renderDialog({
      project: makeProject({ source: { type: 'custom' } }),
      onUpdateProject,
      loadUploadRefs,
    });
    fillDescription('x');
    await waitFor(() => expect(loadUploadRefs).toHaveBeenCalledTimes(1));

    const file = new File([new Uint8Array([1])], 'cover.png', { type: 'image/png' });
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
    await waitFor(() => expect(loadUploadRefs).toHaveBeenCalledTimes(2));

    const input = await confirmAndPublish(onPublish);
    expect(input.song).toEqual({
      kind: 'custom',
      audio: { ...audio, fileName: 'official-413- excite.mp3' },
      cover: { ...cover, fileName: 'cover.png' },
    });
  });

  it('保存封面期间不把整个弹窗切成「发布中」：无状态行、取消仍可点、主键文案不变', async () => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:cover' });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} });
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const onUpdateProject = vi.fn(async () => { await pending; });
    renderDialog({
      project: makeProject({ source: { type: 'custom' } }),
      onUpdateProject,
      uploadRefs: {
        audio: { path: '/data/projects/p1/audio.bin', size: 1024, hash: 'a'.repeat(40) },
        cover: null,
      },
    });
    const file = new File([new Uint8Array([1])], 'cover.png', { type: 'image/png' });
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
    await waitFor(() => expect(document.querySelector('.cover-card')?.className).toContain('is-busy'));

    expect(document.querySelector('.off-status--busy')).toBeNull();
    expect(screen.getByRole('button', { name: '取消' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '发布' })).toBeInTheDocument();

    release();
    await waitFor(() => expect(document.querySelector('.cover-card')?.className).not.toContain('is-busy'));
  });

  it('custom 上传引用读不到：发布键禁用 + 就地一行（不静默放行）', async () => {
    renderDialog({ project: makeProject({ source: { type: 'custom' } }), uploadRefs: null });
    fillDescription('x');
    expect(await screen.findByText('本机文件读取失败，发布未完成。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发布' })).toBeDisabled();
  });
});

describe('票 11 · 发布弹窗：失败就地内联', () => {
  it('平台拒了：告警块留在弹窗里，可重试（仍过确认门）、可关闭（票 50 #2）', async () => {
    const onPublish = vi.fn(async () => ({ ok: false as const, failure: 'rejected' as const }));
    renderDialog({ onPublish });
    fillDescription('x');
    fireEvent.click(screen.getByRole('button', { name: '发布' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认发布' }));

    // 告警块内联在弹窗里，不关窗；文案点出可核对项（不猜平台拒绝的具体成因）
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('社区平台拒绝了这次发布。可核对标题、歌手、难度与等级、谱面与描述后重试。');
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // 重试：重新走不可逆确认门，而不是直接把请求再发一遍
    fireEvent.click(within(alert).getByRole('button', { name: '重试' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(onPublish).toHaveBeenCalledOnce();
    fireEvent.click(within(confirm).getByRole('button', { name: '确认发布' }));
    await waitFor(() => expect(onPublish).toHaveBeenCalledTimes(2));

    // 关闭：红块收起，弹窗留着继续改字段
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('连不上：告警块就地内联', async () => {
    renderDialog({ onPublish: async () => ({ ok: false, failure: 'offline' }) });
    fillDescription('x');
    fireEvent.click(screen.getByRole('button', { name: '发布' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认发布' }));
    expect(await screen.findByText('连不上社区平台，检查网络后重试。')).toBeInTheDocument();
  });
});

describe('票 58 · 发布结果待确认', () => {
  it('结果不明后只提供查帖操作，不再提供发布与重试', async () => {
    const onPublish = vi.fn(async () => ({ ok: false as const, failure: 'pending-confirmation' as const }));
    const onRecover = vi.fn(async () => false);
    renderDialog({ onPublish, onRecover });
    fillDescription();
    await confirmAndPublish(onPublish);
    expect(await screen.findByText('发布结果待确认')).toBeVisible();
    expect(screen.queryByRole('button', { name: '发布' })).toBeNull();
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
    expect(screen.getByRole('button', { name: '打开社区' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '重新核对' }));
    expect(onRecover).toHaveBeenCalledWith(undefined);
    expect(onPublish).toHaveBeenCalledOnce();
  });

  it('核对过程中不把发布键以「发布中」形态放回来', async () => {
    let finish!: (ok: boolean) => void;
    const onRecover = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const onPublish = vi.fn(async () => ({ ok: false as const, failure: 'pending-confirmation' as const }));
    renderDialog({ onPublish, onRecover });
    fillDescription();
    await confirmAndPublish(onPublish);
    fireEvent.click(await screen.findByRole('button', { name: '重新核对' }));
    expect(screen.queryByRole('button', { name: '发布' })).toBeNull();
    expect(screen.queryByRole('button', { name: '发布中…' })).toBeNull();
    finish(false);
    await waitFor(() => expect(screen.getByRole('button', { name: '重新核对' })).toBeEnabled());
  });

  it('关联已有帖子放在底栏，不占发布表单正文', () => {
    renderDialog({ onRecover: vi.fn(async () => false) });
    const associate = screen.getByRole('button', { name: '关联已有帖子' });
    expect(associate.closest('.dialog__foot')).not.toBeNull();
    expect(screen.queryByRole('textbox', { name: '帖子 ID' })).toBeNull();
  });

  it('手动关联已有帖子走独立的核对入口，无需补齐发布必填项', async () => {
    const onRecover = vi.fn(async () => true);
    const onClose = vi.fn();
    const onPublish = renderDialog({ onRecover, onClose });
    expect(screen.getByRole('button', { name: '发布' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '关联已有帖子' }));
    fireEvent.change(screen.getByRole('textbox', { name: '帖子 ID' }), { target: { value: '267296' } });
    fireEvent.click(screen.getByRole('button', { name: '核对并关联' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onRecover).toHaveBeenCalledWith(267296);
    expect(onPublish).not.toHaveBeenCalled();
  });

  it('关联已有帖子：点弹层外部自动收起（票 61）', () => {
    renderDialog({ onRecover: vi.fn(async () => false) });
    fireEvent.click(screen.getByRole('button', { name: '关联已有帖子' }));
    expect(screen.getByRole('textbox', { name: '帖子 ID' })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('textbox', { name: '帖子 ID' })).toBeNull();
  });

  it('补记后弹窗切到已上传态', async () => {
    function RecoverThenUploaded() {
      const [chart, setChart] = useState(makeChart());
      return (
        <PublishDialog
          project={makeProject({ charts: [chart] })}
          chart={chart}
          chartCode={CHART_CODE}
          onPublish={vi.fn()}
          onRecover={async (postId) => {
            setChart(makeChart({ upload: { postId: postId ?? 71, at: AT } }));
            return true;
          }}
        />
      );
    }
    render(<RecoverThenUploaded />);
    fireEvent.click(screen.getByRole('button', { name: '关联已有帖子' }));
    fireEvent.change(screen.getByRole('textbox', { name: '帖子 ID' }), { target: { value: '267296' } });
    fireEvent.click(screen.getByRole('button', { name: '核对并关联' }));
    expect(await screen.findByRole('heading', { name: '更新谱面' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更新' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '发布' })).toBeNull();
    expect(screen.queryByRole('button', { name: '关联已有帖子' })).toBeNull();
  });
});

describe('票 41 / 42 · 发布弹窗只读身份与就地编辑', () => {
  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    resetCommunityAccount();
  });

  it('有会话时画出昵称与头像（票 42 头部右侧）', async () => {
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
    // 2026-10-16 推翻票 42「仅头像」定案：昵称可见（账号名不双写，留 title 提示）
    expect(screen.getByText('Envy')).toBeInTheDocument();
    expect(screen.getByTitle('账号：envy09')).toBeInTheDocument();
    expect(screen.getByText('E')).toBeInTheDocument();
  });

  it('草稿持久化：打开时带出 chart.publishDraft', () => {
    renderDialog({
      chart: makeChart({ publishDraft: '草稿内容已带出' }),
    });
    expect(screen.getByPlaceholderText(DESCRIPTION)).toHaveValue('草稿内容已带出');
  });

  it('就地编辑：修改标题/歌手/难度/等级影响发帖入参', async () => {
    const onPublish = renderDialog({
      chart: makeChart({ title: 'Old Title', diff: 1, level: 10 }),
      project: makeProject({ artist: 'Old Artist' }),
    });

    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'New Title' } });
    fireEvent.change(screen.getByLabelText('歌手'), { target: { value: 'New Artist' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Expert' }));
    fireEvent.change(screen.getByLabelText('等级'), { target: { value: '28' } });
    fillDescription('new desc');

    const input = await confirmAndPublish(onPublish);
    expect(input.title).toBe('New Title');
    expect(input.artists).toBe('New Artist');
    expect(input.diff).toBe(3);
    expect(input.level).toBe(28);
    expect(input.content).toBe('new desc');
  });

  it('关窗时冲刷未到期的难度防抖，不丢刚改的值（票 43 Q2）', () => {
    const onUpdateProject = vi.fn();
    const onClose = vi.fn();
    render(
      <PublishDialog
        project={makeProject()}
        chart={makeChart()}
        chartCode={CHART_CODE}
        onPublish={vi.fn()}
        onUpdateProject={onUpdateProject}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Special' }));
    expect(onUpdateProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onUpdateProject).toHaveBeenCalledOnce();
  });

  it('打开发布弹窗不会触发 onUpdateProject，绝不改动最近修改时间', () => {
    const onUpdateProject = vi.fn();
    render(
      <PublishDialog
        project={makeProject()}
        chart={makeChart()}
        chartCode={CHART_CODE}
        onPublish={vi.fn()}
        onUpdateProject={onUpdateProject}
      />,
    );
    expect(onUpdateProject).not.toHaveBeenCalled();
  });

  it('信息区按「曲目标识 / 谱面概览」分组展示字段', () => {
    renderDialog();
    expect(screen.getByText('标题')).toBeInTheDocument();
    expect(screen.getByText('歌手')).toBeInTheDocument();
    expect(screen.getByText('难度 / 等级')).toBeInTheDocument();
    expect(screen.getByText('谱面概览')).toBeInTheDocument();
    expect(screen.getByText('音符')).toBeInTheDocument();
    expect(screen.getByText('时长')).toBeInTheDocument();
    expect(screen.getByText('BPM')).toBeInTheDocument();
    expect(screen.getByText('平均 NPS')).toBeInTheDocument();
    expect(screen.getByText('音频')).toBeInTheDocument();
    expect(document.querySelector('.ppc-identity > .ppc-field > .dialog-audio-bar')).not.toBeNull();
  });

  it('custom 缺音频时复用编辑工程信息的音轨条，设置入口带工程作用域跳转', async () => {
    const onOpenAudio = vi.fn();
    const onClose = vi.fn();
    renderDialog({
      project: makeProject({ source: { type: 'custom' }, audioName: null }),
      uploadRefs: {
        audio: null,
        cover: { path: '/data/projects/p1/cover.bin', size: 512, hash: 'b'.repeat(40) },
      },
      onOpenAudio,
      onClose,
    });
    await waitFor(() => expect(document.querySelector('.dialog-audio-bar.is-missing')).not.toBeNull());
    const bar = document.querySelector('.dialog-audio-bar.is-missing') as HTMLElement;
    fireEvent.click(within(bar).getByRole('button', { name: /设置/ }));
    expect(onOpenAudio).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('票 51 · 标签芯片与已发态', () => {
  it('回车添加标签芯片；空标签仍可发；tags 进发帖入参', async () => {
    const onPublish = renderDialog();
    const tagInput = screen.getByPlaceholderText('输入后按回车添加');
    expect(tagInput.closest('.ppc-post')).toContainElement(screen.getByPlaceholderText(DESCRIPTION));
    expect(screen.getByPlaceholderText(DESCRIPTION)).toHaveAttribute('rows', '6');
    fireEvent.change(tagInput, { target: { value: '結束バンド' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });
    expect(screen.getByText('結束バンド')).toBeInTheDocument();

    fillDescription('x');
    const input = await confirmAndPublish(onPublish);
    expect(input.tags).toEqual([{ type: 'text', data: '結束バンド' }]);
  });

  it('已发：标题/歌手/描述只读，难度/等级/标签可改；点更新直接 onEdit，无二次确认', async () => {
    const onPublish = vi.fn(async () => ({ ok: true as const, postId: 1, recordWritten: true }));
    const onEdit = vi.fn(async (input: { diff: number; level: number; tags: { type: 'text'; data: string }[] }) => {
      void input;
      return { ok: true as const };
    });
    renderDialog({
      chart: makeChart({
        upload: { postId: 254203, at: AT },
        tags: [{ type: 'text', data: 'old' }],
        publishDraft: '当时那份描述',
      }),
      onPublish,
      onEdit,
    });

    expect(screen.getByLabelText('标题')).toHaveAttribute('readOnly');
    expect(screen.getByLabelText('歌手')).toHaveAttribute('readOnly');
    expect(screen.getByPlaceholderText(DESCRIPTION)).toHaveAttribute('readOnly');
    expect(screen.getByPlaceholderText(DESCRIPTION)).toHaveValue('当时那份描述');
    expect(screen.getByRole('radio', { name: 'Special' })).toBeEnabled();
    expect(screen.getByLabelText('等级')).not.toHaveAttribute('readOnly');

    fireEvent.click(screen.getByRole('radio', { name: 'Special' }));
    fireEvent.change(screen.getByLabelText('等级'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: '移除标签 old' }));
    const tagInput = screen.getByPlaceholderText('输入后按回车添加');
    fireEvent.change(tagInput, { target: { value: 'gimmick' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });

    fireEvent.click(screen.getByRole('button', { name: '更新' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(onEdit).toHaveBeenCalledOnce());
    expect(onPublish).not.toHaveBeenCalled();
    expect(onEdit.mock.calls[0][0]).toEqual({
      diff: 4,
      level: 30,
      tags: [{ type: 'text', data: 'gimmick' }],
    });
  });

  it('已发：post/edit 失败则弹窗留着报错，不关窗', async () => {
    const onEdit = vi.fn(async () => ({ ok: false as const, failure: 'rejected' as const }));
    const onClose = vi.fn();
    render(
      <PublishDialog
        project={makeProject()}
        chart={makeChart({ upload: { postId: 1, at: AT } })}
        chartCode={CHART_CODE}
        onPublish={vi.fn()}
        onEdit={onEdit}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '更新' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('社区平台拒绝了这次发布');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('票 52 · 描述自动生成', () => {
  it('空描述不能发；点自动生成后可发；已有字再点直接覆盖', async () => {
    const onPublish = renderDialog();
    expect(screen.getByRole('button', { name: '发布' })).toBeDisabled();

    expect(screen.getByRole('button', { name: '拖动调整描述高度' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '自动生成' }));
    const generated = [
      'Difficulty: 24',
      'Notes: 1',
      'Length: 1:40',
      'BPM: 210',
    ].join('\n');
    expect(screen.getByPlaceholderText(DESCRIPTION)).toHaveValue(generated);
    expect(screen.getByRole('button', { name: '发布' })).toBeEnabled();

    fillDescription('旧稿');
    fireEvent.click(screen.getByRole('button', { name: '自动生成' }));
    expect(screen.getByPlaceholderText(DESCRIPTION)).toHaveValue(generated);

    const input = await confirmAndPublish(onPublish);
    expect(input.content).toBe(generated);
  });

  it('已发：没有自动生成', () => {
    renderDialog({ chart: makeChart({ upload: { postId: 1, at: AT }, publishDraft: '当时那份描述' }) });
    expect(screen.queryByRole('button', { name: '自动生成' })).toBeNull();
  });

  it('自动生成走 insertText，好进 Ctrl+Z 撤销栈', () => {
    const exec = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });
    try {
      renderDialog();
      fillDescription('旧稿');
      fireEvent.click(screen.getByRole('button', { name: '自动生成' }));
      expect(exec).toHaveBeenCalledWith('insertText', false, expect.stringContaining('Difficulty: 24'));
      expect(exec).toHaveBeenCalledWith('insertText', false, expect.stringContaining('Notes: 1'));
    } finally {
      Reflect.deleteProperty(document, 'execCommand');
    }
  });
});
