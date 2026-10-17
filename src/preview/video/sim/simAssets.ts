// 仿真场素材：**运行时素材**（与音符皮肤同树，release-pipeline 02 起）。
//
//   `public/assets/sim/<类别>/<server>/…` 由外部快照仓库产出、`npm run assets:sync` 取件；
//   dev 与 build 都从 public/ 直读、随 dist 出包，二进制不进 git（`.gitignore` 忽略）。
//   读不到（缺件 / 前缀解析不到，这两者在这一层无法区分）→ 页面给空态
//   （`preview.video.assetsMissing`），本模块不抛错。
//
// 类别目录（脚本默认 jp）：逐服探测第一个能读到**场地图**的目录；全都读不到 = 空态。
import {
  clamp01,
  SIM_BAND_COLORS,
  SIM_BAND_MATERIAL,
  SIM_BAND_MATERIAL_SP,
  type SimBandMaterial,
} from './simGeometry';

/**
 * 仿真场素材根（Vite 把 `public/` 挂在站点根，dev 的前缀就是 `/`）。
 *
 * 必须拼 `import.meta.env.BASE_URL` 而不能写死 `/assets/sim`：Electron 生产包是
 * `loadFile(dist/index.html)`，页面跑在 `file://` 下 —— file 协议没有站点根，
 * 绝对路径会被解析到磁盘根（`file:///assets/sim/…`），图上不去、页面只能误报"缺素材"。
 * 打包态 `base: './'` → `./assets/sim`，相对当前文档解析，才落到 asar 里的 dist/assets/sim。
 */
export const SIM_ASSET_BASE = `${import.meta.env.BASE_URL}assets/sim`;
/** 服务器目录偏好顺序（拉取脚本默认 jp 排头；别的服归档过也能直读） */
export const SIM_ASSET_SERVERS = ['jp', 'en', 'tw', 'cn', 'kr'] as const;
/** 类别目录名（`public/assets/sim/<类别>/<server>/…`） */
const SIM_FIELD_CATEGORY = 'fieldskin';
const SIM_BG_CATEGORY = 'bgskin';
const SIM_SPRITE_CATEGORY = 'sprites';
/** 官方默认档包名 */
const SIM_SKIN_PACK = 'skin00_rip';

/** 某个服务器目录下要读的三张图 */
export interface SimAssetUrls {
  /** 背景（bgskin `liveBG_normal.png`） */
  background: string;
  /** 场地图（fieldskin `bg_line_rhythm.png`） */
  field: string;
  /** 场地判定线（fieldskin `game_play_line.png`） */
  playLine: string;
}

export function simAssetUrls(server: string): SimAssetUrls {
  const fieldPack = `${SIM_ASSET_BASE}/${SIM_FIELD_CATEGORY}/${server}/${SIM_SKIN_PACK}`;
  const bgPack = `${SIM_ASSET_BASE}/${SIM_BG_CATEGORY}/${server}/${SIM_SKIN_PACK}`;
  return {
    background: `${bgPack}/liveBG_normal.png`,
    field: `${fieldPack}/bg_line_rhythm.png`,
    playLine: `${fieldPack}/game_play_line.png`,
  };
}

/** Bestdori 自家精灵（chart-preview 21）：combo 数字 / COMBO 标签 / 打击特效图块 */
export interface SimSpriteUrls {
  digits: string;
  combo: string;
  particles: string;
}

export function simSpriteUrls(server: string): SimSpriteUrls {
  const root = `${SIM_ASSET_BASE}/${SIM_SPRITE_CATEGORY}/${server}`;
  return {
    digits: `${root}/digits.png`,
    combo: `${root}/combo.png`,
    particles: `${root}/particles.png`,
  };
}

/**
 * 已就绪的 Bestdori 自家精灵（chart-preview 21）。
 * **三张齐了才给**：缺一张就整组回落自绘（HUD 文本 + 程序化特效），不做半套。
 */
export interface SimSprites {
  /** `digits.png`（720×96 = 10 个 72×96，左起 10 列） */
  digits: HTMLImageElement;
  /** `combo.png`（150×41 的 "COMBO" 标签图） */
  combo: HTMLImageElement;
  /** `particles.png`（1024×1024 = 4×4 图块，每块 256×256） */
  particles: HTMLImageElement;
}

/** 已就绪的场地素材（缺素材 = `missing`，三图全 null） */
export interface SimAssets {
  background: HTMLImageElement | null;
  field: HTMLImageElement | null;
  playLine: HTMLImageElement | null;
  /** 带体体色 / 亮缘色（皮肤带体图中心取样；取不到 = 兜底绿） */
  bandColor: string;
  bandColorSp: string;
  /** 带体材质（皮肤带体图横截面采样：体 α / 亮缘 α；取不到 = 兜底常量） */
  bandMaterial: SimBandMaterial;
  bandMaterialSp: SimBandMaterial;
  /** Bestdori 自家精灵（combo / 特效）：缺 = null → 回落自绘（chart-preview 21，**不置 missing**） */
  sprites: SimSprites | null;
  /** 缺素材：跑过归档脚本才能有（空态由页面画，这里只报事实） */
  missing: boolean;
  /** 命中的服务器目录（缺素材 = null） */
  server: string | null;
}

export interface SimAssetLoadOptions {
  /** 皮肤普通带体图 src（`ActiveNoteIcons.slideBand.src`） */
  bandSrc?: string | null;
  /** 皮肤 SP 带体图 src（`ActiveNoteIcons.slideBandSp.src`） */
  bandSpSrc?: string | null;
  /** 服务器偏好顺序（默认 `SIM_ASSET_SERVERS`） */
  servers?: readonly string[];
  /** 图片加载（测试注入替身；缺省 `new Image()`） */
  loadImage?: (src: string) => Promise<HTMLImageElement>;
  /** 取色（测试注入替身；缺省读 1×1 离屏画布） */
  sampleColor?: (img: HTMLImageElement) => string | null;
}

