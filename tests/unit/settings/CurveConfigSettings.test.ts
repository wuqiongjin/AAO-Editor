// issue 114 锁测：曲线工具配置**持久化于 settings.curve**（全局一份、跨会话沿用上次值）
// + 面板整改（展开序 / 措辞 / 默认型 In）+ 画笔圆滑彻底退场。
//
// 为什么以静态源码断言为主：面板是 React 组件，本仓没有 render 过工具栏的测试基建；
// 而"配置存哪、字段有没有被 normalize、旧文案还在不在"都是**结构事实**，源码断言最稳
// （照 `EditorAudioSessionRefactor.test.ts` / `ToolbarNoteSkin.test.ts` 惯例）。
// 图标的像素辨识度单测同样拿不到 —— 由票内"出图人工看 18/28px"补。
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import {
  defaultSettings, loadSettings, saveSettings, updateSettings, type AppSettings,
} from '@/src/settings/AppSettings';
import { DEFAULT_CURVE_CONFIG, normalizeCurveConfig } from '@/src/chart/editing/CurveTool';
import { EASING_FAMILY_LABELS, EASING_TYPE_LABELS, CURVE_PRECISIONS } from '@/src/chart/editing/Easing';
import { repoRoot, stripComments, readSource, readStripped, sourceFiles } from '@/tests/support/source';
import { settingsMemStorage as memStorage } from '@/tests/support/storage';

const panelSrc = stripComments(readSource('src/pages/workspace/CurveConfigPanel.tsx'));
// 票 182 / 183：曲线配置住进画布左上角胶囊，工具轨不再内联任何配置项
const capsuleSrc = stripComments(readSource('src/pages/workspace/CurveOptionsCapsule.tsx'));
const railSrc = stripComments(readSource('src/pages/workspace/WorkspaceToolRail.tsx'));

/** 只认 v1 设置键的假 storage（其余 key 一律 null → 快捷键走出厂默认，不干扰本票断言） */

