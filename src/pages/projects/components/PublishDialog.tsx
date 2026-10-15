// 发布弹窗（票 11）：必填预检 + 一次性「发布后不可改」确认 + 阶段提示。
//
// 一条一条对票（issues/06 Q13 定案）：
//   ① 走**既有弹窗壳**（ui/Dialog），不自绘 scrim；一次性确认复用 ConfirmDialog
//      （实底红确认键 = 危险键分寸，这是不可逆动作）；
//   ② **必填预检**：缺什么按字段点名（CONTEXT「工程信息」：缺的字段上传时再拦），
//      预检是纯函数（publish.ts 的 precheckPublish），弹窗与能力层共用同一份；
//   ③ **静默 sanitize**：这里不校验谱面合法性，只报「没有可发布的音符」——
//      System / charge 的剥离开塞给能力层（issue 156：上传时静默清洗）；
//   ④ 描述是唯一在这里填的字段（帖子正文，工程里没有它的家）；
//   ⑤ custom 曲目的上传引用（路径 / 字节数 / SHA-1）打开时就备好 —— 预检要它判
//      「有没有音频」，发布时原样递回（字节不过 IPC，见 projectStore.uploadRefs）。
//
// 发布动作本身不在这里：transport 与上传记录写入由页面侧装配（本组件只递
// PublishInput 与阶段回调），能力层零 React、零工程域依赖。
import { useEffect, useMemo, useState } from 'react';
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
  type ChartProject,
  type ProjectChart,
} from '../../../project/ChartProject';
import type { ProjectUploadFile as ProjectUploadFileRef, ProjectUploadRefs } from '../../../project/ChartProjectRecord';
import { DIFF_NAMES } from '../../../project/projectCatalog';
import { t, type MessageKey } from '../../../i18n';
import ActionBtn from '../../../ui/ActionBtn';
import ConfirmDialog from '../../../ui/ConfirmDialog';
import Dialog from '../../../ui/Dialog';

/** 缺失字段 → 文案键（一档一条「缺什么、去哪儿补」；漏一个编译不过） */
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

/** 发布失败的六档 + 记账失败 → 文案键（与 loginFailure 同族：界面不认平台码） */
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

/** 上传引用加载（默认走 projectStore 桥；测试注入） */
type LoadUploadRefs = (projectId: string) => Promise<ProjectUploadRefs | null>;

function toUploadFile(ref: ProjectUploadFileRef, fileName: string): PublishUploadFile {
  return { path: ref.path, size: ref.size, hash: ref.hash, fileName };
}

