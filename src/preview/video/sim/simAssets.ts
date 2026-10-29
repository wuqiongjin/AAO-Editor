// 仿真场素材：**运行时素材**（与音符皮肤同树，release-pipeline 02 起）。
//
//   `public/assets/sim/<类别>/<server>/…` 由外部快照仓库产出、`npm run assets:sync` 取件；
//   dev 与 build 都从 public/ 直读、随 dist 出包，二进制不进 git（`.gitignore` 忽略）。
//   读不到（缺件 / 前缀解析不到，这两者在这一层无法区分）→ 页面给空态
//   （`preview.video.assetsMissing`），本模块不抛错。
//
// 类别目录（脚本默认 jp）：逐服探测第一个能读到**场地图**的目录；全都读不到 = 空态。
//
// 包选择（chart-preview 41 · ADR-0018）：包与文件名**不硬编码**——按包 ID 查取件侧产出的
// 包清单（`./simAssetPacks` → `./gen/simAssetPacks.gen`）取文件名；非法 / 不在清单里的 ID
// 静默回落默认 `skin00`（"列表即真相"，见 simAssetPacks.ts）。
import {
  clamp01,
  SIM_BAND_COLORS,
  SIM_BAND_MATERIAL,
  SIM_BAND_MATERIAL_SP,
  type SimBandMaterial,
} from './simGeometry';
import {
  findSimBackgroundPack,
  findSimFieldPack,
  normalizeSimAssetPackId,
  SIM_DEFAULT_PACK_IDS,
  SIM_EMPTY_REGISTRY_FILES,
  type SimAssetPackKind,
} from './simAssetPacks';
import { warmupSimSprites } from './simSprites';
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

/**
 * 两个独立选择器传进来的包 ID（chart-preview 41；`settings.preview.bgPackId` / `fieldPackId`）。
 * 缺省 / 非法值在 `simAssetUrls` 里归一化（回落默认 `skin00`），调用方不用先洗值。
 */
export interface SimAssetPackSelection {
  /** 场地皮肤包 ID（fieldskin） */
  field?: string;
  /** 表演背景包 ID（bgskin） */
  background?: string;
}

/** 某个服务器目录下要读的三张图 */
export interface SimAssetUrls {
  /** 背景（bgskin 主图；文件名按包 ID 查清单，`liveBG_normal.png` / `liveBG.png` 两种命名并存） */
  background: string;
  /** 场地图（fieldskin `bg_line_rhythm.png`） */
  field: string;
  /** 场地判定线（fieldskin `game_play_line.png`） */
  playLine: string;
}

/**
 * 拼一个包里的某个文件 URL（`<base>/<类别>/<server>/<packId>_rip/<file>`）：
 * `simAssetUrls` 与 `simAssetPackThumbUrl` 共用这一份路径形状，别处不再拼。
 */
function simPackUrl(kind: SimAssetPackKind, server: string, packId: string, file: string): string {
  const category = kind === 'field' ? SIM_FIELD_CATEGORY : SIM_BG_CATEGORY;
  return `${SIM_ASSET_BASE}/${category}/${server}/${packId}_rip/${file}`;
}

/**
 * 三张图的 URL：包 ID → 清单 → 文件名（ADR-0018 §2，应用侧不拼文件名）。
 * `packs` 缺省 = 两个选择器都取默认 `skin00`。
 */
export function simAssetUrls(server: string, packs: SimAssetPackSelection = {}): SimAssetUrls {
  const fieldId = normalizeSimAssetPackId('field', packs.field);
  const bgId = normalizeSimAssetPackId('background', packs.background);
  const fieldPack = findSimFieldPack(fieldId);
  const bgPack = findSimBackgroundPack(bgId);
  return {
    background: simPackUrl('background', server, bgId, bgPack?.background ?? SIM_EMPTY_REGISTRY_FILES.background),
    field: simPackUrl('field', server, fieldId, fieldPack?.field ?? SIM_EMPTY_REGISTRY_FILES.field),
    playLine: simPackUrl('field', server, fieldId, fieldPack?.playLine ?? SIM_EMPTY_REGISTRY_FILES.playLine),
  };
}

/**
 * 包缩略图 URL（预览页「设置」面板的缩略图网格用，chart-preview 41 定案 #3）：
 * 轨道 = 该包场地图、背景 = 该包主图 —— 缩略从素材自身缩放生成，不额外抓图。
 * 包 ID 先过归一化（不在清单里 → skin00）；**这类素材一个包都没取到（空清单）→ null**，
 * 面板据此不渲染缩略（只留包 ID 格）。
 */
