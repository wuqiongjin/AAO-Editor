// 工程管理页的两个表单弹窗：新建（四项来源）/ 编辑工程信息。
//
// 四项来源（票 12 归类，界面按这个说话）：空白创建 / 从本地谱面导入 / 从官方谱面导入 / 从社区谱面导入。
// 官方这一支（票 08）实做在 OfficialSongPanel + officialImport；社区这一支（票 09）
// 实做在 CommunityPostPanel + communityImport —— 两支共用同一颗 lg 窗（票 13 #5/#6）。
import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, CircleHelp, Copy, Disc3, FolderPlus, Music4, SlidersHorizontal, Tag, Users } from 'lucide-react';
import type { ChartDifficulty, ChartProject } from '../../../project/ChartProject';
import { DIFF_NAMES, type updateProjectInfo } from '../../../project/projectCatalog';
import { displayProjectName, untitledProjectLabel } from '../../../project/ui/projectUi';
import ActionBtn from '../../../ui/ActionBtn';
import CoverField, { useCoverUrl, type CoverValue } from '../../../ui/CoverField';
import Dialog from '../../../ui/Dialog';
import { showToast } from '../../../ui/Toast';
import type { CommunityTransport } from '../../../community/transport';
import { t, type MessageKey } from '../../../i18n';
import { formatDuration } from '../projectFormat';
import type { OfficialImportStage } from '../officialImport';
import type { CommunityImportStage } from '../communityImport';
import { OfficialSongPanel, type OfficialSongSelection } from './OfficialSongPanel';
import { CommunityPostPanel, type CommunityPostSelection } from './CommunityPostPanel';

/** 导入阶段 → 文案键（与 OfficialImportStage 同一处：漏一个编译不过，别用模板串拼键） */
const STAGE_KEYS = {
  audio: 'projects.official.stage.audio',
  cover: 'projects.official.stage.cover',
  chart: 'projects.official.stage.chart',
  save: 'projects.official.stage.save',
} satisfies Record<OfficialImportStage, MessageKey>;

/** 社区导入的阶段键（与官方同一组阶段；chart 那句不同——取的是社区谱面） */
const COMMUNITY_STAGE_KEYS = {
  audio: 'projects.community.stage.audio',
  cover: 'projects.community.stage.cover',
  chart: 'projects.community.stage.chart',
  save: 'projects.community.stage.save',
} satisfies Record<CommunityImportStage, MessageKey>;

export type NewSource = 'blank' | 'copy' | 'official' | 'community';

/** 官方导入的回执：失败时给一句能读的话（按错误域 kind 翻的）；成功可带降级警告（票 26，Toast 展示） */
export type OfficialImportReply =
  | { ok: true; warnings?: string[] }
  | { ok: false; message: string; cancelled?: boolean };

/** 社区导入的回执（形状同官方；社区导入没有「谱面降级」，警告只有封面缺失一种） */
export type CommunityImportReply = OfficialImportReply;

