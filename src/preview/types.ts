// 预览域的公共形状（ADR-0016 §3）。
//
// 本域此刻是**骨架**（chart-preview 02）：只定"预览作用于谁"与两种形态的名字，
// 能力按票推进——静态面板折行 / 长图导出进 03，仿真场进 05，离线导出进 07。
// 依赖方向单向：preview → rendering / chart / audio / playback；本域**不得** import pages/。

/** 预览的作用对象：**哪个工程的哪一张谱面**（作用域二级 `chartId` 的实际内容，ADR-0016 §4）。 */
export interface PreviewTarget {
  projectId: string;
  chartId: string;
}

/**
 * 预览的两种形态（页面侧栏两项；ADR-0016 §1）。
 * id 与 `static/`、`video/` 两个子目录同名：一个是"不动的全景"，一个是"要动的仿真场"。
 */
export type PreviewMode = 'static' | 'video';
