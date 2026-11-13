/**
 * 「从社区谱面导入」的源适配器（票 09；序列已收进 chartImport.ts）。
 *
 * 适配器只回答四个源问题：
 *   1. **谱面默认是主线**：勾着「同步导入谱面」时帖子详情（`post.chart`）取不到就整笔不建 ——
 *      没有「降级成空白谱」这回事（票 26 的降级矩阵是官方导入的：那里谱面是可选项）；
 *      关掉同步导入 = 只建工程 + 音频 + 封面，产出与官方「没勾 B」一致（空 Expert、等级不预填），
 *      并且**连详情都不请求**；
 *   2. **曲目按帖子 `song.type`**：bandori 帖走官方素材那条路（曲库候选 + 歌曲元数据 +
 *      官方音频 / 封面，见 songs.ts），custom 帖按帖内 URL 下载音频与封面、曲目来源记 custom；
 *   3. **工程名称 / 歌手预填**（票 34 预填、票 36 修订名称口径）：工程名一律取**原帖标题**
 *      （bandori 帖标题缺省时退回官方曲名），歌手 = bandori 帖官方乐队名 / custom 帖帖子自报歌手；
 *      谱师署名仍只在导入会话里展示，不落进工程；
 *   4. **等级跟着帖子走，但只在带谱面时**：不导谱面还预填等级 = 给一张空谱挂个属于别人作品的等级。
 *
 * 落盘、探针校时长、取消与 stage 时序归 `chartImport.ts`；本文件不碰 store。
 */
import { formatValidationError, type ValidationError } from '../../chart/editing/ChartConverter';
import type { OfficialSongDetail, PostCandidate, SongCandidate } from '../../community/bestdori/mapping';
import {
  customAudioName,
  customCoverName,
  fetchCustomAudio,
  fetchCustomCover,
  fetchPostDetail,
} from '../../community/bestdori/posts';
import {
  audioFileName,
  coverFileName,
  fetchOfficialAudio,
  fetchOfficialCover,
} from '../../community/bestdori/songs';
import { isCommunityError, type CommunityErrorKind } from '../../community/transport';
import type { CommunityTransport } from '../../community/transport';
import { t, type MessageKey } from '../../i18n';
import type { ChartDifficulty } from '../../project/ChartProject';
import type { ChartImportSource } from './chartImport';

/** custom 帖没有官方曲长可依：先按「无音频默认时长」起，落盘后由实际音频校正 */
const CUSTOM_DURATION_PLACEHOLDER_SECONDS = 30;

/** 不导帖子谱面时的默认难度：Expert（与官方「没勾 B」的产出同口径） */
const DEFAULT_DIFF: ChartDifficulty = 3;

export interface CommunityImportInput {
  post: PostCandidate;
  /** bandori 帖必带：选中时面板已取好的曲库候选与歌曲元数据（素材 / 曲长都靠它们） */
  song?: SongCandidate;
  detail?: OfficialSongDetail;
  /**
   * 是否把帖子里的谱面代码 Apply 进工程（预览栏那颗「同步导入谱面」芯片，**默认开**）。
   * 关掉 = 只建工程 + 音频 + 封面：空 Expert 谱面、难度等级都不预填（与官方「没勾 B」同口径）。
   */
  withChart: boolean;
}

/**
 * bandori 帖的素材 / 元数据依赖；custom 帖返回 null。
 * 缺曲库候选或歌曲元数据 = 面板 misuse（面板的「创建」等它到位才亮），按原样抛出。
 */
function bandoriSong(input: CommunityImportInput): { song: SongCandidate; detail: OfficialSongDetail } | null {
  if (input.post.song.kind !== 'bandori') return null;
  if (input.song == null || input.detail == null) {
    throw new Error(`帖子 ${input.post.postId} 是官方曲帖，但缺少曲库候选或歌曲元数据`);
  }
  return { song: input.song, detail: input.detail };
}

/** 社区来源：bandori 帖复用官方素材，custom 帖走帖内素材；谱面必达、不降级。 */
export function createCommunityImportSource(
  transport: CommunityTransport,
): ChartImportSource<CommunityImportInput> {
  return {
    kind: 'community',

    validate(input) {
      bandoriSong(input);
    },

    async audio(input) {
      const resolved = bandoriSong(input);
      if (resolved) {
        const staged = await fetchOfficialAudio(transport, resolved.song, resolved.detail);
        return { path: staged.path, name: audioFileName(resolved.song) };
      }
      const staged = await fetchCustomAudio(transport, input.post);
      return { path: staged.path, name: customAudioName(input.post) };
    },

    async cover(input) {
      const resolved = bandoriSong(input);
      if (resolved) {
        const staged = await fetchOfficialCover(transport, resolved.song);
        return staged ? { path: staged.path, name: coverFileName(resolved.song) } : null;
      }
      const staged = await fetchCustomCover(transport, input.post);
      return staged ? { path: staged.path, name: customCoverName(input.post) } : null;
    },

    // 谱面是帖子本体：默认（勾着同步导入）取不到就整笔不建，没有官方那支的空白谱降级。
    async chart(input) {
      const detail = await fetchPostDetail(transport, input.post.postId);
      return { codeText: detail.chartCodeText, degraded: false };
    },

    projectMeta(input, chart) {
      const { post } = input;
      const resolved = bandoriSong(input);
      return {
        // 工程名 = 帖标题（谱师对这只谱的命名）；bandori 帖标题缺省时退回官方曲名。
        // 空串由 createOfficialProject 归一成 null；谱师署名仍只在导入会话里展示，不落盘。
        name: post.title.trim() !== '' ? post.title : (resolved?.song.title ?? ''),
        artist: resolved ? resolved.song.artist : post.artists,
        source: post.song.kind === 'bandori' ? { type: 'bandori', id: post.song.songId } : { type: 'custom' },
        durationSeconds: resolved?.detail.lengthSeconds ?? CUSTOM_DURATION_PLACEHOLDER_SECONDS,
        // 带谱面时难度等级跟帖子走；不带时回 Expert、等级不预填。
        diff: chart != null ? (post.diff as ChartDifficulty) : DEFAULT_DIFF,
        level: chart != null ? post.level : null,
      };
    },
  };
}

/**
 * 失败文案：按统一错误域的 kind 走 i18n（message 只作诊断）。
 * 错误域那几句是「从社区谱面导入」这一支自己的（不借官方那组的词）；
 * 「同步导入谱面」那颗中性控件沿用官方支的键（见 CommunityPostPanel，不重复造两份同义键）。
 */
const KIND_MESSAGE_KEYS: Partial<Record<CommunityErrorKind, MessageKey>> = {
  offline: 'projects.community.err.offline',
  timeout: 'projects.community.err.offline',
  'rate-limited': 'projects.community.err.rateLimited',
  'unsupported-runtime': 'projects.community.err.desktopOnly',
  'staging-failed': 'projects.community.err.staging',
};

export function communityErrorText(error: unknown): string {
  if (isCommunityError(error)) {
    const key = KIND_MESSAGE_KEYS[error.kind];
    if (key) return t(key);
  }
  return t('projects.community.err.generic');
}

/** Apply 闸门拒绝时的文案（与另两支同口径：点名第一个错） */
export function communityApplyErrorText(errors: ValidationError[]): string {
  const first = errors[0];
  return t('projects.community.err.apply', { message: first ? formatValidationError(first) : 'invalid' });
}
