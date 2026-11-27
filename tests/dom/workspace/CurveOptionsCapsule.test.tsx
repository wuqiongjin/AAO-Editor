// @vitest-environment jsdom
// issue 179 & issue 235 & issue 242 锁测：画布左上角的曲线选项胶囊
// （177 Q15 / 235 图形化选型与 18 款模板 / 242 常驻展开与缓动图形化选型）
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import { UIProvider, useUI, type ArmedTool } from '@/src/app/providers/UIProvider';
import CurveOptionsCapsule from '@/src/pages/workspace/CurveOptionsCapsule';
import { curveConfigSummary } from '@/src/pages/workspace/curveLabels';
import { buildTemplateSvgPath } from '@/src/pages/workspace/curveSvg';
import { SHAPE_TEMPLATES, shapeTemplateById } from '@/src/chart/editing/ShapeTemplates';
import { DICTS, setActiveUiLanguage } from '@/src/i18n';
import { SETTINGS_KEY, seedZhSettings } from '@/tests/support/storage';

function Arm({ tool }: { tool: ArmedTool | null }) {
  const { setArmedTool } = useUI();
  return <button type="button" onClick={() => setArmedTool(tool)}>{`arm:${tool ?? 'pointer'}`}</button>;
}

function setup(patch: Record<string, unknown> = {}) {
  seedZhSettings(patch);
  return mount();
}

/** 不重新播种设置：用于「重新挂载 = 模拟重启」——落盘内容必须原样被读回 */
function mount() {
  return render(
    <ConfigProvider>
      <UIProvider>
        <Arm tool="curve" />
        <Arm tool="single" />
        <CurveOptionsCapsule />
      </UIProvider>
    </ConfigProvider>,
  );
}

const arm = (tool: string) => fireEvent.click(screen.getByRole('button', { name: `arm:${tool}` }));
const pill = () => screen.getByRole('button', { name: '曲线配置' });
const queryPill = () => screen.queryByRole('button', { name: '曲线配置' });
const form = () => screen.getByRole('group', { name: '曲线配置' });
const queryForm = () => screen.queryByRole('group', { name: '曲线配置' });
/** 缓动族 10 张卡：按网格的 aria-label 定位，不钉卡片的 class（中英文标签不同） */
const easingCards = (scope: HTMLElement, label = '缓动族') =>
  within(within(scope).getByRole('group', { name: label })).getAllByRole('button');
const paramModeBar = () => screen.getByRole('group', { name: '模板参数模式' });
const queryParamModeBar = () => screen.queryByRole('group', { name: '模板参数模式' });
const storedCurve = () => JSON.parse(localStorage.getItem(SETTINGS_KEY)!).curve as {
  family: string;
  type: string;
  precision: number;
  templateId: string | null;
  templateCategory?: string;
  lastTemplateId?: string;
  templateMirrored: boolean;
  templateScale: number;
  templateDensity: number;
};
const storedCapsuleOpen = () =>
  (JSON.parse(localStorage.getItem(SETTINGS_KEY)!) as { layout?: { curveCapsuleOpen?: boolean } })
    .layout?.curveCapsuleOpen;

/** 摘要只在折叠态完整拼接（展开态顶栏只留模板主名）：临时收起读一次再回到展开态 */
function fullSummary(): string {
  expect(pill()).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(pill());
  const text = pill().textContent ?? '';
  fireEvent.click(pill());
  return text;
}