export function simAssetPackThumbUrl(
  kind: SimAssetPackKind,
  packId: string,
  server: string,
): string | null {
  const id = normalizeSimAssetPackId(kind, packId);
  if (kind === 'field') {
    const entry = findSimFieldPack(id);
    return entry ? simPackUrl(kind, server, id, entry.field) : null;
  }
  const entry = findSimBackgroundPack(id);
  return entry ? simPackUrl(kind, server, id, entry.background) : null;
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
  /**
   * 包选择（chart-preview 41：背景 / 轨道两个独立选择器；来自 `settings.preview`）。
   * 缺省 / 非法 ID 回落默认 `skin00`。
   */
  packs?: SimAssetPackSelection;
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

/**
 * 默认图片加载（与 `CanvasSpriteIcon` 各自持缓存：场地图只在这儿用，不进精灵图集）。
 * 导出给预览面板的 hover 大预览复用 —— 那边只多一层"同 URL 不重复 new Image"的缓存，
 * 不另写第三份 `new Image()`。
 */
export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (typeof img.decode === 'function') {
        img.decode().catch(() => undefined).then(() => resolve(img));
      } else {
        resolve(img);
      }
    };
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
 *
 * 包选择（41）：`packs` 两个选择器各自独立；**包内缺件不算空态**（背景 / 判定线缺 = 那一层
 * 不画）——只有**场地图**读不到才换下一个服务器目录。选中包整服都读不到（注册表列了它、
 * 二进制却没摆 / 被裁掉）⇒ 按默认 `skin00` 再探一次（ADR-0018 §1「运行时加载失败兜底回落
 * skin00」）；默认包也读不到才空态。
 */
export async function loadSimAssets(opts: SimAssetLoadOptions = {}): Promise<SimAssets> {
  const {
    bandSrc = null,
    bandSpSrc = null,
    servers = SIM_ASSET_SERVERS,
    packs,
    loadImage = loadImageElement,
    sampleColor = sampleCenterColor,
  } = opts;

  const probe = (selection: Required<SimAssetPackSelection>) => probeSimServers({
    servers, selection, bandSrc, bandSpSrc, loadImage, sampleColor,
  });
  const selected: Required<SimAssetPackSelection> = {
    field: normalizeSimAssetPackId('field', packs?.field),
    background: normalizeSimAssetPackId('background', packs?.background),
  };

  const hit = await probe(selected);
  if (hit) return hit;
  // 选中包与默认包不同且整服读不到 ⇒ 兜底再探一次默认 skin00（不弹错、不做"缺失"占位）
  if (selected.field !== SIM_DEFAULT_PACK_IDS.field || selected.background !== SIM_DEFAULT_PACK_IDS.background) {
    const fallback = await probe({
      field: SIM_DEFAULT_PACK_IDS.field,
      background: SIM_DEFAULT_PACK_IDS.background,
    });
    if (fallback) return fallback;
  }
  return emptySimAssets();
}

/** 逐服探测一轮（`selection` 已是归一化后的包 ID）；命中 = 该服务器目录归档过 */
async function probeSimServers(opts: {
  servers: readonly string[];
  selection: Required<SimAssetPackSelection>;
  bandSrc: string | null;
  bandSpSrc: string | null;
  loadImage: (src: string) => Promise<HTMLImageElement>;
  sampleColor: (img: HTMLImageElement) => string | null;
}): Promise<SimAssets | null> {
  const { servers, selection, bandSrc, bandSpSrc, loadImage, sampleColor } = opts;
  for (const server of servers) {
    const urls = simAssetUrls(server, selection);
    let field: HTMLImageElement;
    try {
      field = await loadImage(urls.field);
    } catch {
      continue; // 这个服务器目录没归档（或没摆选中的场地图）：换下一个
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
    const sprites = digits && combo && particles ? { digits, combo, particles } : null;
    warmupSimSprites(sprites, [background, field, playLine]);
    return {
      background,
      field,
      playLine,
      bandColor: (bandImg ? sampleColor(bandImg) : null) ?? SIM_BAND_COLORS.band,
      bandColorSp: (bandSpImg ? sampleColor(bandSpImg) : null) ?? SIM_BAND_COLORS.sp,
      bandMaterial: sampleBandMaterial(bandImg) ?? { ...SIM_BAND_MATERIAL },
      bandMaterialSp: sampleBandMaterial(bandSpImg) ?? { ...SIM_BAND_MATERIAL_SP },
      sprites,
      missing: false,
      server,
    };
  }
  return null;
}
