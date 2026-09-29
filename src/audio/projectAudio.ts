// 工程音频接缝（票 15 定案 8/9 / ADR-0015 §6）：按 projectId 读写工程记录里的音频与时长。
//
// 为什么不是 AudioSession：session 是「当前工程的播放会话」——它手里握着全站唯一那个共享
// AudioEngine（当前工程解码后的 buffer，也是播放器）。为了改非当前工程的音频去借它 load 一次，
// 会把工作台那份顶掉。所以音频页的写路径收在这里：读记录 → 改记录 → 落盘，作用对象由入参决定，
// 「当前 / 非当前」的差别只剩一条——**目标是当前工程时要先把在飞的编辑落盘**。
//
// 锁（ADR-0015 §4）：UI 禁用是第一道，这里再挡一次——纵深防御，别让"按钮忘了 disable"变成能写。
import type { ChartDifficulty, ChartProject, ChartProjectStore } from '../project/ChartProject';
import { mutateProject } from '../project/ChartProjectRecord';
import { isProjectAudioLocked } from '../project/workspaceProject';
import { clampChartDuration } from './chartDuration';
import { probeAudioDuration, type AudioBytesDecoder } from './probeAudioDuration';

/** 锁定原因（点名的已上传谱面）：横幅文案要能说清"为什么锁" */
export interface ProjectAudioLockSource {
  title: string | null;
  diff: ChartDifficulty;
  level: number | null;
}

/**
 * 按 projectId 读到的音频视图；读是全域开放的（包括锁定工程，ADR-0015 §6）。
 * 带 `name`（工程展示名）是因为作用域条要说清"我在管谁"——读的时候顺手带出来，
 * 免得调用方为了一个名字再回 store 跑一趟。
 */
export interface ProjectAudioView {
  projectId: string;
  name: string | null;
  audioName: string | null;
  hasAudio: boolean;
  durationSeconds: number;
  locked: boolean;
  lockedBy: ProjectAudioLockSource[];
}

export type ProjectAudioWriteResult =
  | { ok: true }
  | { ok: false; reason: 'locked' | 'missing' | 'decode' | 'invalid' };

export interface ProjectAudioDeps {
  store: ChartProjectStore;
  /** 当前工程 id；null = 没有当前工程 */
  currentProjectId: string | null;
  /**
   * 把当前工程在飞的编辑落盘（Editor 注入的 flushPersist）。
   * 目标是当前工程时必须先做：下面的读-改-写会整条记录覆写，不先落盘就盖掉在飞内容。
   */
  flushPersist?: () => Promise<void>;
  /** 通知工程目录 / 详情行刷新（也让当前工程的会话按不变量重新对齐） */
  notifyCatalogChanged: () => void;
  /** 求时长；默认一次性离线探针，测试可注入 */
  probeDuration?: (file: Blob, decode?: AudioBytesDecoder) => Promise<number>;
}

function lockSourcesOf(project: ChartProject): ProjectAudioLockSource[] {
  return project.charts
    .filter((chart) => chart.upload != null)
    .map((chart) => ({ title: chart.title, diff: chart.diff, level: chart.level }));
}

/** 读某个工程的音频视图；工程不存在返回 null（调用方据此走空态 / 回落） */
export async function readProjectAudio(
  store: ChartProjectStore,
  projectId: string,
): Promise<ProjectAudioView | null> {
  const project = await store.get(projectId);
  if (!project) return null;
  return {
    projectId,
    name: project.name,
    audioName: project.audioName,
    hasAudio: project.audioName != null,
    durationSeconds: project.durationSeconds,
    locked: isProjectAudioLocked(project),
    lockedBy: lockSourcesOf(project),
  };
}

/** 一次可写读-改-写里「改成什么」：写、跳过（当前值已在位）、解码失败（整笔不写）。 */
type ChangeOutcome =
  | { outcome: 'write'; next: ChartProject }
  | { outcome: 'skip' }
  | { outcome: 'decode-failed' };

/**
 * 一条**可写**的读-改-写：次序（flush → get → fn → save → notify）由 `mutateProject` 统一拥有，
 * 锁判定与解码留在本文件（音频语义）。
 *
 * 次序的两条约束原样保留：
 * - 目标是当前工程时先落盘在飞编辑（否则整条记录覆写会盖掉工作台正在编辑的内容）；
 * - 锁判定在**解码之前**（探针是这条路径上最贵的一步，ADR-0015 §4 的第二道闸要在第一道上就拦住）。
 */
async function mutateWritable(
  deps: ProjectAudioDeps,
  projectId: string,
  change: (project: ChartProject) => Promise<ChangeOutcome> | ChangeOutcome,
): Promise<ProjectAudioWriteResult> {
  // 不落盘时的失败原因（锁 / 解码）只有本文件懂，挂在 fn 的取消路径上带出来。
  let aborted: ProjectAudioWriteResult | null = null;
  const result = await mutateProject(
    {
      store: deps.store,
      ...(deps.currentProjectId === projectId && deps.flushPersist ? { flush: deps.flushPersist } : {}),
      notify: deps.notifyCatalogChanged,
    },
    projectId,
    async (project) => {
      if (isProjectAudioLocked(project)) {
        aborted = { ok: false, reason: 'locked' };
        return null;
      }
      const outcome = await change(project);
      if (outcome.outcome === 'decode-failed') {
        aborted = { ok: false, reason: 'decode' };
        return null;
      }
      return outcome.outcome === 'write' ? outcome.next : null;
    },
  );
  if (aborted != null) return aborted;
  if (result.status === 'missing') return { ok: false, reason: 'missing' };
  return { ok: true };
}

/** 导入 / 更换音频：时长先探出来（探不到就不写，不留"有音频但时长是旧的"这种半截态） */
export async function importProjectAudio(
  deps: ProjectAudioDeps,
  projectId: string,
  file: File,
): Promise<ProjectAudioWriteResult> {
  return mutateWritable(deps, projectId, async (project) => {
    let duration: number;
    try {
      duration = await (deps.probeDuration ?? probeAudioDuration)(file);
    } catch {
      return { outcome: 'decode-failed' };
    }
    return {
      outcome: 'write',
      next: {
        ...project,
        audioName: file.name,
        audioBlob: file,
        // 有音频 = 音频时长（ADR-0005 §4 / 票 15 定案 1）
        durationSeconds: clampChartDuration(duration),
      },
    };
  });
}

/** 清除音频：时长保留当前值（与 session.clearAudio 同口径——时长是独立字段，不跟着归零） */
export async function clearProjectAudio(
  deps: ProjectAudioDeps,
  projectId: string,
): Promise<ProjectAudioWriteResult> {
  return mutateWritable(deps, projectId, (project) => {
    if (project.audioName == null && project.audioBlob == null) return { outcome: 'skip' };
    const next: ChartProject = { ...project, audioName: null };
    delete next.audioBlob;
    return { outcome: 'write', next };
  });
}

/** 手改谱面时长（只在无音频时有意义：有音频时时长跟随音频，与 session 的口径一致） */
export async function setProjectAudioDuration(
  deps: ProjectAudioDeps,
  projectId: string,
  seconds: number,
): Promise<ProjectAudioWriteResult> {
  if (!Number.isFinite(seconds) || seconds <= 0) return { ok: false, reason: 'invalid' };
  return mutateWritable(deps, projectId, (project) => {
    if (project.audioName != null) return { outcome: 'skip' };
    const clamped = clampChartDuration(seconds);
    if (project.durationSeconds === clamped) return { outcome: 'skip' };
    return { outcome: 'write', next: { ...project, durationSeconds: clamped } };
  });
}