export function PublishDialog({
  project, chart, chartCode, onClose, onPublish, loadUploadRefs = getProjectUploadRefs,
}: {
  project: ChartProject;
  chart: ProjectChart;
  /** 页面用编辑器的导出转换备好的谱面代码（convertNotesToChartCode） */
  chartCode: readonly ChartCodeNote[];
  onClose: () => void;
  /** 发布：递入参 + 收阶段回报；结果由调用方落盘 / 提示，本组件只呈现 */
  onPublish: (input: PublishInput, onStage: (stage: PublishStage) => void) => Promise<PublishOutcome>;
  loadUploadRefs?: LoadUploadRefs;
}) {
  const [content, setContent] = useState('');
  const [stage, setStage] = useState<PublishStage | null>(null);
  const [failure, setFailure] = useState<PublishFailure | null>(null);
  const [confirming, setConfirming] = useState(false);
  // 上传引用：undefined = 还在读；null = 读不到（本机问题，发布不可用）
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

  // 标题按站点口径解析（ADR-0015 §1：帖子的 title 就是谱面名称，未填跟随工程名称），
  // 但**不拿「未命名工程」这个显示兜底去发帖** —— 社区帖的标题是它的门面，
  // 谱面名称与工程名称都缺时就该被预检点名，而不是发一个「未命名工程」上去。
  const chartTitle = chart.title?.trim() ?? '';
  const projectName = project.name?.trim() ?? '';
  const rawTitle = chartTitle !== '' ? chartTitle : projectName;
  const displayTitle = rawTitle !== '' ? rawTitle : t('projects.untitled');

  const input: PublishInput = useMemo(() => ({
    published: chart.upload != null,
    title: rawTitle,
    artists: project.artist ?? '',
    diff: chart.diff,
    level: chart.level,
    content,
    chartCode,
    song,
  }), [project.artist, chart, chartCode, content, song, rawTitle]);

  const precheck = precheckPublish(input);
  const busy = stage !== null;
  // custom 曲目要等上传引用到位才能判「有没有音频」；读不到（null）按发布不可用。
  // 已发布过的谱面直接禁（详情页本就没有它的入口；这是纵深防御，见 ADR-0015 §4）
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
        // 成功：弹窗自己关（页面负责 reload 与提示；记账失败的警告也走那边的 Toast）
        setConfirming(false);
        onClose();
        return;
      }
      setFailure(outcome.failure);
    } catch {
      // 编排层抛了（不该发生 —— publishChart 自己收口）；当通用失败呈现
      setStage(null);
      setFailure('unknown');
    }
    setConfirming(false);
  };

  const songLabel = song.kind === 'bandori'
    ? t('projects.publish.songBandori', { id: song.songId })
    : song.cover != null
      ? t('projects.publish.songCustom')
      : t('projects.publish.songCustomNoCover');

  const row = (label: string, value: string, bad = false) => (
    <div className="dialog-field">
      <span>{label}</span>
      <b className={bad ? 'pp-publish__missing' : ''}>{value}</b>
    </div>
  );

  return (
    <>
      <Dialog
        title={t('projects.publish.title')}
        hint={t('projects.publish.hint')}
        onClose={() => { if (!busy) onClose(); }}
        footer={(
          <>
            <ActionBtn onClick={onClose} disabled={busy}>{t('ui.cancel')}</ActionBtn>
            <ActionBtn
              variant="primary"
              disabled={!canPublish}
              onClick={() => {
                // 缺什么早已实时列在上面（预检纯函数，弹窗与能力层共用）；这枚键是
                // 一次性确认的门，不是报错的门 —— 预检不过时它压根点不动
                setFailure(null);
                setConfirming(true);
              }}
            >
              {busy ? t('projects.publish.submitting') : t('projects.publish.action')}
            </ActionBtn>
          </>
        )}
      >
        <div className="dialog-field-row">
          {row(t('projects.publish.field.title'), displayTitle, rawTitle === '')}
          {row(t('projects.publish.field.artists'), input.artists || t('projects.artistMissing'), !input.artists.trim())}
        </div>
        <div className="dialog-field-row">
          {row(t('projects.publish.field.diff'), DIFF_NAMES[chart.diff])}
          {row(t('projects.publish.field.level'), chart.level != null ? String(chart.level) : '—', chart.level == null)}
        </div>
        <div className="dialog-field-row">
          {row(t('projects.publish.field.song'), songLabel)}
          {row(t('projects.publish.field.chart'), t('projects.publish.notesMeta', { count: countChartNotes(chart.notes) }))}
        </div>

        {/* 缺失清单**实时**派生自预检（同一个纯函数，能力层发帖前还会再跑一遍）——
            用户边填边看到还缺什么，不用等点一次发布才被点名 */}
        {precheck.missing.length > 0 && (
          <div className="pp-publish__missing-box" role="alert">
            <p>{t('projects.publish.missingTitle')}</p>
            <ul>
              {precheck.missing.map((field) => <li key={field}>{t(MISSING_KEYS[field])}</li>)}
            </ul>
          </div>
        )}
        {refsFailed && (
          <p className="pp-publish__error" role="alert">{t('projects.publish.err.local')}</p>
        )}
        {alreadyPublished && (
          <p className="pp-publish__error" role="alert">{t('projects.publish.err.already')}</p>
        )}
        {failure && (
          <p className="pp-publish__error" role="alert">{t(FAILURE_KEYS[failure])}</p>
        )}

        <label className="dialog-field">
          <span>{t('projects.publish.contentLabel')}</span>
          <textarea
            value={content}
            disabled={busy}
            maxLength={POST_CONTENT_MAX_CHARS}
            placeholder={t('projects.publish.contentPlaceholder')}
            onChange={(e) => setContent(e.target.value)}
          />
        </label>

        {busy && (
          <p className="off-status off-status--busy" role="status">
            <span className="off-spinner" aria-hidden="true" />
            {stage ? t(STAGE_KEYS[stage]) : t('projects.publish.submitting')}
          </p>
        )}
      </Dialog>
      {/* 确认浮层只到「确认那一刻」为止：发布动起来（busy）它就退场，阶段提示回到主弹窗 —
          否则进行中它还挂着一枚可点的「取消」，而字节已经在路上，取消只是个谎言 */}
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
