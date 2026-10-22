// issue 49 · ADR-0018 §6：gen 注册表 skinName 契约的形状锁。
//
// gen 注册表本体由素材取件侧产出、不入本仓（release-pipeline 02），本仓唯一「API 同真产物」
// 的产物是 PR 门禁桩（scripts/ci/ci-stub-gen.mjs）——桩不带该字段，无快照环境跑的行为
// 测试验证的就是另一套 API。另锁应用侧消费点只经 skinDisplayName 查表：官方名不进
// i18n 消息表（那正是本次要消灭的「自维护映射」；背景包 6 个手写名是刻意的例外）。
import { describe, expect, it } from 'vitest';
import { readSource, readStripped } from '@/tests/support/source';

describe('issue 49 · 皮肤显示名契约（gen 注册表 skinName 五服命名）', () => {
  it('门禁桩四个注册表接口都声明 skinName（API 同真产物；可选 = 旧快照可缺）', () => {
    const stub = readStripped('scripts/ci/ci-stub-gen.mjs');
    // note / directional / sim field / sim background 四个 entry 接口
    expect(stub.match(/skinName\?: string\[\]/g)).toHaveLength(4);
  });

  it('门禁桩四类 entry 都带 skinName 数据（行为测试在无快照环境也走得到显示名路径）', () => {
    const stub = readStripped('scripts/ci/ci-stub-gen.mjs');
    expect(stub.match(/skinName: \[/g)).toHaveLength(4);
    // 五服原样 [jp, en, tw, cn, kr] 的长度形状
    for (const m of stub.matchAll(/skinName: \[([^\]]*)\]/g)) {
      expect(m[1]!.split(',').length).toBe(5);
    }
  });

  it('应用侧消费点经 skinDisplayName 查表（纯查表、不联网、不走 i18n 消息表）', () => {
    // 选服与回落逻辑收敛在 skinDisplayName.ts 一处（packDisplayName），两域入口各自定 fallback
    expect(readStripped('src/rendering/skin/noteSkin.ts')).toContain('packDisplayName');
    expect(readStripped('src/preview/video/sim/simAssetPacks.ts')).toContain('packDisplayName');
    expect(readStripped('src/pages/preview/PreviewDisplayPanel.tsx')).toContain('simPackDisplayName');
    // 官方名不进消息表（防回退成「69 个包 × 2 语言建 key」的自维护映射）
    expect(readSource('src/i18n/messages/zh-CN.json')).not.toMatch(/按键条皮肤|TYPE[1-7]/);
  });
});