/** 缺素材时的站点素材占位（页面据此画空态，不画半个场地） */
export function emptySimAssets(): SimAssets {
  return {
    background: null,
    field: null,
    playLine: null,
    bandColor: SIM_BAND_COLORS.band,
    bandColorSp: SIM_BAND_COLORS.sp,
    bandMaterial: { ...SIM_BAND_MATERIAL },
    bandMaterialSp: { ...SIM_BAND_MATERIAL_SP },
    sprites: null,
    missing: true,
    server: null,
  };
}

/** 默认图片加载（与 `CanvasSpriteIcon` 各自持缓存：场地图只在这儿用，不进精灵图集） */
function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`图片加载失败: ${src}`));
    img.src = src;
  });
}

/** 读图片中心 1 像素（无 DOM / 无 2d 上下文 / 跨域污染 → null，调用方走兜底色） */
export function sampleCenterColor(img: HTMLImageElement | null): string | null {
  if (!img || typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const sw = Math.max(1, img.naturalWidth || img.width);
    const sh = Math.max(1, img.naturalHeight || img.height);
    ctx.drawImage(img, Math.floor(sw / 2), Math.floor(sh / 2), 1, 1, 0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  } catch {
    return null; // 画布被污染 / 上下文不可用：兜底色顶上
  }
}

/**
 * 读带体图的横截面剖面：中心区域列平均 α = 体部，最亮列 = 亮缘峰值
 * （与画布 `render.bandStripStyle` 同一口径 —— ADR-0009 五轮：剖面走贴图运行时采样、
 * 不手工近似；换肤时体 / 亮缘的透明度自动跟随皮肤，兜底常量只服务缺图环境）。
 * `rimFrac` 不从粗剖面推（峰值位置混着外侧 AA 衰减，推出来会偏宽）：沿用兜底常量。
 * 无 DOM / 无 2d 上下文 / 跨域污染 → null（调用方走兜底材质）。
 */
export function sampleBandMaterial(img: HTMLImageElement | null): SimBandMaterial | null {
  if (!img || typeof document === 'undefined') return null;
  try {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, w, h).data;
    const colAvg = (x: number) => {
      const xx = Math.max(0, Math.min(w - 1, x));
      let s = 0;
      for (let y = 0; y < h; y++) s += d[(y * w + xx) * 4 + 3];
      return s / h / 255;
    };
    const mid = w >> 1;
    const lo = Math.floor(mid - w * 0.3);
    const hi = Math.ceil(mid + w * 0.3);
    let bodySum = 0;
    let bodyN = 0;
    for (let x = lo; x <= hi; x++) {
      bodySum += colAvg(x);
      bodyN++;
    }
    const bodyAlpha = bodyN > 0 ? bodySum / bodyN : colAvg(mid);
    let rimAlpha = 0;
    for (let x = 1; x < w - 1; x++) rimAlpha = Math.max(rimAlpha, colAvg(x));
    return {
      bodyAlpha: clamp01(bodyAlpha),
      rimAlpha: clamp01(rimAlpha),
      rimFrac: SIM_BAND_MATERIAL.rimFrac,
    };
  } catch {
    return null;
  }
}

/**
 * 读场地素材：逐服探测（按**场地图**判成败，它是场地层的必需件），
 * 三图 + 带体取色 / 剖面一次到位；全服都读不到 → `emptySimAssets()`。
 * 不抛错：素材缺席是**明说的产品态**（04 的空态），不是异常。
 */
export async function loadSimAssets(opts: SimAssetLoadOptions = {}): Promise<SimAssets> {
  const {
    bandSrc = null,
    bandSpSrc = null,
    servers = SIM_ASSET_SERVERS,
    loadImage = loadImageElement,
    sampleColor = sampleCenterColor,
  } = opts;

  for (const server of servers) {
    const urls = simAssetUrls(server);
    let field: HTMLImageElement;
    try {
      field = await loadImage(urls.field);
    } catch {
      continue; // 这个服务器目录没归档：换下一个
    }
    const spriteUrls = simSpriteUrls(server);
    const [background, playLine, bandImg, bandSpImg, digits, combo, particles] = await Promise.all([
      loadImage(urls.background).catch(() => null),
      loadImage(urls.playLine).catch(() => null),
      bandSrc ? loadImage(bandSrc).catch(() => null) : Promise.resolve(null),
      bandSpSrc ? loadImage(bandSpSrc).catch(() => null) : Promise.resolve(null),
      // Bestdori 自家精灵（chart-preview 21）：缺席只是"回落自绘"，不影响场地
      loadImage(spriteUrls.digits).catch(() => null),
      loadImage(spriteUrls.combo).catch(() => null),
      loadImage(spriteUrls.particles).catch(() => null),
    ]);
    return {
      background,
      field,
      playLine,
      bandColor: (bandImg ? sampleColor(bandImg) : null) ?? SIM_BAND_COLORS.band,
      bandColorSp: (bandSpImg ? sampleColor(bandSpImg) : null) ?? SIM_BAND_COLORS.sp,
      bandMaterial: sampleBandMaterial(bandImg) ?? { ...SIM_BAND_MATERIAL },
      bandMaterialSp: sampleBandMaterial(bandSpImg) ?? { ...SIM_BAND_MATERIAL_SP },
      sprites: digits && combo && particles ? { digits, combo, particles } : null,
      missing: false,
      server,
    };
  }
  return emptySimAssets();
}
