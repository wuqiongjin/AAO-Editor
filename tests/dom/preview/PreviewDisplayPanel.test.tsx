// @vitest-environment jsdom
// chart-preview 08：预览页「设置」面板的行为锁（2026-09-30 用户定案；二轮收敛文案与默认值）。
//
// 三组口径各锁一条：
//   1. 标记（BPM / 时间 / 节拍线 / Combo / 镜向）落 `settings.preview` —— 跨会话记住，且**不动**画布显示；
//   2. 画布显示组直接写 `settings.display` —— 与设置页「画布显示」是同一份设置（改了双方生效），
//      所以这里断言的是"落盘里的那一份"而不是面板内的副本；
//   3. 浮层交互照站内菜单壳：Esc 关并把焦点还给触发钮、点遮罩关。
//
// 按结构取节点一处：`.pp-menu__scrim`（"点面板外"只有遮罩能表达，照 ScopePicker.test.tsx）。
//
// 控件文案**复用设置页那套**（节奏图示大小 / 同时点击线 / 色觉辅助 / 图像品质 / 轨道颜色…）：
// 面板是同一份设置的第二个入口，两处名字必须一样（面板不另起一套词汇）。
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { AppNavProvider, type AppNavValue } from '@/src/layouts/AppNav';
import { ConfigProvider } from '@/src/app/providers/ConfigProvider';
import PreviewDisplayPanel from '@/src/pages/preview/PreviewDisplayPanel';
import { normalizeNoteSkinSelection, noteSkinPresetLabel } from '@/src/rendering/skin/noteSkin';
import { listSimBackgroundPacks, listSimFieldPacks, simPackDisplayName } from '@/src/preview/video/sim/simAssetPacks';
import { setActiveUiLanguage } from '@/src/i18n';
import { DEFAULT_PREVIEW_SETTINGS, defaultSettings } from '@/src/chart/config/AppSettings';
import { SETTINGS_KEY, seedZhSettings } from '@/tests/support/storage';

// issue 49：显示名走取件侧 skinName 契约字段（五服原样 [jp,en,tw,cn,kr]）。本机真快照
// 尚未带该字段（回落路径由单测覆盖），这里注入两份**带 skinName** 的最小注册表，锁
// 「面板显示选服后的官方名」。背景包官方名是日文 → 当前语言名走 i18n 消息表；
// tooltip 只留显示名（行标签已说明类别，包 ID 对用户无意义）。
vi.mock('@/src/rendering/skin/gen/noteSkinRegistry.gen', () => ({
  NOTE_SKIN_PACKS: [
    {
      kind: 'note', id: 'skin00', label: 'CI 桩皮肤', skinName: ['音符皮肤00', 'TYPE1', '音符条皮膚00', '按键条皮肤00', '音符皮膚00'],
      atlas: 'skins/skin00/atlas.png', atlasW: 1024, atlasH: 1024,
      tap: [], tapVirtual: [], flick: [], skill: [], long: [],
      flickTop: null, slideAmong: null, ink: {},
      band: 'skins/skin00/longNoteLine.png', bandW: 100, bandH: 20,
      bandSp: null, bandSpW: 0, bandSpH: 0,
      simultaneous: null, simultaneousW: 0, simultaneousH: 0,
      pairedDir: 'directionalflickskin00',
    },
    {
      kind: 'directional', id: 'directionalflickskin00', label: 'CI 桩方向皮肤', skinName: ['音符皮肤00', 'TYPE1', '音符条皮膚00', '按键条皮肤00', '音符皮膚00'],
      atlas: 'skins/directionalflickskin00/atlas.png', atlasW: 1024, atlasH: 1024,
      dirL: [], dirR: [], flickTopL: null, flickTopR: null, ink: {},
    },
  ],
  NOTE_SKIN_DEFAULT_SELECTION: {
    tap: 'skin00', flick: 'skin00', skill: 'skin00', slide: 'skin00',
    dirL: 'directionalflickskin00', dirR: 'directionalflickskin00',
  },
}));

