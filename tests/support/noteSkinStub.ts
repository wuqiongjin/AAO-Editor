// 音符皮肤注册表的测试替身：`src/rendering/skin/gen/noteSkinRegistry.gen.ts` 是 assets:sync 取回的
// 快照产物（七包全套精灵矩形，几千行），组件测试只需要「包 id / 图集 URL / 精灵矩形」这几样。
//
// 用法（工厂里必须**动态** import —— `vi.mock` 会被提到文件顶部，静态绑定此时还没初始化）：
//
//   vi.mock('@/src/rendering/skin/gen/noteSkinRegistry.gen', async () => {
//     const { noteSkinRegistryStub } = await import('@/tests/support/noteSkinStub');
//     return noteSkinRegistryStub();
//   });
//
// 替身取值有讲究：note 包的 `label` 与 `skinName` **刻意不同值**（'CI 桩皮肤' vs 'TYPE1'），
// 这样显示名选服测试（issue 49）能识破「回落路径蒙混过关」。
const rects = (baseX: number) =>
  Array.from({ length: 7 }, (_, lane) => ({ x: baseX + lane * 100, y: 0, w: 100, h: 100 }));

const notePack = (n: 0 | 1, pairedDir: string) => ({
  kind: 'note', id: `skin0${n}`, label: `CI 桩皮肤${n === 0 ? '' : ' 2'}`,
  skinName: [n === 0 ? 'TYPE1' : 'TYPE2', n === 0 ? 'TYPE1' : 'TYPE2', n === 0 ? 'TYPE1' : 'TYPE2', n === 0 ? 'TYPE1' : 'TYPE2', n === 0 ? 'TYPE1' : 'TYPE2'],
  atlas: `skins/skin0${n}/atlas.png`, atlasW: 1024, atlasH: 1024,
  tap: rects(0), tapVirtual: rects(200), flick: rects(0), skill: rects(0), long: rects(400),
  flickTop: { x: 0, y: 0, w: 100, h: 100 }, slideAmong: { x: 0, y: 200, w: 100, h: 100 },
  ink: { note_flick_top: { left: 10, top: 10, right: 10, bottom: 10 } },
  band: `skins/skin0${n}/longNoteLine.png`, bandW: 100, bandH: 20,
  bandSp: null, bandSpW: 0, bandSpH: 0,
  simultaneous: null, simultaneousW: 0, simultaneousH: 0,
  pairedDir,
});

const dirPack = (n: 0 | 1) => ({
  kind: 'directional', id: `directionalflickskin0${n}`, label: `CI 桩方向皮肤${n === 0 ? '' : ' 2'}`,
  skinName: [n === 0 ? 'TYPE1' : 'TYPE2', n === 0 ? 'TYPE1' : 'TYPE2', n === 0 ? 'TYPE1' : 'TYPE2', n === 0 ? 'TYPE1' : 'TYPE2', n === 0 ? 'TYPE1' : 'TYPE2'],
  atlas: `skins/directionalflickskin0${n}/atlas.png`, atlasW: 1024, atlasH: 1024,
  dirL: rects(0), dirR: rects(0), flickTopL: null, flickTopR: null, ink: {},
});

/** 注册表模块的替身内容（形状同 gen 产物：NOTE_SKIN_PACKS + NOTE_SKIN_DEFAULT_SELECTION） */
export function noteSkinRegistryStub() {
  return {
    NOTE_SKIN_PACKS: [
      notePack(0, 'directionalflickskin00'),
      notePack(1, 'directionalflickskin01'),
      dirPack(0),
      dirPack(1),
    ],
    NOTE_SKIN_DEFAULT_SELECTION: {
      tap: 'skin00', flick: 'skin00', skill: 'skin00', slide: 'skin00',
      dirL: 'directionalflickskin00', dirR: 'directionalflickskin00',
    },
  };
}
