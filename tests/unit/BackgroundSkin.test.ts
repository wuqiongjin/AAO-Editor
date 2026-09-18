// 谱面背景皮肤（issue 29 Q4 最小模型，2026-08-27 定案）：
//   1) cover 几何纯函数（staticLayerCache 导出）；
//   2) BackgroundSkinStore 纯逻辑（端口注入：内存持久化 + 假解码，node 环境无 IndexedDB/DOM）；
//   3) settings.visual.backgroundSkin 开关位的归一化与 updateSettings 合并行为。
import { describe, it, expect } from 'vitest';
import { computeBackgroundDrawRect, normalizeBackgroundOpacity } from '../../src/visual/staticLayerCache';
import { BackgroundSkinStore, backgroundSkinStore, createElectronBackgroundPersist } from '../../src/chart/rendering/backgroundSkin';
import {
  defaultSettings, loadSettings, updateSettings,
  DEFAULT_BACKGROUND_OPACITY, DEFAULT_BACKGROUND_FIT, DEFAULT_BACKGROUND_SCOPE,
} from '../../src/chart/config/AppSettings';

// ---------------- 1) cover 几何 ----------------

describe('computeBackgroundDrawRect（背景图 fit 几何：cover / contain）', () => {
  it('cover 同比例：完全贴合不偏移', () => {
    expect(computeBackgroundDrawRect(2000, 800, 1000, 400, 'cover')).toEqual({ dx: 0, dy: 0, dw: 2000, dh: 800 });
    expect(computeBackgroundDrawRect(2000, 800, 1000, 400)).toEqual({ dx: 0, dy: 0, dw: 2000, dh: 800 }); // 缺省 = cover
  });

  it('cover 宽源图：按高度铺满、左右溢出居中（超出裁剪）', () => {
    // 画布 100x100，图 200x50 → scale = max(0.5, 2)=2 → dw=400 dh=100，dx=-150
    const r = computeBackgroundDrawRect(100, 100, 200, 50, 'cover');
    expect(r.dh).toBeCloseTo(100);
    expect(r.dw).toBeCloseTo(400);
    expect(r.dx).toBeCloseTo(-150);
    expect(r.dy).toBeCloseTo(0);
  });

  it('contain 宽源图：完整显示，上下留黑边', () => {
    // 图 200x50 → scale=min(0.5,2)=0.5 → dw=100 dh=25，dy=(100-25)/2=37.5
    const r = computeBackgroundDrawRect(100, 100, 200, 50, 'contain');
    expect(r.dw).toBeCloseTo(100);
    expect(r.dh).toBeCloseTo(25);
    expect(r.dx).toBeCloseTo(0);
    expect(r.dy).toBeCloseTo(37.5);
  });

  it('cover 与 contain 对同一输入的 scale 选择互反（max vs min）', () => {
    const cover = computeBackgroundDrawRect(300, 300, 150, 300, 'cover'); // max=2
    const contain = computeBackgroundDrawRect(300, 300, 150, 300, 'contain'); // min=1
    expect(cover.dw).toBeCloseTo(300);
    expect(contain.dw).toBeCloseTo(150);
  });

  it('非法入参（零尺寸）返回退化矩形，不抛错；模式值非法按 cover 处理', () => {
    expect(computeBackgroundDrawRect(100, 100, 0, 10, 'contain')).toEqual({ dx: 0, dy: 0, dw: 100, dh: 100 });
    const bad = computeBackgroundDrawRect(100, 100, 200, 50, 'tile' as 'cover');
    expect(bad.dw).toBeCloseTo(400); // cover 行为兜底
  });

  it('不透明度默认值 0..1 开区间内（修订版：可调参数化，默认 55% ≈ 首版固定遮罩亮度）', () => {
    expect(DEFAULT_BACKGROUND_OPACITY).toBeGreaterThan(0);
    expect(DEFAULT_BACKGROUND_OPACITY).toBeLessThan(1);
    expect(DEFAULT_BACKGROUND_OPACITY).toBeCloseTo(0.55);
  });

  it('normalizeBackgroundOpacity：合法值夹取、非法/缺失回退默认', () => {
    expect(normalizeBackgroundOpacity(0)).toBe(0);
    expect(normalizeBackgroundOpacity(1)).toBe(1);
    expect(normalizeBackgroundOpacity(3)).toBe(1);
    expect(normalizeBackgroundOpacity(-2)).toBe(0);
    expect(normalizeBackgroundOpacity(undefined)).toBe(DEFAULT_BACKGROUND_OPACITY);
    expect(normalizeBackgroundOpacity('yes')).toBe(DEFAULT_BACKGROUND_OPACITY);
    expect(normalizeBackgroundOpacity(Number.NaN)).toBe(DEFAULT_BACKGROUND_OPACITY);
  });
});

// ---------------- 2) BackgroundSkinStore（端口注入版） ----------------

interface FakePersistState {
  blob: Blob | null;
  failLoad?: boolean;
}

