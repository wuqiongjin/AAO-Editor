// 票 22–25：预览栏布局与三态的防回潮网（CSS 事实 → 静态源码断言）。
//
// 为什么是静态源码断言：图标几何居中（padding:0 拿回正圆）、min-width 抑制、line-height 钉死
// 都是布局引擎才看得到的像素事实 —— jsdom 无布局引擎、不加载外部 CSS。
// 像素结论（dx≈0 / dy=0 / 两态芯片恒 22px）走票内 Playwright 人工验收（原型已量）。
import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

const projectsCss = readStripped('src/pages/projects/ProjectsPage.css');
const uiCss = readStripped('src/ui/ui.css');
const panelSrc = readStripped('src/pages/projects/components/OfficialSongPanel.tsx');
const thumbSrc = readStripped('src/pages/projects/components/OfficialSongThumb.tsx');
const compactAudioSrc = readStripped('src/ui/CompactAudio.tsx');

describe('票 22 · 试听条（音量内嵌 + 图标居中 + 音频三态）', () => {
  it('播放钮 padding:0（UA 默认 1px 6px 会把 24×24 内容盒挤到 12px，图标贴左缘）', () => {
    expect(uiCss).toMatch(/\.off-compact-audio__play\s*\{[^}]*padding:\s*0/);
  });

  it('Play 三角 -1px 光学校正只挂在 Play 图标上（Pause 本身居中）', () => {
    expect(uiCss).toMatch(/\.off-compact-audio__nudge\s*\{[^}]*margin-left:\s*-1px/);
    expect(compactAudioSrc).toMatch(/<Play[^>]*className="off-compact-audio__nudge"/);
    expect(compactAudioSrc).not.toMatch(/<Pause[^>]*off-compact-audio__nudge/);
  });

  it('.off-compact-audio 必须 min-width:0（音量组把 min-content 抬到 ~218，不加会撑破 300px 栏宽）', () => {
    expect(uiCss).toMatch(/\.off-compact-audio\s*\{[^}]*min-width:\s*0/);
  });

  it('音量走 props（数据入口全走 props，同 PlayBar 惯例），面板经 useConfig 接 settings.audio.volume', () => {
    expect(compactAudioSrc).toMatch(/volume(?::|\s*=)/);
    expect(compactAudioSrc).toMatch(/onVolumeChange/);
    expect(panelSrc).toMatch(/settings\.audio\.volume/);
    expect(panelSrc).toMatch(/onVolumeChange=\{setAudioVolume\}/);
  });

  it('音量 0 时图标切 VolumeX；音量滑条 aria-label 走 play.volume', () => {
    expect(compactAudioSrc).toMatch(/muted\s*=+\s*volume <= 0/);
    expect(compactAudioSrc).toMatch(/<VolumeX/);
    expect(compactAudioSrc).toMatch(/aria-label=\{t\('play\.volume'\)\}/);
  });

  it('音频三态在按钮位呈现：加载 spinner（off-spin）/ 失败 RotateCcw 重试 / 正常 Play-Pause', () => {
    expect(uiCss).toMatch(/\.off-compact-audio__spin\s*\{/);
    expect(compactAudioSrc).toMatch(/<RotateCcw/);
    expect(compactAudioSrc).toMatch(/onLoadedMetadata/);
    expect(compactAudioSrc).toMatch(/onWaiting/);
  });

  it('重试 = 重挂 <audio>（key nonce）+ 通知调用方重走降级链；面板把 audioUseDirect 打回 false', () => {
    expect(compactAudioSrc).toMatch(/key=\{srcNonce\}/);
    expect(compactAudioSrc).toMatch(/onRetry/);
    expect(panelSrc).toMatch(/onRetry=\{\(\) => \{\s*setAudioUseDirect\(false\);/);
  });
});

describe('票 23 · 预览栏布局（300px / 封面居中 / 芯片 line-height / 试听条进 stack）', () => {
  it('栏宽 300px；820px 媒体查询引用同一变量（不许再写死 260px）', () => {
    expect(projectsCss).toMatch(/\.off-preview\s*\{[^}]*max-width:\s*var\(--off-preview-w\)/);
    expect(projectsCss).not.toMatch(/max-width:\s*260px/);
  });

  it('整摞居中：stack align-items:center + 封面居中放大 180px + 标题/歌手/芯片行居中', () => {
    expect(projectsCss).toMatch(/\.off-preview__stack\s*\{[^}]*align-items:\s*center/);
    expect(projectsCss).toMatch(/\.off-cover\s*\{[^}]*align-self:\s*center/);
    expect(projectsCss).toMatch(/\.off-cover\s*\{[^}]*max-width:\s*180px/);
    expect(projectsCss).toMatch(/\.off-preview__title\s*\{[^}]*text-align:\s*center/);
    expect(projectsCss).toMatch(/\.off-preview__artist\s*\{[^}]*text-align:\s*center/);
    expect(projectsCss).toMatch(/\.off-preview__levels\s*\{[^}]*justify-content:\s*center/);
  });

  it('芯片钉 line-height:14px（✓ 的回退字体行盒高 1px，经 stretch 传染整行把同步开关顶下 1px）', () => {
    expect(projectsCss).toMatch(/\.off-preview__levels button\s*\{[^}]*line-height:\s*14px/);
  });

  it('试听条移进 stack（自然流最后一项）且只许 align-self:stretch，不许 width:100%（300→318 陷阱）', () => {
    expect(projectsCss).toMatch(/\.off-preview__stack \.off-compact-audio\s*\{[^}]*align-self:\s*stretch/);
    expect(projectsCss).not.toMatch(/\.off-preview__stack \.off-compact-audio\s*\{[^}]*width:\s*100%/);
    // 骨架占位与真条同槽位（都在 stack 里）
    expect(panelSrc).toMatch(/off-preview__stack"[\s\S]*off-compact-audio is-skeleton[\s\S]*<CompactAudio/);
  });
});

describe('票 24 · 封面三态 + LoadingShimmer', () => {
  it('共享微光组件存在，关键帧上收 ui.css；缩略图与试听骨架复用它', () => {
    expect(uiCss).toMatch(/\.loading-shimmer\s*\{/);
    expect(uiCss).toMatch(/@keyframes off-thumb-shimmer/);
    expect(projectsCss).not.toMatch(/@keyframes off-thumb-shimmer/);
    expect(thumbSrc).toMatch(/<LoadingShimmer/);
    expect(panelSrc).toMatch(/import LoadingShimmer/);
  });

  it('spinner 与微光层平级（各自绝对定位居中），不做微光层子元素（整层 translateX 会带着它横移）', () => {
    // spinner 在 LoadingShimmer 的兄弟位置（同一 fragment），且 inset:0 + margin:auto 居中
    expect(projectsCss).toMatch(/\.off-cover__spin\s*\{[^}]*inset:\s*0[^}]*margin:\s*auto/);
    expect(panelSrc).toMatch(/<LoadingShimmer \/>\s*<i className="off-cover__spin"/);
  });

  it('失败态整块可点重试（key nonce 强制重挂 img 重走降级链）；无封面只出裸图标', () => {
    expect(projectsCss).toMatch(/\.off-cover__retry\s*\{/);
    expect(panelSrc).toMatch(/className="off-cover__retry"/);
    expect(panelSrc).toMatch(/key=\{coverNonce\}/);
    expect(panelSrc).toMatch(/jacketImage === ''\s*\?\s*\(/);
  });

  it('重试入口只由 onError 触达（飞行中重挂同 URL 资源会永久挂死，ADR-0018 §3）', () => {
    // retryCover 只出现在失败态分支与定义处，加载分支没有「强制重挂」
    expect(panelSrc).toMatch(/const retryCover = useCallback/);
  });
});

describe('票 25 · 同步开关不再禁用闪断', () => {
  it('删掉 detail 门禁：无 disabled / aria-busy / is-loading；骨架微光收窄到试听条槽位', () => {
    expect(panelSrc).not.toMatch(/aria-busy/);
    expect(panelSrc).toMatch(/className=\{`off-sync\$\{withChart \? ' is-on' : ''\}`\}/);
    expect(projectsCss).not.toMatch(/\.off-sync\.is-loading/);
  });
});
