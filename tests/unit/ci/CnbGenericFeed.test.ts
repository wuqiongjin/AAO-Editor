import { describe, expect, it } from 'vitest';
import {
  cnbGenericFeedUrl,
  cnbReleaseAssetUrl,
  isFeedYmlName,
  rewriteGenericFeedYml,
} from '@/scripts/ci/cnbGenericFeed.mjs';

const SLUG = 'AsterPicker/AAO-Editor';
const TAG = 'v0.1.0';

const GH_YML = `version: 0.1.0
files:
  - url: AAO-Editor-Setup-0.1.0.exe
    sha512: abc123checksum
    size: 12
  - url: AAO-Editor-Setup-0.1.0.exe.blockmap
    sha512: def456checksum
    size: 3
path: AAO-Editor-Setup-0.1.0.exe
sha512: abc123checksum
releaseDate: '2026-10-25T00:00:00.000Z'
`;

describe('ADR-0022 §7 · CNB generic feed', () => {
  it('把 GitHub 相对文件名改写成 CNB 匿名下载绝对 URL，sha512 不动', () => {
    const out = rewriteGenericFeedYml(GH_YML, { slug: SLUG, tag: TAG });
    expect(out).toContain(
      `url: ${cnbReleaseAssetUrl(SLUG, TAG, 'AAO-Editor-Setup-0.1.0.exe')}`,
    );
    expect(out).toContain(
      `url: ${cnbReleaseAssetUrl(SLUG, TAG, 'AAO-Editor-Setup-0.1.0.exe.blockmap')}`,
    );
    expect(out).toContain('path: AAO-Editor-Setup-0.1.0.exe');
    expect(out).toContain('sha512: abc123checksum');
    expect(out).not.toMatch(/^(\s*- )?url: AAO-Editor-Setup/m);
  });

  it('附件下载走公开 web 的真实 tag 路径，不含令牌、不造 latest tag', () => {
    expect(cnbGenericFeedUrl(SLUG, TAG)).toBe(
      'https://cnb.cool/AsterPicker/AAO-Editor/-/releases/download/v0.1.0',
    );
    expect(cnbGenericFeedUrl(SLUG, TAG)).not.toContain('/releases/latest/download');
    expect(cnbGenericFeedUrl(SLUG, TAG)).not.toContain('/download/latest');
    expect(cnbReleaseAssetUrl(SLUG, TAG, 'latest.yml')).toBe(
      'https://cnb.cool/AsterPicker/AAO-Editor/-/releases/download/v0.1.0/latest.yml',
    );
    expect(cnbGenericFeedUrl(SLUG, TAG)).not.toMatch(/token|Bearer|api\.cnb/i);
    expect(isFeedYmlName('latest.yml')).toBe(true);
    expect(isFeedYmlName('latest-mac.yml')).toBe(true);
    expect(isFeedYmlName('latest-linux.yml')).toBe(true);
    expect(isFeedYmlName('AAO-Editor-Setup-0.1.0.exe')).toBe(false);
  });
});
