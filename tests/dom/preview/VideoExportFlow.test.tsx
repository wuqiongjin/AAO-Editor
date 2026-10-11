// @vitest-environment jsdom
// 视频导出的进度 / 取消 / 失败态（chart-preview 07 的锁测②）。
//
// 三条（票面「UI 必须给进度 + 取消 + 失败态」）：
//   ① 进度按**帧数**走（06 §5.4：软光栅下"≈ 歌曲时长"这个估法会差到 4 倍）；
//   ② 取消是随时可得的一枚钮；
//   ③ 编码器不可用时给**明确文案**（`isConfigSupported` 为 false → 说清楚，不静默失败）。
//
// 组件是纯展示的（规格 / 进度 / 文案都从 props 进），所以这里不必伪造 WebCodecs
// —— 编码那一段只能端到端人工验收。
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { t } from '@/src/i18n';
import VideoExportControl from '@/src/pages/preview/VideoExportControl';
import { useVideoExport, type UseVideoExportArgs } from '@/src/pages/preview/useVideoExport';
import type { VideoExportOutcome, VideoExportSupport } from '@/src/preview';
import type { VideoExportSpec } from '@/src/pages/preview/useVideoExport';

const outcome = (patch: Partial<VideoExportOutcome>): VideoExportOutcome => ({
  ok: true,
  cancelled: false,
  unsupported: false,
  bytes: 0,
  container: null,
  elapsedMs: 0,
  ...patch,
});

const args: UseVideoExportArgs = {
  // `scene: null` 时 start() 直接返回（没有可导出的谱面），故给一份空谱当"有得导"
  scene: {
    notes: [],
    beatDisplay: 4,
    noteSpeed: 9.5,
    noteSize: 1,
    slideOpacity: 0.8,
    simultaneousClickLines: true,
    colorAssist: false,
    mirror: false,
  },
  audio: null,
  durationSeconds: 30,
  keySetId: 'skin00',
  seVolume: 0.8,
  volume: 1,
  noteSkin: {},
  suggestedBaseName: '曲-EZ-回放',
};

/** 默认档 = 出厂规格（容器默认「自动」，见 exportSpec 的 candidateOrder） */
const spec = { tier: '1080p', container: 'auto', muted: false } as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('导出进度卡 · 按帧数走 + 可取消', () => {
  it('进度条与文案按帧数走（30 / 120），不是按"≈ 歌曲时长"估', () => {
    render(
      <VideoExportControl
        spec={spec}
        onSpecChange={() => undefined}
        onStart={() => undefined}
        onCancel={() => undefined}
        progress={{ phase: 'frames', frame: 30, totalFrames: 120 }}
        notice={null}
      />,
    );
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('max', '120');
    expect(bar).toHaveAttribute('value', '30');
    expect(screen.getByText(t('preview.video.export.phase.frames', { frame: 30, total: 120 }))).toBeInTheDocument();
  });

  it('音轨编码有自己的阶段文案，且这一步不显示帧数进度条', () => {
    render(
      <VideoExportControl
        spec={spec}
        onSpecChange={() => undefined}
        onStart={() => undefined}
        onCancel={() => undefined}
        progress={{ phase: 'audioEncode', frame: 0, totalFrames: 2100 }}
        notice={null}
      />,
    );
    expect(screen.getByText(t('preview.video.export.phase.audioEncode'))).toBeInTheDocument();
    // 进度条只属于 frames 阶段（音轨/封装阶段别装作有帧数进度）
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('取消钮随时在，点了就回调（导出中按钮自己变忙、不再触发第二次）', () => {
    const onCancel = vi.fn();
    render(
      <VideoExportControl
        spec={spec}
        onSpecChange={() => undefined}
        onStart={() => undefined}
        onCancel={onCancel}
        progress={{ phase: 'frames', frame: 30, totalFrames: 120 }}
        notice={null}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t('preview.video.export.cancel') }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    // 导出期间入口本身不可点（防重复起票）
    expect(screen.getByRole('button', { name: t('preview.video.export') })).toBeDisabled();
  });

  it('非模态：进度卡不带 scrim（长谱导出不得阻塞页面交互）', () => {
    const { container } = render(
      <VideoExportControl
        spec={spec}
        onSpecChange={() => undefined}
        onStart={() => undefined}
        onCancel={() => undefined}
        progress={{ phase: 'frames', frame: 1, totalFrames: 10 }}
        notice={null}
      />,
    );
    expect(container.querySelector('.pp-menu__scrim')).toBeNull();
    expect(document.querySelector('.pp-menu__scrim')).toBeNull();
  });

  it('准备 / 音轨 / 封装那三段也给得出阶段文案（不卡在"没动静"上）', () => {
    for (const phase of ['assets', 'audio', 'muxing'] as const) {
      const { unmount } = render(
        <VideoExportControl
          spec={spec}
          onSpecChange={() => undefined}
          onStart={() => undefined}
          onCancel={() => undefined}
          progress={{ phase, frame: 0, totalFrames: 1800 }}
          notice={null}
        />,
      );
      expect(screen.getByText(t(`preview.video.export.phase.${phase}`))).toBeInTheDocument();
      unmount();
    }
  });
});

describe('规格弹层 · 点里面不关、点外面才关', () => {
  const openPanel = (onSpecChange: () => void) => {
    render(
      <VideoExportControl
        spec={spec}
        onSpecChange={onSpecChange}
        onStart={() => undefined}
        onCancel={() => undefined}
        progress={null}
        notice={null}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t('preview.video.export.open') }));
    return screen.getByRole('dialog', { name: t('preview.video.export.title') });
  };

  it('点面板里的控件**不关**面板，且那颗控件真的生效（面板是 portal 出去的）', () => {
    const onSpecChange = vi.fn();
    openPanel(onSpecChange);
    const sound = screen.getByRole('switch', { name: t('preview.video.export.audio') });
    // 真实事件序：mousedown → click。缺陷形态是 mousedown 先把面板卸载，click 就落在已摘除的节点上
    fireEvent.mouseDown(sound);
    fireEvent.click(sound);
    expect(onSpecChange).toHaveBeenCalledWith({ muted: true });
    expect(screen.getByRole('dialog', { name: t('preview.video.export.title') })).toBeInTheDocument();
  });

  it('点面板里的下拉也不关（清晰度 / 文件格式）', () => {
    openPanel(() => undefined);
    fireEvent.mouseDown(screen.getByRole('combobox', { name: t('preview.video.export.tier') }));
    expect(screen.getByRole('dialog', { name: t('preview.video.export.title') })).toBeInTheDocument();
  });

  it('点面板**外**才关（这条没退化成"点哪都关"）', () => {
    openPanel(() => undefined);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog', { name: t('preview.video.export.title') })).toBeNull();
  });
});