describe('issue 114 · 曲线配置持久化到 settings.curve', () => {
  it('出厂默认：Sine + In + 1/16 + 不使用模板 + 档位模式 + 右偏/中幅/标准密/基线 0 + 分类全部/上次模板 S 形', () => {
    expect(DEFAULT_CURVE_CONFIG).toEqual({
      family: 'sine',
      type: 'in',
      precision: 16,
      templateId: null,
      templateParamMode: 'preset',
      templateMirrored: false,
      templateScale: 1,
      templateDensity: 1,
      templateBaseline: 0,
      templateCategory: 'all',
      lastTemplateId: 's-curve',
    });
    expect(defaultSettings().curve).toEqual(DEFAULT_CURVE_CONFIG);
  });

  it('additive 字段：写入 curve **不 bump schemaVersion**（照 backgroundSkin 先例）', () => {
    const merged = updateSettings(defaultSettings(), {
      curve: { family: 'bounce', type: 'outIn', precision: 64, templateId: null },
    });
    expect(merged.schemaVersion).toBe(defaultSettings().schemaVersion);
    expect(merged.curve.family).toBe('bounce');
    // `schemaVersion` 在 updateSettings 里是字面量，光看返回值恒真——补一条源码断言防后人真去 bump
    expect(stripComments(readSource('src/settings/AppSettings.ts'))).not.toMatch(/schemaVersion:\s*[2-9]/);
  });

  it('老设置文件没有 curve 段 → 回落出厂默认（不是 undefined、也不是半截对象）', () => {
    const st = memStorage(JSON.stringify({ schemaVersion: 1, theme: 'dark' }));
    expect(loadSettings(st).curve).toEqual(DEFAULT_CURVE_CONFIG);
  });

  it('脏值逐字段归一化：非法族/型/精度与已下线的模板 id / 非法数值各自回落，连续倍率按合法范围钳制，合法项保留', () => {
    const st = memStorage(JSON.stringify({
      schemaVersion: 1,
      curve: {
        family: 'nope',
        type: 'sideways',
        precision: 999,
        templateId: 'ghost-template',
        templateParamMode: 'bogus',
        templateMirrored: 'yes',
        templateScale: 'invalid',
        templateDensity: Number.NaN,
      },
    }));
    expect(loadSettings(st).curve).toEqual(DEFAULT_CURVE_CONFIG);

    const keep = memStorage(JSON.stringify({
      schemaVersion: 1,
      curve: {
        family: 'elastic',
        type: 'out',
        precision: 32,
        templateId: 'wave',
        templateParamMode: 'free',
        templateMirrored: true,
        templateScale: 2.35,
        templateDensity: 3.5,
      },
    }));
    // 模板 id 必须能解析到现存模板，否则回落 null（模板库改名/删项后老设置仍可读）
    expect(loadSettings(keep).curve).toEqual({
      family: 'elastic',
      type: 'out',
      precision: 32,
      templateId: 'wave',
      templateParamMode: 'free',
      templateMirrored: true,
      templateScale: 2.35,
      templateDensity: 3.5,
      templateBaseline: 0,
      templateCategory: 'all',
      // 242 之前落盘的设置只有 templateId：上次模板按生效模板迁移，别退回 S 形
      lastTemplateId: 'wave',
    });
  });

  it('issue 242 · 模板分类筛选与上次选用模板：合法值保留，非法/缺失回落，无 lastTemplateId 时按 templateId 迁移', () => {
    expect(normalizeCurveConfig({
      templateCategory: 'special',
      lastTemplateId: 'gluten-comb',
    })).toMatchObject({ templateCategory: 'special', lastTemplateId: 'gluten-comb' });

    for (const cat of ['all', 'smooth', 'rhythm', 'special'] as const) {
      expect(normalizeCurveConfig({ templateCategory: cat }).templateCategory).toBe(cat);
    }
    // 非法分类回落 all；非法/已下线的模板 ID 回落 S 形（没有可迁移的生效模板时）
    expect(normalizeCurveConfig({ templateCategory: 'weird', lastTemplateId: 'ghost' }))
      .toMatchObject({ templateCategory: 'all', lastTemplateId: 's-curve' });
    expect(normalizeCurveConfig({})).toMatchObject({ templateCategory: 'all', lastTemplateId: 's-curve' });

    // 非法 lastTemplateId 但生效模板合法 → 迁移生效模板
    expect(normalizeCurveConfig({ templateId: 'zigzag', lastTemplateId: 'ghost' }).lastTemplateId).toBe('zigzag');
    // 两者都合法却不同：以 lastTemplateId 为准（用户上次点选的模板才是"记住的那个"）
    expect(normalizeCurveConfig({ templateId: 'arc', lastTemplateId: 'pulse' }).lastTemplateId).toBe('pulse');
  });

  it('issue 241 · normalizeCurveConfig 保留合法连续倍率、钳制越界值、非法值回落 1 并持久化 templateParamMode', () => {
    expect(normalizeCurveConfig({
      templateId: 'zigzag',
      templateParamMode: 'free',
      templateScale: 0.25,
      templateDensity: 3.5,
    })).toMatchObject({
      templateId: 'zigzag',
      templateParamMode: 'free',
      templateScale: 0.25,
      templateDensity: 3.5,
    });

    expect(normalizeCurveConfig({
      templateScale: 1.356,
      templateDensity: 4,
    })).toMatchObject({
      templateParamMode: 'preset',
      templateScale: 1.36,
      templateDensity: 4,
    });

    // 越界钳制：[0.1, 3.0] 与 [0.25, 4.0]
    expect(normalizeCurveConfig({ templateScale: -2, templateDensity: 0.05 })).toMatchObject({
      templateScale: 0.1,
      templateDensity: 0.25,
    });
    expect(normalizeCurveConfig({ templateScale: 99, templateDensity: 12 })).toMatchObject({
      templateScale: 3,
      templateDensity: 4,
    });

    // 非法输入回落 1 与 'preset'
    expect(normalizeCurveConfig({
      templateParamMode: 'turbo',
      templateScale: Infinity,
      templateDensity: 'dense',
    })).toMatchObject({
      templateParamMode: 'preset',
      templateScale: 1,
      templateDensity: 1,
    });
  });

  it('saveSettings → loadSettings 往返保真（跨会话"沿用上次值"的落点）', () => {
    const st = memStorage();
    const next: AppSettings = {
      ...defaultSettings(),
      curve: {
        family: 'cubic',
        type: 'inOut',
        precision: 64,
        templateId: 's-curve',
        templateParamMode: 'free',
        templateMirrored: true,
        templateScale: 0.5,
        templateDensity: 2,
        templateBaseline: 100,
        templateCategory: 'smooth',
        lastTemplateId: 'arc',
      },
    };
    saveSettings(next, st);
    expect(loadSettings(st).curve).toEqual(next.curve);
  });

  it('issue 240 · normalizeCurveConfig 校验与持久化 templateExtras（剔除无效项与默认值，钳制越界）', () => {
    const cleaned = normalizeCurveConfig({
      family: 'sine',
      type: 'in',
      precision: 16,
      templateId: 'pulse',
      templateExtras: {
        pulse: { pulsePos: 999, rogue: 'x' },
        step: { stepStyle: 'sharp' },
        arc: { bogus: 1 },
        ghost: { foo: 'bar' },
      },
    });
    expect(cleaned.templateExtras).toEqual({
      pulse: { pulsePos: 100 },
      step: { stepStyle: 'sharp' },
    });

    // 全为默认值 / 无效值时省略 templateExtras
    const onlyDefaults = normalizeCurveConfig({
      templateId: 'pulse',
      templateExtras: {
        pulse: { pulsePos: 50 },
        step: { stepStyle: 'invalid' },
      },
    });
    expect(onlyDefaults.templateExtras).toBeUndefined();

    // saveSettings → loadSettings 往返保真
    const st = memStorage();
    const withExtras: AppSettings = {
      ...defaultSettings(),
      curve: {
        ...DEFAULT_CURVE_CONFIG,
        templateId: 'pulse',
        lastTemplateId: 'pulse',
        templateExtras: { pulse: { pulsePos: 0 }, step: { stepStyle: 'sharp' } },
      },
    };
    saveSettings(withExtras, st);
    expect(loadSettings(st).curve).toEqual(withExtras.curve);
  });

  it('normalizeCurveConfig 对任意垃圾输入都产出完整配置（永不把脏值带进运行时）', () => {
    for (const junk of [undefined, null, 42, 'x', [], { family: null, precision: '16' }]) {
      // 逐字段比对（不只是"precision 在档位里"）——否则"错落到 32"也会绿
      expect(normalizeCurveConfig(junk), JSON.stringify(junk)).toEqual(DEFAULT_CURVE_CONFIG);
    }
    expect((CURVE_PRECISIONS as readonly number[])).toContain(DEFAULT_CURVE_CONFIG.precision);
  });
});

