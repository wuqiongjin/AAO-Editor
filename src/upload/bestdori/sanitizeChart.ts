import type { ChartCodeNote } from '@/src/chart/editing/ChartConverter';

/** Bestdori 社区 POST `chart` 白名单（官网 `sanitizeAll`，见 docs/research/bestdori-chart-editor-io.md） */
const UPLOAD_CHART_TYPES = new Set(['Single', 'Directional', 'Slide', 'Long', 'BPM']);

type Sanitizeable = Record<string, unknown> & {
    connections?: Sanitizeable[];
};

function stripCharge(obj: Sanitizeable): Sanitizeable {
    const out = { ...obj };
    delete out.charge;
    if (Array.isArray(out.connections)) {
        out.connections = out.connections.map((c) => stripCharge(c as Sanitizeable));
    }
    return out;
}

/**
 * 将工程内谱面代码转为 Bestdori 社区可 POST 的数组（丢 System、剥 charge）。
 * 上传管道静默调用；不用于 Apply / 工程保存（ADR-0014 §4）。
 */
export function sanitizeChartForBestdoriUpload(chart: readonly ChartCodeNote[]): ChartCodeNote[] {
    if (!Array.isArray(chart)) return [];
    return chart
        .filter((o) => o && UPLOAD_CHART_TYPES.has((o as { type?: string }).type ?? ''))
        .map((o) => stripCharge(structuredClone(o) as Sanitizeable) as ChartCodeNote);
}
