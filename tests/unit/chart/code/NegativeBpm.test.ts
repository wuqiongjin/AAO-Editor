// issue 103 · 负 BPM（倒流区）的校验边界与真谱带符号时间轴回归。
// 权威 = ADR-0010：放行 `bpm < 0`；仍拒 `0`（含 `-0`）与非有限数；另加两条加严规则
// （首条 BPM 负值 / 末条 BPM 负值；issue 63 起首条 = 时间原点，不再看 beat 0）。
// 真谱回归用 ADR-0010 **附录 A** 的 BPM 事件紧凑编码
// （49 条）重建时间轴 —— 谱面文件本身不入库，断言只依赖该编码。
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { validateChartCode, type ChartCodeNote } from '@/src/chart/editing/ChartConverter';
import { beatToSeconds, getBpmEvents, type BpmEvent } from '@/src/audio/AudioTiming';
import { repoRoot } from '@/tests/support/source';

/** ADR-0010 附录 A：社区谱 150030 的 BPM 事件序列（`beat:bpm` 紧凑编码，49 条、23 条为负） */
const ADR_0010_APPENDIX_A =
    '0:225,48:-225,78:225,108:-225,138:225,168:-225,198:225,228:-225,258:225,433:-225,439:225,' +
    '458:-225,461:225,564.5:225,569.5:-225,574.5:225,582:225,692:-225,724:225,756:-225,788:225,' +
    '820:-225,852:225,927:-225,929:225,931:-225,933:225,1104:-225,1106:225,1108:-225,1110:225,' +
    '1112:-225,1114:225,1120:-225,1122:225,1124:-225,1126:225,1128:-225,1130:225,1136:-225,' +
    '1138:225,1140:-225,1142:225,1144:-225,1146:225,1152:-225,1154:225,1156:-225,1158:225';

/** `beat:bpm` 紧凑编码 → BPM 谱面代码（可直接喂校验 / 转换） */
function parseCompact(encoded: string): ChartCodeNote[] {
    return encoded.split(',').map(seg => {
        const [beat, bpm] = seg.split(':');
        return { beat: Number(beat), type: 'BPM' as const, bpm: Number(bpm) };
    });
}

/** 与真实链路同源的事件表：谱面代码 → 内部音符 → `getBpmEvents`（按 beat 升序） */
function eventsOf(code: ChartCodeNote[]): BpmEvent[] {
    const notes = code
        .filter((c): c is Extract<ChartCodeNote, { type: 'BPM' }> => c.type === 'BPM')
        .map(c => ({ beat: c.beat, type: 'BPM' as const, bpm: c.bpm }));
    return getBpmEvents(notes);
}

const bpm = (beat: number, value: number): ChartCodeNote => ({ beat, type: 'BPM', bpm: value });

