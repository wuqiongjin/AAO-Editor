// 键音素材包注册表单测（issue 29 多款入库 + 删占位）：
// 验证生成注册表的包清单、历史持久化 id 的归一化回落、包采样加载完整性与 memoize。
import { describe, it, expect } from 'vitest';
import { hasAssetSnapshot } from '@/tests/support/assetSnapshot';
import {
  KEY_SOUND_SETS,
  DEFAULT_ACTIVE_KEY_SOUND_SET_ID,
  keySoundSetEntryById,
  isKnownKeySoundSetId,
  loadKeySoundSet,
  KEY_SOUND_DEFAULT_TONES,
} from '@/src/audio/KeySound';
import { KEY_SOUND_KINDS } from '@/src/audio/KeySoundMeta';
import { loadSettings } from '@/src/chart/config/AppSettings';
import { settingsStorageOf as storageWith } from '@/tests/support/storage';

describe('KeySound 注册表（skin00–03 普通包入库）', () => {
  // 守约用例：钉的是构建脚本产出的真实快照包清单（官方普通包 skin00–03）。
  // 无快照环境（PR 门禁走最小合法桩，release-pipeline 10）跳过；push / tag_push 门禁有真快照，全量执行。
  it.skipIf(!hasAssetSnapshot)('注册表收录官方普通包 skin00–03，默认激活 skin00', () => {
    expect(KEY_SOUND_SETS.map((s) => s.id)).toEqual(['skin00', 'skin01', 'skin02', 'skin03']);
    expect(DEFAULT_ACTIVE_KEY_SOUND_SET_ID).toBe('skin00');
  });

  it('历史持久化 id（占位包/旧官方包/未知）回落默认包', () => {
    // 占位包已删除：'placeholder' 不再是合法 id，但持久化值必须安全回落
    expect(isKnownKeySoundSetId('placeholder')).toBe(false);
    expect(isKnownKeySoundSetId('bangdream')).toBe(false);
    expect(isKnownKeySoundSetId('skin01')).toBe(true);
    expect(keySoundSetEntryById('placeholder').id).toBe('skin00');
    expect(keySoundSetEntryById('bangdream').id).toBe('skin00'); // 旧官方包 == skin00（采样同源，已核实）
    expect(keySoundSetEntryById('nope').id).toBe('skin00');
  });

  it('振荡器兜底音色覆盖全部 5 种击打样式', () => {
    for (const kind of KEY_SOUND_KINDS) {
      expect(KEY_SOUND_DEFAULT_TONES[kind].frequency).toBeGreaterThan(0);
      expect(KEY_SOUND_DEFAULT_TONES[kind].oscillatorType).toBeTruthy();
    }
  });

  // 守约用例：钉的是构建期真实采样结构（data-URI 内联、方向键 1..3 分档）。
  // 无快照环境（PR 门禁走最小合法桩，release-pipeline 10）跳过；push / tag_push 门禁有真快照，全量执行。
  it.skipIf(!hasAssetSnapshot)('loadKeySoundSet：5 类击打样式全部为真实采样（方向键 1..3 分档），同 id memoize', async () => {
    for (const entry of KEY_SOUND_SETS) {
      const set = await loadKeySoundSet(entry.id);
      expect(set.id).toBe(entry.id);
      for (const kind of KEY_SOUND_KINDS) {
        const sample = set.samples[kind];
        if (kind === 'directional') {
          expect(Object.keys(sample.tierSrcs ?? {}).length).toBe(3); // 1/2/3 档齐全
        } else {
          expect(sample.src?.startsWith('data:audio')).toBe(true); // issue 20：内联 data-URI，无 .mp3 请求
        }
      }
      // memoize：重复加载返回同一实例
      expect(await loadKeySoundSet(entry.id)).toBe(set);
    }
  });
});

describe('settings.audio.keySet 持久化归一化（删占位包迁移）', () => {
  
  it('历史脏值（placeholder/bangdream/未知）→ 回落默认包 skin00', () => {
    for (const legacy of ['placeholder', 'bangdream', 'nope']) {
      const s = loadSettings(storageWith({ schemaVersion: 1, audio: { keySet: legacy } }));
      expect(s.audio.keySet).toBe('skin00');
    }
  });

  it('合法 id（skin02）原样保留', () => {
    const s = loadSettings(storageWith({ schemaVersion: 1, audio: { keySet: 'skin02' } }));
    expect(s.audio.keySet).toBe('skin02');
  });
});
