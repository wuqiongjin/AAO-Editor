// issue 152 锁测：画布旗帜与右侧卡片**共享同一份 SVG**、回跳派发接线在、
// 回跳路径不再做拍→秒换算。这些都是"组件接线 / 资源复用"，单测碰不到，
// 故按 EditorAudioSessionRefactor 的惯例用静态源码断言看守。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { repoRoot } from '@/tests/support/source';

const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf-8');
const strip = (s: string) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

const canvas = strip(read('src/chart/components/canvas/FinalVirtualCanvas.tsx'));
const card = strip(read('src/playback/PlaybackMarkerCard.tsx'));
const coordinator = strip(read('src/playback/usePlaybackCoordinator.ts'));
const editor = strip(read('src/pages/workspace/WorkspacePage.tsx'));

const SVG_SPEC = 'assets/playback-marker/flag.svg';

describe('播放起点共享 SVG 资源（issue 152 锁测）', () => {
  it('画布旗帜与状态卡片引入同一个 SVG 文件', () => {
    expect(canvas).toContain(SVG_SPEC);
    expect(card).toContain(SVG_SPEC);
  });

  it('两处都是 ?url 引入（走浏览器解码缓存，不逐帧解析 SVG）', () => {
    expect(canvas).toMatch(/flag\.svg\?url/);
    expect(card).toMatch(/flag\.svg\?url/);
  });

  it('卡片秒数与播放条同口径（复用 TimeFormat.formatTimePrecise，不自己 toFixed）', () => {
    expect(card).toContain('formatTimePrecise');
    expect(card).not.toMatch(/toFixed/);
  });

  it('卡片尺寸取自 playbackMarker 常数（真源唯一，不在 CSS/组件里另抄一份）', () => {
    expect(card).toContain('PLAYBACK_MARKER_CARD_WIDTH');
    expect(card).toContain('PLAYBACK_MARKER_CARD_HEIGHT');
    expect(canvas).toContain('PLAYBACK_MARKER_LAYOUT');
    expect(canvas).toContain('PLAYBACK_MARKER_CLIP_PATH');
  });
});

describe('回跳播放接线（ADR-0004 §4 / issue 152）', () => {
  it('jumpToMarker 直接 seek 起点的秒数，不再做拍→秒换算', () => {
    const body = coordinator.slice(
      coordinator.indexOf('const jumpToMarker'),
      coordinator.indexOf('const changeDuration'),
    );
    expect(body).toContain('getMarkerSeconds');
    expect(body).toContain('seek(seconds)');
    expect(body).not.toContain('beatToSeconds');
  });

  it('回跳复用 seek（继承 duration 夹取与滚动条同源写入，issue 75）', () => {
    const body = coordinator.slice(
      coordinator.indexOf('const jumpToMarker'),
      coordinator.indexOf('const changeDuration'),
    );
    expect(body).toContain('startPlayback()');
    expect((coordinator.match(/scrollTargetForSeconds/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('播放启动只有一份（togglePlay / jumpToMarker 共用 startPlayback）', () => {
    expect((coordinator.match(/engine\.play\(\)/g) ?? []).length).toBe(1);
    expect(coordinator).toContain('const startPlayback = useCallback(');
  });

  it('快捷键派发注册了 jumpToMarker', () => {
    expect(editor).toMatch(/case 'jumpToMarker':\s*jumpToMarker\(\)/);
  });
});
