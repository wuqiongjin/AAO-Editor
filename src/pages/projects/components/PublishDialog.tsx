// 发布弹窗（票 42）：原型 A 视觉布局 + 字段就地编辑 + 描述草稿持久化。
//
// 依据与定案（issues/42 + issues/11 + ADR-0015）：
//   ① 走 ui/Dialog 既有弹窗壳，头部左侧带 HelpHint 问号气泡，右上角账号头像 + 昵称（与 AccountBar
//      完全一致）；「不双写」= 昵称与账号名不同时出现，账号名只留在头像的 title 提示里；
//   ② 原型 A 封面身份卡：左侧 1:1 封面展示（只读视觉锚），右侧 7 行整齐对齐元信息条目；
//   ③ 字段就地编辑：标题、歌手、难度、等级直接就地操作，保持原型 A 极简纯净排版，不加冗余小图标；
//   ④ 描述草稿持久化（Q3）：草稿记在谱面工程记录里，复制谱面一并带上，发布成功后清除；
//   ⑤ 预检与一次性确认：预检纯函数 precheckPublish，缺项就地标红与空槽展示，确认窗复用 ConfirmDialog。
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Music2 } from 'lucide-react';
import type { ChartCodeNote } from '../../../chart/editing/ChartConverter';
import { countChartNotes } from '../../../chart/editing/NoteEditing';
import {
  precheckPublish,
  type PublishFailure,
  type PublishInput,
  type PublishMissingField,
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
  DIFF_NAMES,
  updateChartInfo,
  updateChartPublishDraft,
  updateProjectInfo,
} from '../../../project/projectCatalog';
import { readChartLevelInput } from '../../../project/ui/ChartInfoDialog';
import { useCoverUrl } from '../../../ui/CoverField';
import { t, type MessageKey } from '../../../i18n';
import ActionBtn from '../../../ui/ActionBtn';
import ConfirmDialog from '../../../ui/ConfirmDialog';
import Dialog from '../../../ui/Dialog';
import HelpHint from '../../../ui/HelpHint';
import { InitialAvatar } from './AccountBar';
import { formatDuration } from '../projectFormat';
import { useCommunityCapabilities } from '../communityCapabilities';
import './PublishDialog.css';

/** 缺失字段 → 文案键 */
const MISSING_KEYS: Record<PublishMissingField, MessageKey> = {
  title: 'projects.publish.missing.title',
  artists: 'projects.publish.missing.artists',
  song: 'projects.publish.missing.song',
  diff: 'projects.publish.missing.diff',
  level: 'projects.publish.missing.level',
  content: 'projects.publish.missing.content',
  chart: 'projects.publish.missing.chart',
  audio: 'projects.publish.missing.audio',
};

/** 发布失败原因 → 文案键 */
const FAILURE_KEYS: Record<PublishFailure, MessageKey> = {
  'missing-fields': 'projects.publish.err.generic',
  'already-published': 'projects.publish.err.already',
  offline: 'projects.publish.err.offline',
  'rate-limited': 'projects.publish.err.rateLimited',
  unauthorized: 'projects.publish.err.unauthorized',
  unsupported: 'projects.publish.err.unsupported',
  rejected: 'projects.publish.err.rejected',
  local: 'projects.publish.err.local',
  unknown: 'projects.publish.err.generic',
};

const STAGE_KEYS: Record<PublishStage, MessageKey> = {
  audio: 'projects.publish.stage.audio',
  cover: 'projects.publish.stage.cover',
  post: 'projects.publish.stage.post',
  record: 'projects.publish.stage.record',
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

function Fact({
  k,
  missing,
  children,
}: {
  k: string;
  missing?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`ppc-fact${missing ? ' is-missing' : ''}`}>
      <span className="ppc-fact__k">{k}</span>
      <span className="ppc-fact__v">{children}</span>
    </div>
  );
}