// 就地编辑走 DOM 输入框（渲染时序单测覆盖不到）→ 静态源码断言钉住拒/收口径（照
// `EditorAudioSessionRefactor.test.ts` 惯例）；交互表现另见手工验收清单。
describe('issue 103 · 就地编辑入口 commitBpmEdit（静态源码断言）', () => {
    const canvasSrc = readFileSync(
        join(repoRoot, 'src/chart/components/canvas/FinalVirtualCanvas.tsx'),
        'utf-8',
    );

    // issue 143 扩订 ADR-0010 结论 8：接受**负值与小数**（不再 `parseInt` 截断）。
    // 解析口径已抽到 `parseBpmInput`（单测见 BpmInput.test.ts）；此处只钉「组件不再有旧拒法」。
    test('接受负值与小数：解析委托 parseBpmInput，旧拒法 `v <= 0` / `Number.isNaN(v)` 已不在组件内', () => {
        expect(canvasSrc).toMatch(/parseBpmInput\(bpmEdit\.value\)/);
        expect(canvasSrc).not.toMatch(/Number\.isNaN\(v\)\s*\|\|\s*v\s*<=\s*0/);
        expect(canvasSrc).not.toMatch(/parseInt\(bpmEdit\.value/);
    });
});

describe('issue 103 · BPM 校验边界（ADR-0010 结论 7）', () => {
    test('放行负值：正 → 负 → 正的三事件谱合法', () => {
        expect(validateChartCode([bpm(0, 120), bpm(5, -120), bpm(6.5, 120)]).valid).toBe(true);
    });

    test('`0` / `-0` 拒（无意义：预览无限加载、游戏内 0 之后空白），文案点明"不得为 0"', () => {
        const zero = validateChartCode([bpm(0, 120), bpm(4, 0)]);
        expect(zero.valid).toBe(false);
        expect(zero.errors).toEqual([expect.objectContaining({ noteIndex: 1, field: 'bpm' })]);
        expect(zero.errors[0].reason).toContain('不得为 0');

        const negZero = validateChartCode([bpm(0, 120), bpm(4, -0)]);
        expect(negZero.valid).toBe(false);
        expect(negZero.errors[0].reason).toContain('不得为 0');
    });

    test('非有限数（NaN / ±Infinity）与"根本不是数字"拒，文案归"必须是有限数字"一类', () => {
        for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, undefined, '120']) {
            const result = validateChartCode([bpm(0, 120), { beat: 4, type: 'BPM', bpm: bad } as unknown as ChartCodeNote]);
            expect(result.valid).toBe(false);
            expect(result.errors).toEqual([expect.objectContaining({ noteIndex: 1, field: 'bpm' })]);
            expect(result.errors[0].reason).toContain('必须是有限数字');
        }
    });

    test('首条 BPM（时间原点）为负 → 拒（全谱秒坐标会倒置）', () => {
        const result = validateChartCode([bpm(0, -120), bpm(5, 120)]);
        expect(result.valid).toBe(false);
        expect(result.errors).toEqual([expect.objectContaining({ noteIndex: 0, field: 'bpm' })]);
        expect(result.errors[0].reason).toContain('首条 BPM');

        // issue 63：首条 BPM 不在 beat 0 也一样——它就是时间原点
        const negativeBeat = validateChartCode([bpm(-4, -120), bpm(5, 120)]);
        expect(negativeBeat.valid).toBe(false);
        expect(negativeBeat.errors).toEqual([expect.objectContaining({ noteIndex: 0, field: 'bpm' })]);
        // 首条为正、只是位置不在 beat 0 → 放行（时间原点随之前移）
        expect(validateChartCode([bpm(-4, 120), bpm(5, 150)]).valid).toBe(true);
    });

    test('beat 0 处的负值但**不是首条** → 放行（倒流区的普通一条）', () => {
        expect(validateChartCode([bpm(-8, 120), bpm(0, -120), bpm(5, 120)]).valid).toBe(true);
    });

    test('「首条」同 beat 取数组序最后一条（稳定排序口径）', () => {
        // 同 beat 两条：后者 -120 才是生效值 → 拒
        const bad = validateChartCode([bpm(0, 120), bpm(0, -120), bpm(5, 120)]);
        expect(bad.valid).toBe(false);
        expect(bad.errors).toEqual([expect.objectContaining({ noteIndex: 1, field: 'bpm' })]);
        // 后者为正 → 生效值为正 → 放行
        expect(validateChartCode([bpm(0, -120), bpm(0, 120), bpm(5, 120)]).valid).toBe(true);
    });

    test('两条规则不重复报同一条：全谱唯一一条 BPM 且为负 → 只报一次', () => {
        const result = validateChartCode([bpm(0, -120)]);
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].reason).toContain('首条 BPM');
    });

    test('末条 BPM 事件为负 → 拒（谱面以负 BPM 收尾会让制谱器崩溃）', () => {
        // 中间负、末尾正 → 合法
        expect(validateChartCode([bpm(0, 120), bpm(4, -120), bpm(6, 120)]).valid).toBe(true);
        // 连续负值收尾 → 拒（定位到真正的末条）
        const tail = validateChartCode([bpm(0, 120), bpm(4, -120), bpm(6, -240)]);
        expect(tail.valid).toBe(false);
        expect(tail.errors).toEqual([expect.objectContaining({ noteIndex: 2, field: 'bpm' })]);
        expect(tail.errors[0].reason).toContain('末条 BPM');
    });

    test('"末条"按 beat 判定（不按数组序）：倒序写法的末条同样被认出', () => {
        // 数组序最后一条（beat 8、-120）不是末条；beat 40 的 -240 才是
        const result = validateChartCode([bpm(0, 120), bpm(40, -240), bpm(8, -120)]);
        expect(result.valid).toBe(false);
        expect(result.errors).toEqual([expect.objectContaining({ noteIndex: 1, field: 'bpm' })]);
    });

    test('片段视图（对象视图）跳过"末条为正"：中途某条 BPM 改负不会被误判成末条', () => {
        const mid = [bpm(4, -225)];
        expect(validateChartCode(mid, { fragment: true }).valid).toBe(true);
        // 整份口径下，同一条代码就是"末条为负" → 拒（两个口径的差别即本用例的意义）
        expect(validateChartCode(mid).valid).toBe(false);
    });

    test('片段视图（对象视图）跳过"首条为正"（issue 63 P3：编辑面不拦，负值换色即警示）', () => {
        const head = [bpm(0, -120)];
        expect(validateChartCode(head, { fragment: true }).valid).toBe(true);
        // 整份口径（导入 / 完整代码 Apply）同样一条 → 拒
        expect(validateChartCode(head).valid).toBe(false);
    });

    test('无 BPM 事件的代码不触发边界规则（边界只针对存在 BPM 的谱面）', () => {
        expect(validateChartCode([{ beat: 1, lane: 0, type: 'Single' }]).valid).toBe(true);
        expect(validateChartCode([]).valid).toBe(true);
    });
});

