// 发布弹窗（票 42）：原型 A 视觉布局 + 字段就地编辑 + 描述草稿持久化。
//
// 依据与定案（issues/42 + issues/11 + ADR-0015）：
//   ① 走 ui/Dialog 既有弹窗壳，头部左侧带 HelpHint 问号气泡，右上角账号头像 + 昵称（与 AccountBar
//      完全一致）；「不双写」= 昵称与账号名不同时出现，账号名只留在头像的 title 提示里；
//   ② 原型 A 封面身份卡：左侧 1:1 封面展示（只读视觉锚），右侧 7 行整齐对齐元信息条目；
//   ③ 字段就地编辑：标题、歌手、难度、等级直接就地操作，保持原型 A 极简纯净排版，不加冗余小图标；
//   ④ 描述草稿持久化（Q3 / 票 51 Q13）：草稿记在谱面工程记录里，复制谱面一并带上，发布成功后保留；
//   ⑤ 预检与一次性确认：预检纯函数 precheckPublish，缺项就地标红与空槽展示，确认窗复用 ConfirmDialog；
//   ⑥ 票 50：确认问句独立成行（#1）、失败展示升级为告警区块（#2）——重试仍过确认门，不猜平台拒绝成因。
//   ⑦ 票 54：已发态标题「更新谱面」（未发「发布谱面」）——标题说这张窗干什么，不拿状态词当标题；
//      谱面行按钮同步改「更新」，「已发布」这类状态交给行内「已上传」徽标。
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Activity, CircleAlert, Gauge, Hash, Timer, Wand2, X } from 'lucide-react';
import { computeChartCodeStats } from '../../../chart/analysis/ChartStats';
import { formatValidationError, type ChartCodeNote, type ValidationError } from '../../../chart/editing/ChartConverter';
import { countChartNotes } from '../../../chart/editing/NoteEditing';
import {
  generatePublishDescription,
  precheckPublish,
  type EditChartOutcome,
  type PostTextTag,
  type PublishFailure,
  type PublishInput,
  type PublishOutcome,
  type PublishSong,
  type PublishStage,
  type PublishUploadFile,
} from '../../../community/bestdori/publish';
import { POST_CONTENT_MAX_CHARS } from '../../../community/bestdori/endpoints';
import {
  getProjectUploadRefs,
  type ChartDifficulty,
  type ChartProject,
  type ProjectChart,
} from '../../../project/ChartProject';
import type { ProjectUploadFile as ProjectUploadFileRef, ProjectUploadRefs } from '../../../project/ChartProjectRecord';
import {
  updateChartInfo,
  updateChartPublishDraft,
  updateChartTags,
  updateProjectInfo,
} from '../../../project/projectCatalog';
import { readChartLevelInput } from '../../../project/ui/ChartInfoDialog';
import DifficultyLevelField from '../../../project/ui/DifficultyLevelField';
import { useCoverUrl, useEphemeralCoverUrl } from '../../../ui/coverUrl';
import { t, type MessageKey } from '../../../i18n';
import ActionBtn from '../../../ui/ActionBtn';
import AudioBar from '../../../ui/AudioBar';
import ConfirmDialog from '../../../ui/ConfirmDialog';
import Dialog from '../../../ui/Dialog';
import HelpHint from '../../../ui/HelpHint';
import { showToast } from '../../../ui/Toast';
import { InitialAvatar } from './AccountBar';
import { formatDuration } from '../projectFormat';
import { useCommunityCapabilities } from '../communityCapabilities';
import type { PublishRecoveryResult } from '../usePublishEntry';
import CoverCard from '../../../ui/CoverCard';
import { PublishAssociateControl, PublishPendingAlert } from './PublishRecoveryPanel';
import './PublishDialog.css';

/** 发布失败原因 → 文案键 */
const FAILURE_KEYS: Record<PublishFailure, MessageKey> = {
  'missing-fields': 'projects.publish.err.generic',
  'already-published': 'projects.publish.err.already',
  offline: 'projects.publish.err.offline',
  'rate-limited': 'projects.publish.err.rateLimited',
  unauthorized: 'projects.publish.err.unauthorized',
  unsupported: 'projects.publish.err.unsupported',
  rejected: 'projects.publish.err.rejected',
  'chart-invalid': 'projects.publish.err.chartInvalid',
  local: 'projects.publish.err.local',
  unknown: 'projects.publish.err.generic',
};

