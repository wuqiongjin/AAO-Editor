/**
 * 「从官方谱面导入」的源适配器（票 08 + 14；序列已收进 chartImport.ts）。
 *
 * 适配器只回答四个源问题：
 *   1. 官方音频（主线，约 4MB，走主进程网关）；
 *   2. 官方封面（可选：平台没有这张图就不带封面，不挡主线）；
 *   3. 官方谱面代码（可选，默认关）：原文交给 Apply 闸门；请求本身失败（离线 / 限流等
 *      网络域）则**降级放行** = 等同没勾 B（票 26），其余错误域照抛整笔失败；
 *   4. 工程元数据：名称 / 歌手 / 曲目来源 / 时长 / 难度 / 等级。
 *
 * 落盘、探针校时长、取消与 stage 时序归 `chartImport.ts`；本文件不碰 store。
 */
import { formatValidationError, type ValidationError } from '../../chart/editing/ChartConverter';
import { officialDiffIndex, type OfficialDifficulty } from '../../community/bestdori/endpoints';
import { songLevel, type OfficialSongDetail, type SongCandidate } from '../../community/bestdori/mapping';
import {
  audioFileName,
  coverFileName,
  fetchOfficialAudio,
  fetchOfficialChartText,
  fetchOfficialCover,
} from '../../community/bestdori/songs';
import { isCommunityError, type CommunityErrorKind } from '../../community/transport';
import type { CommunityTransport } from '../../community/transport';
import { t, type MessageKey } from '../../i18n';
import type { ChartDifficulty } from '../../project/ChartProject';
import type { ChartImportSource } from './chartImport';

/** 不勾「带官方谱面」时的默认难度：Expert（票 08 定案：默认产出 = 一张空 Expert 谱面） */
const DEFAULT_DIFF: ChartDifficulty = 3;

/** 谱面请求可降级的错误域（票 26 定案的「网络类」）：平台侧没把谱面递出来 */
const CHART_DEGRADE_KINDS: ReadonlySet<CommunityErrorKind> = new Set([
  'offline', 'timeout', 'rate-limited', 'http',
]);

export interface OfficialImportInput {
  song: SongCandidate;
  detail: OfficialSongDetail;
  /** 是否把官方谱面内容一起 Apply 进这张谱面（B 选项，默认关） */
  withChart: boolean;
  /** 勾了 B 时的官方难度；不勾时忽略（产出 Expert） */
  diff: OfficialDifficulty;
}

/** 官方来源：素材走曲库，谱面网络失败按票 26 降级放行，元数据取曲库 + 官方难度表。 */
export function createOfficialImportSource(
  transport: CommunityTransport,
): ChartImportSource<OfficialImportInput> {
  return {
    kind: 'official',

    async audio(input) {
      const staged = await fetchOfficialAudio(transport, input.song, input.detail);
      return { path: staged.path, name: audioFileName(input.song) };
    },

    async cover(input) {
      const staged = await fetchOfficialCover(transport, input.song);
      return staged ? { path: staged.path, name: coverFileName(input.song) } : null;
    },

    async chart(input) {
      try {
        return {
          codeText: await fetchOfficialChartText(transport, input.song.id, input.diff),
          degraded: false,
        };
      } catch (error) {
        if (!(isCommunityError(error) && CHART_DEGRADE_KINDS.has(error.kind))) throw error;
        return { codeText: '', degraded: true };
      }
    },

    projectMeta(input, chart) {
      const { song, detail } = input;
      // 降级后按「没勾 B」的口径建谱面：难度回 Expert、等级不预填 —— 别带着官方等级配一张空谱
      const bringChart = chart != null && !chart.degraded;
      return {
        name: song.title,
        artist: song.artist === '' ? null : song.artist,
        source: { type: 'bandori', id: song.id },
        durationSeconds: detail.lengthSeconds,
        // 官方难度编号与工程难度同值（endpoints.officialDiffIndex 只此一张表）
        diff: bringChart ? (officialDiffIndex(input.diff) as ChartDifficulty) : DEFAULT_DIFF,
        // 等级是作品属性：不勾 B 就不预填（人还没作谱）
        level: bringChart ? songLevel(song, input.diff) : null,
      };
    },
  };
}

/**
 * 失败文案：按统一错误域的 kind 走 i18n（票 07 口径：message 只作诊断，不当界面文案）。
 * 界面文案键是**导入口这一处**的，不写进能力层。
 */
const KIND_MESSAGE_KEYS: Partial<Record<CommunityErrorKind, MessageKey>> = {
  // 超时与离线在 KIND_TRAITS 里同属「连不上」，用户侧看不出区别，共用一句
  offline: 'projects.official.err.offline',
  timeout: 'projects.official.err.offline',
  'rate-limited': 'projects.official.err.rateLimited',
  'unsupported-runtime': 'projects.official.err.desktopOnly',
  // 本机写不进去（磁盘满 / 权限）不是网络问题，别混进「读取失败」
  'staging-failed': 'projects.official.err.staging',
};

export function officialErrorText(error: unknown): string {
  if (isCommunityError(error)) {
    const key = KIND_MESSAGE_KEYS[error.kind];
    if (key) return t(key);
  }
  return t('projects.official.err.generic');
}

/** Apply 闸门拒绝时的文案（与「新增谱面」那条路同口径：点名第一个错） */
export function officialApplyErrorText(errors: ValidationError[]): string {
  const first = errors[0];
  return t('projects.official.err.apply', { message: first ? formatValidationError(first) : 'invalid' });
}
