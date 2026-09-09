import { describe, it, expect } from 'vitest';
import {
  getDefaultConfig, resolveAction, buildBindingIndex, setFunctionBinding,
  bindingTakenByOther, loadConfig, formatKey, categoryShortcuts, functionMode,
} from '../../src/chart/config/ShortcutConfig';

const keyEvent = (key: string, ctrl = false): KeyboardEvent =>
  ({ key, ctrlKey: ctrl, metaKey: false } as KeyboardEvent);

describe('ShortcutConfig 默认配置', () => {
  it('每功能恰好一个键', () => {
    const cfg = getDefaultConfig();
    const ids = Object.keys(cfg) as (keyof typeof cfg)[];
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(typeof cfg[id]).toBe('string');
    }
  });

  it('默认含 切换/执行 单键', () => {
    const cfg = getDefaultConfig();
    expect(cfg.switchSingle).toBe('f');
    expect(cfg.execSingle).toBe('ctrl+f');
  });

  it('默认含 bpm/slide/play 动作', () => {
    const cfg = getDefaultConfig();
    expect(cfg.switchBpm).toBe('`');
    expect(cfg.execBpm).toBe('ctrl+`');
    expect(cfg.switchSlide).toBe('e');
    expect(cfg.play).toBe(' ');
  });

  // issue 59 §2：音符代码占 B / Ctrl+B；侧栏折叠让出 Ctrl+B → Ctrl+Shift+B
  it('默认含 音符代码 切换/执行，侧栏折叠改 Ctrl+Shift+B', () => {
    const cfg = getDefaultConfig();
    expect(cfg.switchNoteCode).toBe('b');
    expect(cfg.execNoteCode).toBe('ctrl+b');
    expect(cfg.toggleSidebar).toBe('ctrl+shift+b');
    // 一键一功能：新键位不与既有功能相撞
    expect(buildBindingIndex(cfg).size).toBe(Object.keys(cfg).length);
  });
});

describe('resolveAction 按键解析', () => {
  it('切换单键 f / 执行单键 ctrl+f 均命中', () => {
    const cfg = getDefaultConfig();
    expect(resolveAction(keyEvent('f'), cfg)).toBe('switchSingle');
    expect(resolveAction(keyEvent('f', true), cfg)).toBe('execSingle');
  });

  it('空格命中播放', () => {
    expect(resolveAction(keyEvent(' '), getDefaultConfig())).toBe('play');
  });

  it('未绑定按键返回 null', () => {
    expect(resolveAction(keyEvent('z'), getDefaultConfig())).toBeNull();
  });

  it('B / Ctrl+B / Ctrl+Shift+B 三者各归其位（issue 59 §2 键位裁决）', () => {
    const cfg = getDefaultConfig();
    const shiftEvent = (key: string, ctrl: boolean, shift: boolean): KeyboardEvent =>
      ({ key, ctrlKey: ctrl, shiftKey: shift, metaKey: false } as KeyboardEvent);
    expect(resolveAction(keyEvent('b'), cfg)).toBe('switchNoteCode');
    expect(resolveAction(keyEvent('b', true), cfg)).toBe('execNoteCode');
    expect(resolveAction(shiftEvent('B', true, true), cfg)).toBe('toggleSidebar');
  });
});

