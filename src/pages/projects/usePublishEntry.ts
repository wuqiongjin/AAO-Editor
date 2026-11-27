// 发布入口的页面侧装配（票 11）：状态 + 打开 / 关闭 + 跑发布。
//
// 为什么是 hook 而不是页面里的一段：工程管理页主组件有 500 行拆解纪律
// （tests/static/ProjectDomainLayout），发布这条链路（状态 + 编排 + 弹窗）整块
// 住在这里，页面只留三行接线。同目录的 officialImport / communityImport 是
// 「流程模块」，本文件是「带状态的流程入口」—— 弹窗要记住「在发布哪张谱面」。
//
// 分工（与两支导入同构）：
//   - 能力层（src/community/bestdori/publish.ts）管上传 + 发帖 + 预检；
//   - 上传记录的写入走唯一写入口 mutateProject（「每张谱面至多一条」由
//     recordChartUpload 把门）；
//   - 落账后的页面动作（关弹窗 / reload / Toast）也在这里 —— 帖子发出去而记录
//     写不进来时结果仍是 ok，提示要说「本机记账失败」，不能让人再按一次。
import { useCallback, useRef, useState } from 'react';
import { convertNotesToChartCode, type ChartCodeNote } from '../../chart/editing/ChartConverter';
import {
  editChartPost,
  publishChart,
  type EditChartOutcome,
  type PostTextTag,
  type PublishInput,
  type PublishOutcome,
  type PublishStage,
  type PostSongBody,
} from '../../community/bestdori/publish';
import { getCommunityAccount } from '../../community/bestdori/account';
import { uploadedFileUrl } from '../../community/bestdori/endpoints';
import type { PostDetail } from '../../community/bestdori/mapping';
import { fetchPostDetail } from '../../community/bestdori/posts';
import { digestPublishedChart, findPublishedPosts, matchesPublishedPost, sameCommunityAccount, samePublishedTags } from '../../community/bestdori/publishRecovery';
import { sanitizeChartForBestdoriUpload } from '../../community/bestdori/sanitizeChart';
import { createCommunityTransport } from '../../community/electronTransport';
import { getProjectUploadRefs } from '../../project/ChartProject';
import type {
  ChartDifficulty,
  ChartProject,
  ChartSummary,
  PendingChartPublish,
  ProjectChart,
  ProjectSummary,
} from '../../project/ChartProject';
import { mutateProject, type ProjectMutationResult, type ProjectMutationStore } from '../../project/ChartProjectRecord';
import { recordChartUpload, updateUploadedChartMeta } from '../../project/projectCatalog';
import { trail } from '../../diagnostics/trail';
import { t } from '../../i18n';
import { showToast } from '../../ui/Toast';

/** 弹窗记住的发布目标：谱面代码在打开时就按导出口径转好（预检与发布共用同一份） */
export interface PublishTarget {
  project: ChartProject;
  chart: ProjectChart;
  chartCode: ChartCodeNote[];
}

export interface PublishEntryDeps {
  store: ProjectMutationStore;
  /** 落盘在飞编辑（唯一写入口的 flush 前置，见 mutateProject） */
  flush: () => Promise<void>;
  /** 落账成功后通知工程目录 / 详情刷新 */
  notify: () => void;
  /** 成功后重读目录（上传记录即时可见） */
  reload: () => Promise<void>;
  /** 出口（默认走 IPC；页面注入以复用同一份） */
  transport?: ReturnType<typeof createCommunityTransport>;
}