/** 假端口工厂：内存持久化 + 恒定假解码（尺寸随内容标记变化以区分新旧图） */
function makePorts(state: FakePersistState) {
  const urls: string[] = [];
  const revoked: string[] = [];
  return {
    ports: {
      persist: {
        async load() {
          if (state.failLoad) throw new Error('idb broken');
          return state.blob;
        },
        async save(blob: Blob) {
          state.blob = blob;
        },
        async clear() {
          state.blob = null;
        },
      },
      decode: async (blob: Blob) => {
        const tag = await blob.text();
        const [w, h] = tag.split('x').map(Number);
        if (!Number.isFinite(w)) throw new Error('decode boom');
        return { source: `bmp:${tag}`, width: w, height: h };
      },
      createUrl: (blob: Blob) => {
        void blob;
        const url = `blob:url-${urls.length}`;
        urls.push(url);
        return url;
      },
      revokeUrl: (url: string) => { revoked.push(url); },
    },
    get revoked() { return revoked; },
    get urlCount() { return urls.length; },
  };
}

describe('BackgroundSkinStore（最小模型三原语）', () => {
  it('空库装载：status=ready 且 image=null，revision 保持 0（与初始渲染输出一致）', async () => {
    const f = makePorts({ blob: null });
    const store = new BackgroundSkinStore(f.ports);
    const seen: number[] = [];
    store.subscribe(() => seen.push(store.getSnapshot().revision));
    await store.ensureLoaded();
    const snap = store.getSnapshot();
    expect(snap.status).toBe('ready');
    expect(snap.image).toBeNull();
    expect(snap.revision).toBe(0);
  });

  it('有图装载：出图并 bump revision；快照字段完整（url/source/width/height）', async () => {
    const f = makePorts({ blob: new Blob(['1920x1080']) });
    const store = new BackgroundSkinStore(f.ports);
    await store.ensureLoaded();
    const snap = store.getSnapshot();
    expect(snap.status).toBe('ready');
    expect(snap.image).not.toBeNull();
    expect(snap.image!.width).toBe(1920);
    expect(snap.image!.height).toBe(1080);
    expect(snap.image!.source).toBe('bmp:1920x1080');
    expect(String(snap.image!.url)).toMatch(/^blob:url-/);
    expect(snap.revision).toBe(1);
  });

  it('上传替换：先落盘再换快照；旧 URL 被回收；revision 单调递增', async () => {
    const state: FakePersistState = { blob: new Blob(['100x50']) };
    const f = makePorts(state);
    const store = new BackgroundSkinStore(f.ports);
    await store.ensureLoaded();
    const rev0 = store.getSnapshot().revision;

    const oldUrl = store.getSnapshot().image!.url;
    await store.setImage(new Blob(['300x300']));
    expect(await state.blob!.text()).toBe('300x300'); // 已持久化
    const snap = store.getSnapshot();
    expect(snap.image!.width).toBe(300);
    expect(snap.revision).toBe(rev0 + 1);
    expect(f.revoked).toContain(oldUrl);
  });

  it('清除：删库存档、快照去图、revision 继续推进', async () => {
    const state: FakePersistState = { blob: new Blob(['100x50']) };
    const f = makePorts(state);
    const store = new BackgroundSkinStore(f.ports);
    await store.ensureLoaded();
    await store.clear();
    expect(state.blob).toBeNull();
    const snap = store.getSnapshot();
    expect(snap.image).toBeNull();
    expect(snap.revision).toBeGreaterThanOrEqual(2); // 装载 1 次 + 清除 1 次
  });

  it('保存后解码失败：setImage 抛错且内存态不被污染；随后重传有效图可恢复', async () => {
    const state: FakePersistState = { blob: new Blob(['100x50']) };
    const f = makePorts(state);
    const store = new BackgroundSkinStore(f.ports);
    await store.ensureLoaded();
    const before = store.getSnapshot();

    await expect(store.setImage(new Blob(['not-dims']))).rejects.toThrow('decode boom');
    // 内存态未被污染（旧图仍在）
    expect(store.getSnapshot().image).toBe(before.image);
    // 链条未断：下一次有效上传照常工作
    await store.setImage(new Blob(['64x64']));
    expect(store.getSnapshot().image!.width).toBe(64);
  });

  it('装载异常（IndexedDB 打不开）：静默降级为 ready+null，不抛错', async () => {
    const f = makePorts({ blob: null, failLoad: true });
    const store = new BackgroundSkinStore(f.ports);
    const warn = console.warn;
    console.warn = () => {}; // 吞掉降级告警输出
    try {
      await expect(store.ensureLoaded()).resolves.toBeUndefined();
    } finally {
      console.warn = warn;
    }
    const snap = store.getSnapshot();
    expect(snap.status).toBe('ready');
    expect(snap.image).toBeNull();
  });

  it('默认单例可构造且 subscribe 可退订（浏览器接线的冒烟）', () => {
    const listener = () => {};
    const off = backgroundSkinStore.subscribe(listener);
    off();
    expect(typeof backgroundSkinStore.getSnapshot().revision).toBe('number');
  });
});

