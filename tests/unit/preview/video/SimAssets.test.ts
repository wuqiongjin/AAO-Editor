// 仿真场素材的读取口径（chart-preview 05 锁测③；chart-preview 41 起按包 ID 解析）：
//   - 三个 URL 一律在 `public/assets/sim/` 下（前缀 = `SIM_ASSET_BASE`，跟着构建 base）；
//   - **包与文件名不硬编码**：按包 ID 查取件侧包清单取文件名（ADR-0018 §2）——上游
//     `liveBG_normal.png` / `liveBG.png` 两种命名并存，故这里注入一份双命名清单锁解析；
//   - 逐服探测：第一个归档过的服务器目录胜出（本机没归档都是空态）；
//   - 素材缺席是**明说的产品态**（`missing` + 空态文案），不抛错；
//   - 带体取色失败走兜底色（1×1 离屏画布不可用 / 图未解码时也一样）。
import { describe, expect, it, vi } from 'vitest';

// 注入一份比本机快照丰富的清单（多包 + `liveBG_normal` / `liveBG` 两种命名）：
// "按包 ID 解析"不依赖快照里实际取到哪些包，也不受 CI 桩（只有 skin00）限制。
// 可变对象：空清单那条靠现场清空它造（simAssetPacks 每次调用都重读）。
vi.mock('@/src/preview/video/sim/gen/simAssetPacks.gen', () => ({
  SIM_ASSET_PACKS: {
    field: [
      { id: 'skin00', field: 'bg_line_rhythm.png', playLine: 'game_play_line.png' },
      { id: 'skin_miku', field: 'bg_line_rhythm.png', playLine: 'game_play_line.png' },
    ],
    background: [
      { id: 'skin00', background: 'liveBG_normal.png' },
      { id: 'skin_miku', background: 'liveBG.png' },
    ],
  },
}));

import {
  SIM_ASSET_BASE,
  SIM_ASSET_SERVERS,
  emptySimAssets,
  loadSimAssets,
  sampleCenterColor,
  simAssetPackThumbUrl,
  simAssetUrls,
  simSpriteUrls,
} from '@/src/preview/video/sim/simAssets';
import { SIM_BAND_COLORS, SIM_BAND_MATERIAL, SIM_BAND_MATERIAL_SP } from '@/src/preview/video/sim/simGeometry';

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
  it('默认（不传包）= skin00：三张场地/背景图都在运行时素材树里（`assets/sim/<类别>/<server>/…`）', () => {
    const urls = simAssetUrls('jp');
    for (const url of [urls.field, urls.background, urls.playLine]) {
      expect(url.startsWith(`${SIM_ASSET_BASE}/`)).toBe(true);
    }
    expect(urls.field).toContain('/fieldskin/jp/skin00_rip/bg_line_rhythm.png');
    expect(urls.playLine).toContain('/fieldskin/jp/skin00_rip/game_play_line.png');
    expect(urls.background).toContain('/bgskin/jp/skin00_rip/liveBG_normal.png');
  });

  it('按包 ID 解析：两个选择器各自独立，文件名从清单取（不再拼文件名）', () => {
    const urls = simAssetUrls('jp', { field: 'skin_miku', background: 'skin_miku' });
    expect(urls.field).toContain('/fieldskin/jp/skin_miku_rip/bg_line_rhythm.png');
    expect(urls.playLine).toContain('/fieldskin/jp/skin_miku_rip/game_play_line.png');
    expect(urls.background).toContain('/bgskin/jp/skin_miku_rip/liveBG.png');
  });

  it('主背景图两种命名都按清单走：skin00 = liveBG_normal、skin_miku = liveBG', () => {
    expect(simAssetUrls('jp', { background: 'skin00' }).background).toContain('/bgskin/jp/skin00_rip/liveBG_normal.png');
    expect(simAssetUrls('jp', { background: 'skin_miku' }).background).toContain('/bgskin/jp/skin_miku_rip/liveBG.png');
  });

  it('非法 / 不在清单里的包 ID → 静默回落 skin00（两个选择器各自）', () => {
    expect(simAssetUrls('jp', { field: 'skin_nope', background: 'skin_nope' }).field)
      .toContain('/fieldskin/jp/skin00_rip/bg_line_rhythm.png');
    expect(simAssetUrls('jp', { field: 'skin_nope', background: 'skin_nope' }).background)
      .toContain('/bgskin/jp/skin00_rip/liveBG_normal.png');
    // 脏值（非字符串）同样回落，不抛错
    expect(simAssetUrls('jp', { field: 42 as unknown as string }).field)
      .toContain('/fieldskin/jp/skin00_rip/bg_line_rhythm.png');
  });

  it('包缩略图 URL：轨道取场地图、背景取主图（缩略从素材自身缩放，不额外抓图）', () => {
    expect(simAssetPackThumbUrl('field', 'skin_miku', 'jp'))
      .toBe(`${SIM_ASSET_BASE}/fieldskin/jp/skin_miku_rip/bg_line_rhythm.png`);
    expect(simAssetPackThumbUrl('background', 'skin00', 'jp'))
      .toBe(`${SIM_ASSET_BASE}/bgskin/jp/skin00_rip/liveBG_normal.png`);
    expect(simAssetPackThumbUrl('background', 'skin_miku', 'jp'))
      .toBe(`${SIM_ASSET_BASE}/bgskin/jp/skin_miku_rip/liveBG.png`);
  });

  it('Bestdori 自家精灵也走同一条运行时素材树（chart-preview 21）', () => {
    const urls = simSpriteUrls('jp');
    expect(urls.digits).toBe(`${SIM_ASSET_BASE}/sprites/jp/digits.png`);
    expect(urls.combo).toBe(`${SIM_ASSET_BASE}/sprites/jp/combo.png`);
    expect(urls.particles).toBe(`${SIM_ASSET_BASE}/sprites/jp/particles.png`);
  });
});