describe('issue 235 · 图形化曲线配置面板（两段切换 / 缩略图 / 胶囊控件）', () => {
  it('顶部提供缓动函数 / 形状模板模式切换，模板网格通过 SVG 直观预览', () => {
    expect(panelSrc).toContain("t('curve.mode.easing')");
    expect(panelSrc).toContain("t('curve.mode.template')");
    expect(panelSrc).toContain('MiniTemplateSvg');
    expect(panelSrc).toContain('MiniEasingSvg');
  });

  it('面板不使用禁用“不用模板”旧措辞，也不内联硬编码数量括号', () => {
    expect(panelSrc).not.toContain('不用模板');
    expect(panelSrc).not.toContain('40种');
    expect(panelSrc).not.toContain('16款');
    expect(panelSrc).not.toContain('18款');
  });

  it('缓动族/型命名：英文首字母大写 + 全角括号中文（多语言只换这两张表）', () => {
    expect(EASING_FAMILY_LABELS.sine).toBe('Sine（正弦）');
    expect(EASING_FAMILY_LABELS.bounce).toBe('Bounce（弹跳）');
    expect(EASING_TYPE_LABELS.inOut).toBe('In-Out（缓入缓出）');
    for (const label of Object.values(EASING_FAMILY_LABELS)) {
      expect(label, label).toMatch(/^[A-Z][A-Za-z]*（.+）$/);
    }
  });

  it('文案不出现第三方站名（缓动族 title 里的对标说明已删）', () => {
    for (const src of [panelSrc, capsuleSrc]) {
      expect(stripComments(src).toLowerCase()).not.toContain('bestdori');
    }
  });

  it('面板抽成独立组件：胶囊挂面板，工具轨与胶囊都不内联曲线配置控件', () => {
    expect(capsuleSrc).toContain('CurveConfigPanel');
    for (const marker of ['EASING_FAMILIES', 'SHAPE_TEMPLATES', 'TEMPLATE_SCALES']) {
      expect(capsuleSrc, `曲线配置 ${marker} 不该内联进胶囊`).not.toContain(marker);
      expect(railSrc, `曲线配置 ${marker} 不该回到工具轨`).not.toContain(marker);
    }
  });
});

describe('issue 114 · 画笔圆滑彻底退场（防复活）', () => {
  // 全仓静态扫描在并行满载时会被抢到超过默认 5s（见 test-infra/02）：显式放宽，断言本身不变
  it('src/ 与 tests/ 内零 smoothPenLanes / smoothedPenSamples / 画笔圆滑', () => {
    const banned = ['smoothPenLanes', 'smoothedPenSamples', '画笔圆滑'];
    const hits: string[] = [];
    const files = [...sourceFiles(join(repoRoot, 'src')), ...sourceFiles(join(repoRoot, 'tests'))]
      .filter((rel) => rel !== 'tests/unit/settings/CurveConfigSettings.test.ts'); // 本文件因列出禁用词必然命中，排除自身
    for (const rel of files) {
      const s = readStripped(rel);
      for (const b of banned) if (s.includes(b)) hits.push(`${rel}:${b}`);
    }
    expect(hits).toEqual([]);
  }, 30_000);

  it('CurveConfig 类型不再有 smooth 字段', () => {
    const src = stripComments(readSource('src/chart/editing/CurveTool.ts'));
    expect(src).not.toMatch(/^\s*smooth\??[:(]/m);
  });
});