vi.mock('@/src/preview/video/sim/gen/simAssetPacks.gen', () => ({
  SIM_ASSET_PACKS: {
    field: [
      { id: 'skin_maid', field: 'bg_line_rhythm.png', playLine: 'game_play_line.png', skinName: ['Maid', 'Maid', 'Maid', 'Maid', 'Maid'] },
      { id: 'skin00', field: 'bg_line_rhythm.png', playLine: 'game_play_line.png', skinName: ['レーンスキン00', 'レーンスキン00', '軌跡外觀00', '按键条皮肤00', '레인 스킨00'] },
      { id: 'skin05', field: 'bg_line_rhythm.png', playLine: 'game_play_line.png', skinName: ["Poppin'Partyのレーン", "Poppin'Party Lane", "Poppin'Party的軌跡", "Poppin'Party的按键条皮肤", "Poppin'Party 레인"] },
    ],
    background: [
      { id: 'skin_miku', background: 'liveBG.png', skinName: ['Miku', 'Miku', 'Miku', 'Miku', 'Miku'] },
      { id: 'skin00', background: 'liveBG_normal.png', skinName: ['デフォルト背景', 'デフォルト背景', 'デフォルト背景', 'デフォルト背景', '기본 배경'] },
    ],
  },
}));

interface StoredSettings {
  display: Record<string, unknown>;
  preview: Record<string, unknown>;
  export: Record<string, unknown>;
}

function setup() {
  seedZhSettings();
  const setActivePage = vi.fn();
  const nav: AppNavValue = {
    activePage: 'preview', setActivePage, pageScope: null,
    navCollapsed: false, setNavCollapsed: vi.fn(),
  };
  render(
    <AppNavProvider value={nav}>
      <ConfigProvider>
        <PreviewDisplayPanel />
      </ConfigProvider>
    </AppNavProvider>,
  );
  fireEvent.click(trigger());
  return { setActivePage };
}

/** 动态（仿真场）形态：那一组才有音符速度档（票 24 的输入形态锁在这里） */
function setupDynamic(patch: Record<string, unknown> = {}) {
  seedZhSettings(patch);
  render(
    <AppNavProvider value={{ activePage: 'preview', setActivePage: vi.fn(), pageScope: null, navCollapsed: false, setNavCollapsed: vi.fn() }}>
      <ConfigProvider><PreviewDisplayPanel mode="dynamic" /></ConfigProvider>
    </AppNavProvider>,
  );
  fireEvent.click(trigger());
}

const trigger = () => screen.getByRole('button', { name: '设置' });
const panel = () => screen.getByRole('dialog', { name: '显示设置' });
const scrim = () => document.querySelector('.pp-menu__scrim') as HTMLElement;
/** 落盘的那份设置（ConfigProvider 每次改动都整份写回同一 key） */
const stored = (): StoredSettings => JSON.parse(localStorage.getItem(SETTINGS_KEY)!) as StoredSettings;
const bpmSwitch = () => within(panel()).getByRole('switch', { name: 'BPM 标记' });
const comboswitch = () => within(panel()).getByRole('switch', { name: 'Combo 标记' });
const mirrorSwitch = () => within(panel()).getByRole('switch', { name: '镜向' });
const dualSwitch = () => within(panel()).getByRole('switch', { name: '同时点击线' });
const colorAssistSwitch = () => within(panel()).getByRole('switch', { name: '色觉辅助' });
const timeSelect = () => within(panel()).getByRole('combobox', { name: '时间标记' });
const beatSelect = () => within(panel()).getByRole('combobox', { name: '节拍线' });
const qualitySelect = () => within(panel()).getByRole('combobox', { name: '图像品质' });
const noteSizeSlider = () => within(panel()).getByRole('slider', { name: '节奏图示大小' });
const gridOpacitySlider = () => within(panel()).getByRole('slider', { name: '轨道线透明度' });

