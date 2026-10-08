// chart-preview 22 的静态锁：播放条复用的**结构性事实** —— DOM 测试能证明"控件接到了回放上"，
// 证明不了"是不是同一件实现、有没有第二份抄写"。
//
// 手法照 PlayBarProgressFill / PreviewPageWiring：读源码、剥注释后断言。
import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

describe('chart-preview 22 · 预览播放条复用工作台 PlayBar', () => {
  const stage = readStripped('src/pages/preview/PreviewVideoStage.tsx');
  const bar = readStripped('src/playback/PlayBar.tsx');
  const ws = readStripped('src/pages/workspace/WorkspacePage.tsx');

  it('预览条是工作台同一件 PlayBar（preview 变体 + 倍速 slot），不再自带第二份时间码编辑实现', () => {
    expect(stage).toMatch(/import PlayBar from '\.\.\/\.\.\/playback\/PlayBar'/);
    expect(stage).toMatch(/<PlayBar[\s\S]*?variant="preview"/);
    expect(stage).toMatch(/rateSlot=\{/);
    // 时间码编辑（解析 / 草稿 / 提交）只有 PlayBar 一份：预览层不许再出现第二份
    expect(stage).not.toMatch(/parseTimeInput/);
    expect(stage).not.toMatch(/editingTime|timeDraft|play-bar__time-input/);
    // 拖拽 seek（指针捕获状态机）同样只有一份
    expect(stage).not.toMatch(/setPointerCapture/);
    // 旧的 pv-bar 一族类名整体退场（外壳与子件样式都由 PlayBar.css 承担）
    expect(stage).not.toMatch(/pv-bar/);
  });

  it('PlayBar 是纯受控件：不直读 context，倍速走 slot（两处配置各自接线）', () => {
    expect(bar).not.toMatch(/usePlayback|useAudioSession|useConfig/);
    expect(bar).not.toMatch(/PLAYBACK_RATE|pv-rate|Gauge/);
    expect(bar).toMatch(/variant = 'workspace'/); // 默认 = 工作台页底栏
    expect(bar).toMatch(/play-bar--\$\{variant\}/); // 外壳两档变体由它自己拼
  });

  it('工作台接线：数据入口逐条显式传入（票 22「拨接不变」的可读版本）', () => {
    expect(ws).toMatch(/isPlaying=\{ctxIsPlaying\}/);
    expect(ws).toMatch(/currentSeconds=\{playheadSeconds\}/);
    expect(ws).toMatch(/duration=\{ctxDuration\}/);
    expect(ws).toMatch(/volume=\{ctxVolume\}/);
    expect(ws).toMatch(/audioLocked=\{audioSnap\.audioLocked\}/);
    // 行为口径保持：有音频禁止编辑定位（Q3 只放开预览）；播放中掩手形光标照旧
    expect(ws).toMatch(/canEditTime=\{!canPlay\}/);
    expect(ws).toMatch(/seekNoCursor=\{!canPlay && ctxIsPlaying\}/);
    expect(ws).toMatch(/shortcutKey=\{formatKey\(shortcutConfig\.play\)\}/);
  });

  it('预览页只接管 play 这一个功能键（Q2），其余绑定放行原生行为', () => {
    expect(stage).toMatch(/only: PLAY_ONLY/);
    expect(stage).toMatch(/const PLAY_ONLY: readonly FunctionId\[\] = \['play'\]/);
  });
});
