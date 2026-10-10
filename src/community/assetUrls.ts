/**
 * 本机素材的 URL 形态（票 15：「与 16 同一条通道」）。
 *
 * 素材缓存里的字节住在磁盘上，媒体标签（`<img>`，16 的 `<audio>`）只能读 URL ——
 * 主进程为此开了一条**只读**协议（`electron/assetProtocol.cjs`），这里是它的形参约定：
 * `tsugu-asset://thumb/?url=<素材原始 URL>`。
 *
 * 两条口径：
 *   - 只认**已缓存**的东西：没有条目（或缩略图）时协议回 404，媒体标签走 `onError` 降级成图标；
 *     「什么该进缓存」仍归网关那条路（`songs.ts` 先取数、再让媒体标签读本机）。
 *   - scheme / host 是跨进程契约：CJS 侧同值常量在 `electron/assetProtocol.cjs`，
 *     改一边要改另一边（有互锁测试）。
 */

export const ASSET_SCHEME = 'tsugu-asset';
/** 缩略图那一支的 host（16 的大图 / 音频会另加一支） */
export const ASSET_THUMB_HOST = 'thumb';

/** 缩略图 URL：`upstreamUrl` 是**素材原图**的地址（缓存按它寻址） */
export function assetThumbUrl(upstreamUrl: string): string {
  return `${ASSET_SCHEME}://${ASSET_THUMB_HOST}/?url=${encodeURIComponent(upstreamUrl)}`;
}