describe('chart-preview 08 · 面板打开与默认档', () => {
  it('点「设置」弹出面板：标记 / 画布显示 / 音符皮肤三组都在', () => {
    setup();
    expect(panel()).toBeInTheDocument();
    expect(within(panel()).getByText('标记')).toBeInTheDocument();
    expect(within(panel()).getByText('画布显示')).toBeInTheDocument();
    expect(within(panel()).getByText('音符皮肤')).toBeInTheDocument();
  });

  it('默认档（用户定案）：BPM / Combo 标记开、时间标记 5 秒、节拍线 1/1、不镜像', () => {
    setup();
    expect(bpmSwitch()).toHaveAttribute('aria-checked', 'true');
    expect(timeSelect()).toHaveValue('5');
    expect(beatSelect()).toHaveValue('1');
    expect(comboswitch()).toHaveAttribute('aria-checked', 'true');
    expect(mirrorSwitch()).toHaveAttribute('aria-checked', 'false');
    expect(DEFAULT_PREVIEW_SETTINGS.timeMarks).toBe(5);
  });

  it('皮肤组显示当前整包名（六条目命中某个整包；不是整包时显示"已自定义"）', () => {
    setup();

    // 期望名从注册表算（不抄字面量）：与素材页"整包预设"同一判定口径。
    // 默认选择就是某个整包 → 面板显示的是它的显示名，而不是"已自定义"。
    const expected = noteSkinPresetLabel(normalizeNoteSkinSelection(undefined));
    expect(expected).toBeTruthy();
    // issue 49：显示名 = 官方命名映射选服（zh-CN 取 cn 条目），不是 label
    expect(expected).toBe('按键条皮肤00');
    expect(within(panel()).getByText(expected!)).toBeInTheDocument();
    expect(within(panel()).queryByText('已自定义')).toBeNull();
    expect(within(panel()).queryByText('CI 桩皮肤')).toBeNull();
  });

  it('运行中切界面语言：整包名跟随选服换语言（useMemo 依赖带 lang）', () => {
    setup();
    expect(within(panel()).getByText('按键条皮肤00')).toBeInTheDocument(); // zh-CN 取 cn 条目

    // 切语言的真实路径 = setUiLanguage → setActiveUiLanguage + 设置态变更带动整树重渲；
    // 这里直接置 locale 再点任一开关触发重渲（不动音符皮肤设置）。
    setActiveUiLanguage('en');
    fireEvent.click(mirrorSwitch());
    // 重渲后面板文案也换成了 en —— 按 role 取对话框（不再按中文名）
    const panelEn = screen.getByRole('dialog');
    expect(within(panelEn).getByText('TYPE1')).toBeInTheDocument(); // en 取 en 条目
    expect(within(panelEn).queryByText('按键条皮肤00')).toBeNull();

    setActiveUiLanguage('zh-CN'); // 还原，避免污染同文件后续用例
  });
});

describe('chart-preview 08 · 标记项落 settings.preview', () => {
  it('五个档位各写各的，且不碰画布显示那段', () => {
    setup();

    fireEvent.click(bpmSwitch());
    expect(bpmSwitch()).toHaveAttribute('aria-checked', 'false');
    expect(stored().preview.bpmMarks).toBe(false);

    fireEvent.change(timeSelect(), { target: { value: '10' } });
    expect(stored().preview.timeMarks).toBe(10);

    fireEvent.change(beatSelect(), { target: { value: '4' } });
    expect(stored().preview.beatMarks).toBe(4);

    fireEvent.click(comboswitch());
    expect(stored().preview.comboMarks).toBe(false);

    fireEvent.click(mirrorSwitch());
    expect(stored().preview.mirror).toBe(true);

    expect(stored().preview).toEqual({
      ...DEFAULT_PREVIEW_SETTINGS,
      bpmMarks: false, timeMarks: 10, beatMarks: 4, comboMarks: false, mirror: true,
    });
    // 画布那段一个字段都没被动过（写回的是整份设置，值是默认档）
    expect(stored().display).toEqual(defaultSettings().display);
  });
});

