// 仿真场素材：**只从 04 的开发期直读通道取**（ADR-0016 §6；票面「素材仅从 04 的开发期直读通道取」）。
//
//   通道 = Vite dev 中间件挂的 `/__bestdori-assets/`（`vite.config.ts` 的 `bestdori-preview-assets`，
//   `apply: 'serve'`）；生产构建没有这条通道 → 素材缺席 → 页面给空态（04 的空态文案已写好：
//   `preview.video.assetsMissing` / `preview.video.assetsCommand`）。
//
// 硬约束（04 的锁测看着）：`public/assets/` 不放、`dist/` 不含、仓库不提交这些二进制 ——
// 本模块只**引用**那三个 URL，不拷贝、不打包、不写回。
//
// 归档产物按服务器分目录（`docs/resource/bestdori/<server>/…`，脚本默认 jp）：
// 逐服探测第一个能读到**场地图**的目录；全都读不到 = 空态。
import { SIM_BAND_COLORS } from './simGeometry';

/** 开发期直读通道前缀（vite.config.ts 的中间件） */
export const SIM_ASSET_BASE = '/__bestdori-assets';
/** 服务器目录偏好顺序（归档脚本默认 jp 排头；别的服归档过也能直读） */
export const SIM_ASSET_SERVERS = ['jp', 'en', 'tw', 'cn', 'kr'] as const;
/** 场地包（fieldskin）/ 背景包（bgskin）：skin00 是官方默认档 */
const SIM_FIELD_PACK = 'fieldskin/skin00_rip';
const SIM_BG_PACK = 'bgskin/skin00_rip';
/** Bestdori 自家精灵目录（归档脚本 `--category bestdori-sprites` 的产物） */
const SIM_SPRITE_PACK = 'sprites';

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
  const root = `${SIM_ASSET_BASE}/${server}`;
  return {
    background: `${root}/${SIM_BG_PACK}/liveBG_normal.png`,
    field: `${root}/${SIM_FIELD_PACK}/bg_line_rhythm.png`,
    playLine: `${root}/${SIM_FIELD_PACK}/game_play_line.png`,
  };
}

/** Bestdori 自家精灵（chart-preview 21）：combo 数字 / COMBO 标签 / 打击特效图块 */
export interface SimSpriteUrls {
  digits: string;
  combo: string;
  particles: string;
}

export function simSpriteUrls(server: string): SimSpriteUrls {
  const root = `${SIM_ASSET_BASE}/${server}/${SIM_SPRITE_PACK}`;
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
  /** 带体填充色（皮肤带体图中心取样；取不到 = 兜底绿） */
  bandColor: string;
  bandColorSp: string;
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
 * 读场地素材：逐服探测（按**场地图**判成败，它是场地层的必需件），
 * 三图 + 带体取色一次到位；全服都读不到 → `emptySimAssets()`。
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
      sprites: digits && combo && particles ? { digits, combo, particles } : null,
      missing: false,
      server,
    };
  }
  return emptySimAssets();
}
