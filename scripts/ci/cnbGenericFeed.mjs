/** CNB 匿名 generic feed（ADR-0022 §7 / release-pipeline 16）
 *  公开 web：https://cnb.cool/{slug}/-/releases/download/{真实 tag}/{file}
 *  客户端用 `/-/releases?format=json` 解析 tag，不要写 tag=latest（没有这个 tag）。
 *  不要套 GitHub 的 /releases/latest/download/ —— CNB 这条是 JSON 404。
 *  令牌不得进客户端、不得写进 yml。
 */

export const CNB_WEB = 'https://cnb.cool';

export function cnbGenericFeedUrl(slug, tag) {
  return `${CNB_WEB}/${slug}/-/releases/download/${encodeURIComponent(tag)}`;
}

export function cnbReleaseAssetUrl(slug, tag, filename) {
  return `${CNB_WEB}/${slug}/-/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(filename)}`;
}

export function isFeedYmlName(name) {
  return /^latest(?:-mac|-linux)?\.yml$/.test(name);
}

function filenameFromUrlValue(raw) {
  const trimmed = String(raw).trim().replace(/^['"]|['"]$/g, '');
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const path = new URL(trimmed).pathname;
      const last = path.split('/').filter(Boolean).pop();
      return last ? decodeURIComponent(last) : trimmed;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

/** 只改 `url:`（含 files 列表项）；`path:` 仍是文件名；sha512 原样保留。 */
export function rewriteGenericFeedYml(yml, { slug, tag }) {
  return String(yml).replace(/^([ \t]*(?:-[ \t]*)?url:[ \t]*)(.+)$/gm, (_full, prefix, value) => {
    const name = filenameFromUrlValue(value);
    return `${prefix}${cnbReleaseAssetUrl(slug, tag, name)}`;
  });
}
