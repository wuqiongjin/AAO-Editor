// 动态形态工具栏的**导出入口**（chart-preview 07；票 20 定案：这一枚随本票落地，不做禁用占位钮）。
//
// 两块，都是**非模态**（票面：长谱导出不得阻塞页面交互）：
//   ① 规格弹层（文件格式 / 清晰度 / 声音 + 说明行 + 开始导出）—— 与「显示」面板同一套浮层壳；
//   ② 进度卡（按帧数走 + 取消 + 失败文案）—— portal 到 body、贴视口右下角，不带 scrim。
//
// **控件词汇与「显示」面板同一套**：
//   - **文件格式** / **清晰度** = 下拉（`.select-control`，同「图像品质」「轨道颜色」）；
//   - **声音** = 开关（`.switch`，同「色觉辅助」）——开 = 视频带声音，状态在控件上，不靠说明句；
//   - **文件格式**默认「自动（推荐）」= 按本机编码能力挑最通用的一格；
//   - **清晰度**只给档位名（1080p / 720p），尺寸在触发钮的 tooltip；
//   - **文案去术语化**：不说「容器」「编码器」「H.264 / AAC」；说明行见 `outcomeNote`。
//
// 为什么不复用全站弹窗壳：弹窗是模态的，导出期间会把舞台与工具栏整块遮住 ——
// 而导出一次可能要好几分钟（06 §5.4：软光栅下 1080p 约 0.26× 实时），那几分钟页面应当还能用。
//
// 组件本身**纯展示**（规格 / 进度 / 文案都从 props 进），跑导出的是 `useVideoExport` ——
// 锁测因此能在 jsdom 里直接驱动它，不必伪造 WebCodecs。
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clapperboard } from 'lucide-react';
import IconButton from '../../ui/IconButton';
import { t, type MessageKey } from '../../i18n';
import {
  CONTAINER_FALLBACK_ORDER,
  EXPORT_FPS,
  VIDEO_EXPORT_TIERS,
  isAacCodec,
  tierOf,
  type VideoContainerChoice,
  type VideoExportProgress,
  type VideoExportSupport,
  type VideoTierId,
} from '../../preview';
import type { VideoExportNotice, VideoExportSpec } from './useVideoExport';
// 面板定位的量算与「显示」面板共用一份（同一块浮层壳，盒宽口径必须一致，见 issue 29）
import { panelLayoutFor } from './PreviewDisplayPanel';
// 浮层复用菜单壳（与 PreviewDisplayPanel 同因：`.pp-menu__*` 定义在 ProjectsPage.css）
import '../projects/ProjectsPage.css';
import './PreviewPage.css';

/** 一行：[标签] [控件]（与「显示」面板同一套行版式；标签不许被控件挤成竖排） */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="pvex__row">
      <div className="pvex__row-text"><strong>{label}</strong></div>
      {children}
    </div>
  );
}

