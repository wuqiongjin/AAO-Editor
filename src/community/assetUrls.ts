/**
 * 本机素材的 URL 形态（票 15：「与 16 同一条通道」）。
 *
 * 素材缓存里的字节住在磁盘上，媒体标签（`<img>`，16 的 `<audio>`）只能读 URL ——
 * 主进程为此开了一条**只读**协议（`electron/assetProtocol.cjs`）。
 * scheme 是**自起名**（自定义协议没有既有约定）：现用 `aao-` 前缀占位（旧占位名随仓库名、
 * 已弃用 —— 产品名大概率也不会是它；正式名未定，定名后随发版一并改，改名只动这份常量与 CJS 侧同值常量）。
 * 形参约定（两支）：
 *   - `aao-asset://thumb/?url=<素材原始 URL>`：缩略图（票 15，选曲目录行）；
 *   - `aao-asset://raw/?url=<素材原始 URL>`：**原始字节**（票 16，预览区封面大图 / 试听音频）。
 *
 * 两条口径：
 *   - 只认**已缓存**的东西：没有条目（或缩略图）时协议回 404，媒体标签走 `onError` 降级
 *     （thumb 降级成图标，raw 降级成直链）；「什么该进缓存」仍归网关那条路
 *     （`songs.ts` 先取数、再让媒体标签读本机）。
 *   - scheme / host 是跨进程契约：CJS 侧同值常量在 `electron/assetProtocol.cjs`，
 *     改一边要改另一边（有互锁测试）。
 */

export const ASSET_SCHEME = 'aao-asset';
/** 缩略图那一支的 host（票 15） */
export const ASSET_THUMB_HOST = 'thumb';
/** 原始字节那一支的 host（票 16：预览大图 / 音频共用；音频的 Range 由协议侧处理） */
export const ASSET_RAW_HOST = 'raw';

/** 缩略图 URL：`upstreamUrl` 是**素材原图**的地址（缓存按它寻址） */
export function assetThumbUrl(upstreamUrl: string): string {
  return `${ASSET_SCHEME}://${ASSET_THUMB_HOST}/?url=${encodeURIComponent(upstreamUrl)}`;
}

/** 原始字节 URL（票 16）：读缓存里按 `upstreamUrl` 寻址的那份原件，未缓存回 404 */
export function assetRawUrl(upstreamUrl: string): string {
  return `${ASSET_SCHEME}://${ASSET_RAW_HOST}/?url=${encodeURIComponent(upstreamUrl)}`;
}
