import { describe, expect, it } from 'vitest';
import {
  CNB_SLUG,
  cnbGenericFeedUrlForTag,
  cnbReleasesListUrl,
  pickLatestCnbReleaseTag,
} from '@/electron/cnbFeed.cjs';

describe('CNB 运行时 feed：真实 tag，不用 latest 这个假 tag', () => {
  it('公开列表 URL 走网页 JSON，不打 api.cnb', () => {
    expect(cnbReleasesListUrl(CNB_SLUG)).toBe(
      'https://cnb.cool/AsterPicker/AAO-Editor/-/releases?format=json',
    );
    expect(cnbReleasesListUrl(CNB_SLUG)).not.toMatch(/api\.cnb|token|Bearer/i);
  });

  it('generic 根是 /releases/download/{tag}，不是 /download/latest 也不是 GitHub 的 latest/download', () => {
    expect(cnbGenericFeedUrlForTag(CNB_SLUG, 'v0.1.0')).toBe(
      'https://cnb.cool/AsterPicker/AAO-Editor/-/releases/download/v0.1.0',
    );
    expect(cnbGenericFeedUrlForTag(CNB_SLUG, 'v0.1.0')).not.toContain('/download/latest');
    expect(cnbGenericFeedUrlForTag(CNB_SLUG, 'v0.1.0')).not.toContain('/releases/latest/download');
  });

  it('is_latest 全 false 时按 published_at 取正式版 tag', () => {
    expect(
      pickLatestCnbReleaseTag([
        {
          tag_name: 'v0.1.0',
          draft: false,
          prerelease: false,
          is_latest: false,
          published_at: '2026-10-22T02:02:16Z',
        },
        {
          tag_name: 'v0.0.9',
          draft: false,
          prerelease: false,
          is_latest: false,
          published_at: '2026-10-01T00:00:00Z',
        },
        {
          tag_name: 'v0.2.0-rc',
          draft: false,
          prerelease: true,
          is_latest: false,
          published_at: '2026-10-23T00:00:00Z',
        },
      ]),
    ).toBe('v0.1.0');
  });

  it('标了 is_latest 的正式版优先；空列表没有 tag', () => {
    expect(
      pickLatestCnbReleaseTag([
        {
          tag_name: 'v0.1.0',
          draft: false,
          prerelease: false,
          is_latest: false,
          published_at: '2026-10-22T02:02:16Z',
        },
        {
          tag_name: 'v0.2.0',
          draft: false,
          prerelease: false,
          is_latest: true,
          published_at: '2026-10-20T00:00:00Z',
        },
      ]),
    ).toBe('v0.2.0');
    expect(pickLatestCnbReleaseTag([])).toBeNull();
    expect(pickLatestCnbReleaseTag(null)).toBeNull();
  });
});