describe('chart-preview 08 · 画布显示组落 settings.display（与设置页同一份）', () => {
  it('同时点击线 / 色觉辅助 / 图像品质 / 音符大小 / 轨道线透明度都写进 display，且不碰标记那段', () => {
    setup();

    fireEvent.click(dualSwitch());
    expect(dualSwitch()).toHaveAttribute('aria-checked', 'false');
    expect(stored().display.simultaneousClickLines).toBe(false);

    fireEvent.click(colorAssistSwitch());
    expect(colorAssistSwitch()).toHaveAttribute('aria-checked', 'false');
    expect(stored().display.colorAssist).toBe(false);

    fireEvent.change(qualitySelect(), { target: { value: 'standard' } });
    expect(stored().display.imageQuality).toBe('standard');

    fireEvent.change(noteSizeSlider(), { target: { value: '150' } });
    expect(stored().display.noteSize).toBeCloseTo(1.5, 6);

    fireEvent.change(gridOpacitySlider(), { target: { value: '40' } });
    expect(stored().display.gridOpacity).toBeCloseTo(0.4, 6);

    // 标记那段一个字段都没被动过
    expect(stored().preview).toEqual(defaultSettings().preview);
  });

  it('面板读的是同一份设置：外部（设置页）改过之后打开面板能看到当前值', () => {
    seedZhSettings({
      display: { noteSize: 0.5, simultaneousClickLines: false, colorAssist: false, imageQuality: 'smooth', gridOpacity: 0.5 },
    });
    const setActivePage = vi.fn();
    render(
      <AppNavProvider value={{ activePage: 'preview', setActivePage, pageScope: null, navCollapsed: false, setNavCollapsed: vi.fn() }}>
        <ConfigProvider><PreviewDisplayPanel /></ConfigProvider>
      </AppNavProvider>,
    );
    fireEvent.click(trigger());

    expect(noteSizeSlider()).toHaveValue('50');
    expect(dualSwitch()).toHaveAttribute('aria-checked', 'false');
    expect(colorAssistSwitch()).toHaveAttribute('aria-checked', 'false');
    expect(qualitySelect()).toHaveValue('smooth');
    expect(gridOpacitySlider()).toHaveValue('50');
    // 没在种子里的项读的是 settings.display 的默认值（面板不自己造一套默认）
    expect(within(panel()).getByRole('combobox', { name: '轨道颜色' })).toHaveValue(defaultSettings().display.gridStyle);
    expect(bpmSwitch()).toHaveAttribute('aria-checked', 'true');
  });
});

describe('chart-preview 37 · 「设置」面板不再承载「导出信息」（已迁移至导出按钮）', () => {
  it('设置面板仅包含标记、画布显示、音符皮肤三组，不展示导出信息', () => {
    setup();
    expect(within(panel()).getByText('标记')).toBeInTheDocument();
    expect(within(panel()).getByText('画布显示')).toBeInTheDocument();
    expect(within(panel()).getByText('音符皮肤')).toBeInTheDocument();
    expect(within(panel()).queryByText('导出信息')).toBeNull();
    expect(within(panel()).queryByRole('switch', { name: '启用头带' })).toBeNull();
  });
});