/** 下拉（与「显示」面板同一枚 `.select-control`——图像品质 / 轨道颜色那一套，不新造样式） */
function Select<T extends string>({
  value, label, options, onChange,
}: {
  value: T;
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <select
      className="select-control"
      value={value}
      aria-label={label}
      onChange={(e) => {
        const hit = options.find((o) => o.value === e.target.value);
        if (hit) onChange(hit.value);
      }}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** 开关（与「显示」面板同一枚 `.switch`——色觉辅助那一套）：开 / 关本身就是状态，不需要说明句 */
function Toggle({
  label, checked, onChange,
}: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch${checked ? ' is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

/** 进度卡的阶段文案 */
function phaseText(progress: VideoExportProgress): string {
  if (progress.phase === 'frames') {
    return t('preview.video.export.phase.frames', { frame: progress.frame, total: progress.totalFrames });
  }
  return t(`preview.video.export.phase.${progress.phase}` as MessageKey);
}

/**
 * 文件格式行下的说明行（`probeVideoExportSupport` 的结论，与真正导出同一判定）。
 *
 * 口径：**常识不占行** —— MP4 + 有 AAC 不出现（MP4 到处能放人人知道）；WebM 的兼容面用户未必知道，
 * 讲；自动降级与 mp4 + Opus 要讲（用户需要应对）。探不出结论不占位；"能不能导出来"归
 * `unsupported` 那条。措辞去术语化：不出现容器 / codec 名。
 */
function outcomeNote(
  support: VideoExportSupport | null,
  probing: boolean,
  choice: VideoContainerChoice,
  muted: boolean,
): string | null {
  if (probing) return t('preview.video.export.note.probing');
  if (!support) return null;
  if (!support.ok) return t('preview.video.export.unsupported');
  if (support.container === 'mp4') {
    // 静音导出文件里**没有音轨**，"MP4 放不出"这个前提不成立 ⇒ 警告是假命题，不占行
    // （此时探测回 audioCodec = null 只是"没探音频"，不是"本机没有 AAC"）
    if (muted) return null;
    // 有 AAC ⇒ 无可补充（常识）；无 AAC ⇒ mp4 壳装 Opus，要警告
    return support.audioCodec && isAacCodec(support.audioCodec)
      ? null
      : t('preview.video.export.note.mp4Opus');
  }
  return choice === 'auto'
    ? t('preview.video.export.note.webmFallback')
    : t('preview.video.export.note.webm');
}

export interface VideoExportControlProps {
  /** 没有可导出的谱面 / 素材未就绪 */
  disabled?: boolean;
  spec: VideoExportSpec;
  onSpecChange: (patch: Partial<VideoExportSpec>) => void;
  onStart: () => void;
  onCancel: () => void;
  /** null = 空闲（进度卡不出现） */
  progress: VideoExportProgress | null;
  /** 结果文案（失败 / 编码器不可用 / 已取消） */
  notice: VideoExportNotice | null;
  /** 本机实际会用的编码组合（null = 还没探）；面板打开时调 `onProbe` 探一次 */
  support?: VideoExportSupport | null;
  probing?: boolean;
  onProbe?: () => void;
}

export default function VideoExportControl({
  disabled = false,
  spec,
  onSpecChange,
  onStart,
  onCancel,
  progress,
  notice,
  support = null,
  probing = false,
  onProbe,
}: VideoExportControlProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLSpanElement>(null);
  /** 面板 portal 到 body ⇒ 它**不在** `btnRef` 里，判"点外面"必须把它也算进来 */
  const panelRef = useRef<HTMLDivElement>(null);

  const tier = tierOf(spec.tier);
  const busy = progress != null;

  /** 量触发钮定面板位；等值守卫免得平白制造一次重渲 */
  const computePos = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const next = panelLayoutFor(btn.getBoundingClientRect());
    setPos((prev) => (prev.top === next.top && prev.left === next.left ? prev : next));
  }, []);

  // 点面板外 / Esc 收起（不做焦点陷阱）。
  // **触发钮与面板都要算"里面"**：面板是 portal 出去的，只认触发钮的话，点面板里任何一颗
  // 控件都会被判成"点在外面" ⇒ mousedown 先把面板卸载，后面的 click 落在已摘除的节点上，
  // 表现为"弹窗里点什么都是关窗、且那个控件根本没生效"（2026-10-10 验收缺陷）。
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // 开着时跟随触发钮（issue 29 同款病灶：这一排贴页面右缘，伸缩窗口就把它挪走；
  // 不重新量的话面板停在旧位置、与触发钮脱节，右缘还会跑出视口）。
  // 跨帧补测：触发钮几何未必在 resize 当帧落定，延后两帧各量一次兜住字体 / 滚动条那类迟到几何。
  useEffect(() => {
    if (!open) return;
    let raf1 = 0;
    let raf2 = 0;
    const onResize = () => {
      computePos();
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      raf1 = requestAnimationFrame(() => {
        computePos();
        raf2 = requestAnimationFrame(computePos);
      });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [open, computePos]);

  const tierOptions = VIDEO_EXPORT_TIERS.map((v) => ({
    value: v.id,
    label: t(`preview.video.export.tier.${v.id}` as MessageKey),
  }));
  // 「自动（推荐）」在最前 = 出厂默认（按本机编码能力挑最通用的一格）；
  // 后两档是"明确要某个格式"，顺序照容器兜底表（MP4 在前，它通用性最好）
  const formatOptions: ReadonlyArray<{ value: VideoContainerChoice; label: string }> = [
    { value: 'auto', label: t('preview.video.export.format.auto') },
    ...CONTAINER_FALLBACK_ORDER.map((id) => ({
      value: id,
      label: t(`preview.video.export.format.${id}` as MessageKey),
    })),
  ];
  const note = outcomeNote(support, probing, spec.container, spec.muted);

  return (
    <div className="pvex">
      <span className="pvex__trigger" ref={btnRef}>
        <IconButton
          width="auto"
          size="sm"
          disabled={disabled || busy}
          icon={<Clapperboard size={15} />}
          label={busy ? t('preview.video.export') : t('preview.video.export.open')}
          title={t('preview.video.export.hint', { w: tier.width, h: tier.height, fps: EXPORT_FPS })}
          active={open}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => {
            if (!open) {
              computePos();
              onProbe?.(); // 面板一开就问一遍本机编码能力（下面那行结论要说的就是它）
            }
            setOpen(!open);
          }}
        />
      </span>

      {open && !busy && createPortal(
        <div
          ref={panelRef}
          className="pp-menu__panel is-portaled pdp__panel pvex__panel"
          style={{ top: pos.top, left: pos.left }}
          role="dialog"
          aria-label={t('preview.video.export.title')}
        >
          <section className="pvex__group">
            <h3 className="pvex__group-title">{t('preview.video.export.title')}</h3>
            {/* 行序：文件格式 → 清晰度 → 声音（声音收尾）；说明行是格式行的脚注，不与它隔开 */}
            <Row label={t('preview.video.export.format')}>
              <Select<VideoContainerChoice>
                label={t('preview.video.export.format')}
                value={spec.container}
                options={formatOptions}
                onChange={(v) => onSpecChange({ container: v })}
              />
            </Row>

            {note && <p className="pvex__note">{note}</p>}

            <Row label={t('preview.video.export.tier')}>
              <Select<VideoTierId>
                label={t('preview.video.export.tier')}
                value={spec.tier}
                options={tierOptions}
                onChange={(v) => onSpecChange({ tier: v })}
              />
            </Row>

            <Row label={t('preview.video.export.audio')}>
              <Toggle
                label={t('preview.video.export.audio')}
                checked={!spec.muted}
                onChange={(on) => onSpecChange({ muted: !on })}
              />
            </Row>

            <button
              type="button"
              className="action-btn pvex__start"
              onClick={() => {
                setOpen(false);
                onStart();
              }}
            >
              {t('preview.video.export.start')}
            </button>
          </section>
        </div>,
        document.body,
      )}

      {/* 进度卡（非模态）：贴视口右下角，不带 scrim —— 导出期间页面其余部分照样能点 */}
      {busy && progress && createPortal(
        <div className="pvex__card" role="status" aria-live="polite">
          <span className="pvex__card-text">{phaseText(progress)}</span>
          {progress.phase === 'frames' && progress.totalFrames > 0 && (
            <progress
              className="pvex__card-bar"
              max={progress.totalFrames}
              value={progress.frame}
              aria-label={t('preview.video.export.title')}
            />
          )}
          <button type="button" className="action-btn pvex__card-cancel" onClick={onCancel}>
            {t('preview.video.export.cancel')}
          </button>
        </div>,
        document.body,
      )}

      {/* 结果文案（失败 / 编码器不可用 / 已取消）：读屏立刻打断 */}
      {notice && createPortal(
        <div className={`pvex__card pvex__card--${notice.tone}`} role="alert">
          <span className="pvex__card-text">{notice.text}</span>
        </div>,
        document.body,
      )}
    </div>
  );
}