describe('issue 179 · 曲线选项胶囊', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('只在曲线持工具态出现；切走工具即消失', () => {
    setup();
    expect(queryPill()).not.toBeInTheDocument();
    arm('curve');
    expect(pill()).toBeInTheDocument();
    arm('single');
    expect(queryPill()).not.toBeInTheDocument();
  });

  it('胶囊摘要：族 · 型 · 精度（去掉括号里的中文释义）', () => {
    setup();
    arm('curve');
    expect(pill()).toHaveTextContent('曲线');
    expect(pill()).toHaveTextContent('Sine · In · 1/16');
  });

  it('选了模板时摘要显示模板名·偏向·幅度，且药丸含 SVG 迷你预览', () => {
    setup({ curve: { family: 'sine', type: 'in', precision: 16, templateId: 'wave' } });
    arm('curve');
    expect(pill()).toHaveTextContent('双波浪 · 右偏 · 中');
    expect(pill().querySelector('svg')).not.toBeNull();
  });

  it('点开 = 缓动函数/形状模板两段切换；改缓动/精度/模板参数均写盘持久化', () => {
    setup();
    arm('curve');
    expect(queryForm()).not.toBeInTheDocument();
    fireEvent.click(pill());

    // 缓动页：无原生下拉框，缓动族改为 10 张实时 SVG 卡片，点选即生效并写盘
    expect(within(form()).queryAllByRole('combobox')).toHaveLength(0);
    expect(easingCards(form())).toHaveLength(10);
    fireEvent.click(within(form()).getByRole('button', { name: /^Bounce/ }));
    fireEvent.click(within(form()).getByRole('button', { name: '1/32' }));
    expect(storedCurve().family).toBe('bounce');
    expect(storedCurve().precision).toBe(32);

    // 切到形状模板页：展示 18 张 SVG 缩略图卡，可按分类筛选
    fireEvent.click(within(form()).getByRole('tab', { name: '形状模板' }));
    expect(form().querySelectorAll('.ccp__card')).toHaveLength(18);
    fireEvent.click(within(form()).getByRole('tab', { name: '面筋/锁链' }));
    expect(form().querySelectorAll('.ccp__card')).toHaveLength(6);

    // 选面筋·梳齿：第 3 排切换为「段密」（稀疏/标准/稠密），修改偏向/幅度/段密均写盘
    fireEvent.click(within(form()).getByRole('button', { name: '面筋·梳齿' }));
    expect(within(form()).queryByRole('button', { name: '1/64' })).not.toBeInTheDocument();
    fireEvent.click(within(form()).getByRole('button', { name: '↰ 左偏' }));
    fireEvent.click(within(form()).getByRole('button', { name: '大' }));
    fireEvent.click(within(form()).getByRole('button', { name: '稠密' }));
    expect(storedCurve().templateId).toBe('gluten-comb');
    expect(storedCurve().templateMirrored).toBe(true);
    expect(storedCurve().templateScale).toBe(1.5);
    expect(storedCurve().templateDensity).toBe(2);
    expect(pill()).toHaveTextContent('面筋·梳齿');
    expect(pill()).not.toHaveTextContent('左偏');

    // 切回平滑弧弯大弧：第 3 排还原为「精度」且可切换 1/64 写盘
    fireEvent.click(within(form()).getByRole('tab', { name: '全部' }));
    fireEvent.click(within(form()).getByRole('button', { name: '大弧' }));
    expect(within(form()).getByRole('button', { name: '1/64' })).toBeEnabled();
    fireEvent.click(within(form()).getByRole('button', { name: '1/64' }));
    expect(storedCurve().precision).toBe(64);
  });

  it('英文界面渲染全部 18 款模板与控件且无缺词回退', () => {
    seedZhSettings({ uiLanguage: 'en', curve: { family: 'sine', type: 'in', precision: 16, templateId: 'soft-elastic' } });
    render(
      <ConfigProvider>
        <UIProvider>
          <Arm tool="curve" />
          <CurveOptionsCapsule />
        </UIProvider>
      </ConfigProvider>,
    );
    arm('curve');
    const enPill = screen.getByRole('button', { name: 'Curve' });
    expect(enPill).toHaveTextContent('Soft elastic · Right · M');
    fireEvent.click(enPill);
    const enForm = screen.getByRole('group', { name: 'Curve' });
    expect(within(enForm).getByRole('tab', { name: 'Shapes' })).toHaveAttribute('aria-selected', 'true');
    const cards = Array.from(enForm.querySelectorAll('.ccp__card'));
    expect(cards).toHaveLength(18);
    for (const card of cards) {
      expect(card.textContent?.trim()).not.toMatch(/^(shape\.|No template)/);
      expect(card.getAttribute('title')).not.toMatch(/^shapeTip\./);
    }

    // 英文界面检查新增专属参数控件文案完整
    fireEvent.click(within(enForm).getByRole('button', { name: 'Stair step' }));
    expect(within(enForm).getByRole('button', { name: 'Sharp' })).toBeInTheDocument();
    fireEvent.click(within(enForm).getByRole('button', { name: 'Pulse' }));
    expect(within(enForm).getByRole('button', { name: 'Start' })).toBeInTheDocument();
    expect(within(enForm).getByRole('button', { name: 'Mid' })).toBeInTheDocument();
    expect(within(enForm).getByRole('button', { name: 'End' })).toBeInTheDocument();
    expect(within(enForm).queryByRole('button', { name: /0%/ })).not.toBeInTheDocument();
    fireEvent.click(within(enForm).getByRole('button', { name: 'Zigzag' }));
    expect(within(enForm).getByRole('button', { name: 'Left' })).toBeInTheDocument();
    expect(within(enForm).getByRole('button', { name: 'Center' })).toBeInTheDocument();
    expect(within(enForm).getByRole('button', { name: 'Right' })).toBeInTheDocument();
    expect(within(enForm).getByText('Baseline')).toBeInTheDocument();
  });

  it('issue 240 · 阶梯隐藏偏向/幅度并展示阶跃形态；尖刺支持位置按钮且摘要常显并独立记忆', () => {
    setup({ curve: { family: 'sine', type: 'in', precision: 16, templateId: 'step' } });
    arm('curve');
    // 阶梯常显阶跃形态；不支持的偏向与幅度跳过
    expect(pill()).toHaveTextContent('阶梯 · 标准 · 斜坡');
    expect(pill()).not.toHaveTextContent('右偏');

    fireEvent.click(pill());
    // 偏向与幅度行隐藏
    expect(within(form()).queryByRole('button', { name: '↰ 左偏' })).not.toBeInTheDocument();
    expect(within(form()).queryByRole('button', { name: '小' })).not.toBeInTheDocument();
    // 阶跃形态胶囊可切换直角并写盘、卡片 SVG 实时重绘；收起摘要随之更新
    const stepCardBefore = within(form()).getByRole('button', { name: '阶梯' }).querySelector('svg path')?.getAttribute('d');
    const sharpBtn = within(form()).getByRole('button', { name: '直角' });
    fireEvent.click(sharpBtn);
    expect(fullSummary()).toContain('阶梯 · 标准 · 直角');
    const stepCardAfter = within(form()).getByRole('button', { name: '阶梯' }).querySelector('svg path')?.getAttribute('d');
    expect(stepCardAfter).not.toBe(stepCardBefore);

    // 切换到尖刺：恢复偏向/幅度，并显示位置按钮；默认 50% 也占摘要，写「中段」
    fireEvent.click(within(form()).getByRole('button', { name: '尖刺' }));
    expect(within(form()).getByRole('button', { name: '↰ 左偏' })).toBeInTheDocument();
    const centerBtn = within(form()).getByRole('button', { name: '中段' });
    expect(centerBtn).toHaveAttribute('aria-pressed', 'true');
    const pulseDefault = fullSummary();
    expect(pulseDefault).toContain('尖刺 · 右偏 · 中 · 标准 · 中段');
    expect(pulseDefault).not.toContain('50%');

    // 点击「起拍」→ 胶囊与卡片 SVG 同步重绘
    const pulseSvgBefore = pill().querySelector('svg path')?.getAttribute('d');
    fireEvent.click(within(form()).getByRole('button', { name: '起拍' }));
    expect(within(form()).getByRole('button', { name: '起拍' })).toHaveAttribute('aria-pressed', 'true');
    expect(pill().querySelector('svg path')?.getAttribute('d')).not.toBe(pulseSvgBefore);
    const pulseStart = fullSummary();
    expect(pulseStart).toContain('尖刺 · 右偏 · 中 · 标准 · 起拍');
    expect(pulseStart).not.toContain('0%');

    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY)!).curve as {
      templateExtras?: Record<string, Record<string, number | string>>;
    };
    expect(stored.templateExtras).toEqual({
      step: { stepStyle: 'sharp' },
      pulse: { pulsePos: 0 },
    });

    // 点回「中段」→ 默认档位同样占摘要
    const centerAgain = within(form()).getByRole('button', { name: '中段' });
    fireEvent.click(centerAgain);
    expect(centerAgain).toHaveAttribute('aria-pressed', 'true');
    const pulseBack = fullSummary();
    expect(pulseBack).toContain('尖刺 · 右偏 · 中 · 标准 · 中段');
    expect(pulseBack).not.toContain('50%');

    // 切回阶梯：仍记住之前的「直角」
    fireEvent.click(within(form()).getByRole('button', { name: '阶梯' }));
    expect(within(form()).getByRole('button', { name: '直角' })).toHaveAttribute('aria-pressed', 'true');
    expect(fullSummary()).toContain('阶梯 · 标准 · 直角');
  });

  it('issue 240 · SVG 预览联动：阶梯走左下→右上斜弦且区分斜坡/直角；尖刺随位置重绘', () => {
    const step = shapeTemplateById('step')!;
    const sloped = buildTemplateSvgPath(step, 46, 48);
    const sharp = buildTemplateSvgPath(step, 46, 48, { extra: { stepStyle: 'sharp' } });
    // endpoint-interp 弦线左下 → 右上
    expect(sloped.startPt[0]).toBeLessThan(sloped.endPt[0]);
    expect(sloped.startPt[1]).toBeGreaterThan(sloped.endPt[1]);
    expect(sloped.bandPolygons).toHaveLength(1);
    expect(sharp.bandPolygons.length).toBeGreaterThan(1);

    const pulse = shapeTemplateById('pulse')!;
    const p50 = buildTemplateSvgPath(pulse, 46, 48);
    const p0 = buildTemplateSvgPath(pulse, 46, 48, { extra: { pulsePos: 0 } });
    expect(p0.strokePath).not.toBe(p50.strokePath);

    const zigzag = shapeTemplateById('zigzag')!;
    const z0 = buildTemplateSvgPath(zigzag, 46, 48);
    const zRight = buildTemplateSvgPath(zigzag, 46, 48, { extra: { baseline: 100 } });
    expect(zRight.strokePath).not.toBe(z0.strokePath);
    const xs = (g: { strokePath: string }) =>
      [...g.strokePath.matchAll(/[\d.]+/g)].map(Number).filter((_, i) => i % 2 === 0);
    expect(Math.min(...xs(zRight))).toBeGreaterThan(Math.min(...xs(z0)) - 1e-6);
    expect(Math.min(...xs(zRight))).toBeGreaterThan(22);
  });

  it('issue 242 · 展开态跨工具切换与跨会话：切走只隐藏整枚胶囊，切回 / 重启都恢复展开', () => {
    const view = setup();
    arm('curve');
    // 首次进入曲线工具默认折叠（出厂默认）
    expect(queryForm()).not.toBeInTheDocument();
    expect(pill()).toHaveAttribute('aria-expanded', 'false');
    expect(storedCapsuleOpen()).toBeUndefined();

    fireEvent.click(pill());
    expect(form()).toBeInTheDocument();
    expect(storedCapsuleOpen()).toBe(true);

    // 切走工具：整枚胶囊隐藏，但偏好不被覆写
    arm('single');
    expect(queryPill()).not.toBeInTheDocument();
    expect(storedCapsuleOpen()).toBe(true);

    // 切回：按持久化偏好直接展开
    arm('curve');
    expect(form()).toBeInTheDocument();
    expect(pill()).toHaveAttribute('aria-expanded', 'true');

    // 重新挂载 = 模拟重启：仍按落盘恢复
    view.unmount();
    mount();
    arm('curve');
    expect(form()).toBeInTheDocument();

    // 手动折叠写盘；切工具再切回保持折叠
    fireEvent.click(pill());
    expect(queryForm()).not.toBeInTheDocument();
    expect(storedCapsuleOpen()).toBe(false);
    arm('single');
    arm('curve');
    expect(queryForm()).not.toBeInTheDocument();
    expect(pill()).toHaveAttribute('aria-expanded', 'false');
  });

  it('issue 242 · 点外部不折叠；Esc 不折叠也不拦截（完整交还画布五档链）', () => {
    setup({ layout: { curveCapsuleOpen: true } });
    arm('curve');
    expect(form()).toBeInTheDocument();

    // 点击画布任意处（含 body）都不再自动收起
    fireEvent.mouseDown(document.body);
    expect(form()).toBeInTheDocument();
    expect(pill()).toHaveAttribute('aria-expanded', 'true');

    // Esc 必须原样冒泡到 window：既不能 preventDefault，也不能 stopPropagation
    const seen: KeyboardEvent[] = [];
    const onKey = (e: KeyboardEvent) => seen.push(e);
    window.addEventListener('keydown', onKey);
    const notPrevented = fireEvent.keyDown(pill(), { key: 'Escape' });
    window.removeEventListener('keydown', onKey);
    expect(notPrevented).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.cancelBubble).toBe(false);
    expect(form()).toBeInTheDocument();
  });

  it('issue 241 · curveConfigSummary：自由模式统一数值；档位模式命中词 / 非预设回落数值（默认值占位见 245）', () => {
    seedZhSettings({});
    expect(curveConfigSummary({
      family: 'sine', type: 'in', precision: 16,
      templateId: 'zigzag', templateParamMode: 'free', templateScale: 1, templateDensity: 2,
    })).toBe('震动条 · 右偏 · 1× · 2× · 0%');

    expect(curveConfigSummary({
      family: 'sine', type: 'in', precision: 16,
      templateId: 'pulse', templateParamMode: 'free', templateScale: 1.25, templateDensity: 3.5,
      templateExtras: { pulse: { pulsePos: 25 } },
    })).toBe('尖刺 · 右偏 · 1.25× · 3.5× · 25%');

    expect(curveConfigSummary({
      family: 'sine', type: 'in', precision: 16,
      templateId: 'zigzag', templateParamMode: 'preset', templateScale: 1, templateDensity: 2,
    })).toBe('震动条 · 右偏 · 中 · 稠密 · 居中');

    expect(curveConfigSummary({
      family: 'sine', type: 'in', precision: 16,
      templateId: 'zigzag', templateParamMode: 'preset', templateScale: 1, templateDensity: 3.5,
    })).toBe('震动条 · 右偏 · 中 · 3.5× · 居中');

    expect(curveConfigSummary({
      family: 'sine', type: 'in', precision: 16,
      templateId: 'zigzag', templateParamMode: 'preset', templateScale: 1, templateDensity: 3.5,
    }, { compact: true })).toBe('震动条');

    expect(curveConfigSummary({
      family: 'sine', type: 'in', precision: 16,
      templateId: 'zigzag', templateParamMode: 'preset',
      templateBaseline: -100,
    })).toBe('震动条 · 右偏 · 中 · 标准 · 贴左');
    expect(curveConfigSummary({
      family: 'sine', type: 'in', precision: 16,
      templateId: 'zigzag', templateParamMode: 'preset',
    })).toBe('震动条 · 右偏 · 中 · 标准 · 居中');
    expect(curveConfigSummary({
      family: 'sine', type: 'in', precision: 16,
      templateId: 'pulse', templateParamMode: 'preset',
      templateExtras: { pulse: { pulsePos: 0 } },
    })).toBe('尖刺 · 右偏 · 中 · 标准 · 起拍');
    expect(curveConfigSummary({
      family: 'sine', type: 'in', precision: 16,
      templateId: 'zigzag', templateParamMode: 'free', templateScale: 1, templateDensity: 1,
      templateBaseline: -200,
    })).toBe('震动条 · 右偏 · 1× · 1× · -200%');
  });

  it('issue 245 · 默认值也占摘要：档位词照写，尖刺默认写「中段」、基线默认写「居中」', () => {
    setActiveUiLanguage('zh-CN');
    const base = { family: 'sine', type: 'in', precision: 16 } as const;

    // 尖刺：位置默认 50% 命中「中段」
    expect(curveConfigSummary({ ...base, templateId: 'pulse', templateParamMode: 'preset' }))
      .toBe('尖刺 · 右偏 · 中 · 标准 · 中段');
    // 震动条：基线默认 0 命中「居中」
    expect(curveConfigSummary({ ...base, templateId: 'zigzag', templateParamMode: 'preset' }))
      .toBe('震动条 · 右偏 · 中 · 标准 · 居中');
    // 阶梯：不声明基线，摘要仍是主名 · 段密 · 阶跃形态
    expect(curveConfigSummary({ ...base, templateId: 'step', templateParamMode: 'preset' }))
      .toBe('阶梯 · 标准 · 斜坡');
    // 自由模式：非预设值照旧写数值 + 单位（不被档位词顶替）
    expect(curveConfigSummary({
      ...base, templateId: 'pulse', templateParamMode: 'free', templateScale: 1.25,
      templateExtras: { pulse: { pulsePos: 25 } },
    })).toBe('尖刺 · 右偏 · 1.25× · 1× · 25%');
    expect(curveConfigSummary({
      ...base, templateId: 'zigzag', templateParamMode: 'free', templateBaseline: -200,
    })).toBe('震动条 · 右偏 · 1× · 1× · -200%');
  });

  it('issue 245 · 尖刺「居中」改称「中段」避与基线撞词，中文摘要不出现两个「居中」', () => {
    const zh = DICTS['zh-CN'];
    const en = DICTS.en;
    expect(zh['curve.extra.pulsePos.center']).toBe('中段');
    expect(en['curve.extra.pulsePos.center']).toBe('Mid');
    expect(zh['curve.extra.baseline.center']).toBe('居中');
    expect(zh['curve.extra.pulsePosHint']).not.toContain('居中');

    // 键集合与空串：两份消息表逐键对齐（复数类别按各语言自己的 CLDR 出键，不参与 parity）
    const PLURAL_TAIL = /\.(zero|one|two|few|many)$/;
    const shared = (key: string) => key !== 'i18n.fallbackProbe' && !PLURAL_TAIL.test(key);
    const zhKeys = Object.keys(zh).filter(shared);
    const enKeys = Object.keys(en).filter(shared);
    expect(zhKeys.length).toBeGreaterThan(0);
    for (const key of zhKeys) {
      expect(en[key], `en 缺 ${key}`).toBeDefined();
      expect(zh[key].trim(), `zh-CN 空句 ${key}`).not.toBe('');
      expect(en[key].trim(), `en 空句 ${key}`).not.toBe('');
    }
    expect(enKeys).toHaveLength(zhKeys.length);

    // 逐模板默认摘要：将来若有模板同时声明基线与尖刺位置，撞词会在这里现形
    setActiveUiLanguage('zh-CN');
    const summaries = SHAPE_TEMPLATES.map((tp) => curveConfigSummary({
      family: 'sine', type: 'in', precision: 16, templateId: tp.id, templateParamMode: 'preset',
    }));
    for (const text of summaries) expect(text).not.toContain('居中 · 居中');
    expect(summaries.some((text) => text.endsWith('居中'))).toBe(true);
    expect(summaries.some((text) => text.endsWith('中段'))).toBe(true);
  });

  it('展开态顶栏只留模板主名；折叠恢复完整摘要', () => {
    setup({
      curve: {
        family: 'sine', type: 'in', precision: 16,
        templateId: 'gluten-saw', templateMirrored: true, templateScale: 1, templateDensity: 1,
      },
    });
    arm('curve');
    expect(pill()).toHaveTextContent('面筋·斜纹 · 左偏 · 中 · 标准 · 居中');
    fireEvent.click(pill());
    expect(pill()).toHaveTextContent('面筋·斜纹');
    expect(pill()).not.toHaveTextContent('左偏');
    expect(paramModeBar()).toBeInTheDocument();
    fireEvent.click(within(paramModeBar()).getByRole('button', { name: '档位' }));
    expect(form()).toBeInTheDocument();
    expect(pill()).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(pill());
    expect(queryForm()).not.toBeInTheDocument();
    expect(pill()).toHaveTextContent('面筋·斜纹 · 左偏 · 中 · 标准 · 居中');
    expect(queryParamModeBar()).not.toBeInTheDocument();
  });

  it('缓动页展开不显示顶栏参数模式；切到形状模板后出现，切回缓动则消失并恢复族·型·精度', () => {
    setup();
    arm('curve');
    fireEvent.click(pill());
    expect(queryParamModeBar()).not.toBeInTheDocument();
    expect(pill()).toHaveTextContent('Sine · In · 1/16');
    fireEvent.click(within(form()).getByRole('tab', { name: '形状模板' }));
    expect(paramModeBar()).toBeInTheDocument();
    expect(pill()).not.toHaveTextContent('Sine · In · 1/16');
    fireEvent.click(within(form()).getByRole('tab', { name: '缓动函数' }));
    expect(queryParamModeBar()).not.toBeInTheDocument();
    expect(pill()).toHaveTextContent('Sine · In · 1/16');
  });

  it('issue 241 · 顶栏档位/自由切换、连续滑块与数值框交互、Esc 撤销不关胶囊及双击单行复位', () => {
    setup({ curve: { family: 'sine', type: 'in', precision: 16, templateId: 'pulse' } });
    arm('curve');
    fireEvent.click(pill());

    const stored = () => JSON.parse(localStorage.getItem(SETTINGS_KEY)!).curve as {
      templateParamMode: 'preset' | 'free';
      templateMirrored: boolean;
      templateScale: number;
      templateDensity: number;
      templateExtras?: Record<string, Record<string, number | string>>;
    };

    // 1. 默认档位；顶栏双段同屏；切自由后幅度/段密/位置变滑块+数值框，偏向保持按钮
    expect(within(form()).queryByRole('button', { name: '重置' })).not.toBeInTheDocument();
    expect(within(paramModeBar()).getByRole('button', { name: '档位' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(paramModeBar()).getByRole('button', { name: '自由' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(within(paramModeBar()).getByRole('button', { name: '自由' }));
    expect(stored().templateParamMode).toBe('free');
    expect(within(paramModeBar()).getByRole('button', { name: '自由' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(form()).getByRole('button', { name: '↰ 左偏' })).toBeInTheDocument();
    expect(within(form()).getByRole('slider', { name: '幅度' })).toBeInTheDocument();
    expect(within(form()).getByRole('textbox', { name: '幅度' })).toBeInTheDocument();
    expect(within(form()).getByRole('slider', { name: '段密' })).toBeInTheDocument();
    expect(within(form()).getByRole('slider', { name: '位置' })).toBeInTheDocument();
    expect(pill()).toHaveTextContent('尖刺');
    expect(pill()).not.toHaveTextContent('50%');

    // 平滑模板（arc）切自由后，精度仍保持三档按钮
    fireEvent.click(within(form()).getByRole('button', { name: '大弧' }));
    expect(within(form()).getByRole('button', { name: '1/16' })).toBeInTheDocument();
    expect(within(form()).queryByRole('slider', { name: '精度' })).not.toBeInTheDocument();

    // 阶梯（step）切自由后，阶跃形态仍保持按钮
    fireEvent.click(within(form()).getByRole('button', { name: '阶梯' }));
    expect(within(form()).getByRole('button', { name: '斜坡' })).toBeInTheDocument();
    expect(within(form()).getByRole('button', { name: '直角' })).toBeInTheDocument();

    // 回到尖刺：测试拖动滑块、数值输入（含越界钳制）、Esc 取消草稿而不关闭胶囊
    fireEvent.click(within(form()).getByRole('button', { name: '尖刺' }));
    const svgBefore = pill().querySelector('svg path')?.getAttribute('d');

    fireEvent.change(within(form()).getByRole('slider', { name: '段密' }), { target: { value: '3.5' } });
    expect(stored().templateDensity).toBe(3.5);
    expect(pill()).toHaveTextContent('尖刺');
    expect(pill()).not.toHaveTextContent('3.5');
    expect(pill().querySelector('svg path')?.getAttribute('d')).not.toBe(svgBefore);

    const scaleInput = within(form()).getByRole('textbox', { name: '幅度' });
    fireEvent.focus(scaleInput);
    fireEvent.change(scaleInput, { target: { value: '2.35' } });
    fireEvent.keyDown(scaleInput, { key: 'Enter' });
    expect(stored().templateScale).toBe(2.35);

    // 越界输入失焦自动钳制（0.01 -> 0.1）
    fireEvent.focus(scaleInput);
    fireEvent.change(scaleInput, { target: { value: '0.01' } });
    fireEvent.blur(scaleInput);
    expect(stored().templateScale).toBe(0.1);

    // Esc 仅撤回草稿，绝不关闭整个胶囊
    const posInput = within(form()).getByRole('textbox', { name: '位置' });
    fireEvent.focus(posInput);
    fireEvent.change(posInput, { target: { value: '25' } });
    fireEvent.keyDown(posInput, { key: 'Escape' });
    expect(form()).toBeInTheDocument();
    expect(posInput).toHaveValue('50');
    expect(stored().templateExtras?.pulse?.pulsePos).toBeUndefined();

    // 真正提交位置 25%
    fireEvent.focus(posInput);
    fireEvent.change(posInput, { target: { value: '25' } });
    fireEvent.keyDown(posInput, { key: 'Enter' });
    expect(stored().templateExtras?.pulse?.pulsePos).toBe(25);

    // 2. 切回档位模式：3.5× 继续生效，按钮均未高亮且不加多余徽章；点标准立即覆盖
    fireEvent.click(within(paramModeBar()).getByRole('button', { name: '档位' }));
    expect(stored().templateParamMode).toBe('preset');
    expect(within(paramModeBar()).getByRole('button', { name: '档位' })).toHaveAttribute('aria-pressed', 'true');
    expect(stored().templateDensity).toBe(3.5);
    expect(within(form()).getByRole('button', { name: '稀疏' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(form()).getByRole('button', { name: '标准' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(form()).getByRole('button', { name: '稠密' })).toHaveAttribute('aria-pressed', 'false');
    expect(form().querySelector('.ccp__custom-badge')).toBeNull();
    expect(pill()).toHaveTextContent('尖刺');
    expect(pill()).not.toHaveTextContent('3.5');

    fireEvent.click(within(form()).getByRole('button', { name: '标准' }));
    expect(stored().templateDensity).toBe(1);
    expect(within(form()).getByRole('button', { name: '标准' })).toHaveAttribute('aria-pressed', 'true');
    expect(pill()).toHaveTextContent('尖刺');
    expect(pill()).not.toHaveTextContent('标准');

    // 3. 单行双击复位（滑块 & 行标签）仅复位当前这一项，不影响其它连续项或偏向
    fireEvent.click(within(paramModeBar()).getByRole('button', { name: '自由' }));
    fireEvent.click(within(form()).getByRole('button', { name: '↰ 左偏' }));
    expect(stored().templateScale).toBe(0.1);
    fireEvent.doubleClick(within(form()).getByRole('slider', { name: '幅度' }));
    expect(stored().templateScale).toBe(1);
    expect(stored().templateMirrored).toBe(true);
    expect(stored().templateExtras?.pulse?.pulsePos).toBe(25);

    fireEvent.change(within(form()).getByRole('slider', { name: '段密' }), { target: { value: '2.5' } });
    expect(stored().templateDensity).toBe(2.5);
    fireEvent.doubleClick(within(form()).getByText('段密'));
    expect(stored().templateDensity).toBe(1);
    expect(stored().templateExtras?.pulse?.pulsePos).toBe(25);

    fireEvent.doubleClick(within(form()).getByRole('slider', { name: '位置' }));
    expect(stored().templateExtras?.pulse).toBeUndefined();
    expect(stored().templateMirrored).toBe(true);
  });

  it('issue 244 · 基线跨模板共享：切模板后同一值仍显示并写盘；不声明基线的模板无该行', () => {
    setup({ curve: { family: 'sine', type: 'in', precision: 16, templateId: 'zigzag' } });
    arm('curve');
    fireEvent.click(pill());
    expect(within(form()).getByRole('button', { name: '贴左' })).toBeInTheDocument();
    expect(within(form()).getByRole('button', { name: '居中' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(form()).getByRole('button', { name: '贴右' })).toBeInTheDocument();
    fireEvent.click(within(form()).getByRole('button', { name: '贴左' }));
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).curve.templateBaseline).toBe(-100);
    // 基线不再按模板 ID 记在 extras 里
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).curve.templateExtras).toBeUndefined();

    // 切到另一款双侧摆动模板：值不归零
    fireEvent.click(within(form()).getByRole('button', { name: '余震条' }));
    expect(within(form()).getByRole('button', { name: '贴左' })).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).curve.templateBaseline).toBe(-100);

    // 不声明基线的模板：行消失，但值仍保留在配置里
    fireEvent.click(within(form()).getByRole('button', { name: '尖刺' }));
    expect(within(form()).queryByRole('button', { name: '贴左' })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).curve.templateBaseline).toBe(-100);

    // 切回声明基线的模板：仍读到同一值
    fireEvent.click(within(form()).getByRole('button', { name: '锁链·方波' }));
    expect(within(form()).getByRole('button', { name: '贴左' })).toHaveAttribute('aria-pressed', 'true');

    // 自由模式：基线滑块可到 ±200，写盘仍是同一个单值
    fireEvent.click(within(paramModeBar()).getByRole('button', { name: '自由' }));
    const baselineSlider = within(form()).getByRole('slider', { name: '基线' });
    expect(baselineSlider).toHaveAttribute('min', '-200');
    expect(baselineSlider).toHaveAttribute('max', '200');
    fireEvent.change(baselineSlider, { target: { value: '200' } });
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).curve.templateBaseline).toBe(200);

    // 尖刺档位仍是纯词、且没有基线行
    fireEvent.click(within(paramModeBar()).getByRole('button', { name: '档位' }));
    fireEvent.click(within(form()).getByRole('button', { name: '尖刺' }));
    expect(within(form()).getByRole('button', { name: '起拍' })).toBeInTheDocument();
    expect(within(form()).getByRole('button', { name: '中段' })).toBeInTheDocument();
    expect(within(form()).getByRole('button', { name: '尾拍' })).toBeInTheDocument();
    expect(within(form()).queryByRole('button', { name: /0%/ })).not.toBeInTheDocument();
    expect(within(form()).queryByRole('button', { name: '贴左' })).not.toBeInTheDocument();
  });

  it('issue 242 · 缓动页图形化：4 枚缓动型胶囊 + 10 张族卡 + 精度胶囊，切换缓动型联动重绘并写盘', () => {
    setup();
    arm('curve');
    fireEvent.click(pill());

    // 原生下拉框彻底退场
    expect(within(form()).queryAllByRole('combobox')).toHaveLength(0);
    for (const name of ['In', 'Out', 'In-Out', 'Out-In']) {
      expect(within(form()).getByRole('button', { name })).toBeInTheDocument();
    }

    const cards = () => easingCards(form());
    expect(cards()).toHaveLength(10);
    expect(cards().every((card) => card.querySelector('svg path'))).toBe(true);

    // 切换缓动型：10 张卡片的曲线全部实时重绘
    const before = cards().map((card) => card.querySelector('svg path')!.getAttribute('d'));
    fireEvent.click(within(form()).getByRole('button', { name: 'In-Out' }));
    expect(storedCurve().type).toBe('inOut');
    expect(within(form()).getByRole('button', { name: 'In-Out' })).toHaveAttribute('aria-pressed', 'true');
    const after = cards().map((card) => card.querySelector('svg path')!.getAttribute('d'));
    expect(after).not.toEqual(before);
    for (let i = 0; i < after.length; i++) expect(after[i]).not.toBe(before[i]);

    // 点选缓动族：立即写盘，折叠态摘要同步
    fireEvent.click(within(form()).getByRole('button', { name: /^Expo/ }));
    expect(storedCurve().family).toBe('expo');
    expect(within(form()).getByRole('button', { name: /^Expo/ })).toHaveAttribute('aria-pressed', 'true');
    expect(pill()).toHaveTextContent('Expo · In-Out · 1/16');
    expect(within(form()).getByText('精度')).toBeInTheDocument();
    fireEvent.click(within(form()).getByRole('button', { name: '1/64' }));
    expect(storedCurve().precision).toBe(64);
  });

  it('issue 242 · 中文界面族卡两行双语（英文主名 + 中文副名），工具提示给完整双语', () => {
    setup();
    arm('curve');
    fireEvent.click(pill());
    const sine = within(form()).getByRole('button', { name: /^Sine/ });
    expect(within(sine).getByText('Sine')).toBeInTheDocument();
    expect(within(sine).getByText('正弦')).toBeInTheDocument();
    expect(sine).toHaveAttribute('title', 'Sine（正弦）');
    expect(within(form()).getByRole('button', { name: 'In-Out' })).toHaveAttribute('title', 'In-Out（缓入缓出）');
  });

  it('issue 242 · 英文界面族卡单行英文名，无副名与缺词回退', () => {
    seedZhSettings({ uiLanguage: 'en' });
    mount();
    arm('curve');
    fireEvent.click(screen.getByRole('button', { name: 'Curve' }));
    const enForm = screen.getByRole('group', { name: 'Curve' });
    const cards = easingCards(enForm, 'Easing family');
    expect(cards).toHaveLength(10);
    expect(cards[0]!.textContent?.trim()).toBe('Sine');
    expect(cards[0]!.getAttribute('title')).toBe('Sine');
    for (const card of cards) {
      expect(card.textContent?.trim()).not.toMatch(/^easing\./);
      // 单行英文卡：任何 CJK 都算副名回退
      expect(card.textContent).not.toMatch(/[\u3400-\u9fff]/);
    }
  });

  it('issue 242 · 模板分类与上次选用模板跨折叠 / 切工具 / 重启忠实恢复', () => {
    const first = setup();
    arm('curve');
    fireEvent.click(pill());
    fireEvent.click(within(form()).getByRole('tab', { name: '形状模板' }));

    fireEvent.click(within(form()).getByRole('tab', { name: '面筋/锁链' }));
    expect(storedCurve().templateCategory).toBe('special');
    fireEvent.click(within(form()).getByRole('button', { name: '面筋·梳齿' }));
    expect(storedCurve().templateId).toBe('gluten-comb');
    expect(storedCurve().lastTemplateId).toBe('gluten-comb');

    // 折叠再展开
    fireEvent.click(pill());
    fireEvent.click(pill());
    expect(within(form()).getByRole('tab', { name: '面筋/锁链' })).toHaveAttribute('aria-selected', 'true');

    // 切走工具再切回
    arm('single');
    arm('curve');
    expect(within(form()).getByRole('tab', { name: '面筋/锁链' })).toHaveAttribute('aria-selected', 'true');

    // 重新挂载（模拟重启）
    first.unmount();
    const second = mount();
    arm('curve');
    expect(within(form()).getByRole('tab', { name: '面筋/锁链' })).toHaveAttribute('aria-selected', 'true');

    // 切到缓动页 → 重启 → 切回形状模板：恢复上次选用的面筋·梳齿，而非回退 S 形
    fireEvent.click(within(form()).getByRole('tab', { name: '缓动函数' }));
    expect(storedCurve().templateId).toBe(null);
    second.unmount();
    mount();
    arm('curve');
    fireEvent.click(within(form()).getByRole('tab', { name: '形状模板' }));
    expect(storedCurve().templateId).toBe('gluten-comb');
    expect(within(form()).getByRole('button', { name: '面筋·梳齿' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('issue 242 · 分类忠实恢复：生效大弧、上次只浏览面筋/锁链，重开仍停在该分类且不改写生效模板', () => {
    const first = setup();
    arm('curve');
    fireEvent.click(pill());
    fireEvent.click(within(form()).getByRole('tab', { name: '形状模板' }));
    fireEvent.click(within(form()).getByRole('button', { name: '大弧' }));
    expect(storedCurve().templateId).toBe('arc');

    // 点分类只是浏览，不选模板
    fireEvent.click(within(form()).getByRole('tab', { name: '面筋/锁链' }));
    first.unmount();
    mount();
    arm('curve');

    expect(within(form()).getByRole('tab', { name: '面筋/锁链' })).toHaveAttribute('aria-selected', 'true');
    expect(storedCurve().templateId).toBe('arc');
    expect(pill()).toHaveTextContent('大弧');
    expect(within(form()).queryByRole('button', { name: '大弧' })).not.toBeInTheDocument();
  });

  it('issue 242 · 顶栏档位/自由各说各的：档位=预设，自由=可超范围连续调', () => {
    setup({ curve: { family: 'sine', type: 'in', precision: 16, templateId: 'pulse' } });
    arm('curve');
    fireEvent.click(pill());

    const preset = within(paramModeBar()).getByRole('button', { name: '档位' });
    const free = within(paramModeBar()).getByRole('button', { name: '自由' });
    // 共用一个「点击切换…」的含糊提示等于没提示：两个模式调的是同一批参数，差别正在「怎么调」
    expect(preset).toHaveAttribute('title', '档位：按小 / 中 / 大预设调节');
    expect(free).toHaveAttribute('title', '自由：滑块连续调节，可超出预设档位范围');
  });
});