export function PublishDialog(props: {
  project: ChartProject;
  chart: ProjectChart;
  chartCode: readonly ChartCodeNote[];
  onClose?: () => void;
  onPublish: (input: PublishInput, onStage: (stage: PublishStage) => void) => Promise<PublishOutcome>;
  loadUploadRefs?: LoadUploadRefs;
  onUpdateProject?: (updater: (p: ChartProject) => ChartProject | null) => Promise<void> | void;
}) {
  const {
    project,
    chart,
    chartCode,
    onClose,
    onPublish,
    loadUploadRefs = getProjectUploadRefs,
    onUpdateProject,
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

  const [stage, setStage] = useState<PublishStage | null>(null);
  const [failure, setFailure] = useState<PublishFailure | null>(null);
  const [confirming, setConfirming] = useState(false);

  const [refs, setRefs] = useState<ProjectUploadRefs | null | undefined>(undefined);
  const custom = project.source.type === 'custom';

  useEffect(() => {
    if (!custom) return;
    let alive = true;
    void loadUploadRefs(project.id).then((loaded) => {
      if (alive) setRefs(loaded);
    });
    return () => { alive = false; };
  }, [custom, project.id, loadUploadRefs]);

  const coverUrl = useCoverUrl(project.coverBlob);
  const hasCover = custom ? !!project.coverBlob : true;

  // 描述草稿防抖持久化（票 42 Q3）
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
    if (chartMetaUnchanged(next)) return;
    onUpdateProject?.((p) => updateChartInfo(p, chart.id, next, Date.now()));
  };
  const syncChartMeta = (nextTitle: string, nextDiff: ChartDifficulty, nextLevelStr: string) => {
    const next = nextChartMeta(nextTitle, nextDiff, nextLevelStr);
    if (chartMetaUnchanged(next)) {
      cancelSave(debouncedChartRef);
      return;
    }
    scheduleSave(debouncedChartRef, () => commitChartMeta(next));
  };

  // 歌手就地改动防抖落盘
  const debouncedArtistRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitArtistMeta = (nextArtist: string | null) => {
    if (nextArtist === (project.artist?.trim() || null)) return;
    onUpdateProject?.((p) => updateProjectInfo(p, { ...p, artist: nextArtist }));
  };
  const syncArtistMeta = (nextArtist: string) => {
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
    published: chart.upload != null,
    title: rawTitle,
    artists: artists.trim(),
    diff,
    level: parsedLevel,
    content,
    chartCode,
    song,
  }), [chart.upload, rawTitle, artists, diff, parsedLevel, content, chartCode, song]);

  const precheck = precheckPublish(input);
  const busy = stage !== null;
  const refsPending = custom && refs === undefined;
  const refsFailed = custom && refs === null;
  const alreadyPublished = chart.upload != null;
  const canPublish = !busy && !refsPending && !refsFailed && !alreadyPublished && precheck.ok;

  const runPublish = async () => {
    setFailure(null);
    try {
      const outcome = await onPublish(input, setStage);
      setStage(null);
      if (outcome.ok) {
        setConfirming(false);
        // 票 43 Q2：发布成功同样是关窗 —— 350ms 内未到期的就地编辑（标题/难度/等级/歌手）
        // 先落盘再关，否则定时器在卸载后触发、updateProject 因 target 已空直接 return，改动被丢。
        // 描述草稿不刷：recordChartUpload 发布成功时已把它清除（票 42 Q3），再写会复活。
        flushPendingSaves();
        onClose?.();
        return;
      }
      setFailure(outcome.failure);
    } catch {
      setStage(null);
      setFailure('unknown');
    }
    setConfirming(false);
  };

  const notesCount = countChartNotes(chart.notes);
  const audioMissing = custom && (!refs?.audio || !project.audioName);
  const isTitleMissing = !rawTitle;
  const isArtistsMissing = !artists.trim();
  const isLevelMissing = parsedLevel == null;
  const isContentMissing = !content.trim();
  const isNotesMissing = notesCount === 0;


  const head = (
    <div className="ppc-head">
      <div className="ppc-head__title">
        <h3 className="dialog__title">{t('projects.publish.title')}</h3>
        <HelpHint text={t('projects.publish.helpHint')} placement="down" />
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
        size="md"
        head={head}
        onClose={closeDialog}
        footer={(
          <>
            <ActionBtn onClick={closeDialog} disabled={busy}>{t('ui.cancel')}</ActionBtn>
            <ActionBtn
              variant="primary"
              disabled={!canPublish}
              onClick={() => {
                setFailure(null);
                setConfirming(true);
              }}
            >
              {busy ? t('projects.publish.submitting') : t('projects.publish.action')}
            </ActionBtn>
          </>
        )}
      >
        <div className="ppc-a">
          {/* 左列：1:1 封面展示（只读视觉卡） */}
          <div
            className={`ppc-cover${hasCover ? '' : ' is-optional'}`}
            title={hasCover ? t('projects.cover') : '暂无封面'}
          >
            {hasCover && coverUrl ? (
              <span className="ppc-cover__art" style={{ backgroundImage: `url(${coverUrl})` }} />
            ) : (
              <Music2 size={32} />
            )}
          </div>

          {/* 右列：7 个整齐条目（就地可编辑） */}
          <div className="ppc-a__id">
            {/* 标题 */}
            <Fact k={t('projects.publish.field.title')} missing={isTitleMissing}>
              <input
                type="text"
                className={`ppc-fact-input ppc-fact-input--title${isTitleMissing ? ' is-missing' : ''}`}
                value={title}
                disabled={busy}
                placeholder={project.name?.trim() || t('projects.untitled')}
                aria-label={t('projects.publish.field.title')}
                onChange={(e) => {
                  setTitle(e.target.value);
                  syncChartMeta(e.target.value, diff, level);
                }}
              />
            </Fact>

            {/* 歌手 */}
            <Fact k={t('projects.publish.field.artists')} missing={isArtistsMissing}>
              <input
                type="text"
                className={`ppc-fact-input${isArtistsMissing ? ' is-missing' : ''}`}
                value={artists}
                disabled={busy}
                placeholder={t('projects.artistMissing')}
                aria-label={t('projects.publish.field.artists')}
                onChange={(e) => {
                  setArtists(e.target.value);
                  syncArtistMeta(e.target.value);
                }}
              />
            </Fact>

            {/* 难度 */}
            <Fact k={t('projects.publish.field.diff')}>
              <select
                className="ppc-diff-select"
                value={diff}
                disabled={busy}
                aria-label={t('projects.publish.field.diff')}
                onChange={(e) => {
                  const next = Number(e.target.value) as ChartDifficulty;
                  setDiff(next);
                  syncChartMeta(title, next, level);
                }}
              >
                {DIFF_NAMES.map((name, i) => (
                  <option key={name} value={i}>{name}</option>
                ))}
              </select>
            </Fact>

            {/* 等级 */}
            <Fact k={t('projects.publish.field.level')} missing={isLevelMissing}>
              <input
                type="text"
                inputMode="numeric"
                className={`ppc-fact-input ppc-fact-input--level${isLevelMissing ? ' is-missing' : ''}`}
                value={level}
                disabled={busy}
                placeholder="未填"
                aria-label={t('projects.publish.field.level')}
                onChange={(e) => {
                  setLevel(e.target.value);
                  syncChartMeta(title, diff, e.target.value);
                }}
              />
            </Fact>

            {/* 音符 */}
            <Fact k={t('projects.publish.field.chart')} missing={isNotesMissing}>
              {isNotesMissing ? (
                <span role="alert" className="ppc-miss">{t(MISSING_KEYS.chart)}</span>
              ) : (
                <span className="ppc-fact__plain">{t('projects.publish.notesMeta', { count: notesCount })}</span>
              )}
            </Fact>

            {/* 音频 */}
            <Fact k={t('projects.publish.field.audio')} missing={audioMissing}>
              {audioMissing ? (
                <span className="ppc-miss">未导入</span>
              ) : (
                <span className="ppc-fact__plain ppc-fact__audio-name" title={project.audioName ?? ''}>
                  {project.audioName ?? ''}
                </span>
              )}
            </Fact>

            {/* 时长 */}
            <Fact k={t('projects.publish.field.duration')} missing={audioMissing}>
              {audioMissing ? (
                <span className="ppc-miss">未填</span>
              ) : (
                <span className="ppc-fact__plain">{formatDuration(project.durationSeconds)}</span>
              )}
            </Fact>
          </div>
        </div>

        {/* 失败与环境异常内联提示 */}
        {refsFailed && (
          <p className="pp-publish__error" role="alert">{t('projects.publish.err.local')}</p>
        )}
        {alreadyPublished && (
          <p className="pp-publish__error" role="alert">{t('projects.publish.err.already')}</p>
        )}
        {failure && (
          <p className="pp-publish__error" role="alert">{t(FAILURE_KEYS[failure])}</p>
        )}

        {/* 描述正文（草稿持久化 + 换行解析） */}
        <label className={`dialog-field ppc-content${isContentMissing ? ' is-missing' : ''}`}>
          <span>{t('projects.publish.contentLabel')}</span>
          <textarea
            value={content}
            disabled={busy}
            maxLength={POST_CONTENT_MAX_CHARS}
            placeholder={t('projects.publish.contentPlaceholder')}
            onChange={(e) => syncDraft(e.target.value)}
          />
          <small>{content.length} / {POST_CONTENT_MAX_CHARS}</small>
        </label>

        {busy && (
          <p className="off-status off-status--busy" role="status">
            <span className="off-spinner" aria-hidden="true" />
            {stage ? t(STAGE_KEYS[stage]) : t('projects.publish.submitting')}
          </p>
        )}
      </Dialog>

      {/* 不可逆确认弹窗 */}
      {confirming && !busy && (
        <ConfirmDialog
          title={t('projects.publish.confirmTitle')}
          message={t('projects.publish.confirmMessage', { title: displayTitle })}
          confirmLabel={t('projects.publish.confirmAction')}
          onConfirm={() => void runPublish()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
