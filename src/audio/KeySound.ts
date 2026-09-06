// 键音素材包（ADR-0004 §7 修订 + issue 29 多款入库 2026-09-06）：按"击打样式"分类，不做 per-lane 音高。
// 包数据由构建脚本生成：scripts/build-key-sounds.mjs → gen/keySoundRegistry.gen.ts。
//   - 官方普通键音包 skin00–03（skin00 = 游戏默认；联动/限定包暂不收录，改脚本 PACKS 清单即可扩容）；
//   - 每包差异采样（tap/slide/flick）经动态 import 独立 JS chunk 懒下载；共享采样（skill/directional）静态内联。
// 真实音频仍以 Vite `?inline` 内联为 base64 data-URI（issue 20）：**不产生任何 .mp3 网络请求**，
// 从而规避浏览器下载插件（如 IDM）劫持 fetch 导致的无声/弹下载，且 web/Electron 都可靠可用。
// 方向键（LDirectional/RDirectional）按组合长度 length(1..3) 分 3 档音效。
// "占位"振荡器包已删除（2026-09-06 用户拍板）：历史持久化 id（'placeholder'/'bangdream'）经
// keySoundSetEntryById 归一化与 settings normalize 回落为默认包；振荡器仅保留为采样缺失/加载失败兜底。
import { GENERATED_KEY_SOUND_PACKS } from './gen/keySoundRegistry.gen';

export type KeySoundKind = 'tap' | 'flick' | 'skill' | 'slide' | 'directional';

/** 单个采样的规格：真实音频（src/tierSrcs，Vite 内联 data-URI）或振荡器兜底（frequency/oscillatorType） */
export interface KeySoundSample {
  /** 真实音频资源（issue 20：Vite `?inline` 内联 data-URI，无 .mp3 网络请求）；缺省走振荡器兜底 */
  src?: string;
  /** 方向键专用：按组合长度 length(1..3) 分档 → 采样（data-URI） */
  tierSrcs?: Record<number, string>;
  // 振荡器兜底参数（无 src 或采样未加载时使用；缺省取 KEY_SOUND_DEFAULT_TONES）
  frequency?: number;
  oscillatorType?: OscillatorType;
}

/** 素材包（已加载完成态：全部样为本包差异采样 + 共享采样） */
export interface KeySoundSet {
  id: string;
  label: string;
  samples: Record<KeySoundKind, KeySoundSample>;
}

/** 素材包注册表条目：静态元数据 + 异步加载（动态 import 本包 chunk；经 loadKeySoundSet memoize） */
export interface KeySoundSetEntry {
  id: string;
  label: string;
  load(): Promise<KeySoundSet>;
}

/** 素材包注册表（构建脚本生成；默认包 = 第一个条目） */
export const KEY_SOUND_SETS: KeySoundSetEntry[] = GENERATED_KEY_SOUND_PACKS;

const DEFAULT_ENTRY = GENERATED_KEY_SOUND_PACKS[0];

/** 默认激活素材包 id（官方默认键音包；旧值 'bangdream'/'placeholder' 均归一化回落至此） */
export const DEFAULT_ACTIVE_KEY_SOUND_SET_ID = DEFAULT_ENTRY.id;

/** 振荡器兜底音色（原"占位"包参数）：采样缺失、chunk 下载失败或解码失败时保证按键有反馈声 */
export const KEY_SOUND_DEFAULT_TONES: Record<
  KeySoundKind,
  { frequency: number; oscillatorType: OscillatorType }
> = {
  tap: { frequency: 880, oscillatorType: 'square' },
  flick: { frequency: 1320, oscillatorType: 'square' },
  skill: { frequency: 660, oscillatorType: 'square' },
  slide: { frequency: 1100, oscillatorType: 'triangle' },
  directional: { frequency: 990, oscillatorType: 'square' },
};

/** 按 id 查注册表条目；未知 id（含历史 'placeholder'/'bangdream'）回落默认包 */
export const keySoundSetEntryById = (id: string): KeySoundSetEntry =>
  KEY_SOUND_SETS.find((s) => s.id === id) ?? DEFAULT_ENTRY;

/** id 是否命中注册表（settings 归一化用：未知值回落默认包，避免持久化脏 id） */
export const isKnownKeySoundSetId = (id: string): boolean =>
  KEY_SOUND_SETS.some((s) => s.id === id);

// 包加载缓存：id → in-flight/已完成 Promise（切换包与试听共享一次动态 import）
const packPromises = new Map<string, Promise<KeySoundSet>>();

/** 加载素材包（首触发动态 chunk 下载，之后内存复用；失败不缓存、允许重试） */
export function loadKeySoundSet(id: string): Promise<KeySoundSet> {
  const entry = keySoundSetEntryById(id);
  const existing = packPromises.get(entry.id);
  if (existing) return existing;
  const p = entry.load();
  packPromises.set(entry.id, p);
  p.catch(() => packPromises.delete(entry.id));
  return p;
}
