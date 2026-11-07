// 14 票（架构评审候选 5）：设置对象的写回只经 module，落盘只在 `saveSettings` 一处。
//
// 这是**接线事实**（static/ 的正当用途）：26 个 React setter 的调用方式行为侧
// 由 45 个 DOM 净值网、SettingsCommit.test.ts 与 SettingsCommitTrail.test.tsx 看守；
// 这里只钉住「没人再手搓一份 persistSettings(updateSettings(...))」，防回潮。
import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

const PROVIDER = 'src/app/providers/ConfigProvider.tsx';
const MODULE = 'src/settings/AppSettings.ts';

describe('14 · 唯一写回入口接线', () => {
  it('Provider 不自己落盘 / 变换，落盘只在 module 一处，轨迹只由一个 helper 定义', () => {
    const provider = readStripped(PROVIDER);
    const module = readStripped(MODULE);

    expect(provider).not.toMatch(/\bsaveSettings\s*\(/);
    expect(provider).not.toMatch(/\bupdateSettings\s*\(/);
    expect(provider).not.toMatch(/persistSettings/);
    expect(provider).toMatch(/commitSettings\(prev, resolved\)/);

    expect((module.match(/storage\.setItem\(/g) ?? []).length).toBe(1);
    expect(module).toMatch(/export function commitSettings\(/);

    expect((provider.match(/trail\.record\(/g) ?? []).length).toBe(1);
    // 定义 1 处 + commit 1 处 + setAllSettings（整体替换，语义不同）1 处
    expect((provider.match(/noteSettingsChange\(/g) ?? []).length).toBeLessThanOrEqual(3);
  });
});
