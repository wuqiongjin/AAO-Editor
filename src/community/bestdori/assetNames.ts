/**
 * 导入素材的落名规则（票 35，2026-10-13 定案）：**来源前缀 + 谱面 ID + 歌曲名**，官方与社区同一把尺。
 *
 *   - bandori 来源（官方导入 / 社区 bandori 帖）= `official-<songId>-<曲名>.mp3` / `.png`
 *   - custom 来源（社区 custom 帖）= `community-<postId>-<曲名>.mp3` / `.png`
 *
 * 前缀按**素材从哪来**分（官方曲库那条路 / 帖内上传那条路），不是「官方谱 / 社区谱」那对
 * 用户入口分类，也不是 `曲目来源` 字段的显示名（CONTEXT 的三个 _Avoid_ 都盯着别混轴）——
 * 它只是文件名里的一个寻址token。
 *
 * 取代此前的三套各自演化：官方走平台内部文件名（`bgm029.mp3` / `blackshout.png`，对用户是黑话、
 * 看不出是什么歌）、custom 退帖 id 派生（`post-248468-audio.mp3`，同病）。手动换音频不归这里管 ——
 * 它维持用户原始文件名（`projectAudio.ts` 的 `file.name`）。
 *
 * 曲名清洗在这一处做，调用点不各长一份：
 *   - Windows 非法字符 `\ / : * ? " < > |`（外加控制字符）→ `_`：**替换不删除**，
 *     「A/B」删掉斜杆会粘成「AB」，替换保留词间分隔；
 *   - 首尾空格与点去掉：Windows 会静默吞掉尾点尾空格，工程记录里不留这种名
 *     （**截断之后还要再剥一次**：60 字的切口可能正好落在点上）；
 *   - 超长截断：帖子标题是用户自填的，见过两百字的，不封顶路径与展示都炸。
 * 标题缺省（清洗后为空，或只剩分隔符）→ 退 `<前缀>-<id>.<ext>`，不留「official-29-.mp3」这种秃名。
 *
 * **只对之后的导入生效**：已落盘工程的 `audioName` / `coverName` 不回改（票 35 定案）。
 * 这两个名字同时是素材缓存的 `suggestedName`（主进程侧还会再过一遍 `safeStem`，见 assetCache.cjs）。
 */

/** 曲名段的字符上限（帖子标题自填无约束；封顶后全名仍远低于各平台路径上限） */
const TITLE_MAX_CHARS = 60;

/**
 * Windows 文件名非法字符。**控制字符按码点判**（不走正则：`\u0000` 进字符类会撞
 * `no-control-regex`，而那些字符确实不该出现在任何文件名里）。
 */
const ILLEGAL_CHARS: ReadonlySet<string> = new Set(['\\', '/', ':', '*', '?', '"', '<', '>', '|']);

/** 曲名 → 文件名安全段：非法字符换 `_`（**替换不删除**：「A/B」删掉斜杆会粘成「AB」） */
function toFileNameSafe(title: string): string {
  let out = '';
  for (const ch of title) {
    const code = ch.codePointAt(0) ?? 0;
    out += ILLEGAL_CHARS.has(ch) || code <= 0x1f ? '_' : ch;
  }
  return out;
}

/**
 * 超长截断（UTF-16 码元计）+ 收尾。切口有两处坑：
 *   - 正好落在点上 → 尾点残留（Windows 会静默吞掉它，工程记录里不留这种名）；
 *   - 正好劈开代理对 → 留下孤单高位代理，那个字符落盘会编码失败（Windows 直接抛）。
 * 砍完再剥一次尾点尾空格、必要时砍掉半拉代理。
 */
function truncateSegment(stem: string): string {
  const sliced = stem.slice(0, TITLE_MAX_CHARS).replace(/[.\s]+$/, '');
  const last = sliced.charCodeAt(sliced.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? sliced.slice(0, -1) : sliced;
}

/** 曲名 → 文件名段：非法字符换 `_`、去首尾空格与点、超长截断（清洗后可能为空串） */
export function sanitizeFileNameSegment(title: string): string {
  return truncateSegment(
    toFileNameSafe(title)
      .trim()
      // 首尾的「点 + 空格」混合也一起去（'. . .' 这种整行点空格的帖子标题洗后应为空）
      .replace(/^[.\s]+/, '')
      .replace(/[.\s]+$/, ''),
  );
}

/** 落进工程的素材后缀：音频 mp3 / 封面 png（两支同一把尺） */
export type AssetExtension = 'mp3' | 'png';

/**
 * 清洗后的曲名段算不算「缺省」：空串，或**只剩分隔符**（整行都是非法字符的帖子标题洗成 `___`
 * 也是秃名，一样退 id）。有实词内容（字母 / 数字 / 汉字 / 全角标点…）才拼进名字。
 */
function isBlankStem(stem: string): boolean {
  return stem.replace(/_/g, '') === '';
}

/** 两支共用的那一把尺：`<prefix>-<id>-<曲名>.<ext>`；曲名缺省退 `<prefix>-<id>.<ext>` */
function buildAssetName(prefix: string, id: number, title: string, extension: AssetExtension): string {
  const stem = sanitizeFileNameSegment(title);
  return isBlankStem(stem) ? `${prefix}-${id}.${extension}` : `${prefix}-${id}-${stem}.${extension}`;
}

/** bandori 来源的素材名：`official-<songId>-<曲名>.<ext>`；曲名缺省退 `official-<songId>.<ext>` */
export function officialAssetName(song: { id: number; title: string }, extension: AssetExtension): string {
  return buildAssetName('official', song.id, song.title, extension);
}

/** custom 来源的素材名：`community-<postId>-<曲名>.<ext>`；标题缺省退 `community-<postId>.<ext>` */
export function communityAssetName(post: { postId: number; title: string }, extension: AssetExtension): string {
  return buildAssetName('community', post.postId, post.title, extension);
}