export interface PublishEntry {
  target: PublishTarget | null;
  open: (project: ProjectSummary | ChartProject, chart: ChartSummary | ProjectChart) => void;
  close: () => void;
  /** 跑一次发布；结果原样回给弹窗（失败就地点名，成功由这里收尾） */
  run: (input: PublishInput, onStage: (stage: PublishStage) => void) => Promise<PublishOutcome>;
  recovery: PublishRecoveryResult | null;
  recover: (postId?: number) => Promise<boolean>;
  /** 已发谱面改元数据；失败本地不动（票 51 Q15） */
  runEdit: (input: { diff: ChartDifficulty; level: number; tags: PostTextTag[] }) => Promise<EditChartOutcome>;
  /** 就地修改工程（发布弹窗内就地编辑标题/歌手/难度/等级/草稿，见票 42） */
  updateProject: (updater: (p: ChartProject) => ChartProject | null) => Promise<void>;
}

export type PublishRecoveryResult =
  | { status: 'choose'; posts: { id: number; title: string; time: number | null }[] }
  | { status: 'unmatched' | 'unavailable' | 'wrong-account' | 'mismatch' | 'record-failed' };

function digestLocalChart(chart: ProjectChart): Promise<string> {
  return digestPublishedChart(sanitizeChartForBestdoriUpload(convertNotesToChartCode(chart.notes)));
}

async function getLegacySong(project: ChartProject): Promise<PostSongBody | null> {
  if (project.source.type === 'bandori') return { type: 'bandori', id: project.source.id };
  const audio = (await getProjectUploadRefs(project.id))?.audio;
  return audio ? { type: 'custom', audio: uploadedFileUrl(audio.hash) } : null;
}

function resolveSyncPublishTarget(
  project: ProjectSummary | ChartProject,
  chart: ChartSummary | ProjectChart,
): { project: ChartProject; chart: ProjectChart } | null {
  if (!('notes' in chart) || !Array.isArray(chart.notes)) return null;
  if ('coverPresent' in project && project.coverPresent && !project.coverBlob) return null;
  const fullCharts = project.charts;
  if (!fullCharts.every((c): c is ProjectChart => 'notes' in c && Array.isArray(c.notes))) return null;
  return {
    project: { ...project, charts: fullCharts },
    chart,
  };
}