export function NewProjectDialog({
  initialSource, projects, onClose, onCreate, onCopy, onImportOfficial, onImportCommunity, transport, importSources = false,
}: {
  initialSource: NewSource;
  projects: ChartProject[];
  onClose: () => void;
  onCreate: (input: { name: string; artist: string; diff: ChartDifficulty }) => void;
  onCopy: (projectId: string) => void;
  onImportOfficial: (
    selection: OfficialSongSelection,
    onStage: (stage: OfficialImportStage) => void,
    signal?: AbortSignal,
  ) => Promise<OfficialImportReply>;
  onImportCommunity: (
    selection: CommunityPostSelection,
    onStage: (stage: CommunityImportStage) => void,
    signal?: AbortSignal,
  ) => Promise<CommunityImportReply>;
  /** 注入点：测试塞假出口；不传走 IPC 出口 */
  transport?: CommunityTransport;
  /** 有没有社区平台出口：静态演示版只留前两支（票 12 / ADR-0011 §1） */
  importSources?: boolean;
}) {
  const [source, setSource] = useState<NewSource>(initialSource);
  const [name, setName] = useState('');
  const [artist, setArtist] = useState('');
  const [diff, setDiff] = useState<ChartDifficulty>(3);
  const [copyFrom, setCopyFrom] = useState(projects[0]?.id ?? '');
  const [official, setOfficial] = useState<OfficialSongSelection | null>(null);
  const [community, setCommunity] = useState<CommunityPostSelection | null>(null);
  // 票 45：导入中可以取消。关窗 / 取消键 abort，编排在落盘前看到 aborted 就不建工程。
  const [stage, setStage] = useState<OfficialImportStage | null>(null);
  const busy = stage !== null;
  const importAbort = useRef<AbortController | null>(null);

  const pickOfficial = useCallback((next: OfficialSongSelection | null) => setOfficial(next), []);
  const pickCommunity = useCallback((next: CommunityPostSelection | null) => setCommunity(next), []);
  const close = () => {
    importAbort.current?.abort();
    importAbort.current = null;
    onClose();
  };

  const submit = () => {
    if (source === 'copy') { onCopy(copyFrom); return; }
    if (source === 'official') {
      if (!official) return;
      const abort = new AbortController();
      importAbort.current = abort;
      setStage('audio');
      void onImportOfficial(official, setStage, abort.signal)
        .then((reply) => {
          if (abort.signal.aborted || (!reply.ok && reply.cancelled)) return;
          if (!reply.ok) {
            showToast(reply.message, 'danger');
            setStage(null);
          }
        })
        .catch(() => {
          if (abort.signal.aborted) return;
          showToast(t('projects.official.err.generic'), 'danger');
          setStage(null);
        });
      return;
    }
    if (source === 'community') {
      if (!community) return;
      const abort = new AbortController();
      importAbort.current = abort;
      setStage('audio');
      void onImportCommunity(community, setStage, abort.signal)
        .then((reply) => {
          if (abort.signal.aborted || (!reply.ok && reply.cancelled)) return;
          if (!reply.ok) {
            showToast(reply.message, 'danger');
            setStage(null);
          }
        })
        .catch(() => {
          if (abort.signal.aborted) return;
          showToast(t('projects.community.err.generic'), 'danger');
          setStage(null);
        });
      return;
    }
    onCreate({ name, artist, diff });
  };

  const confirmDisabled = busy
    || (source === 'copy' && !copyFrom)
    || (source === 'official' && !official)
    || (source === 'community' && !community);
  const pickerShell = source === 'official' || source === 'community';
  const noLocalProject = projects.length === 0;

  return (
    <Dialog
      // 空白/本地 md、官方/社区 lg：同一颗窗改 size + 宽高过渡，遮罩不卸（票 13 #6）
      size={pickerShell ? 'lg' : 'md'}
      clipBody={pickerShell}
      title={t('projects.newDialogTitle')}
      onClose={close}
      footer={(
        <>
            <ActionBtn onClick={close}>{t('projects.cancel')}</ActionBtn>
          <ActionBtn variant="primary" disabled={confirmDisabled} onClick={submit}>
            {source === 'copy' ? t('projects.copyAction') : t('projects.createOpen')}
          </ActionBtn>
        </>
      )}
    >
      <div className="dialog-tabs">
        <button type="button" className={source === 'blank' ? 'is-active' : ''} disabled={busy} onClick={() => setSource('blank')}>
          <FolderPlus size={14} />{t('projects.tabBlank')}
        </button>
        <button
          type="button"
          className={source === 'copy' ? 'is-active' : ''}
          disabled={busy || noLocalProject}
          title={noLocalProject ? t('projects.copyDisabledHint') : undefined}
          onClick={() => setSource('copy')}
        >
          <Copy size={14} />{t('projects.tabCopy')}
        </button>
        {importSources && (
          <>
            <button type="button" className={source === 'official' ? 'is-active' : ''} disabled={busy} onClick={() => setSource('official')}>
              <Music4 size={14} />{t('projects.tabOfficial')}
            </button>
            <button type="button" className={source === 'community' ? 'is-active' : ''} disabled={busy} onClick={() => setSource('community')}>
              <Users size={14} />{t('projects.tabCommunity')}
            </button>
          </>
        )}
      </div>

      {source === 'copy' && (
        <label className="dialog-field">
          <span>{t('projects.copyWhich')}</span>
          <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{t('projects.copyCharts', { name: displayProjectName(p), count: p.charts.length })}</option>
            ))}
          </select>
          <small>{t('projects.copyHint')}</small>
        </label>
      )}

      {source === 'blank' && (
        <>
          <div className="dialog-field-row">
            <label className="dialog-field"><span>{t('projects.name')}</span><input value={name} placeholder={untitledProjectLabel()} onChange={(e) => setName(e.target.value)} /></label>
            <label className="dialog-field"><span>{t('projects.artist')}</span><input value={artist} placeholder={t('projects.artistLater')} onChange={(e) => setArtist(e.target.value)} /></label>
          </div>
          <label className="dialog-field">
            <span>{t('projects.firstDiff')}</span>
            <select value={diff} onChange={(e) => setDiff(Number(e.target.value) as ChartDifficulty)}>
              {DIFF_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
            </select>
          </label>
        </>
      )}

      {source === 'official' && (
        <>
          <OfficialSongPanel selection={official} onSelectionChange={pickOfficial} transport={transport} />
          {stage && (
            <p className="off-status off-status--busy" role="status">
              <span className="off-spinner" aria-hidden="true" />
              {t(STAGE_KEYS[stage])}
            </p>
          )}
        </>
      )}

      {source === 'community' && (
        <>
          <CommunityPostPanel onSelectionChange={pickCommunity} transport={transport} />
          {stage && (
            <p className="off-status off-status--busy" role="status">
              <span className="off-spinner" aria-hidden="true" />
              {t(COMMUNITY_STAGE_KEYS[stage])}
            </p>
          )}
        </>
      )}
    </Dialog>
  );
}