describe('loadSimAssets · Bestdori 自家精灵（chart-preview 21）', () => {
  it('三张齐了才给：缺一张 → 整组 null（回落自绘），不影响场地与 missing', async () => {
    const jp = simAssetUrls('jp');
    const sprites = simSpriteUrls('jp');
    const full = await loadSimAssets({
      servers: ['jp'],
      loadImage: fakeLoader((src) => src === jp.field || src.startsWith(`${SIM_ASSET_BASE}/sprites/jp/`)).load,
    });
    expect(full.missing).toBe(false);
    expect(full.sprites?.digits.src).toBe(sprites.digits);
    expect(full.sprites?.combo.src).toBe(sprites.combo);
    expect(full.sprites?.particles.src).toBe(sprites.particles);

    const partial = await loadSimAssets({
      servers: ['jp'],
      loadImage: fakeLoader((src) => src === jp.field || src === sprites.digits).load,
    });
    expect(partial.sprites).toBeNull(); // 缺 combo / particles ⇒ 整组不用
    expect(partial.missing).toBe(false); // 场地仍在：不是空态
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
    // node 环境没有 2d 上下文 ⇒ 剖面采样失败，走兜底材质（有 DOM 时才按皮肤图采样）
    expect(assets.bandMaterial).toEqual(SIM_BAND_MATERIAL);
    expect(assets.bandMaterialSp).toEqual(SIM_BAND_MATERIAL_SP);
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

describe('loadSimAssets · 包选择透传（chart-preview 41）', () => {
  it('packs 里的两个包 ID 各自决定自己那一层的 URL（背景 / 轨道独立）', async () => {
    const urls = simAssetUrls('jp', { field: 'skin_miku', background: 'skin_miku' });
    const assets = await loadSimAssets({
      servers: ['jp'],
      packs: { field: 'skin_miku', background: 'skin_miku' },
      loadImage: fakeLoader(() => true).load,
    });
    expect(assets.missing).toBe(false);
    expect(assets.field?.src).toBe(urls.field);
    expect(assets.playLine?.src).toBe(urls.playLine);
    expect(assets.background?.src).toBe(urls.background);
  });

  it('选中包整服读不到 → 兜底回落默认 skin00（不弹错、不进空态，ADR-0018 §1）', async () => {
    // jp 只摆了 skin00_rip：选中 skin_miku 的场地图 404 ⇒ 按默认包再探一次，拿到 skin00
    const fallback = simAssetUrls('jp');
    const assets = await loadSimAssets({
      servers: ['jp'],
      packs: { field: 'skin_miku', background: 'skin_miku' },
      loadImage: fakeLoader((src) => src.includes('skin00_rip')).load,
    });
    expect(assets.missing).toBe(false);
    expect(assets.field?.src).toBe(fallback.field);
    expect(assets.background?.src).toBe(fallback.background);
  });

  it('选中包与默认包都读不到 → 空态（缺素材这个事实，不抛错）', async () => {
    const assets = await loadSimAssets({
      servers: ['jp'],
      packs: { field: 'skin_miku' },
      loadImage: fakeLoader(() => false).load,
    });
    expect(assets).toEqual(emptySimAssets());
    expect(assets.missing).toBe(true);
  });

  it('包内缺件（背景 / 判定线）不算空态：只缺那一层不画', async () => {
    const urls = simAssetUrls('jp', { field: 'skin_miku', background: 'skin_miku' });
    const assets = await loadSimAssets({
      servers: ['jp'],
      packs: { field: 'skin_miku', background: 'skin_miku' },
      loadImage: fakeLoader((src) => src === urls.field).load,
    });
    expect(assets.missing).toBe(false);
    expect(assets.field).not.toBeNull();
    expect(assets.background).toBeNull();
    expect(assets.playLine).toBeNull();
  });
});

describe('sampleCenterColor', () => {
  it('没有 DOM / 没有图 → null（调用方走兜底色，不抛错）', () => {
    expect(sampleCenterColor(null)).toBeNull();
  });
});

describe('chart-preview 57 · loadImageElement 预解码', () => {
  it('onload 后若支持 img.decode() 则等待解码完成再 resolve，decode 失败也不阻断', async () => {
    const { loadImageElement } = await import('@/src/preview/video/sim/simAssets');
    let decoded = false;
    const prevImage = (globalThis as { Image?: unknown }).Image;
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private _src = '';
      decode() {
        return new Promise<void>((r) => {
          decoded = true;
          r();
        });
      }
      set src(v: string) {
        this._src = v;
        this.onload?.();
      }
      get src() {
        return this._src;
      }
    }
    (globalThis as { Image?: unknown }).Image = FakeImage;
    try {
      const img = await loadImageElement('/assets/sim/sprites/jp/particles.png');
      expect(decoded).toBe(true);
      expect(img.src).toBe('/assets/sim/sprites/jp/particles.png');
    } finally {
      if (prevImage === undefined) delete (globalThis as { Image?: unknown }).Image;
      else (globalThis as { Image?: unknown }).Image = prevImage;
    }
  });
});
