// issue 114 锁测：曲线工具配置**持久化于 settings.curve**（全局一份、跨会话沿用上次值）
// + 面板整改（展开序 / 措辞 / 默认型 In）+ 画笔圆滑彻底退场。
//
// 为什么以静态源码断言为主：面板是 React 组件，本仓没有 render 过工具栏的测试基建；
// 而"配置存哪、字段有没有被 normalize、旧文案还在不在"都是**结构事实**，源码断言最稳
// （照 `EditorAudioSessionRefactor.test.ts` / `ToolbarNoteSkin.test.ts` 惯例）。
// 图标的像素辨识度单测同样拿不到 —— 由票内"出图人工看 18/28px"补。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  defaultSettings, loadSettings, saveSettings, updateSettings, type AppSettings,
} from '@/src/chart/config/AppSettings';
import { DEFAULT_CURVE_CONFIG, normalizeCurveConfig } from '@/src/chart/editing/CurveTool';
import { EASING_FAMILY_LABELS, EASING_TYPE_LABELS, CURVE_PRECISIONS } from '@/src/chart/editing/Easing';
import { repoRoot, stripComments, readSource } from '@/tests/support/source';
import { settingsMemStorage as memStorage } from '@/tests/support/storage';

const panelSrc = stripComments(readSource('src/pages/WorkspacePage/CurveConfigPanel.tsx'));
const toolbarSrc = stripComments(readSource('src/pages/WorkspacePage/Toolbar.tsx'));

/** 只认 v1 设置键的假 storage（其余 key 一律 null → 快捷键走出厂默认，不干扰本票断言） */
function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkTs(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe('issue 114 · 曲线配置持久化到 settings.curve', () => {
  it('出厂默认：Sine + In + 1/16 + 不使用模板（默认型由 In-Out 改为 In）', () => {
    expect(DEFAULT_CURVE_CONFIG).toEqual({
      family: 'sine', type: 'in', precision: 16, templateId: null,
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
    expect(stripComments(readSource('src/chart/config/AppSettings.ts'))).not.toMatch(/schemaVersion:\s*[2-9]/);
  });

  it('老设置文件没有 curve 段 → 回落出厂默认（不是 undefined、也不是半截对象）', () => {
    const st = memStorage(JSON.stringify({ schemaVersion: 1, theme: 'dark' }));
    expect(loadSettings(st).curve).toEqual(DEFAULT_CURVE_CONFIG);
  });

  it('脏值逐字段归一化：非法族/型/精度与已下线的模板 id 各自回落，合法项保留', () => {
    const st = memStorage(JSON.stringify({
      schemaVersion: 1,
      curve: { family: 'nope', type: 'sideways', precision: 999, templateId: 'ghost-template' },
    }));
    expect(loadSettings(st).curve).toEqual(DEFAULT_CURVE_CONFIG);

    const keep = memStorage(JSON.stringify({
      schemaVersion: 1,
      curve: { family: 'elastic', type: 'out', precision: 32, templateId: 'wave' },
    }));
    // 模板 id 必须能解析到现存模板，否则回落 null（模板库改名/删项后老设置仍可读）
    expect(loadSettings(keep).curve).toEqual({
      family: 'elastic', type: 'out', precision: 32, templateId: 'wave',
    });
  });

  it('saveSettings → loadSettings 往返保真（跨会话"沿用上次值"的落点）', () => {
    const st = memStorage();
    const next: AppSettings = {
      ...defaultSettings(),
      curve: { family: 'cubic', type: 'inOut', precision: 64, templateId: 's-curve' },
    };
    saveSettings(next, st);
    expect(loadSettings(st).curve).toEqual(next.curve);
  });

  it('normalizeCurveConfig 对任意垃圾输入都产出完整配置（永不把脏值带进运行时）', () => {
    for (const junk of [undefined, null, 42, 'x', [], { family: null, precision: '16' }]) {
      // 逐字段比对（不只是"precision 在档位里"）——否则"错落到 32"也会绿
      expect(normalizeCurveConfig(junk), JSON.stringify(junk)).toEqual(DEFAULT_CURVE_CONFIG);
    }
    expect((CURVE_PRECISIONS as readonly number[])).toContain(DEFAULT_CURVE_CONFIG.precision);
  });
});

describe('issue 114 · 曲线配置面板（展开序 / 措辞 / 表驱动）', () => {
  it('展开序 = 缓动族 → 缓动型 → 采样精度 → 形状模板（模板挪到最后）', () => {
    const at = (id: string) => panelSrc.indexOf(`id: '${id}'`);
    expect(at('family')).toBeGreaterThan(-1);
    expect(at('family'), '族在型之前').toBeLessThan(at('type'));
    expect(at('type'), '型在精度之前').toBeLessThan(at('precision'));
    expect(at('precision'), '精度在模板之前').toBeLessThan(at('templateId'));
  });

  it('模板下拉的"不选模板"项 = 「不使用模板」——不提缓动函数（用户看不懂）', () => {
    expect(panelSrc).toContain("t('curve.noTemplate')");
    expect(panelSrc).not.toContain('缓动函数');
    expect(panelSrc).not.toContain('不用模板');
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
    for (const src of [panelSrc, toolbarSrc]) {
      expect(stripComments(src).toLowerCase()).not.toContain('bestdori');
    }
  });

  it('面板抽成独立组件 + 表驱动：Toolbar 不再内联曲线配置项', () => {
    expect(toolbarSrc).toContain('CurveConfigPanel');
    // 只否定旧标识符不够（换名内联回 Toolbar 就绿了）——直接断言四个字段 id 都不在 Toolbar 里
    for (const id of ['family', 'type', 'precision', 'templateId']) {
      expect(toolbarSrc, `曲线配置项 ${id} 不该回到 Toolbar`).not.toContain(`id: '${id}'`);
    }
    for (const id of ['family', 'type', 'precision', 'templateId']) {
      expect(panelSrc, `曲线配置项 ${id} 应在面板里`).toContain(`id: '${id}'`);
    }
  });
});

describe('issue 114 · 画笔圆滑彻底退场（防复活）', () => {
  it('src/ 与 tests/ 内零 smoothPenLanes / smoothedPenSamples / 画笔圆滑', () => {
    const banned = ['smoothPenLanes', 'smoothedPenSamples', '画笔圆滑'];
    const hits: string[] = [];
    const files = [...walkTs(join(repoRoot, 'src')), ...walkTs(join(repoRoot, 'tests'))]
      .filter((f) => f !== __filename); // 本文件因列出禁用词必然命中，排除自身
    for (const f of files) {
      const s = stripComments(readFileSync(f, 'utf-8'));
      for (const b of banned) if (s.includes(b)) hits.push(`${f.replace(repoRoot + '/', '')}:${b}`);
    }
    expect(hits).toEqual([]);
  });

  it('CurveConfig 类型不再有 smooth 字段', () => {
    const src = stripComments(readSource('src/chart/editing/CurveTool.ts'));
    expect(src).not.toMatch(/^\s*smooth\??[:(]/m);
  });
});
