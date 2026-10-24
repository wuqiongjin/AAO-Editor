/**
 * 谱面域规则清单（issue 49）：谱面代码「值域外」点名的单一来源，两条通道共用——
 * 代码弹窗的警告（`validateChartCode` 的 warnings，只提示不拦）与发布硬拦
 * （`community/bestdori/publish.ts`，域外值不发任何网络）。规则本身是谱面域自己的
 * 事实（如 width 的合法组合长度：`src/chart/types.ts`「组合长度 (1-3)」、画布只产
 * 1..3、键音分档 1..3），**不引入任何发布渠道的概念**——编辑器只说「值域外」，
 * 不说「平台收不收」。
 *
 * 扩充判据（维护者口径，issue 49）：往清单里加一条，要有真机实测或在野社区语料
 * 证据，不靠猜。lane 是现成的反例——差点被写进清单，结果已发布社区谱 91 张带越界
 * lane（全是 hidden connection），拦了只会误伤（语料合计 143 张，另 52 张为官方谱；
 * docs/research/chart-compatibility-stress-test.md）。
 *
 * 本轮清单（一条）：
 *   - Directional `width` 必须是 1 / 2 / 3（issue 49 实测：width 5 被发布渠道拒收；
 *     4 也不行，不为 4 留口子；语料里真实 width 全为整数、社区谱无 >3）。
 *
 * 其余候选（direction 值域、Slide 结点数、BPM 值域）没有证据可判，不收——
 * 等有实测或在野证据，按同一份机制往里加一条。
 */
import { t } from '../../i18n';
import type { ChartCodeNote, ValidationError } from './ChartConverter';

type RawNote = Record<string, unknown>;

/** Directional width 的值域（issue 49 定案：4 也不行，不为 4 留口子） */
const WIDTH_MIN = 1;
const WIDTH_MAX = 3;

/**
 * 逐条过规则清单（纯函数，一次收集全部，带定位路径）。
 * 输入可能是 JSON.parse 来的脏对象，按原样读。结构错误（缺 type、width 非数字等）
 * 不归这里翻案——那是 `validateChartCode` errors 通道的辖区；这里只回答一个问题：
 * **这条谱面代码里有没有越出值域的值。**
 */
export function checkChartDomainRules(chartCode: readonly ChartCodeNote[]): ValidationError[] {
    const issues: ValidationError[] = [];
    if (!Array.isArray(chartCode)) return issues;
    for (let i = 0; i < chartCode.length; i++) {
        const raw: unknown = chartCode[i];
        if (raw === null || typeof raw !== 'object') continue;
        const note = raw as RawNote;
        if (note.type !== 'Directional') continue;
        const width = note.width;
        if (typeof width === 'number' && Number.isInteger(width) && width >= WIDTH_MIN && width <= WIDTH_MAX) continue;
        // 文案复用 errors 通道同字段的既有键（值域口径只有一份）；不设 expected——
        // reason 已写明范围，再挂一段「期望：1-3」是重复
        issues.push({
            noteIndex: i, field: 'width',
            reason: t('validate.widthRange'),
        });
    }
    return issues;
}
