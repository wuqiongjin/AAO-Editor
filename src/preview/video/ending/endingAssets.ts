// 结尾段的**游戏 UI 素材**（票 52；清单见 `docs/research/gbp-ui-assets.md`）。
//
// 全部是游戏原图 / 从真截图抠的派生件，**不入 git、不进安装包**（ADR-0016 §6）：
// 生产要么走 `release-pipeline/01` 注入，要么按票 52 Q12 —— **缺件留空或纯字，不画假徽章**。
// 因此本模块**从不抛错**：读不到就是 null，绘制侧据此降级（纯字 / 不画）。
//
// 目录与仿真场素材同一套规则：`public/` 挂站点根，Electron 打包态是 `file://` +
// `base: './'` ⇒ 必须拼 `import.meta.env.BASE_URL`，不能写死绝对路径。
/** 结尾段素材根（`<站点根>/assets/game-ui`） */
export const ENDING_ASSET_BASE = `${import.meta.env.BASE_URL}assets/game-ui`;

/** 已就绪的结尾段素材；**缺件 = null**（每件各自降级，不整组作废） */
export interface EndingAssets {
  /** `result/all-perfect.png`：中央章字样 + 结算 AP 标（同一张图两处用） */
  stamp: HTMLImageElement | null;
  /** `judgeskin/skin00/judge.png`：结算白卡的判定五档标签 */
  judge: HTMLImageElement | null;
  /** `stageskin/normal/tex_parSet_fever.png`：章粒子（按亮度染色后的星形） */
  particles: HTMLImageElement | null;
  /** `derived/star-64.png`：结算顶栏最左星徽（从真截图抠的派生件） */
  badgeStar: HTMLImageElement | null;
}

/** 素材一个都没有（缺件常态：素材不在安装包里） */
export const EMPTY_ENDING_ASSETS: EndingAssets = {
  stamp: null,
  judge: null,
  particles: null,
  badgeStar: null,
};

/** 四件素材的 URL（路径形状只在这里拼一次） */
export function endingAssetUrls(): Record<keyof EndingAssets, string> {
  return {
    stamp: `${ENDING_ASSET_BASE}/result/all-perfect.png`,
    judge: `${ENDING_ASSET_BASE}/judgeskin/skin00/judge.png`,
    particles: `${ENDING_ASSET_BASE}/stageskin/normal/tex_parSet_fever.png`,
    badgeStar: `${ENDING_ASSET_BASE}/derived/star-64.png`,
  };
}

export interface EndingAssetLoadOptions {
  /** 图片加载（测试注入替身；缺省 `new Image()`） */
  loadImage?: (src: string) => Promise<HTMLImageElement>;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`图片加载失败: ${src}`));
    img.src = src;
  });
}

/**
 * 读四件素材。**并发、逐件兜底**：某一件读不到只等于"那一处不画 / 走纯字"，
 * 不影响其它三件，也不阻断导出（票 52 Q12）。
 */
export async function loadEndingAssets(opts: EndingAssetLoadOptions = {}): Promise<EndingAssets> {
  const { loadImage = loadImageElement } = opts;
  const urls = endingAssetUrls();
  const [stamp, judge, particles, badgeStar] = await Promise.all([
    loadImage(urls.stamp).catch(() => null),
    loadImage(urls.judge).catch(() => null),
    loadImage(urls.particles).catch(() => null),
    loadImage(urls.badgeStar).catch(() => null),
  ]);
  return { stamp, judge, particles, badgeStar };
}