describe('本机编码能力 · 说明跟着探测结论走（不写死"AAC 不可用"）', () => {
  const withSupport = (
    support: VideoExportSupport | null,
    over: Partial<VideoExportSpec> = {},
    onSpecChange: (patch: Partial<VideoExportSpec>) => void = () => undefined,
  ) => {
    render(
      <VideoExportControl
        spec={{ ...spec, ...over }}
        onSpecChange={onSpecChange}
        onStart={() => undefined}
        onCancel={() => undefined}
        progress={null}
        notice={null}
        support={support}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t('preview.video.export.open') }));
  };

  it('自动 + 本机导得出 MP4 + 有 AAC：**不出现**说明行（"MP4 到处能放"是常识，废话）', () => {
    withSupport({ ok: true, container: 'mp4', videoCodec: 'avc1.640033', audioCodec: 'mp4a.40.2' });
    expect(document.querySelector('.pvex__note')).toBeNull();
  });

  it('自动但本机导不出 MP4：说清"将改用 WebM"与它能去哪放', () => {
    withSupport({ ok: true, container: 'webm', videoCodec: 'vp09.00.10.08', audioCodec: 'opus' });
    expect(screen.getByText(t('preview.video.export.note.webmFallback'))).toBeInTheDocument();
  });

  it('手选 WebM：一句平实说明（不必解释"为什么不是 MP4"）', () => {
    withSupport(
      { ok: true, container: 'webm', videoCodec: 'vp09.00.10.08', audioCodec: 'opus' },
      { container: 'webm' },
    );
    expect(screen.getByText(t('preview.video.export.note.webm'))).toBeInTheDocument();
  });

  it('手选 MP4 但本机导出的 MP4 兼容性差：直说"建议改用 WebM"', () => {
    withSupport(
      { ok: true, container: 'mp4', videoCodec: 'avc1.640033', audioCodec: 'opus' },
      { container: 'mp4' },
    );
    expect(screen.getByText(t('preview.video.export.note.mp4Opus'))).toBeInTheDocument();
  });

  it('静音导出：**不出现** MP4 兼容性警告（文件里没有音轨，那句是假命题）', () => {
    // 静音探测回 audioCodec = null = "没探音频"，不是"本机没有 AAC"
    withSupport({ ok: true, container: 'mp4', videoCodec: 'avc1.640033', audioCodec: null }, { muted: true });
    expect(document.querySelector('.pvex__note')).toBeNull();
  });

  it('还没探出结论时**不出现**那一行（不写"尚未检测"这类占位废话）', () => {
    withSupport(null);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText(/尚未检测/)).toBeNull();
    expect(document.querySelector('.pvex__note')).toBeNull();
  });

  it('三行顺序：文件格式 → 清晰度 → 声音（声音收尾）', () => {
    withSupport({ ok: true, container: 'mp4', videoCodec: 'avc1.640033', audioCodec: 'mp4a.40.2' });
    expect(
      [...document.querySelectorAll('.pvex__row .pvex__row-text strong')].map((n) => n.textContent),
    ).toEqual([
      t('preview.video.export.format'),
      t('preview.video.export.tier'),
      t('preview.video.export.audio'),
    ]);
  });

  it('说明行紧跟格式行（它是格式的脚注，不与它隔开）', () => {
    withSupport({ ok: true, container: 'webm', videoCodec: 'vp09.00.10.08', audioCodec: 'opus' });
    const group = document.querySelector('.pvex__group')!;
    const flow = [...group.children].map((n) => {
      if (n.classList.contains('pvex__group-title')) return 'title';
      if (n.classList.contains('pvex__row')) return n.querySelector('.pvex__row-text strong')!.textContent;
      if (n.classList.contains('pvex__note')) return 'note';
      return 'btn';
    });
    expect(flow).toEqual([
      'title',
      t('preview.video.export.format'),
      'note',
      t('preview.video.export.tier'),
      t('preview.video.export.audio'),
      'btn',
    ]);
  });

  it('探测中：给一行"正在检测"，不装作没事发生', () => {
    render(
      <VideoExportControl
        spec={spec}
        onSpecChange={() => undefined}
        onStart={() => undefined}
        onCancel={() => undefined}
        progress={null}
        notice={null}
        probing
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t('preview.video.export.open') }));
    expect(screen.getByText(t('preview.video.export.note.probing'))).toBeInTheDocument();
  });

  it('探测失败：直接给"没有可用编码器"那句，不装没事发生', () => {
    withSupport({ ok: false, container: null, reason: 'video' });
    expect(screen.getByText(t('preview.video.export.unsupported'))).toBeInTheDocument();
  });

  it('文件格式是一个下拉：默认「自动（推荐）」，三档（自动 / MP4 / WebM）', () => {
    withSupport({ ok: true, container: 'mp4', videoCodec: 'avc1.640033', audioCodec: 'mp4a.40.2' });
    const select = screen.getByRole('combobox', { name: t('preview.video.export.format') });
    expect(select).toHaveValue('auto');
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      t('preview.video.export.format.auto'),
      t('preview.video.export.format.mp4'),
      t('preview.video.export.format.webm'),
    ]);
    // 默认档（MP4 + 有 AAC）**不出现**说明行：那里没有用户不知道的事实
    expect(document.querySelector('.pvex__note')).toBeNull();
  });

  it('手选 WebM 就写进规格（不静默）', () => {
    const onSpecChange = vi.fn();
    withSupport(null, {}, onSpecChange);
    fireEvent.change(screen.getByRole('combobox', { name: t('preview.video.export.format') }), {
      target: { value: 'webm' },
    });
    expect(onSpecChange).toHaveBeenCalledWith({ container: 'webm' });
  });

  it('声音是一枚开关：开 = 视频带声音（状态在控件上，不靠说明句）', () => {
    withSupport(null);
    expect(screen.getByRole('switch', { name: t('preview.video.export.audio') })).toHaveAttribute('aria-checked', 'true');
  });

  it('关掉声音就写进规格（muted）', () => {
    const onSpecChange = vi.fn();
    withSupport(null, {}, onSpecChange);
    fireEvent.click(screen.getByRole('switch', { name: t('preview.video.export.audio') }));
    expect(onSpecChange).toHaveBeenCalledWith({ muted: true });
  });

  it('静音导出（muted）时开关是关的', () => {
    withSupport(null, { muted: true });
    expect(screen.getByRole('switch', { name: t('preview.video.export.audio') })).toHaveAttribute('aria-checked', 'false');
  });

  it('面板三行（文件格式 / 清晰度 / 声音）与「显示」面板同一套控件：两个下拉 + 一枚开关', () => {
    withSupport(null);
    expect(screen.getAllByRole('combobox').map((s) => s.getAttribute('aria-label'))).toEqual([
      t('preview.video.export.format'),
      t('preview.video.export.tier'),
    ]);
    expect(screen.getByRole('switch', { name: t('preview.video.export.audio') })).toBeInTheDocument();
  });

  it('清晰度默认 1080p，两档只有档位名', () => {
    withSupport(null);
    const select = screen.getByRole('combobox', { name: t('preview.video.export.tier') });
    expect(select).toHaveValue('1080p');
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      t('preview.video.export.tier.1080p'),
      t('preview.video.export.tier.720p'),
    ]);
  });
});