describe('issue 103 · 真谱回归：带符号累加（ADR-0010 附录 A/B）', () => {
    test('附录 A：49 条事件、23 条为负，首 0:225 / 末 1158:225（满足"末条为正"）', () => {
        const code = parseCompact(ADR_0010_APPENDIX_A);
        expect(code).toHaveLength(49);
        expect(code.filter(c => c.type === 'BPM' && c.bpm < 0)).toHaveLength(23);
        expect(code[0]).toEqual({ beat: 0, type: 'BPM', bpm: 225 });
        expect(code[code.length - 1]).toEqual({ beat: 1158, type: 'BPM', bpm: 225 });
        // 这份社区谱现在必须能打开（放行负 BPM 的全部意义）
        expect(validateChartCode(code).valid).toBe(true);
    });

    test('附录 A：末音符 beat 1160 → 带符号累加 172.80s；按 |bpm| 累加 309.33s（反向哨兵）', () => {
        const events = eventsOf(parseCompact(ADR_0010_APPENDIX_A));
        const signed = beatToSeconds(events, 1160);
        expect(signed).toBeCloseTo(172.8, 2);
        // 反向哨兵：取绝对值会让这首 173.376s 的歌跑到 309s 之外——时间轴必然带符号
        const absEvents = events.map(e => ({ ...e, bpm: Math.abs(e.bpm) }));
        expect(beatToSeconds(absEvents, 1160)).toBeCloseTo(309.33, 2);
    });

    test('附录 B 最小三事件谱：t(0)=0 → t(5)=2.5 → t(6.5)=1.75（倒扣 0.75s）→ t(8)=2.5', () => {
        const events: BpmEvent[] = [{ beat: 0, bpm: 120 }, { beat: 5, bpm: -120 }, { beat: 6.5, bpm: 120 }];
        expect(beatToSeconds(events, 0)).toBeCloseTo(0, 9);
        expect(beatToSeconds(events, 5)).toBeCloseTo(2.5, 9);
        expect(beatToSeconds(events, 6.5)).toBeCloseTo(1.75, 9);
        expect(beatToSeconds(events, 8)).toBeCloseTo(2.5, 9);
    });
});