describe('issue 117 · Electron 背景图文件 persist（桥注入）', () => {
  it('文件已有字节则不读 IndexedDB', async () => {
    const persist = createElectronBackgroundPersist(
      {
        get: async () => new Uint8Array([9, 8]),
        put: async () => { throw new Error('must not put'); },
        clear: async () => {},
      },
      { load: async () => new Blob(['idb']) },
    );
    const blob = await persist.load();
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(new Uint8Array([9, 8]));
  });

  it('文件为空时从旧存储迁入一次，绝不覆盖已有文件', async () => {
    let disk: Uint8Array | null = null;
    const puts: Uint8Array[] = [];
    const persist = createElectronBackgroundPersist(
      {
        get: async () => disk,
        put: async (bytes) => {
          puts.push(bytes);
          disk = bytes;
        },
        clear: async () => { disk = null; },
      },
      { load: async () => new Blob([new Uint8Array([1, 2, 3])]) },
    );
    const first = await persist.load();
    expect(Array.from(new Uint8Array(await first!.arrayBuffer()))).toEqual([1, 2, 3]);
    expect(puts).toHaveLength(1);
    await persist.load();
    expect(puts).toHaveLength(1);
  });
});

// ---------------- 3) settings 开关位归一化 ----------------

const storageWith = (json: string | null) => ({ getItem: () => json } as Storage);

describe('settings.visual.backgroundSkin（additive：开关 + 不透明度 + 填充方式 + 显示范围）', () => {
  it('默认设置：enabled=false，opacity=0.55，fit=cover，scope=outsideTrack', () => {
    const d = defaultSettings().visual.backgroundSkin;
    expect(d?.enabled).toBe(false);
    expect(d?.opacity).toBe(DEFAULT_BACKGROUND_OPACITY);
    expect(d?.fit).toBe(DEFAULT_BACKGROUND_FIT);
    expect(d?.scope).toBe(DEFAULT_BACKGROUND_SCOPE);
  });

  it('缺字段/旧存档（仅 enabled，甚至无 visual.backgroundSkin）：逐字段补默认值', () => {
    const s = loadSettings(storageWith(JSON.stringify({ schemaVersion: 1, visual: { backgroundSkin: { enabled: true } } })));
    const bg = s.visual.backgroundSkin!;
    expect(bg.enabled).toBe(true);
    expect(bg.opacity).toBe(DEFAULT_BACKGROUND_OPACITY);
    expect(bg.fit).toBe('cover');
    expect(bg.scope).toBe('outsideTrack');
  });

  it('非法值回退：enabled 垃圾值 → false；opacity 越界夹取；fit/scope 白名单外 → 默认', () => {
    const s = loadSettings(storageWith(JSON.stringify({
      schemaVersion: 1,
      visual: { backgroundSkin: { enabled: 'yes', opacity: 'oops', fit: 'tile', scope: 'everywhere' } },
    })));
    const bg = s.visual.backgroundSkin!;
    expect(bg.enabled).toBe(false);
    expect(bg.opacity).toBe(DEFAULT_BACKGROUND_OPACITY);
    expect(bg.fit).toBe(DEFAULT_BACKGROUND_FIT);
    expect(bg.scope).toBe(DEFAULT_BACKGROUND_SCOPE);

    const hi = loadSettings(storageWith(JSON.stringify({ schemaVersion: 1, visual: { backgroundSkin: { enabled: true, opacity: 3, fit: 'contain', scope: 'fullCanvas' } } })));
    expect(hi.visual.backgroundSkin?.opacity).toBe(1);
    expect(hi.visual.backgroundSkin?.fit).toBe('contain');
    expect(hi.visual.backgroundSkin?.scope).toBe('fullCanvas');
  });

  it('updateSettings/patch 合并语义：单字段写入不丢兄弟字段（含 noteSkin 隔离）', () => {
    const base = defaultSettings();
    const seeded = updateSettings(base, { visual: { backgroundSkin: { enabled: true, opacity: 0.8, fit: 'contain', scope: 'fullCanvas' } } });
    expect(seeded.visual.backgroundSkin).toEqual({ enabled: true, opacity: 0.8, fit: 'contain', scope: 'fullCanvas' });

    // 模拟 ConfigContext.setBackgroundSkin 的合并：prev 展开再覆盖单字段
    const offOnly = { ...seeded.visual.backgroundSkin!, ...{ enabled: false } };
    expect(offOnly).toEqual({ enabled: false, opacity: 0.8, fit: 'contain', scope: 'fullCanvas' }); // 关灯不重置其他项
    const opOnly = { ...seeded.visual.backgroundSkin!, ...{ opacity: 1 } };
    expect(opOnly).toEqual({ enabled: true, opacity: 1, fit: 'contain', scope: 'fullCanvas' });

    // noteSkin 与 backgroundSkin 互不干扰
    const thenNoteSkin = updateSettings(seeded, { visual: { noteSkin: { tap: 'skin03' } } });
    expect(thenNoteSkin.visual.noteSkin.tap).toBe('skin03');
    expect(thenNoteSkin.visual.backgroundSkin?.enabled).toBe(true);
    expect(thenNoteSkin.visual.backgroundSkin?.scope).toBe('fullCanvas');
  });
});