describe('失败态 · 明确文案，不静默', () => {
  it('编码器不可用：给"没有可用视频编码器"的明确文案（读屏立刻打断）', () => {
    render(
      <VideoExportControl
        spec={spec}
        onSpecChange={() => undefined}
        onStart={() => undefined}
        onCancel={() => undefined}
        progress={null}
        notice={{ text: t('preview.video.export.unsupported'), tone: 'danger' }}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(t('preview.video.export.unsupported'));
  });

  it('域那一层说"不支持" → 页面把它翻成那句明确文案（不吞掉、也不空着）', async () => {
    const run = vi.fn(async () => outcome({ ok: false, unsupported: true }));
    const { result } = renderHook(() => useVideoExport(args, run));
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.notice?.text).toBe(t('preview.video.export.unsupported'));
    expect(result.current.notice?.tone).toBe('danger');
  });

  it('素材没就绪：给一句能照做的文案（i18n 出，不吐域层中文）', async () => {
    const run = vi.fn(async () => outcome({ ok: false, failure: 'assets' }));
    const { result } = renderHook(() => useVideoExport(args, run));
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.notice?.text).toBe(t('preview.video.export.failedAssets'));
    expect(result.current.notice?.tone).toBe('danger');
  });

  it('普通失败：通用失败文案；原始错误不进界面（已在 console）', async () => {
    const run = vi.fn(async () => outcome({ ok: false, failure: 'unknown' }));
    const { result } = renderHook(() => useVideoExport(args, run));
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.notice?.text).toBe(t('preview.video.export.failed'));
    expect(result.current.notice?.tone).toBe('danger');
  });

  it('取消是"已取消"，不是失败（两种结局文案不同）', async () => {
    const run = vi.fn(async () => outcome({ ok: true, cancelled: true }));
    const { result } = renderHook(() => useVideoExport(args, run));
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.notice?.text).toBe(t('preview.video.export.cancelled'));
    expect(result.current.notice?.tone).toBe('warn');
  });

  it('成功不留文案（成功走 toast，不再占一张卡）', async () => {
    const run = vi.fn(async () => outcome({ ok: true, bytes: 1024 }));
    const { result } = renderHook(() => useVideoExport(args, run));
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.notice).toBeNull();
    expect(result.current.progress).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it('issue 34 #1：结果卡片带关闭按钮，点击触发 onDismissNotice', () => {
    const onDismiss = vi.fn();
    render(
      <VideoExportControl
        spec={spec}
        onSpecChange={() => undefined}
        onStart={() => undefined}
        onCancel={() => undefined}
        progress={null}
        notice={{ text: t('preview.video.export.failed'), tone: 'danger' }}
        onDismissNotice={onDismiss}
      />,
    );
    const closeBtn = screen.getByRole('button', { name: t('ui.dismiss') });
    expect(closeBtn).toBeInTheDocument();
    fireEvent.click(closeBtn);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('issue 34 #1：notice 在 5 秒后自动消失', async () => {
    vi.useFakeTimers();
    try {
      const run = vi.fn(async () => outcome({ ok: false, failure: 'unknown' }));
      const { result } = renderHook(() => useVideoExport(args, run));
      let startPromise: Promise<void> | undefined;
      act(() => {
        startPromise = result.current.start();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
        await startPromise;
      });
      expect(result.current.notice).not.toBeNull();
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(result.current.notice).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('issue 34 #4：开场组具备帮助图标且描述不单独占行', () => {
    render(
      <VideoExportControl
        spec={spec}
        opening={{ enabled: true, items: { difficulty: true, title: true, artist: true } }}
        onOpeningChange={() => undefined}
        onSpecChange={() => undefined}
        onStart={() => undefined}
        onCancel={() => undefined}
        progress={null}
        notice={null}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: t('preview.video.export.open') }));
    // 开场标题
    expect(screen.getByText(t('preview.video.export.opening'))).toBeInTheDocument();
    // 问号帮助图标包含描述 tooltip，且点击能弹出 popover 气泡
    const help = screen.getByLabelText(t('preview.video.export.opening.note', { seconds: 5 }));
    expect(help).toBeInTheDocument();
    expect(screen.queryByRole('tooltip')).toBeNull();

    // 点击弹出说明气泡
    fireEvent.click(help);
    expect(screen.getByRole('tooltip')).toHaveTextContent(t('preview.video.export.opening.note', { seconds: 5 }));

    // 再次点击收起
    fireEvent.click(help);
    expect(screen.queryByRole('tooltip')).toBeNull();

    // 独立的大段描述段落不再出现
    expect(document.querySelector('.pvex__group--sub .pvex__note')).toBeNull();
  });
});
