// 结尾段的**游戏 UI 素材**（票 52；清单见 `docs/research/gbp-ui-assets.md`）。
//
// 全部是游戏原图 / 从真截图抠的派生件，**不入 git、不进安装包**（ADR-0016 §6）：
// 生产要么走 `release-pipeline/01` 注入，要么按票 52 Q12 —— **缺件留空或纯字，不画假徽章**。
// 因此本模块**从不抛错**：读不到就是 null，绘制侧据此降级（纯字 / 不画）。
//
// **AP / FC 是两套材质**（2026-10-27 用户指认）：
//   - `stamp*` = 中央章用的**大号**（章宽 62.2%W，最大最清的那张）；
//   - `mark*`  = 结算白卡右下角用的**小号**（高 5%H，另有一张小的）。
// 两处**不共用同一张图** —— 大图缩到小标会糊，小图放到章上会糊。
//
// 目录与仿真场素材同一套规则：`public/` 挂站点根，Electron 打包态是 `file://` +
// `base: './'` ⇒ 必须拼 `import.meta.env.BASE_URL`，不能写死绝对路径。
/** 结尾段素材根（`<站点根>/assets/game-ui`） */
export const ENDING_ASSET_BASE = `${import.meta.env.BASE_URL}assets/game-ui`;

/** 已就绪的结尾段素材；**缺件 = null**（每件各自降级，不整组作废） */
export interface EndingAssets {
  /** 中央章 AP（大）：`result/stamp-ap.png` 1028×187（用户自抠，与 `结尾中央徽章.mov` 同一套） */
  stampAp: HTMLImageElement | null;
  /** 中央章 FC（大）：`result/stamp-fc.png` —— **暂缺**（等用户截图抠图），缺件走纯字 */
  stampFc: HTMLImageElement | null;
  /** 结算 AP 标（小）：`result/mark-ap.png` —— **暂缺**，缺件走纯字 */
  markAp: HTMLImageElement | null;
  /** 结算 FC 标（小）：`result/mark-fc.png` 221×40（韩服 `MenuAtlas.png` `527,737`） */
  markFc: HTMLImageElement | null;
  /** `judgeskin/skin00/judge.png`：结算白卡的判定五档标签 */
  judge: HTMLImageElement | null;
  /** `stageskin/normal/tex_parSet_fever.png`：章粒子（按亮度染色后的星形） */
  particles: HTMLImageElement | null;
  /** `result/max-combo.png`：MAX / COMBO 两行白字（韩服 `MenuAtlas.png` 真件，`940,718` 112×59） */
  maxCombo: HTMLImageElement | null;
  /**
   * `atlas/MenuAtlas.png`：结算顶栏**星徽图集** —— 三态各一格（虹彩 / 粉 / 金），
   * 切图坐标在 `endingFrame.BADGE_SPRITES`（2026-10-27 用户指认，同一张韩服图集）。
   */
  menu: HTMLImageElement | null;
  /**
   * `stageskin/normal/RhythmGameUI.png`：结算 Score 行左侧的**圆星章**
   * （`HUD_SPRITES.medal = [7,421,29,30]`，票 73）。缺件留空，不画假章。
   */
  rhythmGameUI: HTMLImageElement | null;
}

/** 素材一个都没有（缺件常态：素材不在安装包里） */
export const EMPTY_ENDING_ASSETS: EndingAssets = {
  stampAp: null,
  stampFc: null,
  markAp: null,
  markFc: null,
  judge: null,
  particles: null,
  maxCombo: null,
  menu: null,
  rhythmGameUI: null,
};

/** 八件素材的 URL（路径形状只在这里拼一次） */
export function endingAssetUrls(): Record<keyof EndingAssets, string> {
  return {
    stampAp: `${ENDING_ASSET_BASE}/result/stamp-ap.png`,
    stampFc: `${ENDING_ASSET_BASE}/result/stamp-fc.png`,
    markAp: `${ENDING_ASSET_BASE}/result/mark-ap.png`,
    markFc: `${ENDING_ASSET_BASE}/result/mark-fc.png`,
    judge: `${ENDING_ASSET_BASE}/judgeskin/skin00/judge.png`,
    particles: `${ENDING_ASSET_BASE}/stageskin/normal/tex_parSet_fever.png`,
    maxCombo: `${ENDING_ASSET_BASE}/result/max-combo.png`,
    menu: `${ENDING_ASSET_BASE}/atlas/MenuAtlas.png`,
    rhythmGameUI: `${ENDING_ASSET_BASE}/stageskin/normal/RhythmGameUI.png`,
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
 * 读八件素材。**并发、逐件兜底**：某一件读不到只等于"那一处不画 / 走纯字"，
 * 不影响其它件，也不阻断导出（票 52 Q12）。
 */
export async function loadEndingAssets(opts: EndingAssetLoadOptions = {}): Promise<EndingAssets> {
  const { loadImage = loadImageElement } = opts;
  const urls = endingAssetUrls();
  const [stampAp, stampFc, markAp, markFc, judge, particles, maxCombo, menu, rhythmGameUI] = await Promise.all([
    loadImage(urls.stampAp).catch(() => null),
    loadImage(urls.stampFc).catch(() => null),
    loadImage(urls.markAp).catch(() => null),
    loadImage(urls.markFc).catch(() => null),
    loadImage(urls.judge).catch(() => null),
    loadImage(urls.particles).catch(() => null),
    loadImage(urls.maxCombo).catch(() => null),
    loadImage(urls.menu).catch(() => null),
    loadImage(urls.rhythmGameUI).catch(() => null),
  ]);
  return { stampAp, stampFc, markAp, markFc, judge, particles, maxCombo, menu, rhythmGameUI };
}