describe('chart-preview 08 · 浮层交互与皮肤入口', () => {
  it('Esc 关面板并把焦点还给触发钮', () => {
    setup();
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it('点面板外（遮罩）关闭', () => {
    setup();
    fireEvent.click(scrim());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('「去素材页」关掉面板并切到素材页', () => {
    const { setActivePage } = setup();
    fireEvent.click(within(panel()).getByRole('button', { name: '去素材页' }));

    expect(setActivePage).toHaveBeenCalledWith('assets');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('chart-preview 24 · 音符速度档（1..12 / 步长 0.1 / 可手动输入）', () => {
  /** 数字输入框（`<input type="number">`） */
  const speedInput = () => within(panel()).getByRole('spinbutton', { name: '音符速度' });
  /** 粗调滑杆（与输入框同一份值） */
  const speedSlider = () => within(panel()).getByRole('slider', { name: '音符速度' });
  /** 步进钮（小 0.1 / 大 0.5 各一对，照 Bestdori 的 small / large） */
  const speedStep = (name: string) => within(panel()).getByRole('button', { name });

  it('默认 9.5：输入框与滑杆是同一份值，区间 1..12 步长 0.1', () => {
    setupDynamic();
    expect(speedInput()).toHaveValue(9.5);
    expect(speedSlider()).toHaveValue('9.5');
    expect(speedSlider()).toHaveAttribute('min', '1');
    expect(speedSlider()).toHaveAttribute('max', '12');
    expect(speedSlider()).toHaveAttribute('step', '0.1');
    // 这一档自带整行版式（不再套 `Row`）：标签只出现一次
    expect(within(panel()).getAllByText('音符速度')).toHaveLength(1);
  });

  it('输入 12 被接受（旧上界 11 会把它夹到 11 ⇒ 这条必红）', () => {
    setupDynamic();
    fireEvent.change(speedInput(), { target: { value: '12' } });

    expect(stored().preview.noteSpeed).toBe(12);
    expect(speedSlider()).toHaveValue('12');
  });

  it('输入 11.9：读数就是 11.9（步长 0.1，不再被吸到半档）', () => {
    setupDynamic();
    fireEvent.change(speedInput(), { target: { value: '11.9' } });

    expect(stored().preview.noteSpeed).toBe(11.9);
    expect(speedInput()).toHaveValue(11.9);
  });

  it('越界输入夹回区间：99 → 12、0.4 → 1', () => {
    setupDynamic();
    fireEvent.change(speedInput(), { target: { value: '99' } });
    expect(stored().preview.noteSpeed).toBe(12);

    fireEvent.change(speedInput(), { target: { value: '0.4' } });
    expect(stored().preview.noteSpeed).toBe(1);
  });

  it('步进钮两档：大 0.5 / 小 0.1（照 Bestdori 的 large / small）', () => {
    setupDynamic();
    fireEvent.click(speedStep('音符速度加 0.5'));
    expect(stored().preview.noteSpeed).toBe(10);

    fireEvent.click(speedStep('音符速度减 0.1'));
    expect(stored().preview.noteSpeed).toBe(9.9);

    fireEvent.click(speedStep('音符速度加 0.1'));
    expect(stored().preview.noteSpeed).toBe(10);

    // 上界那儿不再被夹到 11：11.8 + 0.5 落在 12
    fireEvent.change(speedInput(), { target: { value: '11.8' } });
    fireEvent.click(speedStep('音符速度加 0.5'));
    expect(stored().preview.noteSpeed).toBe(12);
  });

  it('滑杆拖到 12：写同一份设置，输入框跟着走', () => {
    setupDynamic();
    fireEvent.change(speedSlider(), { target: { value: '12' } });

    expect(stored().preview.noteSpeed).toBe(12);
    expect(speedInput()).toHaveValue(12);
  });

  it('静态形态没有这一档（只有动态形态的仿真场组有音符速度）', () => {
    setup();
    expect(within(panel()).queryByRole('spinbutton', { name: '音符速度' })).toBeNull();
  });
});

describe('chart-preview 56 · 素材包选择器（二级视图 + hover 大预览）', () => {
  /** 两个独立选择器（ADR-0018 §1）：设置视图一行「更换」，格子进二级视图 */
  const bgPack = (id: string) => listSimBackgroundPacks().find((p) => p.id === id)!;
  const fieldPack = (id: string) => listSimFieldPacks().find((p) => p.id === id)!;
  const bgRow = () => within(panel()).getByRole('button', { name: '更换背景' });
  const fieldRow = () => within(panel()).getByRole('button', { name: '更换轨道' });
  const openPicker = (kind: 'background' | 'field') =>
    fireEvent.click(kind === 'background' ? bgRow() : fieldRow());
  const back = () => fireEvent.click(within(panel()).getByRole('button', { name: '返回' }));
  const pickerGrid = (full: string) => within(panel()).getByRole('group', { name: full });
  /** 格钮可及名 = 显示名（官方命名选服 / 背景包取 i18n 名，issue 49） */
  const bgBtn = (id: string) => within(pickerGrid('表演背景'))
    .getByRole('button', { name: simPackDisplayName(bgPack(id), 'background') });
  const fieldBtn = (id: string) => within(pickerGrid('场地皮肤包'))
    .getByRole('button', { name: simPackDisplayName(fieldPack(id), 'field') });

  it('设置视图只有两行「当前选择」（缩略 + 显示名 + 更换），网格不在设置流里', () => {
    setupDynamic();
    expect(within(panel()).getByText('背景')).toBeInTheDocument();
    expect(within(panel()).getByText('轨道')).toBeInTheDocument();
    // 33 格不再进设置流 —— 嵌套滚动是"滚轮被吃掉"的根因（票 56 追加症状）
    expect(within(panel()).queryByRole('group', { name: '表演背景' })).toBeNull();
    expect(within(panel()).queryByRole('group', { name: '场地皮肤包' })).toBeNull();
    // 行上直接显示当前包（选服后的显示名）；按 title 取——轨道皮肤的官方名可能与
    // 「音符皮肤」那行的名字撞字（都是「按键条皮肤00」）
    expect(within(panel()).getByTitle(simPackDisplayName(bgPack('skin00'), 'background'))).toBeInTheDocument();
    expect(within(panel()).getByTitle(simPackDisplayName(fieldPack('skin00'), 'field'))).toBeInTheDocument();
    expect(bgRow()).toBeInTheDocument();
    expect(fieldRow()).toBeInTheDocument();
  });

  it('背景选择器：列全部包、显示名 + tooltip、缩略 = 素材自身 URL；点格落盘且不碰轨道', () => {
    setupDynamic();
    openPicker('background');
    const bgPacks = listSimBackgroundPacks();
    expect(bgPacks.length).toBeGreaterThan(0);
    for (const pack of bgPacks) {
      const display = simPackDisplayName(pack, 'background');
      expect(bgBtn(pack.id)).toHaveAttribute('title', display);
    }
    // 背景 skin00：官方名五服同值日文 → 显示 i18n 中文名，不出原始日文（用户 2026-10-22 反馈）
    expect(within(pickerGrid('表演背景')).getByText('默认背景')).toBeInTheDocument();
    expect(within(pickerGrid('表演背景')).queryByText('デフォルト背景')).toBeNull();
    // 缩略从素材自身缩放生成（不额外抓图）：src 落在该包的运行时素材树路径上
    const thumb = bgBtn(bgPacks[0].id).querySelector('img');
    expect(thumb?.getAttribute('src')).toContain(`/bgskin/jp/${bgPacks[0].id}_rip/`);

    // 点一个**非默认**包：落盘的就是它，另一个选择器没被碰；仍停选择器里（可连着比较）
    fireEvent.click(bgBtn('skin_miku'));
    expect(stored().preview.bgPackId).toBe('skin_miku');
    expect(stored().preview.fieldPackId).toBe('skin00');
    expect(pickerGrid('表演背景')).toBeInTheDocument();
  });

  it('轨道选择器：展示序 = 编号包在前（默认 skin00 第一格）、主题包在后；点格写 fieldPackId', () => {
    setupDynamic();
    openPicker('field');
    // 注入清单里主题包 skin_maid 写在编号包之前 → 渲染序仍是编号包在前
    expect(listSimFieldPacks().map((p) => p.id)).toEqual(['skin00', 'skin05', 'skin_maid']);
    expect(fieldBtn('skin00')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(fieldBtn('skin_maid'));
    expect(stored().preview.fieldPackId).toBe('skin_maid');
    expect(stored().preview.bgPackId).toBe('skin00');
  });

  it('进选择器焦点落在当前选中格；返回 / Esc 先回设置视图（焦点还给「更换」钮），再 Esc 才关面板', () => {
    setupDynamic();
    openPicker('field');
    expect(pickerGrid('场地皮肤包')).toBeInTheDocument();
    // 「更换」钮已卸载：焦点必须送进选择器，否则掉到 body、Tab 会走出弹窗
    expect(fieldBtn('skin00')).toHaveFocus();
    back();
    expect(within(panel()).queryByRole('group', { name: '场地皮肤包' })).toBeNull();
    expect(fieldRow()).toHaveFocus();

    openPicker('field');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(within(panel()).queryByRole('group', { name: '场地皮肤包' })).toBeNull();
    expect(fieldRow()).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('存了清单里没有的旧包 ID：行上显示归一化后的默认名；选择器里默认格高亮', () => {
    setupDynamic({ preview: { bgPackId: 'skin_已消失' } });
    expect(within(panel()).getByTitle(simPackDisplayName(bgPack('skin00'), 'background'))).toBeInTheDocument();

    openPicker('background');
    expect(bgBtn('skin00')).toHaveAttribute('aria-pressed', 'true'); // 归一化后的高亮，不占"缺失"行
    fireEvent.click(bgBtn('skin00'));
    expect(stored().preview.bgPackId).toBe('skin00');
  });

  it('hover / focus 一格浮出大预览（名字 = 该包显示名），移开即收', () => {
    setupDynamic();
    openPicker('field');
    // hover 只预览，不写设置（写盘只由点格触发）：直接比落盘字符串
    const before = localStorage.getItem(SETTINGS_KEY);
    fireEvent.mouseOver(fieldBtn('skin05'), { relatedTarget: document.body });
    const preview = document.querySelector('.pdp__preview');
    expect(preview).not.toBeNull();
    expect(preview!.textContent).toContain(simPackDisplayName(fieldPack('skin05'), 'field'));
    expect(localStorage.getItem(SETTINGS_KEY)).toBe(before);

    fireEvent.mouseOut(fieldBtn('skin05'), { relatedTarget: document.body });
    expect(document.querySelector('.pdp__preview')).toBeNull();
  });

  it('选择器打开时点遮罩：整个面板关闭（不是退回设置视图）', () => {
    setupDynamic();
    openPicker('background');
    expect(pickerGrid('表演背景')).toBeInTheDocument();

    fireEvent.click(scrim());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('静态形态没有这两行（仿真场专属，画布不画背景）', () => {
    setup();
    expect(within(panel()).queryByRole('button', { name: '更换背景' })).toBeNull();
    expect(within(panel()).queryByRole('button', { name: '更换轨道' })).toBeNull();
  });
});

describe('chart-preview 43 · 背景亮度', () => {
  const brightnessSlider = () => within(panel()).getByRole('slider', { name: '背景亮度' });

  it('默认 70%、区间 0..100、步长 5；拖动写 settings.preview.bgBrightness', () => {
    setupDynamic();
    expect(brightnessSlider()).toHaveValue('70');
    expect(brightnessSlider()).toHaveAttribute('min', '0');
    expect(brightnessSlider()).toHaveAttribute('max', '100');
    expect(brightnessSlider()).toHaveAttribute('step', '5');

    fireEvent.change(brightnessSlider(), { target: { value: '35' } });
    expect(stored().preview.bgBrightness).toBeCloseTo(0.35, 6);
  });

  it('静态形态没有这一项（仿真场专属）', () => {
    setup();
    expect(within(panel()).queryByRole('slider', { name: '背景亮度' })).toBeNull();
  });
});

describe('issue 29 · 面板定位（盒宽对齐 + 开着时伸缩跟随）', () => {
  // jsdom 没有布局引擎（`getBoundingClientRect()` 恒 0）⇒ 触发钮矩形只能显式注入，照 ScopePicker.test.tsx。
  // 面板盒宽 = 内容 320（CSS `.pdp__panel { width }`）+ 壳 14（padding 6×2 + `.pp-menu__panel` border 1×2）；
  // 三处一致性走 `tests/static/PreviewPanelAnchorWidth.test.ts`，这里只锁定位算式。
  const BOX_W = 334;
  /** 面板离视口边缘的留白（组件同款常量） */
  const MARGIN = 8;

  afterEach(() => { vi.unstubAllGlobals(); });

  /** 触发钮的量尺外壳（`.pdp__trigger`）：`IconButton` 不可 ref，量的是这层 */
  const ruler = () => document.querySelector('.pdp__trigger') as HTMLElement;
  const panelLeft = () => Number.parseFloat(panel().style.left);
  const panelTop = () => Number.parseFloat(panel().style.top);

  /**
   * 渲染 + 注入触发钮矩形 + 点开（定位是"打开那一刻量一次"，注入必须在点击之前）。
   * 返回可变矩形：改它再派 `resize` = 模拟"伸缩后触发钮随布局移动"。
   */
  function openAt(right: number, bottom: number) {
    seedZhSettings();
    render(
      <AppNavProvider value={{ activePage: 'preview', setActivePage: vi.fn(), pageScope: null, navCollapsed: false, setNavCollapsed: vi.fn() }}>
        <ConfigProvider><PreviewDisplayPanel /></ConfigProvider>
      </AppNavProvider>,
    );
    const rect = { right, bottom };
    vi.spyOn(ruler(), 'getBoundingClientRect').mockImplementation(() => ({
      x: rect.right - 73, y: rect.bottom - 30, left: rect.right - 73, right: rect.right,
      top: rect.bottom - 30, bottom: rect.bottom, width: 73, height: 30, toJSON: () => ({}),
    }) as DOMRect);
    fireEvent.click(trigger());
    return rect;
  }

  it('面板右缘贴触发钮右缘：left = 触发钮 right − 334（盒宽，不是内容宽 320）', () => {
    vi.stubGlobal('innerWidth', 1600);
    openAt(1418, 110);

    // 拿内容宽当盒宽得 1098 ⇒ 面板右缘比触发钮右缘多出 14px（旧写法该条必红）
    expect(panelLeft()).toBe(1418 - BOX_W);
    expect(panelLeft() + BOX_W).toBe(1418);
    expect(panelTop()).toBe(113);              // 触发钮下缘 + 3
  });

  it('面板开着时伸缩窗口：重新量触发钮，面板跟随（不留在旧位置）', () => {
    vi.stubGlobal('innerWidth', 1600);
    const rect = openAt(1418, 110);
    expect(panelLeft()).toBe(1418 - BOX_W);

    // 放大：右簇贴右缘 ⇒ 触发钮 right 随窗宽走（实测 1418 → 1738）
    vi.stubGlobal('innerWidth', 1920);
    rect.right = 1738;
    rect.bottom = 130;
    fireEvent(window, new Event('resize'));

    expect(panelLeft()).toBe(1738 - BOX_W);
    expect(panelTop()).toBe(133);
  });

  it('布局晚一拍（触发钮几何在 resize 之后才落定）：当帧量旧位，后续帧补测跟上', async () => {
    vi.stubGlobal('innerWidth', 1600);
    const rect = openAt(1418, 110);

    fireEvent(window, new Event('resize'));
    expect(panelLeft()).toBe(1418 - BOX_W);    // 当帧触发钮还没挪（补测要等布局落定）

    // 一拍之后几何才落定：视口变大 + 触发钮随右簇贴到新右缘（两者同时变，故一起注入）
    vi.stubGlobal('innerWidth', 1920);
    rect.right = 1738;
    await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 60)); });

    expect(panelLeft()).toBe(1738 - BOX_W);
  });

  it('缩到装不下时夹进视口：右缘留在 8px 留白内（夹取式同样按盒宽算）', () => {
    vi.stubGlobal('innerWidth', 1600);
    const rect = openAt(1418, 110);

    vi.stubGlobal('innerWidth', 1180);
    rect.right = 1176;                          // 触发钮已贴到视口右缘
    fireEvent(window, new Event('resize'));

    expect(panelLeft()).toBe(1180 - BOX_W - MARGIN);
    expect(panelLeft() + BOX_W).toBeLessThanOrEqual(1180 - MARGIN);
  });
});
