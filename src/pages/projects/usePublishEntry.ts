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
import { useCallback, useState } from 'react';
import { convertNotesToChartCode, type ChartCodeNote } from '../../chart/editing/ChartConverter';
import {
  editChartPost,
  publishChart,
  type EditChartOutcome,
  type PostTextTag,
  type PublishInput,
  type PublishOutcome,
  type PublishStage,
} from '../../community/bestdori/publish';
import { getCommunityAccount } from '../../community/bestdori/account';
import { createCommunityTransport } from '../../community/electronTransport';
import type { ChartDifficulty, ChartProject, ProjectChart } from '../../project/ChartProject';
import { mutateProject, type ProjectMutationStore } from '../../project/ChartProjectRecord';
import { recordChartUpload, updateUploadedChartMeta } from '../../project/projectCatalog';
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
  open: (project: ChartProject, chart: ProjectChart) => void;
  close: () => void;
  /** 跑一次发布；结果原样回给弹窗（失败就地点名，成功由这里收尾） */
  run: (input: PublishInput, onStage: (stage: PublishStage) => void) => Promise<PublishOutcome>;
  /** 已发谱面改元数据；失败本地不动（票 51 Q15） */
  runEdit: (input: { diff: ChartDifficulty; level: number; tags: PostTextTag[] }) => Promise<EditChartOutcome>;
  /** 就地修改工程（发布弹窗内就地编辑标题/歌手/难度/等级/草稿，见票 42） */
  updateProject: (updater: (p: ChartProject) => ChartProject | null) => Promise<void>;
}

export function usePublishEntry(deps: PublishEntryDeps): PublishEntry {
  const [target, setTarget] = useState<PublishTarget | null>(null);
  // 逐个取依赖（页面每次渲染都新建 deps 对象；按项列依赖才能让 run 的引用稳下来）
  const { store, flush, notify, reload, transport } = deps;

  const open = useCallback((project: ChartProject, chart: ProjectChart) => {
    setTarget({ project, chart, chartCode: convertNotesToChartCode(chart.notes) });
  }, []);
  const close = useCallback(() => setTarget(null), []);

  const run = useCallback(async (
    input: PublishInput,
    onStage: (stage: PublishStage) => void,
  ): Promise<PublishOutcome> => {
    const current = target;
    if (!current) return { ok: false, failure: 'unknown' };
    const currentUsername = getCommunityAccount().getSession().account?.username;
    const outcome = await publishChart(
      {
        transport: transport ?? createCommunityTransport(),
        onStage,
        username: currentUsername,
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
            (loaded) => recordChartUpload(loaded, current.chart.id, uploadRecord),
          );
          return result.status === 'saved';
        },
      },
      input,
    );
    if (outcome.ok) {
      await reload();
      showToast(
        outcome.recordWritten
          ? t('projects.publish.done', { id: outcome.postId })
          : t('projects.publish.err.record'),
        outcome.recordWritten ? 'success' : 'warn',
      );
    }
    return outcome;
  }, [target, store, flush, notify, reload, transport]);

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
      const nextChart = result.project.charts.find((c) => c.id === current.chart.id);
      if (nextChart) {
        // 票 43 Q2：关窗后在飞写入不得把 target 设回来（否则弹窗关了又开）
        setTarget((prev) => (prev == null ? null : {
          project: result.project,
          chart: nextChart,
          chartCode: prev.chartCode,
        }));
      }
      await reload();
    }
  }, [target, store, flush, notify, reload]);

  return { target, open, close, run, runEdit, updateProject };
}
