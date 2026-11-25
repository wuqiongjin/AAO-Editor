// **应用自带**的仿真场素材包（chart-preview 84 · ADR-0018 §7）。
//
// 与取件侧清单（`./gen/simAssetPacks.gen`）刻意分开：
//   1. 快照只搬上游游戏素材 —— 这是 AAO 自己的原创图，不该混进去；
//   2. `npm run assets:sync` 对 `public/assets/sim` 是**整根替换**（`rmSync` 后覆盖），
//      放进去的文件夹下次取件就没了；`gen/*.gen.ts` 也是每次同步重新生成的构建产物。
// 所以自带包写在这里，由 `simAssetPacks.listSimBackgroundPacks()` **前置合并**进背景清单：
// 网格第一格、`findSimBackgroundPack` 命中、`normalizeSimAssetPackId` 认得它 —— 三处一处改动全通。
//
// 素材本身放 `public/assets/preview/`（**不在** `assets-sync` 的替换根里，随 vite `public/`
// 原样拷进发行物），URL 仍拼 `import.meta.env.BASE_URL`（Electron `file://` 必需，同 `SIM_ASSET_BASE`）。

/** 背景网格第一格、出厂默认的那个包（ADR-0018 §7） */
export const AAO_STAGE_PACK_ID = 'aao-stage';

/**
 * 一个应用自带的素材包（现在只有背景一类；将来若加轨道自带包，照这个形状扩）。
 * 显示名不在这里写：与官方背景包同一条 `preview.display.bgName.<包 ID>` 通道，
 * 由 `simPackDisplayName` → `pickBackgroundSkinName` 按 ID 拼键去消息表取。
 */
export interface AppBackgroundPack {
  /** 包 ID（与取件侧包 ID 共处一个命名空间：上游是 `skin*` / 主题包，不会撞） */
  id: string;
  /** 相对 `public/` 的路径（拼 `BASE_URL` 后即 URL） */
  file: string;
}

/**
 * 自带背景包清单。**故意不叫 registry**：它不是取件侧产出的"有哪些包"的镜子，
 * 而是应用自己带来的一格（ADR-0018 §7）。
 */
export const APP_BACKGROUND_PACKS: readonly AppBackgroundPack[] = [
  {
    id: AAO_STAGE_PACK_ID,
    file: 'assets/preview/aao-stage-frame-bg.webp',
  },
];

/** 按包 ID 查自带包；非字符串 / 查不到 → undefined */
export function findAppBackgroundPack(id: unknown): AppBackgroundPack | undefined {
  if (typeof id !== 'string' || id === '') return undefined;
  return APP_BACKGROUND_PACKS.find((pack) => pack.id === id);
}

/** 这个包 ID 是不是应用自带的（URL 形状、相框封面都按它分叉） */
export function isAppBackgroundPack(id: unknown): boolean {
  return findAppBackgroundPack(id) !== undefined;
}

/** 自带背景包的图 URL：`BASE_URL + 相对 public/ 的路径`（Electron `file://` 下也成立） */
export function appBackgroundUrl(pack: AppBackgroundPack): string {
  return `${import.meta.env.BASE_URL}${pack.file}`;
}

/**
 * 「相框层」—— 只有应用自带背景包才有的一层（ADR-0018 §7）。
 *
 * 一个字段载两件事，因为它们在语义上不可分：**有值 = 背景是自带包**（取景走自然比例、
 * 图正中那块玻璃屏存在），`cover` 则是屏里要填的工程封面（null = 工程没封面 → 留空）。
 * 收成一个可选对象，省得 `backgroundCover` + `backgroundAppOwned` 两个字段在
 * `SimAssets` / `SimFrameAssets` / `OpeningFieldImages` / 绘制参数四处靠手抄对齐。
 */
export interface SimStageFrame {
  cover: CanvasImageSource | null;
}