/** 「重试」只给再试一次可能成的失败档：平台 / 网络 / 会话侧。确定性拦截
 *  （谱面域预检、本机读不到、环境不支持）重试必然原样再败，不给这颗键（票 50 #2）。 */
const RETRYABLE_FAILURES: ReadonlySet<PublishFailure> = new Set([
  'rejected',
  'offline',
  'rate-limited',
  'unauthorized',
  'unknown',
]);

/** chart-invalid 明细列表最多展示的条数，其余折叠（与谱面代码弹窗同口径） */
const MAX_VISIBLE_CHART_ISSUES = 8;

const STAGE_KEYS: Record<PublishStage, MessageKey> = {
  audio: 'projects.publish.stage.audio',
  cover: 'projects.publish.stage.cover',
  post: 'projects.publish.stage.post',
  record: 'projects.publish.stage.record',
  check: 'projects.publish.stage.check',
};

type LoadUploadRefs = (projectId: string) => Promise<ProjectUploadRefs | null>;

function toUploadFile(ref: ProjectUploadFileRef, fileName: string): PublishUploadFile {
  return { path: ref.path, size: ref.size, hash: ref.hash, fileName };
}

/** 就地编辑防抖时长（票 42）：改完停下来这么久才落盘 */
const SAVE_DEBOUNCE_MS = 350;

type SaveTimerRef = { current: ReturnType<typeof setTimeout> | null };

/** 下一版谱面元信息（票 43 Q3：等级越界不写、回落到当前值） */
type ChartMetaNext = { title: string | null; diff: ChartDifficulty; level: number | null };

function cancelSave(ref: SaveTimerRef): void {
  if (ref.current) {
    clearTimeout(ref.current);
    ref.current = null;
  }
}

/** 重排防抖；触发时自清 ref —— 否则 flush 会把已经落过盘的写再写一遍（票 43） */
function scheduleSave(ref: SaveTimerRef, run: () => void): void {
  if (ref.current) clearTimeout(ref.current);
  ref.current = setTimeout(() => {
    ref.current = null;
    run();
  }, SAVE_DEBOUNCE_MS);
}

/** 把在飞的防抖立刻落盘（票 43 Q2：关窗 / 发布成功都不丢刚改的值） */
function flushSave(ref: SaveTimerRef, run: () => void): void {
  if (!ref.current) return;
  cancelSave(ref);
  run();
}

/** 描述卡右下角手柄：按住竖向拖高度。 */
function startVerticalResize(
  box: HTMLElement,
  handle: HTMLElement,
  startY: number,
  startH: number,
  pointerId: number,
): void {
  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    const maxH = Math.round(window.innerHeight * 0.48);
    box.style.height = `${Math.min(maxH, Math.max(160, startH + ev.clientY - startY))}px`;
  };
  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    handle.releasePointerCapture(pointerId);
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onUp);
  };
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
}

/** 走浏览器原生插入，好进 Ctrl+Z 撤销栈。失败由调用方退回受控 setState。 */
function replaceTextareaPreservingUndo(el: HTMLTextAreaElement, next: string): boolean {
  if (el.value === next) return true;
  el.focus();
  el.setSelectionRange(0, el.value.length);
  try {
    return typeof document.execCommand === 'function'
      && document.execCommand('insertText', false, next);
  } catch {
    return false;
  }
}

/** 谱面概览的一格：音符 / 时长 / BPM / 平均 NPS */
function Stat({ icon, label, value, hint, missing, missingHint }: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
  missing?: boolean;
  missingHint?: string;
}) {
  return (
    <div className={`ppc-stat${missing ? ' is-missing' : ''}`} title={missing ? missingHint : undefined}>
      <span className="ppc-stat__k">{icon}{label}</span>
      <span className="ppc-stat__v">{value}{hint && <small>{hint}</small>}</span>
    </div>
  );
}

/** 失败 / 环境异常告警块（票 50 #2）：一行红字升级为 danger 左饰边 + soft 底的告警区，
 *  样式族照音频页的 .audio-locked-banner，不新造壳。actions 区放重试 / 关闭（可不给）。 */
