/**
 * CNB 匿名更新 feed（ADR-0022 §7）。
 * 没有 GitHub 的 /releases/latest/download 目录，也没有名为 latest 的 tag。
 * 列表：GET https://cnb.cool/{slug}/-/releases?format=json（匿名，不要 api.cnb 令牌）。
 * 附件：https://cnb.cool/{slug}/-/releases/download/{真实 tag}/{file}
 */

const CNB_WEB = 'https://cnb.cool';
const CNB_SLUG = 'AsterPicker/AAO-Editor';

function cnbReleasesListUrl(slug) {
  return `${CNB_WEB}/${slug}/-/releases?format=json`;
}

function cnbGenericFeedUrlForTag(slug, tag) {
  return `${CNB_WEB}/${slug}/-/releases/download/${encodeURIComponent(tag)}`;
}

/** 正式版里优先 is_latest；CNB 可能全是 false，再按 published_at 取最新。 */
function pickLatestCnbReleaseTag(releases) {
  if (!Array.isArray(releases)) return null;
  const stable = releases.filter(
    (item) =>
      item &&
      item.draft !== true &&
      item.prerelease !== true &&
      typeof item.tag_name === 'string' &&
      item.tag_name.trim(),
  );
  if (stable.length === 0) return null;
  const marked = stable.find((item) => item.is_latest === true);
  if (marked) return marked.tag_name;
  stable.sort((a, b) => {
    const tb = Date.parse(b.published_at || b.created_at || '') || 0;
    const ta = Date.parse(a.published_at || a.created_at || '') || 0;
    return tb - ta;
  });
  return stable[0].tag_name;
}

module.exports = {
  CNB_WEB,
  CNB_SLUG,
  cnbReleasesListUrl,
  cnbGenericFeedUrlForTag,
  pickLatestCnbReleaseTag,
};