export function usePublishEntry(deps: PublishEntryDeps): PublishEntry {
  const [target, setTarget] = useState<PublishTarget | null>(null);
  const [recovery, setRecovery] = useState<PublishRecoveryResult | null>(null);
  const openGenRef = useRef(0);
  const operatingRef = useRef(false);
  // 逐个取依赖（页面每次渲染都新建 deps 对象；按项列依赖才能让 run 的引用稳下来）
  const { store, flush, notify, reload, transport } = deps;

  const open = useCallback((project: ProjectSummary | ChartProject, chart: ChartSummary | ProjectChart) => {
    const gen = ++openGenRef.current;
    setRecovery(null);
    const syncTarget = resolveSyncPublishTarget(project, chart);
    if (syncTarget) {
      setTarget({
        project: syncTarget.project,
        chart: syncTarget.chart,
        chartCode: convertNotesToChartCode(syncTarget.chart.notes),
      });
      return;
    }
    void store.get(project.id).then((loaded) => {
      if (gen !== openGenRef.current || !loaded) return;
      const fullChart = loaded.charts.find((c) => c.id === chart.id);
      if (!fullChart) return;
      setTarget({
        project: loaded,
        chart: fullChart,
        chartCode: convertNotesToChartCode(fullChart.notes),
      });
    }).catch(() => {});
  }, [store]);
  const close = useCallback(() => {
    openGenRef.current += 1;
    setTarget(null);
  }, []);

  const syncTarget = useCallback((current: PublishTarget, result: ProjectMutationResult) => {
    if (result.status !== 'saved') return;
    const chart = result.project.charts.find((candidate) => candidate.id === current.chart.id);
    if (!chart) return;
    setTarget((prev) => prev?.project.id === current.project.id && prev.chart.id === chart.id
      ? { ...prev, project: result.project, chart } : prev);
  }, []);

  const checkPublication = useCallback(async (
    current: PublishTarget,
    pending: PendingChartPublish | undefined,
    postId?: number,
  ): Promise<number | null> => {
    setRecovery(null);
    let foundId: number | undefined;
    let recorded = false;
    try {
      const username = getCommunityAccount().getSession().account?.username;
      if (!username || (pending && !sameCommunityAccount(username, pending.username))) {
        setRecovery({ status: 'wrong-account' });
        return null;
      }
      const outlet = transport ?? createCommunityTransport();
      let detail: PostDetail;
      if (postId !== undefined) {
        detail = await fetchPostDetail(outlet, postId, undefined, true);
        const song = pending?.song ?? await getLegacySong(current.project);
        const chartDigest = pending?.chartDigest ?? await digestLocalChart(current.chart);
        if (!song || detail.post.postId !== postId || !await matchesPublishedPost(detail, { username, song, chartDigest })) {
          setRecovery({ status: 'mismatch' });
          return null;
        }
      } else {
        if (!pending) return null;
        const matches = await findPublishedPosts(outlet, pending);
        if (matches.length === 0) {
          setRecovery({ status: 'unmatched' });
          return null;
        }
        if (matches.length > 1) {
          setRecovery({ status: 'choose', posts: matches.map(({ post }) => ({ id: post.postId, title: post.title, time: post.time })) });
          return null;
        }
        detail = matches[0];
      }

      foundId = detail.post.postId;
      const record = { postId: foundId, username, at: detail.post.time ?? pending?.at ?? Date.now() };
      const result = await mutateProject({ store, flush, notify }, current.project.id, async (loaded) => {
        const chart = loaded.charts.find((candidate) => candidate.id === current.chart.id);
        if (!chart) return null;
        if (pending) {
          if (await digestLocalChart(chart) !== pending.chartDigest) return null;
        } else {
          const song = await getLegacySong(loaded);
          if (!song || !await matchesPublishedPost(detail, { username, song, chartDigest: await digestLocalChart(chart) })) return null;
        }
        return recordChartUpload(loaded, chart.id, record, pending?.attemptId);
      });
      if (result.status !== 'saved') {
        setRecovery({ status: 'record-failed' });
        return null;
      }
      recorded = true;
      syncTarget(current, result);
      const tagsMatch = samePublishedTags(pending?.tags ?? current.chart.tags ?? [], detail.tags);
      showToast(t('projects.publish.done', { id: foundId }), 'success');
      if (!tagsMatch) showToast(t('projects.publish.tagsDiffer'), 'warn');
      await reload().catch(() => {});
      return foundId;
    } catch {
      setRecovery({ status: foundId !== undefined ? 'record-failed' : 'unavailable' });
      return null;
    } finally {
      trail.record({ module: 'community', action: 'post-recovery', result: recorded ? 'ok' : 'pending', meta: {
        attemptId: pending?.attemptId, stage: 'check', postId: foundId, tags: (pending?.tags ?? []).length,
      } });
      void trail.flush();
    }
  }, [store, flush, notify, reload, transport, syncTarget]);

  const run = useCallback(async (
    input: PublishInput,
    onStage: (stage: PublishStage) => void,
  ): Promise<PublishOutcome> => {
    const current = target;
    if (!current || operatingRef.current) return { ok: false, failure: 'local' };
    if (current.chart.pendingPublish) return { ok: false, failure: 'pending-confirmation' };
    const currentUsername = getCommunityAccount().getSession().account?.username;
    if (!currentUsername) return { ok: false, failure: 'unauthorized' };
    operatingRef.current = true;
    const submission: { pending?: PendingChartPublish } = {};
    try {
    const outcome = await publishChart(
      {
        transport: transport ?? createCommunityTransport(),
        onStage,
        username: currentUsername,
        beforePost: async ({ chart, ...fields }) => {
          const entry = { ...fields, username: currentUsername, chartDigest: await digestPublishedChart(chart) };
          const result = await mutateProject({ store, flush, notify }, current.project.id, async (loaded) => {
            const targetChart = loaded.charts.find((candidate) => candidate.id === current.chart.id);
            const account = getCommunityAccount().getSession().account?.username;
            if (!targetChart || targetChart.upload || targetChart.pendingPublish || account !== currentUsername
              || await digestLocalChart(targetChart) !== entry.chartDigest) return null;
            return { ...loaded, charts: loaded.charts.map((candidate) => candidate === targetChart
              ? { ...candidate, pendingPublish: entry } : candidate) };
          });
          if (result.status !== 'saved') return false;
          submission.pending = entry;
          syncTarget(current, result);
          return true;
        },
        writeUploadRecord: async (record) => {
          const author = record.username ?? currentUsername;
          const uploadRecord = {
            postId: record.postId,
            at: record.at,
            ...(author ? { username: author } : {}),
          };
          const result = await mutateProject(
            { store, flush, notify },
            current.project.id,
            (loaded) => recordChartUpload(loaded, current.chart.id, uploadRecord, submission.pending?.attemptId),
          );
          return result.status === 'saved';
        },
      },
      input,
    );
    const pending = submission.pending;
    if (outcome.ok) {
      await reload().catch(() => {});
      showToast(
        outcome.recordWritten
          ? t('projects.publish.done', { id: outcome.postId })
          : t('projects.publish.err.record'),
        outcome.recordWritten ? 'success' : 'warn',
      );
    } else if (pending) {
      if (outcome.failure === 'pending-confirmation') {
        onStage('check');
        const postId = await checkPublication(current, pending);
        if (postId !== null) return { ok: true, postId, recordWritten: true };
      } else {
        const attemptId = pending.attemptId;
        const result = await mutateProject({ store, flush, notify }, current.project.id, (loaded) => {
          const chart = loaded.charts.find((candidate) => candidate.id === current.chart.id);
          if (chart?.pendingPublish?.attemptId !== attemptId) return null;
          const { pendingPublish: _pendingPublish, ...unlocked } = chart;
          return { ...loaded, charts: loaded.charts.map((candidate) => candidate === chart ? unlocked : candidate) };
        }).catch(() => null);
        if (result?.status !== 'saved') return { ok: false, failure: 'pending-confirmation' };
        syncTarget(current, result);
      }
    }
    return outcome;
    } finally {
      operatingRef.current = false;
    }
  }, [target, store, flush, notify, reload, transport, syncTarget, checkPublication]);

  const recover = useCallback(async (postId?: number) => {
    if (!target || target.chart.upload || operatingRef.current) return false;
    operatingRef.current = true;
    try {
      return await checkPublication(target, target.chart.pendingPublish, postId) !== null;
    } finally {
      operatingRef.current = false;
    }
  }, [target, checkPublication]);

  const runEdit = useCallback(async (
    input: { diff: ChartDifficulty; level: number; tags: PostTextTag[] },
  ): Promise<EditChartOutcome> => {
    const current = target;
    const postId = current?.chart.upload?.postId;
    if (current == null || postId == null) return { ok: false, failure: 'unknown' };
    const outcome = await editChartPost(
      { transport: transport ?? createCommunityTransport() },
      { postId, diff: input.diff, level: input.level, tags: input.tags },
    );
    if (!outcome.ok) return outcome;
    const result = await mutateProject(
      { store, flush, notify },
      current.project.id,
      (loaded) => updateUploadedChartMeta(loaded, current.chart.id, input),
    );
    await reload();
    showToast(
      t('projects.publish.updated'),
      result.status === 'saved' ? 'success' : 'warn',
    );
    return { ok: true };
  }, [target, store, flush, notify, reload, transport]);

  const updateProject = useCallback(async (updater: (p: ChartProject) => ChartProject | null) => {
    const current = target;
    if (!current) return;
    const result = await mutateProject(
      { store, flush, notify },
      current.project.id,
      updater,
    );
    if (result.status === 'saved') {
      syncTarget(current, result);
      await reload();
    }
  }, [target, store, flush, notify, reload, syncTarget]);

  return { target, open, close, run, recovery, recover, runEdit, updateProject };
}