function PublishAlert({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="pp-publish__alert" role="alert">
      <CircleAlert size={15} aria-hidden="true" />
      <div className="pp-publish__alert__body">{children}</div>
      {actions}
    </div>
  );
}

export function PublishDialog(props: {
  project: ChartProject;
  chart: ProjectChart;
  chartCode: readonly ChartCodeNote[];
  onClose?: () => void;
  onPublish: (input: PublishInput, onStage: (stage: PublishStage) => void) => Promise<PublishOutcome>;
  recovery?: PublishRecoveryResult | null;
  onRecover?: (postId?: number) => Promise<boolean>;
  /** 已发谱面点「更新」：直接 `post/edit`，无二次确认（票 51 Q14） */
  onEdit?: (input: { diff: ChartDifficulty; level: number; tags: PostTextTag[] }) => Promise<EditChartOutcome>;
  loadUploadRefs?: LoadUploadRefs;
  onUpdateProject?: (updater: (p: ChartProject) => ChartProject | null) => Promise<void> | void;
  /** 音频缺失时带工程作用域跳音频页；由页面侧提供（票 61 追加回修） */
  onOpenAudio?: () => void;
}) {
  const {
    project,
    chart,
    chartCode,
    onClose,
    onPublish,
    recovery = null,
    onRecover,
    onEdit,
    loadUploadRefs = getProjectUploadRefs,
    onUpdateProject,
    onOpenAudio,
  } = props;
  const { session } = useCommunityCapabilities();
  const profile = session.signedIn ? session.account : null;
  const displayName = profile ? (profile.nickname ?? profile.username) : '';

  // 本地就地编辑状态（票 42：原型 A 风格直接编辑）
  const [title, setTitle] = useState(chart.title ?? '');
  const [artists, setArtists] = useState(project.artist ?? '');
  const [diff, setDiff] = useState<ChartDifficulty>(chart.diff);
  const [level, setLevel] = useState(chart.level != null ? String(chart.level) : '');
  const [content, setContent] = useState(chart.publishDraft ?? '');
  const [tags, setTags] = useState<string[]>(() => (chart.tags ?? []).map((tag) => tag.data));
  const [tagDraft, setTagDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const published = chart.upload != null;
  const [awaitingOutcome, setAwaitingOutcome] = useState(false);
  const pending = chart.pendingPublish != null || awaitingOutcome;

  const [stage, setStage] = useState<PublishStage | null>(null);
  const [failure, setFailure] = useState<PublishFailure | null>(null);
  // chart-invalid 的点名明细（issue 49：哪条音符、哪个字段；可列多条）
  const [chartIssues, setChartIssues] = useState<ValidationError[]>([]);
  const [confirming, setConfirming] = useState(false);

  const [refs, setRefs] = useState<ProjectUploadRefs | null | undefined>(undefined);
  const custom = project.source.type === 'custom';

  useEffect(() => {
    if (!custom || pending || published) return;
    let alive = true;
    void loadUploadRefs(project.id).then((loaded) => {
      if (alive) setRefs(loaded);
    });
    return () => { alive = false; };
  }, [custom, pending, published, project.id, loadUploadRefs]);

  const storedCoverUrl = useCoverUrl(project.coverBlob);
  const [localCover, setLocalCover] = useState<File | null>(null);
  const localCoverUrl = useEphemeralCoverUrl(localCover ?? undefined);
  const [coverSaving, setCoverSaving] = useState(false);
  const coverUrl = localCoverUrl ?? storedCoverUrl;
  const hasCover = custom ? !!coverUrl : true;

  // 描述草稿防抖持久化（票 42 Q3）
  const contentEl = useRef<HTMLTextAreaElement>(null);
  const postEl = useRef<HTMLDivElement>(null);
  const debouncedDraftRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitDraft = (nextDraft: string) => {
    onUpdateProject?.((p) => updateChartPublishDraft(p, chart.id, nextDraft));
  };
  const syncDraft = (nextDraft: string) => {
    setContent(nextDraft);
    if ((nextDraft.trim() || null) === (chart.publishDraft?.trim() || null)) {
      cancelSave(debouncedDraftRef);
      return;
    }
    scheduleSave(debouncedDraftRef, () => commitDraft(nextDraft));
  };

  // 谱面信息（标题、难度、等级）就地改动防抖落盘
  const debouncedChartRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextChartMeta = (nextTitle: string, nextDiff: ChartDifficulty, nextLevelStr: string): ChartMetaNext => {
    const levelRead = readChartLevelInput(nextLevelStr);
    return {
      title: nextTitle.trim() || null,
      diff: nextDiff,
      level: levelRead.persist ? levelRead.level : chart.level,
    };
  };
  const chartMetaUnchanged = (next: ChartMetaNext) =>
    next.title === (chart.title?.trim() || null)
    && next.diff === chart.diff
    && next.level === chart.level;
  const commitChartMeta = (next: ChartMetaNext) => {
    if (published || chartMetaUnchanged(next)) return;
    onUpdateProject?.((p) => updateChartInfo(p, chart.id, next, Date.now()));
  };
  const syncChartMeta = (nextTitle: string, nextDiff: ChartDifficulty, nextLevelStr: string) => {
    if (published) return;
    const next = nextChartMeta(nextTitle, nextDiff, nextLevelStr);
    if (chartMetaUnchanged(next)) {
      cancelSave(debouncedChartRef);
      return;
    }
    scheduleSave(debouncedChartRef, () => commitChartMeta(next));
  };
  const tagObjects = (): PostTextTag[] => tags.map((data) => ({ type: 'text', data }));
  const persistTags = (next: string[]) => {
    if (published) return;
    onUpdateProject?.((p) => updateChartTags(p, chart.id, next.map((data) => ({ type: 'text', data }))));
  };
  const addTag = (raw: string) => {
    const data = raw.trim();
    setTagDraft('');
    if (!data || tags.includes(data)) return;
    const next = [...tags, data];
    setTags(next);
    persistTags(next);
  };
  const removeTag = (data: string) => {
    const next = tags.filter((tag) => tag !== data);
    setTags(next);
    persistTags(next);
  };

  // 歌手就地改动防抖落盘
  const debouncedArtistRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitArtistMeta = (nextArtist: string | null) => {
    if (nextArtist === (project.artist?.trim() || null)) return;
    onUpdateProject?.((p) => updateProjectInfo(p, { ...p, artist: nextArtist }));
  };
  const syncArtistMeta = (nextArtist: string) => {
    if (published) return;
    const next = nextArtist.trim() || null;
    if (next === (project.artist?.trim() || null)) {
      cancelSave(debouncedArtistRef);
      return;
    }
    scheduleSave(debouncedArtistRef, () => commitArtistMeta(next));
  };

  // 退出 / 跳转前强制冲刷草稿与就地元数据（票 43 Q2：关窗不丢刚改的难度）
  const flushDraftImmediate = () => flushSave(debouncedDraftRef, () => {
    if ((content.trim() || null) !== (chart.publishDraft?.trim() || null)) commitDraft(content);
  });
  const flushChartImmediate = () => flushSave(
    debouncedChartRef,
    () => commitChartMeta(nextChartMeta(title, diff, level)),
  );
  const flushArtistImmediate = () => flushSave(debouncedArtistRef, () => commitArtistMeta(artists.trim() || null));

  /** 就地元数据（谱面信息 + 歌手）的在飞防抖立刻落盘 */
  const flushPendingSaves = () => {
    flushChartImmediate();
    flushArtistImmediate();
  };

  const closeDialog = () => {
    if (stage !== null) return;
    flushDraftImmediate();
    flushPendingSaves();
    onClose?.();
  };

  /** 跳音频页前先落盘在飞草稿，避免用户回来发现弹窗里的改动丢了。 */
  const handleOpenAudio = () => {
    if (stage !== null) return;
    flushDraftImmediate();
    flushPendingSaves();
    onOpenAudio?.();
    onClose?.();
  };

  const song: PublishSong = useMemo(() => {
    if (project.source.type === 'bandori') {
      return { kind: 'bandori', songId: project.source.id };
    }
    return {
      kind: 'custom',
      audio: refs?.audio ? toUploadFile(refs.audio, project.audioName ?? 'audio.mp3') : null,
      cover: refs?.cover ? toUploadFile(refs.cover, project.coverName ?? 'cover.png') : null,
    };
  }, [project.source, project.audioName, project.coverName, refs]);

  const rawTitle = title.trim() || project.name?.trim() || '';
  const displayTitle = rawTitle !== '' ? rawTitle : t('projects.untitled');
  const levelRead = readChartLevelInput(level);
  // 空 / 越界 / 非整数都算缺等级（票 43 Q3：28.5 与 0 一样当缺项）
  const parsedLevel = levelRead.persist ? levelRead.level : null;

  const input: PublishInput = useMemo(() => ({
    published,
    title: rawTitle,
    artists: artists.trim(),
    diff,
    level: parsedLevel,
    content,
    chartCode,
    song,
    tags: tagObjects(),
  }), [published, rawTitle, artists, diff, parsedLevel, content, chartCode, song, tags]);

  const precheck = precheckPublish(input);
  // busy = 发布/更新流程本身（驱动状态行、底部按钮文案、取消禁用）；
  // 封面落盘只是本地写文件，不能把整个弹窗切成"发布中…"，否则右下角会闪成别的按钮。
  const busy = stage !== null || editing;
  const blocked = busy || coverSaving;
  const refsPending = custom && refs === undefined;
  const refsFailed = custom && refs === null;
  const canPublish = !published && !pending && !blocked && !refsPending && !refsFailed && precheck.ok;
  const canUpdate = published && !blocked && parsedLevel != null;
  // 失败与常驻事实重复（本机读不到）就不叠第二条告警（票 50 #2）
  const failureDuplicatesKnownFact = failure != null && refsFailed && failure === 'local';

  /** 封面写入工程后要重取 upload refs：发帖载荷读的是 refs，不是 coverBlob */
  const persistCover = async (file: File) => {
    if (!onUpdateProject || published || pending || coverSaving) return;
    setLocalCover(file);
    setCoverSaving(true);
    try {
      await onUpdateProject((p) => updateProjectInfo(p, { ...p, coverBlob: file, coverName: file.name }));
    } catch {
      setLocalCover(null);
      showToast(t('projects.publish.err.coverSave'), 'danger');
      setCoverSaving(false);
      return;
    }
    setLocalCover(null);
    try {
      setRefs(await loadUploadRefs(project.id));
    } catch {
      setRefs(null);
    } finally {
      setCoverSaving(false);
    }
  };

  const clearCover = async () => {
    if (!onUpdateProject || published || pending || coverSaving) return;
    setCoverSaving(true);
    try {
      await onUpdateProject((p) => updateProjectInfo(p, { ...p, clearCover: true }));
      setLocalCover(null);
    } catch {
      showToast(t('projects.publish.err.coverSave'), 'danger');
      setCoverSaving(false);
      return;
    }
    try {
      setRefs(await loadUploadRefs(project.id));
    } catch {
      setRefs(null);
    } finally {
      setCoverSaving(false);
    }
  };

  const runPublish = async () => {
    if (!canPublish) return;
    flushDraftImmediate();
    flushPendingSaves();
    setFailure(null);
    setChartIssues([]);
    try {
      const outcome = await onPublish(input, setStage);
      setStage(null);
      if (outcome.ok) {
        setConfirming(false);
        // 票 43 Q2：发布成功同样是关窗 —— 350ms 内未到期的就地编辑（标题/难度/等级/歌手）
        // 先落盘再关，否则定时器在卸载后触发、updateProject 因 target 已空直接 return，改动被丢。
        // 票 51 Q13：草稿发后保留，关窗前冲刷，别把 350ms 内未到期的描述丢掉。
        flushDraftImmediate();
        flushPendingSaves();
        onClose?.();
        return;
      }
      if (outcome.failure === 'pending-confirmation') {
        setAwaitingOutcome(true);
      } else {
        setFailure(outcome.failure);
        setChartIssues(outcome.chartIssues ?? []);
      }
    } catch {
      setStage(null);
      setFailure('unknown');
      setChartIssues([]);
    }
    setConfirming(false);
  };

  const runRecovery = async (postId?: number) => {
    if (!onRecover || busy) return;
    flushDraftImmediate();
    flushPendingSaves();
    setStage('check');
    try {
      if (await onRecover(postId)) onClose?.();
    } finally {
      setStage(null);
    }
  };

  const runEdit = async () => {
    if (!onEdit || parsedLevel == null) return;
    setFailure(null);
    setChartIssues([]);
    setEditing(true);
    try {
      const outcome = await onEdit({ diff, level: parsedLevel, tags: tagObjects() });
      setEditing(false);
      if (outcome.ok) {
        onClose?.();
        return;
      }
      setFailure(outcome.failure);
    } catch {
      setEditing(false);
      setFailure('unknown');
    }
  };

  const notesCount = countChartNotes(chart.notes);
  const audioMissing = custom && (!refs?.audio || !project.audioName);
  const isTitleMissing = !rawTitle;
  const isArtistsMissing = !artists.trim();
  const isLevelMissing = parsedLevel == null;
  const isContentMissing = !published && !content.trim();
  const isNotesMissing = notesCount === 0;

  const chartStats = useMemo(() => computeChartCodeStats(chartCode), [chartCode]);
  // 平均 NPS 的分母 = 首击到末击；分子与「音符」同一口径（countChartNotes）
  const averageNps = notesCount > 0 && chartStats.playableSeconds > 0
    ? notesCount / chartStats.playableSeconds
    : null;

  const fillAutogen = () => {
    const next = generatePublishDescription({
      level: parsedLevel,
      noteCount: notesCount,
      duration: audioMissing ? null : formatDuration(project.durationSeconds),
      bpm: chartStats.bpmRange,
      nps: averageNps,
    });
    const el = contentEl.current;
    if (el) replaceTextareaPreservingUndo(el, next);
    // insertText 只负责进撤销栈；受控 value 仍要 setState，否则下一帧 React 会写回旧稿。
    syncDraft(next);
  };

  const head = (
    <div className="ppc-head">
      <div className="ppc-head__title">
        <h3 className="dialog__title">{t(published ? 'projects.publish.updateTitle' : 'projects.publish.title')}</h3>
        <HelpHint text={t(published ? 'projects.publish.editHint' : 'projects.publish.helpHint')} placement="down" />
      </div>
      {profile && (
        <div
          className="ppc-who"
          title={t('community.account.menuAccount', { username: profile.username })}
        >
          <InitialAvatar name={displayName} seed={profile.username} />
          <span className="ppc-who__name">{displayName}</span>
        </div>
      )}
    </div>
  );

  return (
    <>
      <Dialog
        size="xl"
        head={head}
        onClose={closeDialog}
        footer={(
          <>
            {!published && onRecover && (
              <PublishAssociateControl busy={busy} onRecover={(postId) => void runRecovery(postId)} />
            )}
            <span className="dialog__spacer" />
            <ActionBtn onClick={closeDialog} disabled={busy}>{t('ui.cancel')}</ActionBtn>
            {!pending && <ActionBtn
              variant="primary"
              disabled={published ? !canUpdate : !canPublish}
              // 未发：清失败留给 runPublish（确认门上取消的话，告警块还说得通）。已发：点更新直接 post/edit（Q14）。
              onClick={() => (published ? void runEdit() : setConfirming(true))}
            >
              {busy
                ? t(published ? 'projects.publish.updating' : 'projects.publish.submitting')
                : t(published ? 'projects.publish.update' : 'projects.publish.action')}
            </ActionBtn>}
          </>
        )}
      >
        <div className="ppc-b">
          <section className="ppc-identity">
            <div className="ppc-identity__top">
              <div className="ppc-identity__cover">
                <CoverCard
                  editable={custom && !published && !pending}
                  hasCover={hasCover}
                  coverUrl={coverUrl}
                  busy={blocked || !onUpdateProject}
                  required={custom}
                  onPick={(file) => void persistCover(file)}
                  onClear={() => void clearCover()}
                />
              </div>
              <div className="ppc-identity__fields">
                <label className="ppc-field">
                  <span className="ppc-field__k">{t('projects.publish.field.title')}</span>
                  <input
                    type="text"
                    className={`ppc-input ppc-input--title${isTitleMissing ? ' is-missing' : ''}`}
                    value={title}
                    disabled={busy}
                    readOnly={published || pending}
                    placeholder={project.name?.trim() || t('projects.untitled')}
                    aria-label={t('projects.publish.field.title')}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      syncChartMeta(e.target.value, diff, level);
                    }}
                  />
                </label>
                <label className="ppc-field">
                  <span className="ppc-field__k">{t('projects.publish.field.artists')}</span>
                  <input
                    type="text"
                    className={`ppc-input${isArtistsMissing ? ' is-missing' : ''}`}
                    value={artists}
                    disabled={busy}
                    readOnly={published || pending}
                    placeholder={t('projects.artistMissing')}
                    aria-label={t('projects.publish.field.artists')}
                    onChange={(e) => {
                      setArtists(e.target.value);
                      syncArtistMeta(e.target.value);
                    }}
                  />
                </label>
                <div className="ppc-field">
                  <span className="ppc-field__k">{t('projects.publish.field.diffLevel')}</span>
                  <DifficultyLevelField
                    diff={diff}
                    onDiffChange={(next) => {
                      setDiff(next);
                      syncChartMeta(title, next, level);
                    }}
                    level={level}
                    onLevelChange={(next) => {
                      setLevel(next);
                      syncChartMeta(title, diff, next);
                    }}
                    levelPlaceholder={t('projects.publish.levelMissing')}
                    levelInvalid={isLevelMissing}
                    disabled={busy || pending}
                  />
                </div>
              </div>
            </div>
            <div className={`ppc-field ppc-field--audio${audioMissing ? ' is-missing' : ''}`}>
              <span className="ppc-field__k">{t('projects.publish.field.audio')}</span>
              <AudioBar
                name={custom
                  ? (audioMissing ? t('projects.publish.audioMissing') : project.audioName)
                  : t('projects.publish.audioFromCatalog')}
                durationText={audioMissing ? '—' : formatDuration(project.durationSeconds)}
                missing={audioMissing}
                onOpenAudio={custom && !published && !pending && onOpenAudio ? handleOpenAudio : undefined}
              />
            </div>
          </section>

          {/* 谱面概览（票 61）：音符 / 时长 / BPM / 平均 NPS */}
          <section className="ppc-section">
            <header className="ppc-section__head">
              <span className="ppc-section__title">
                <Activity size={14} aria-hidden="true" />
                {t('projects.publish.stats.title')}
              </span>
              <span className="ppc-section__hint">{t('projects.publish.stats.auto')}</span>
            </header>
            <div className="ppc-stats">
              <Stat
                icon={<Hash size={12} aria-hidden="true" />}
                label={t('projects.publish.field.chart')}
                value={notesCount.toLocaleString('zh-CN')}
                missing={isNotesMissing}
                missingHint={t('projects.publish.missing.chart')}
              />
              <Stat
                icon={<Timer size={12} aria-hidden="true" />}
                label={t('projects.publish.field.duration')}
                value={audioMissing ? '—' : formatDuration(project.durationSeconds)}
                missing={audioMissing}
              />
              <Stat
                icon={<Gauge size={12} aria-hidden="true" />}
                label={t('projects.publish.stats.bpm')}
                value={chartStats.bpmRange ?? '—'}
              />
              <Stat
                icon={<Activity size={12} aria-hidden="true" />}
                label={t('projects.publish.stats.nps')}
                value={averageNps == null ? '—' : averageNps.toFixed(1)}
                hint={t('projects.publish.stats.npsHint')}
              />
            </div>
          </section>

        {/* 失败与环境异常告警区（票 50 #2）：环境异常（读不到引用 / 已发布过）是事实陈述，只陈述不挂动作；
            发布失败可关闭（改完字段不再挂着红字）、「重试」重新走发布流程（不可逆动作，仍先过确认弹窗）。
            失败与常驻事实重复时（本地读不到 / 已发布过）不叠两条。 */}
        {refsFailed && !published && !pending && (
          <PublishAlert><p>{t('projects.publish.err.local')}</p></PublishAlert>
        )}
        {failure && !pending && !failureDuplicatesKnownFact && (
          <PublishAlert
            actions={(
              <div className="pp-publish__alert__actions">
                {(published ? canUpdate : canPublish) && failure != null && RETRYABLE_FAILURES.has(failure) && (
                  <ActionBtn onClick={() => (published ? void runEdit() : setConfirming(true))}>
                    {t('projects.publish.retry')}
                  </ActionBtn>
                )}
                <button
                  type="button"
                  className="pp-publish__alert__close"
                  aria-label={t('ui.dismiss')}
                  onClick={() => {
                    setFailure(null);
                    setChartIssues([]);
                  }}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            )}
          >
            <p>{t(FAILURE_KEYS[failure])}</p>
            {/* 谱面域点名明细（issue 49）：校验拦下、未发请求，逐条说清哪条音符哪个字段 */}
            {failure === 'chart-invalid' && chartIssues.length > 0 && (
              <ul className="pp-publish__issues">
                {chartIssues.slice(0, MAX_VISIBLE_CHART_ISSUES).map((issue, index) => (
                  <li key={index}>{formatValidationError(issue)}</li>
                ))}
                {chartIssues.length > MAX_VISIBLE_CHART_ISSUES && (
                  <li>{t('chartCode.errorsMore', { count: chartIssues.length - MAX_VISIBLE_CHART_ISSUES })}</li>
                )}
              </ul>
            )}
          </PublishAlert>
        )}

        {!published && (pending || recovery) && (
          <PublishPendingAlert pending={pending} status={recovery} busy={busy} onRecover={(postId) => void runRecovery(postId)} />
        )}

        {/* 标签收进描述同一张内容卡：上面芯片、下面正文，少一块孤立输入框。
            生成键不进 <label>：否则无障碍名会被拼成整段「描述 + 计数」。 */}
        <div className={`dialog-field ppc-content${isContentMissing ? ' is-missing' : ''}`}>
          <span className="ppc-content__head">
            {t('projects.publish.contentLabel')}
            <span className="ppc-content__actions">
              {!published && !pending && (
                <button
                  type="button"
                  className="ppc-content__autogen"
                  disabled={busy}
                  onClick={fillAutogen}
                >
                  <Wand2 size={12} aria-hidden="true" />
                  {t('projects.publish.autogen')}
                </button>
              )}
            </span>
          </span>
          <div className="ppc-post" ref={postEl}>
            <div className="ppc-tags__row">
              <span className="ppc-tags__k">{t('projects.publish.field.tags')}</span>
              {tags.map((tag) => (
                <span key={tag} className="ppc-tag">
                  {tag}
                  <button
                    type="button"
                    className="ppc-tag__remove"
                    aria-label={t('projects.publish.removeTag', { tag })}
                    disabled={busy || pending}
                    onClick={() => removeTag(tag)}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              ))}
              <input
                type="text"
                className="ppc-tags__input"
                value={tagDraft}
                disabled={busy || pending}
                placeholder={t('projects.publish.tagsPlaceholder')}
                aria-label={t('projects.publish.field.tags')}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag(tagDraft);
                  }
                }}
              />
            </div>
            <textarea
              ref={contentEl}
              rows={6}
              value={content}
              disabled={busy}
              readOnly={published || pending}
              maxLength={POST_CONTENT_MAX_CHARS}
              placeholder={t('projects.publish.contentPlaceholder')}
              aria-label={t('projects.publish.contentLabel')}
              onChange={(e) => syncDraft(e.target.value)}
            />
            <button
              type="button"
              className="ppc-resize"
              aria-label={t('projects.publish.resizeDescription')}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                const box = postEl.current;
                if (!box) return;
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                startVerticalResize(
                  box,
                  e.currentTarget,
                  e.clientY,
                  box.getBoundingClientRect().height,
                  e.pointerId,
                );
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path
                  d="M8 2L2 8M9 5L5 9M9 8L8 9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.15"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
          <small>
            {content.length} / {POST_CONTENT_MAX_CHARS}
          </small>
        </div>
        </div>

        {busy && (
          <p className="off-status off-status--busy" role="status">
            <span className="off-spinner" aria-hidden="true" />
            {stage
              ? t(STAGE_KEYS[stage])
              : t(published ? 'projects.publish.updating' : 'projects.publish.submitting')}
          </p>
        )}
      </Dialog>

      {/* 不可逆确认弹窗（票 50 #1）：后果说明与问句拆两个文案键，\n 拼接 ——
          .dialog__message 的 pre-line 让问句「确定发布「…」？」独占一行，ConfirmDialog 本体不动 */}
      {confirming && !busy && !pending && (
        <ConfirmDialog
          title={t('projects.publish.confirmTitle')}
          message={`${t('projects.publish.confirmMessage')}\n${t('projects.publish.confirmQuestion', { title: displayTitle })}`}
          confirmLabel={t('projects.publish.confirmAction')}
          onConfirm={() => void runPublish()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