describe('冲突检测', () => {
  it('同一键位被其它功能占用时拒绝', () => {
    const cfg = getDefaultConfig();
    // 尝试把 切换-滑键 设为 f（已被 切换-单键 占用）
    const conflict = setFunctionBinding(cfg, 'switchFlick', 'f');
    expect(conflict).toBe('switchSingle');
    expect(cfg.switchFlick).toBe('g'); // 未被修改
  });

  it('空闲键位可成功设置', () => {
    const cfg = getDefaultConfig();
    const conflict = setFunctionBinding(cfg, 'switchFlick', 'h');
    expect(conflict).toBeNull();
    expect(cfg.switchFlick).toBe('h');
  });

  it('屏蔽：传入 null 清空绑定且不冲突', () => {
    const cfg = getDefaultConfig();
    const conflict = setFunctionBinding(cfg, 'switchSingle', null);
    expect(conflict).toBeNull();
    expect(cfg.switchSingle).toBeNull();
  });

  it('屏蔽后 buildBindingIndex 不再索引、resolveAction 不命中', () => {
    const cfg = getDefaultConfig();
    setFunctionBinding(cfg, 'switchSingle', null);
    expect(buildBindingIndex(cfg).get('f')).toBeUndefined();
    expect(resolveAction(keyEvent('f'), cfg)).toBeNull();
    expect(resolveAction(keyEvent('f', true), cfg)).toBe('execSingle'); // 其它功能不受影响
  });

  it('loadConfig 保留显式屏蔽值 null', () => {
    const cfg = loadConfig({ getItem: () => JSON.stringify({ switchSingle: null }) });
    expect(cfg.switchSingle).toBeNull();
  });

  // issue 59：旧存档里 toggleSidebar 仍是旧默认 ctrl+b（已被「执行-音符代码」接管）→ 必须修回 Ctrl+Shift+B
  it('loadConfig 修复被接管的旧默认键（Ctrl+B 归还给执行-音符代码）', () => {
    const cfg = loadConfig({ getItem: () => JSON.stringify({ toggleSidebar: 'ctrl+b' }) });
    expect(cfg.toggleSidebar).toBe('ctrl+shift+b');
    expect(cfg.execNoteCode).toBe('ctrl+b');
    // 修复后不得再有撞键
    expect(buildBindingIndex(cfg).size).toBe(Object.keys(cfg).length);
  });

  it('用户真正改过的 toggleSidebar 键位不受修复影响', () => {
    const cfg = loadConfig({ getItem: () => JSON.stringify({ toggleSidebar: 'ctrl+alt+s' }) });
    expect(cfg.toggleSidebar).toBe('ctrl+alt+s');
  });

  it('bindingTakenByOther 返回占用方', () => {
    const cfg = getDefaultConfig();
    expect(bindingTakenByOther(cfg, 'execSingle', 'f')).toBe('switchSingle');
  });
});

describe('loadConfig 容错', () => {
  it('损坏数据回退到默认', () => {
    const cfg = loadConfig({ getItem: () => 'not-json' });
    expect(cfg.switchSingle).toBe('f');
  });

  it('部分覆盖保持其余默认', () => {
    const cfg = loadConfig({ getItem: () => JSON.stringify({ switchSingle: 'j' }) });
    expect(cfg.switchSingle).toBe('j');
    expect(cfg.execSingle).toBe('ctrl+f');
  });
});

describe('展示辅助', () => {
  it('functionMode 区分 切换/执行', () => {
    expect(functionMode('switchSingle')).toBe('switch');
    expect(functionMode('execSingle')).toBe('exec');
    expect(functionMode('undo')).toBe('exec');
  });

  it('formatKey 格式化', () => {
    expect(formatKey('ctrl+f')).toBe('Ctrl+F');
    expect(formatKey(' ')).toBe('Space');
    expect(formatKey('ctrl+ ')).toBe('Ctrl+Space'); // 「跳回起点标记」组合键中空格的展示
    expect(formatKey('ctrl+shift+q')).toBe('Ctrl+Shift+Q');
  });

  it('categoryShortcuts 合并 切换/执行', () => {
    const lines = categoryShortcuts(getDefaultConfig(), '单键');
    expect(lines).toContainEqual({ mode: '切换', key: 'F' });
    expect(lines).toContainEqual({ mode: '执行', key: 'Ctrl+F' });
  });

  it('buildBindingIndex 一键一功能', () => {
    const index = buildBindingIndex(getDefaultConfig());
    expect(index.size).toBe(Object.keys(getDefaultConfig()).length);
    expect(index.get('f')).toBe('switchSingle');
  });
});