function DialogMarquee({ text }: { text: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [contentWidth, setContentWidth] = useState(0);

  useEffect(() => {
    const measure = () => {
      if (!containerRef.current || !measureRef.current) return;
      const cWidth = containerRef.current.clientWidth;
      const sWidth = measureRef.current.scrollWidth;
      setContentWidth(sWidth);
      setOverflow(sWidth > cWidth + 4);
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (observer && containerRef.current) observer.observe(containerRef.current);
    return () => observer?.disconnect();
  }, [text]);

  const gap = 48;
  const cycleDist = contentWidth + gap;
  // 匀速单向循环滚动速度约 32px/s，加上开头静止阅读 2.5s（占 25% 周期）
  const totalSec = Math.max(8, cycleDist / 24);

  if (!overflow) {
    return (
      <div ref={containerRef} className="dialog-marquee" title={text}>
        <span ref={measureRef} className="dialog-marquee__content">
          {text}
        </span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="dialog-marquee is-overflowing" title={text}>
      {/* 隐藏的测量 span，用于精确计算文本自然宽度 */}
      <span ref={measureRef} className="dialog-marquee__measure" aria-hidden="true">
        {text}
      </span>
      <div
        className="dialog-marquee__track"
        style={{
          '--marquee-dist': `-${cycleDist}px`,
          '--marquee-dur': `${totalSec.toFixed(2)}s`,
          gap: `${gap}px`,
        } as React.CSSProperties}
      >
        <span className="dialog-marquee__item">{text}</span>
        <span className="dialog-marquee__item" aria-hidden="true">{text}</span>
      </div>
    </div>
  );
}

export function EditInfoDialog({ project, onClose, onSave, onOpenAudio }: {
  project: ChartProject;
  onClose: () => void;
  onSave: (patch: Parameters<typeof updateProjectInfo>[1]) => void;
  onOpenAudio?: () => void;
}) {
  const [name, setName] = useState(project.name ?? '');
  const [artist, setArtist] = useState(project.artist ?? '');
  // 封面三态：null 沿用既有 / File 新选 / 'clear' 清除（保存时按此推导 patch 出参）
  const [cover, setCover] = useState<CoverValue>(null);
  // 只管既有封面的 URL：新选的 File 由 CoverField 自己开，同一张图不建两次 objectURL。
  const existingPreview = useCoverUrl(project.coverBlob);

  const [showSourceHelp, setShowSourceHelp] = useState(false);
  const showSourceHelpRef = useRef(showSourceHelp);
  showSourceHelpRef.current = showSourceHelp;
  const helpRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showSourceHelp) return;
    const handleClickOutside = (e: PointerEvent | MouseEvent) => {
      if (helpRef.current && !helpRef.current.contains(e.target as Node)) {
        setShowSourceHelp(false);
      }
    };
    window.addEventListener('pointerdown', handleClickOutside, true);
    return () => {
      window.removeEventListener('pointerdown', handleClickOutside, true);
    };
  }, [showSourceHelp]);

  // 当问号气泡展开时，Esc 或外层触发先仅收起气泡，不误关整个编辑弹窗
  const handleDialogClose = () => {
    if (showSourceHelpRef.current) {
      setShowSourceHelp(false);
      return;
    }
    onClose();
  };

  const isBandori = project.source.type === 'bandori';
  const sourceHint = isBandori
    ? t('projects.sourceBandoriHint')
    : t('projects.sourceCustomHint');

  const buildPatch = () => ({
    name,
    artist,
    source: project.source,
    coverName: cover instanceof File ? cover.name : undefined,
    coverBlob: cover instanceof File ? cover : undefined,
    clearCover: cover === 'clear',
  });

  const handleJumpAudio = () => {
    onSave(buildPatch());
    onOpenAudio?.();
  };

  return (
    <Dialog
      title={t('projects.editTitle')}
      onClose={handleDialogClose}
      footer={(
        <>
          <ActionBtn onClick={onClose}>{t('projects.cancel')}</ActionBtn>
          <ActionBtn
            variant="primary"
            onClick={() => onSave(buildPatch())}
          >
            {t('projects.save')}
          </ActionBtn>
        </>
      )}
    >
      {/* 封面在左：它是工程在启动台的门面，不该缩成字段流里的一小块 */}
      <div className="dialog-edit-grid">
        <CoverField
          label={t('projects.cover')}
          value={cover}
          previewUrl={existingPreview}
          onChange={setCover}
        />
        <div className="dialog-edit-fields">
          <label className="dialog-field">
            <span>{t('projects.name')}</span>
            <input value={name} placeholder={untitledProjectLabel()} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="dialog-field">
            <span>{t('projects.artist')}</span>
            <input value={artist} placeholder={t('projects.artistMissing')} onChange={(e) => setArtist(e.target.value)} />
          </label>

          {/* 音频信息与管理跳转：整合为通栏音轨条，设置按钮内嵌在右侧；长文件名支持动态往返走马灯 */}
          <div className="dialog-field">
            <span>{t('projects.audio')}</span>
            <div className="dialog-audio-bar">
              <div
                className="dialog-audio-bar__info"
                title={`${project.audioName ?? t('projects.noAudio')} · ${formatDuration(project.durationSeconds)}`}
              >
                <AudioLines size={13} />
                <DialogMarquee text={`${project.audioName ?? t('projects.noAudio')} · ${formatDuration(project.durationSeconds)}`} />
              </div>
              {onOpenAudio && (
                <button
                  type="button"
                  className="dialog-audio-jump-btn"
                  title={t('audio.jumpManageTitle')}
                  onClick={handleJumpAudio}
                >
                  <SlidersHorizontal size={11} />
                  {t('audio.jumpManage')}
                </button>
              )}
            </div>
          </div>

          {/* 曲目归属（chart-projects 票 30）：工程出生属性，只读胶囊徽标展示，问号气泡按需展开说明。
              放置在最末作为元数据底注，官方曲用 Disc3 唱片图标，自定义用 Tag 标签图标，与音频声波图标彻底区隔。 */}
          <div className="dialog-field">
            <div className="dialog-field__label-row">
              <div className="dialog-field__label-left" ref={helpRef}>
                <span>{t('projects.source')}</span>
                <button
                  type="button"
                  className="dialog-field__help-btn"
                  title={sourceHint}
                  aria-label={sourceHint}
                  onClick={() => setShowSourceHelp((prev) => !prev)}
                >
                  <CircleHelp size={13} />
                </button>
                {showSourceHelp && (
                  <div className="dialog-field__popover" role="tooltip">
                    {sourceHint}
                  </div>
                )}
              </div>
            </div>
            <div className="dialog-source-pill">
              {project.source.type === 'bandori' ? <Disc3 size={12} /> : <Tag size={12} />}
              <span>
                {project.source.type === 'bandori'
                  ? t('projects.sourceBadgeBandori', { id: project.source.id })
                  : t('projects.sourceBadgeCustom')}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
