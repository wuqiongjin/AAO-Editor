// 仿真场素材的读取口径（chart-preview 05 锁测③，接 04 的直读通道）：
//   - 三个 URL 一律挂 `/__bestdori-assets/`（开发期中间件），不落 `public/assets/`；
//   - 逐服探测：第一个归档过的服务器目录胜出（本机没归档都是空态）；
//   - 素材缺席是**明说的产品态**（`missing` + 空态文案），不抛错；
//   - 带体取色失败走兜底色（1×1 离屏画布不可用 / 图未解码时也一样）。
import { describe, expect, it } from 'vitest';
import {
  SIM_ASSET_BASE,
  SIM_ASSET_SERVERS,
  emptySimAssets,
  loadSimAssets,
  sampleCenterColor,
  simAssetUrls,
} from '@/src/preview/video/sim/simAssets';
import { SIM_BAND_COLORS } from '@/src/preview/video/sim/simGeometry';

const okImage = (src: string) => ({ naturalWidth: 8, naturalHeight: 8, src } as unknown as HTMLImageElement);

/** 假图片加载：`allow` 里列出的 src 才算存在（其余 404 → 该服务器目录视为没归档） */
function fakeLoader(allow: (src: string) => boolean, seen: string[] = []) {
  return {
    seen,
    load: (src: string) => {
      seen.push(src);
      return allow(src) ? Promise.resolve(okImage(src)) : Promise.reject(new Error(`404 ${src}`));
    },
  };
}

describe('仿真场的素材 URL', () => {
  it('三张场地/背景图都在开发期直读通道下（`/__bestdori-assets/<server>/…`）', () => {
    const urls = simAssetUrls('jp');
    for (const url of [urls.field, urls.background, urls.playLine]) {
      expect(url.startsWith(`${SIM_ASSET_BASE}/jp/`)).toBe(true);
    }
    expect(urls.field).toContain('fieldskin/skin00_rip/bg_line_rhythm.png');
    expect(urls.playLine).toContain('fieldskin/skin00_rip/game_play_line.png');
    expect(urls.background).toContain('bgskin/skin00_rip/liveBG_normal.png');
  });
});

describe('loadSimAssets · 逐服探测', () => {
  it('第一个归档过的服务器目录胜出（并顺带读走三图与带体取色）', async () => {
    const jp = simAssetUrls('jp');
    const en = simAssetUrls('en');
    const band = '/assets/skins/skin00/longNoteLine.png';
    const bandSp = '/assets/skins/skin00/longNoteLine2.png';
    const loader = fakeLoader((src) =>
      src === en.field || src === en.background || src === en.playLine || src === band || src === bandSp);
    const assets = await loadSimAssets({
      servers: ['jp', 'en'],
      loadImage: loader.load,
      bandSrc: band,
      bandSpSrc: bandSp,
      sampleColor: () => 'rgb(1, 2, 3)',
    });

    expect(assets.missing).toBe(false);
    expect(assets.server).toBe('en');
    expect(assets.field?.src).toBe(en.field);
    expect(assets.bandColor).toBe('rgb(1, 2, 3)');
    expect(assets.bandColorSp).toBe('rgb(1, 2, 3)');
    // 探测顺序：jp 的场地图先失败，才轮到 en；带体图（取色用）也读到了
    expect(loader.seen[0]).toBe(jp.field);
    expect(loader.seen).toContain(en.field);
    expect(loader.seen).toContain(band);
  });

  it('一个服务器都没归档 → 空态（不抛错，给的是"缺素材"这个事实）', async () => {
    const loader = fakeLoader(() => false);
    const assets = await loadSimAssets({
      servers: ['jp', 'cn'],
      loadImage: loader.load,
      bandSrc: '/assets/skins/skin00/longNoteLine.png',
      sampleColor: () => 'rgb(9, 9, 9)',
    });
    expect(assets).toEqual(emptySimAssets());
    expect(assets.missing).toBe(true);
    expect(assets.bandColor).toBe(SIM_BAND_COLORS.band);
  });

  it('场地图在、背景 / 判定线缺 → 不算空态（缺的那层不画）', async () => {
    const jp = simAssetUrls('jp');
    const assets = await loadSimAssets({
      servers: ['jp'],
      loadImage: fakeLoader((src) => src === jp.field).load,
      sampleColor: () => null,
    });
    expect(assets.missing).toBe(false);
    expect(assets.field).not.toBeNull();
    expect(assets.background).toBeNull();
    expect(assets.playLine).toBeNull();
    expect(assets.bandColor).toBe(SIM_BAND_COLORS.band); // 取色失败 → 兜底绿
  });

  it('默认探测顺序以 jp 打头（归档脚本的默认服务器）', () => {
    expect(SIM_ASSET_SERVERS[0]).toBe('jp');
  });
});

describe('sampleCenterColor', () => {
  it('没有 DOM / 没有图 → null（调用方走兜底色，不抛错）', () => {
    expect(sampleCenterColor(null)).toBeNull();
  });
});
