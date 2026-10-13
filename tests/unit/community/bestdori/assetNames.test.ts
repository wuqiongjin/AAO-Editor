// bestdori-integration 35：导入素材的统一落名规则（来源前缀 + 谱面 ID + 歌曲名）。
//
// 本文件锁四件事：
//   ① 两支同一把尺：official-<songId>-<曲名> / community-<postId>-<曲名>，音频与封面同规则；
//   ② 曲名清洗：Windows 非法字符换 `_`（不删除）、去首尾空格与点（截断后再剥一次）、超长截断；
//   ③ 标题缺省（清洗后为空 / 只剩分隔符）退 `<前缀>-<id>.<ext>`，不留秃名。
// ④（范围外，不在这里锁）手动换音频维持用户原文件名 —— 见 projectAudio 的锁测。
import { describe, expect, it } from 'vitest';
import {
  communityAssetName,
  officialAssetName,
  sanitizeFileNameSegment,
} from '@/src/community/bestdori/assetNames';

describe('票 35 · 曲名清洗', () => {
  it('Windows 非法字符换 `_`（替换不删除：词间分隔要留住）', () => {
    expect(sanitizeFileNameSegment('A/B:C*D?E"F<G>H|I\\J')).toBe('A_B_C_D_E_F_G_H_I_J');
  });

  it('控制字符也换掉（不该出现在任何文件名里）', () => {
    expect(sanitizeFileNameSegment('a\u0000b\u001fc')).toBe('a_b_c');
  });

  it('首尾空格与点去掉（Windows 会静默吞掉尾点尾空格）', () => {
    expect(sanitizeFileNameSegment('  .hidden.  ')).toBe('hidden');
    expect(sanitizeFileNameSegment('..')).toBe('');
    expect(sanitizeFileNameSegment('   ')).toBe('');
  });

  it('超长截断到 60 字符（帖子标题自填，见过两百字的）', () => {
    const long = 'x'.repeat(200);
    const stem = sanitizeFileNameSegment(long);
    expect(stem).toHaveLength(60);
    // 截断后落在空格上也要收尾（不留尾空格）
    expect(sanitizeFileNameSegment(`${'y'.repeat(59)} zzz`)).toHaveLength(59);
  });

  it('截断的切口踩在点上：尾点再剥一次（Windows 会静默吞掉尾点）', () => {
    // 第 60 个码元正是点：切完是 59 个 a 加点 → 点剥掉，长度 59
    const onDot = `${'a'.repeat(59)}.${'b'.repeat(10)}`;
    const stem = sanitizeFileNameSegment(onDot);
    expect(stem).toBe('a'.repeat(59));
    expect(stem).not.toMatch(/\.$/);
  });

  it('截断不劈代理对（emoji 踩线时砍掉半拉，不留孤单高位代理）', () => {
    // 第 60 个码元正好落在 🎵 的高位代理上：砍掉后半拉，长度 59
    const withEmoji = `${'a'.repeat(59)}🎵${'b'.repeat(10)}`;
    const stem = sanitizeFileNameSegment(withEmoji);
    expect(stem).toBe('a'.repeat(59));
    expect(stem).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('普通曲名原样过（不清洗无辜标题）', () => {
    expect(sanitizeFileNameSegment('BLACK SHOUT')).toBe('BLACK SHOUT');
    expect(sanitizeFileNameSegment('Yes! BanG_Dream!')).toBe('Yes! BanG_Dream!');
  });
});

describe('票 35 · 官方 / 社区两支同一把尺', () => {
  it('bandori 来源：official-<songId>-<曲名>', () => {
    expect(officialAssetName({ id: 29, title: 'BLACK SHOUT' }, 'mp3')).toBe('official-29-BLACK SHOUT.mp3');
    expect(officialAssetName({ id: 29, title: 'BLACK SHOUT' }, 'png')).toBe('official-29-BLACK SHOUT.png');
  });

  it('custom 来源：community-<postId>-<曲名>', () => {
    expect(communityAssetName({ postId: 248468, title: 'All You Wanted (GBP Edit)' }, 'mp3'))
      .toBe('community-248468-All You Wanted (GBP Edit).mp3');
    expect(communityAssetName({ postId: 248468, title: 'All You Wanted (GBP Edit)' }, 'png'))
      .toBe('community-248468-All You Wanted (GBP Edit).png');
  });

  it('标题缺省（清洗后为空）退 `<前缀>-<id>.<ext>`，不留秃名', () => {
    expect(officialAssetName({ id: 29, title: '  ' }, 'mp3')).toBe('official-29.mp3');
    expect(officialAssetName({ id: 29, title: '///' }, 'png')).toBe('official-29.png');
    expect(communityAssetName({ postId: 248468, title: '' }, 'mp3')).toBe('community-248468.mp3');
    expect(communityAssetName({ postId: 248468, title: '. . .' }, 'png')).toBe('community-248468.png');
  });

  it('非法标题字符先清洗再拼（不在最终名里留 `\\/:*?"<>|`）', () => {
    const name = officialAssetName({ id: 1, title: 'Yes/ BanG_Dream!?' }, 'mp3');
    expect(name).toBe('official-1-Yes_ BanG_Dream!_.mp3');
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
  });
});
