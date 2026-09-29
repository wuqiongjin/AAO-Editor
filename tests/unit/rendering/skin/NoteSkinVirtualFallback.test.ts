// issue 39 #4 色觉辅助防御分支：皮肤包缺虚拍精灵（tapVirtual 全 null）时，
// tapVirtualFor 回退实拍款配置（渲染侧无需感知缺失）。用 vi.mock 注入缺失场景——
// 现有 7 包均自带 note_normal_16，真实数据无法触发该分支。
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/src/rendering/skin/gen/noteSkinRegistry.gen', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/src/rendering/skin/gen/noteSkinRegistry.gen')>();
  return {
    ...mod,
    NOTE_SKIN_PACKS: mod.NOTE_SKIN_PACKS.map((p) =>
      p.kind === 'note' ? { ...p, tapVirtual: p.tapVirtual.map(() => null) } : p,
    ),
  };
});

const { buildActiveNoteIcons, normalizeNoteSkinSelection } = await import('@/src/rendering/skin/noteSkin');

describe('tapVirtualFor 缺失回退（注册表无虚拍精灵的包）', () => {
  const icons = buildActiveNoteIcons(normalizeNoteSkinSelection(undefined));

  it('虚拍配置 === 实拍配置（同引用即回退成功）', () => {
    expect(icons.tapVirtualFor(3)).toBe(icons.tapFor(3));
    expect(icons.tapVirtualFor(0)).toBe(icons.tapFor(0));
  });
});
