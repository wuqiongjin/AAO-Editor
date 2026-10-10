// chart-preview 07 落点锁：视频导出的**接线事实**（DOM 测不到、端到端才测得动的那几条）。
//
// 手法照 PreviewBinarySaveWiring.test.ts：读源码做字符串断言。锁的是票面的四条硬约定：
//   ① 导出只经 05 的出帧函数（`drawSimFrameAt`）——**不开第二份渲染真相**；
//   ② 离线音轨不另立音量 / 调度口径（采样与包络都从 `audio/keySoundSamples` 来）；
//   ③ 落盘只走 03 建的二进制通道（`saveBinaryAs`），不为视频新开一条；
//   ④ 新增依赖在 `package.json` 可见，且按容器**动态 import**（只付一份体积）。
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSource, readStripped, repoRoot } from '@/tests/support/source';

const ENCODE_DIR = 'src/preview/video/encode';

/** `encode/` 下全部 .ts（不含 index barrel 也一起扫，它只做导出） */
function encodeFiles(dir: string = ENCODE_DIR): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(repoRoot, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(repoRoot, rel)).isDirectory()) out.push(...encodeFiles(rel));
    else if (/\.ts$/.test(entry)) out.push(rel);
  }
  return out;
}

const file = (name: string) => readStripped(`${ENCODE_DIR}/${name}`);
const frameDriver = file('frameDriver.ts');
const muxer = file('muxer.ts');
const renderAudio = file('renderAudioTrack.ts');
const exportVideo = file('exportVideo.ts');
const exportSpec = file('exportSpec.ts');
const page = readStripped('src/pages/preview/PreviewPage.tsx');
const control = readStripped('src/pages/preview/VideoExportControl.tsx');
const engine = readStripped('src/audio/AudioEngine.ts');
const keySamples = readStripped('src/audio/keySoundSamples.ts');
const main = readStripped('electron/main.cjs');
const pkg = readSource('package.json');

describe('07 · 画面只经 05 的出帧函数（不开第二份渲染真相）', () => {
  // 30 起开场段占掉时间轴最前面那段 ⇒ 谱面秒 = 视频秒 − 开场长度（关掉开场时减 0）
  it('frameDriver 逐帧调 drawSimFrameAt（05 的同一份任意秒出帧）', () => {
    expect(frameDriver).toMatch(/drawSimFrameAt\(ctx, input, t - \(req\.openingSeconds \?\? 0\)\)/);
  });

  it('开场段的画面不进 drawSimFrameAt（③ / ④ 走场地的分层绘制）', () => {
    expect(frameDriver).toMatch(/openingSegmentAt\(t\)/);
    expect(frameDriver).toMatch(/drawOpeningFieldBackground\(/);
    expect(frameDriver).toMatch(/drawOpeningTrack\(/);
  });

  it('frameDriver 不自己画场地 / 音符 / 特效（只有铺留边那一笔 fillRect）', () => {
    expect(frameDriver).not.toMatch(/drawImage\(/);
    expect(frameDriver).not.toMatch(/spriteIcon\.render/);
    expect(frameDriver).not.toMatch(/createPanelPainter|renderChart|renderDecorator/);
    expect(frameDriver).not.toMatch(/createLinearGradient/);
    // 铺底那一笔是"留边不透明"（H.264 没有 alpha 通道），不是第二套画笔
    expect(frameDriver).toMatch(/ctx\.fillRect\(0, 0, geometry\.width, geometry\.height\)/);
  });

  it('encode/ 里 drawSimFrameAt 只出现一次（唯一的出帧入口）', () => {
    const hits = encodeFiles()
      .map((rel) => readStripped(rel))
      .filter((src) => src.includes('drawSimFrameAt('));
    expect(hits.length).toBe(1);
  });

  it('编排层用 05 的谱面派生表（buildSimChart），不自己把谱面折成元素', () => {
    expect(exportVideo).toMatch(/buildSimChart\(req\.scene, noteIcons\)/);
    expect(exportVideo).not.toMatch(/type: 'Single'/);
  });

  it('逐帧循环分片让出主线程（与宽图导出同一份原语）', () => {
    expect(frameDriver).toMatch(/yieldToMainThread\(\)/);
    expect(frameDriver).toMatch(/from '\.\.\/\.\.\/static\/exportPanels'/);
  });
});

describe('07 · 离线音轨不另立音量 / 调度口径', () => {
  it('事件表由编排层用 AudioTiming.buildKeyEvents 建（与引擎 setChart 同源）', () => {
    expect(exportVideo).toMatch(/buildKeyEvents\(req\.scene\.notes, req\.scene\.beatDisplay, getBpmEvents\(req\.scene\.notes\)\)/);
  });

  it('采样加载与发声都从 audio/keySoundSamples 来（不写第二份包络 / 取文件规则）', () => {
    expect(renderAudio).toMatch(/from '\.\.\/\.\.\/\.\.\/audio\/keySoundSamples'/);
    expect(renderAudio).toMatch(/keySoundBank\.load\(/);
    expect(renderAudio).toMatch(/scheduleKeySample\(/);
    expect(renderAudio).toMatch(/scheduleKeyTone\(/);
    expect(renderAudio).toMatch(/sampleSrcFor\(/);
    // 兜底音的参数与包络只在 keySoundSamples 里定义一次
    expect(renderAudio).not.toMatch(/KEY_SOUND_DEFAULT_TONES/);
    expect(renderAudio).not.toMatch(/oscillatorType/);
  });

  it('音量链与实时同构：BGM → master(volume) → destination，键音 → se(seVolume) → master', () => {
    expect(renderAudio).toMatch(/se\.connect\(master\)/);
    expect(renderAudio).toMatch(/master\.gain\.value = Math\.max\(0, Math\.min\(1, req\.volume\)\)/);
    expect(renderAudio).toMatch(/se\.gain\.value = Math\.max\(0, Math\.min\(1, req\.seVolume\)\)/);
  });

  it('AudioEngine 已改用共享采样模块（票面「接缝」：不再是 private 的 sampleCache / loadSample）', () => {
    expect(engine).toMatch(/from '\.\/keySoundSamples'/);
    expect(engine).toMatch(/keySoundBank/);
    expect(engine).not.toMatch(/sampleCache/);
    expect(engine).not.toMatch(/private async loadSample/);
  });

  it('采样 / 包络 / 取文件规则在 keySoundSamples 里各只定义一份', () => {
    expect(keySamples).toMatch(/export function sampleSrcFor\(/);
    expect(keySamples).toMatch(/export function scheduleKeySample\(/);
    expect(keySamples).toMatch(/export function scheduleKeyTone\(/);
    expect(keySamples).toMatch(/export const keySoundBank/);
  });

  it('不落中间音轨文件（内存里直接喂 AudioEncoder）', () => {
    expect(renderAudio).not.toMatch(/toBlob|showSaveDialog|writeFile/);
    expect(renderAudio).toMatch(/ctx\.startRendering\(\)/);
  });
});

describe('07 · 落盘只走既有二进制通道', () => {
  it('编码完交给 saveBinaryAs（03 建的通道），不为视频新开一条', () => {
    expect(exportVideo).toMatch(/from '\.\.\/\.\.\/static\/saveBinary'/);
    expect(exportVideo).toMatch(/await saveBinaryAs\(\{/);
    expect(exportVideo).not.toMatch(/a\.click\(\)/);
    expect(exportVideo).not.toMatch(/createObjectURL/);
    expect(exportVideo).not.toMatch(/showSaveDialog|writeFile/);
  });

  it('Electron 侧：同一条 preview:saveBinary，只给 binaryFilter 补了视频两种 mime', () => {
    expect(main).toMatch(/if \(mime === 'video\/mp4'\) return \{ label: 'MP4', ext: 'mp4' \}/);
    expect(main).toMatch(/if \(mime === 'video\/webm'\) return \{ label: 'WebM', ext: 'webm' \}/);
    // 没有为视频新开一个 IPC handler（数一数仍是这一条）
    expect(main.match(/ipcMain\.handle\(\s*['"]preview:/g)?.length).toBe(1);
  });

  it('mime 与扩展名由 CONTAINER_SPECS 出（不散落在页面里）', () => {
    expect(exportSpec).toMatch(/mime: 'video\/webm'/);
    expect(exportSpec).toMatch(/mime: 'video\/mp4'/);
    expect(exportSpec).toMatch(/extension: 'webm'/);
    expect(exportSpec).toMatch(/extension: 'mp4'/);
    expect(control).not.toMatch(/'\.\w+'\s*\);?\s*$/);
  });
});

describe('07 · 依赖与体积（新增依赖在 package.json 可见）', () => {
  it('package.json 里两个封装库都在（照票面要求记账）', () => {
    const deps = JSON.parse(pkg).dependencies as Record<string, string>;
    expect(deps['mp4-muxer']).toBeDefined();
    expect(deps['webm-muxer']).toBeDefined();
  });

  it('按容器**动态** import：一次导出只付一份（不自写 EBML / ISOBMFF）', () => {
    expect(muxer).toMatch(/await import\(\s*\n?\s*opts\.spec\.id === 'webm' \? 'webm-muxer' : 'mp4-muxer'/);
    expect(muxer).not.toMatch(/from 'webm-muxer'/);
    expect(muxer).not.toMatch(/from 'mp4-muxer'/);
  });

  it('不自写容器格式：没有 EBML / ISOBMFF 的手搓痕迹', () => {
    const src = encodeFiles().map((rel) => readStripped(rel)).join('\n');
    expect(src).not.toMatch(/0x1a45dfa3|EBML|moov|mdat|trak\b/);
  });
});

describe('07 · 导出与预览解耦（不读窗口，不阻塞页面）', () => {
  it('encode/ 不读窗口尺寸 / 设备像素比（尺寸只从分辨率档来，ADR-0016 §7）', () => {
    const src = encodeFiles().map((rel) => readStripped(rel)).join('\n');
    expect(src).not.toMatch(/devicePixelRatio/);
    expect(src).not.toMatch(/window\.inner/);
    expect(src).not.toMatch(/clientWidth|clientHeight/);
    expect(src).not.toMatch(/resolveCanvasDpr/);
    expect(src).not.toMatch(/getBoundingClientRect/);
  });

  it('进度卡非模态：不用全站弹窗壳，也没有 scrim', () => {
    expect(control).not.toMatch(/pp-menu__scrim/);
    expect(control).not.toMatch(/Dialog/);
    expect(control).toMatch(/createPortal\(/);
    expect(control).toMatch(/role="status"/);
    // 失败文案要读屏立刻打断
    expect(control).toMatch(/role="alert"/);
  });

  it('页面只走预览域 barrel，不直摸 encode/ 内部', () => {
    expect(page).toMatch(/from '\.\.\/\.\.\/preview'/);
    expect(page).not.toMatch(/preview\/video\/encode/);
    expect(page).toMatch(/<VideoExportControl/);
  });

  it('导出入口在动态形态工具栏（票 20 定案），全屏仍在末位', () => {
    const toolbar = page.slice(page.indexOf("mode === 'static' ? ("));
    expect(toolbar).toMatch(/<PreviewDisplayPanel mode="video" \/>/);
    expect(toolbar).toMatch(/<VideoExportControl/);
    expect(toolbar.indexOf('<VideoExportControl')).toBeLessThan(toolbar.indexOf('<PreviewEnterFullscreenButton'));
  });
});

describe('07 · 容器口径跟运行时走（不在代码里断言"AAC 不可用"）', () => {
  it('默认是 auto：交给运行时探测，不钉死某一格', () => {
    expect(exportSpec).toMatch(/DEFAULT_VIDEO_CONTAINER: VideoContainerChoice = 'auto'/);
    expect(readStripped('src/preview/video/encode/exportSpec.ts')).toMatch(/export type VideoContainerChoice = VideoContainer \| 'auto'/);
  });

  it('mp4 的音频候选表 AAC 在前（平台有编码器就白拿真 mp4），webm 恒 Opus', () => {
    expect(exportSpec).toMatch(/audioCodecs: \[\.\.\.AAC_AUDIO_CODECS, OPUS_AUDIO_CODEC\]/);
    expect(exportSpec).toMatch(/audioCodecs: \['opus'\]/);
    expect(exportSpec).toMatch(/AAC_AUDIO_CODECS: readonly string\[\] = \['mp4a\.40\.2'\]/);
  });

  it('候选顺序：auto = ① mp4+AAC ② webm+Opus；手选才把该容器提到最前', () => {
    expect(exportSpec).toMatch(/const auto: TargetCandidate\[\] = \[\{ container: 'mp4', aacOnly: true \}, full\('webm'\)\];/);
    expect(exportSpec).toMatch(/return dedupeCandidates\(\[full\(preferred\), \.\.\.auto\]\);/);
  });

  it('封装库要的音频 codec 归一（WebCodecs 说 `mp4a.40.2`，mp4-muxer 只认 `aac`）', () => {
    expect(exportSpec).toMatch(/export function muxerAudioCodecFor/);
    expect(exportSpec).toMatch(/isAacCodec\(audioCodec\) \? 'aac' : 'opus'/);
    expect(muxer).toMatch(/codec: muxerAudioCodecFor\(opts\.spec, opts\.audioCodec\)/);
  });

  it('探测允许限定 codec（探"这台机器有没有 AAC"的那道闸）', () => {
    expect(muxer).toMatch(/numberOfChannels: number; codecs\?: readonly string\[\] \} \| null;/);
    expect(muxer).toMatch(/for \(const codec of input\.audio\.codecs \?\? spec\.audioCodecs\)/);
  });

  it('面板那行说明跟着探测结论走，且**只在有异常时才说话**（常识不占行）', () => {
    const raw = readSource('src/i18n/messages/zh-CN.json');
    const zh = JSON.parse(raw) as Record<string, string>;
    for (const key of [
      'preview.video.export.note.webm',
      'preview.video.export.note.webmFallback',
      'preview.video.export.note.mp4Opus',
    ]) {
      expect(zh[key]).toBeTruthy();
    }
    // MP4 + 有 AAC ⇒ 不占一行（常识）。按 key 判，不能按子串：`note.mp4Opus` 含有 `note.mp4`
    expect(zh['preview.video.export.note.mp4']).toBeUndefined();
    expect(raw).not.toContain('手机和电脑');
    // 没有结论就不出现这一行：不许再有"尚未检测"这类占位文案（用户看不懂，也没帮他做决定）
    expect(zh['preview.video.export.note.unknown']).toBeUndefined();
    expect(zh['preview.video.export.note.muted']).toBeUndefined();
    expect(control).toMatch(/\{note && <p className="pvex__note">\{note\}<\/p>\}/);
    // 探测结论是**面板打开时**问的，不是挂载就问
    expect(control).toMatch(/onProbe\?\.\(\);/);
    expect(readStripped('src/pages/preview/useVideoExport.ts')).toMatch(/probeVideoExportSupport\(\{ tier: spec\.tier, muted: spec\.muted, preferred: spec\.container \}\)/);
  });

  it('真导出与面板探测走同一个判定函数（说的事和做的事是同一件）', () => {
    expect(exportVideo).toMatch(/async function resolveTarget\(/);
    const probeIdx = exportVideo.indexOf('export async function probeVideoExportSupport');
    const runIdx = exportVideo.indexOf('export async function runVideoExport');
    expect(probeIdx).toBeGreaterThan(-1);
    expect(runIdx).toBeGreaterThan(probeIdx);
    // probeVideoExportSupport 内部就是 resolveTarget(...)；runVideoExport 也调它
    expect(exportVideo.slice(probeIdx, runIdx)).toMatch(/await resolveTarget\(/);
    expect(exportVideo.slice(runIdx)).toMatch(/await resolveTarget\(/);
  });
});

describe('07 · 导出面板的用词与跟随（2026-10-10 验收回修；三轮控件词汇对齐「显示」面板）', () => {
  const zh = JSON.parse(readSource('src/i18n/messages/zh-CN.json')) as Record<string, string>;

  it('界面文案去术语化：普通用户看得懂（不说容器 / codec / 编码器）', () => {
    // 三轮验收原话："MP4（H.264 + AAC）这到底在说啥玩意呢" —— 用户看得见的字全要人话
    const visible = Object.keys(zh)
      .filter((k) => k.startsWith('preview.video.export.'))
      .map((k) => zh[k])
      .join('\n');
    expect(visible).not.toMatch(/容器|H\.264|AAC|VP9|Opus|WebCodecs|编码器|封装|逐帧/);
    expect(zh['preview.video.export.container']).toBeUndefined();
    expect(control).not.toMatch(/preview\.video\.export\.container/);
  });

  it('行版式不许把标签挤成竖排（标签曾被控件压成三行）', () => {
    const css = readStripped('src/pages/preview/PreviewPage.css');
    expect(css).toMatch(/\.pvex__row-text strong \{[\s\S]*?white-space: nowrap;/);
    expect(css).toMatch(/\.pvex__row \{[\s\S]*?flex-wrap: wrap;/);
  });

  it('清晰度 / 声音 / 文件格式三行与「显示」面板同一套控件（下拉 + 开关，不新造样式）', () => {
    expect(zh['preview.video.export.tier']).toBe('清晰度');
    expect(zh['preview.video.export.audio']).toBe('声音');
    expect(zh['preview.video.export.format']).toBe('文件格式');
    expect(zh['preview.video.export.format.auto']).toBe('自动（推荐）');
    // 旧键（分段钮 / 更改展开态那一套）全部退役
    expect(zh['preview.video.export.format.change']).toBeUndefined();
    expect(zh['preview.video.export.format.override']).toBeUndefined();
    expect(zh['preview.video.export.audio.on']).toBeUndefined();
    expect(zh['preview.video.export.audio.off']).toBeUndefined();
    expect(zh['preview.video.export.tierHint']).toBeUndefined();
    // 档位只留数字（常识不写进标签；"导出更快"还会随机器真伪变化）
    expect(zh['preview.video.export.tier.1080p']).toBe('1080p');
    expect(zh['preview.video.export.tier.720p']).toBe('720p');
    expect(control).toMatch(/className="select-control"/);
    expect(control).toMatch(/role="switch"/);
    // 分段药丸钮那一套已撤（三轮验收：与全站控件词汇不一致）
    expect(control).not.toMatch(/role="radiogroup"/);
    expect(control).not.toMatch(/pvex__seg|pickingFormat/);
  });

  it('面板几何与「显示」面板**共用一份**（同一块壳 + 同一个 panelLayoutFor）', () => {
    // 自己不再声明 320 / 14 / 334：两块面板各写一份的话，改一处就会朝不同边缘对齐（issue 29）
    expect(control).not.toMatch(/const PANEL_W = \d+/);
    expect(control).not.toMatch(/const PANEL_CHROME_W = \d+/);
    expect(control).toMatch(/import \{ panelLayoutFor \} from '\.\/PreviewDisplayPanel'/);
    // 挂的是同一块壳的 class（宽度 / padding 走 .pdp__panel）
    expect(control).toMatch(/pp-menu__panel is-portaled pdp__panel pvex__panel/);
    expect(readStripped('src/pages/preview/PreviewDisplayPanel.tsx')).toMatch(/export function panelLayoutFor\(/);
  });

  it('开着时跟随触发钮：resize 监听 + 跨帧补测 + 等值守卫（issue 29 同款病灶）', () => {
    expect(control).toMatch(/window\.addEventListener\('resize', onResize\)/);
    expect(control).toMatch(/window\.removeEventListener\('resize', onResize\)/);
    // 跨帧补测：触发钮几何未必在 resize 当帧落定，延后两帧各量一次
    expect(control).toMatch(/raf1 = requestAnimationFrame\(\(\) => \{/);
    expect(control).toMatch(/raf2 = requestAnimationFrame\(computePos\)/);
    // 等值守卫：几何没变时别平白制造一次重渲
    expect(control).toMatch(/prev\.top === next\.top && prev\.left === next\.left \? prev : next/);
  });

  it('面板里的控件不再被判成"点外面"（触发钮 + 面板两个 ref 都算里面）', () => {
    expect(control).toMatch(/if \(panelRef\.current\?\.contains\(target\)\) return;/);
    expect(control).toMatch(/ref=\{panelRef\}/);
  });
});

describe('07 · 代码评审回修（2026-10-10）：文案与文件名各只有一份', () => {
  const zh = JSON.parse(readSource('src/i18n/messages/zh-CN.json')) as Record<string, string>;
  const hook = readStripped('src/pages/preview/useVideoExport.ts');

  it('失败文案全走 i18n：域层只回失败档，不产出用户可见文字', () => {
    // 死掉的 reason 文案（无处显示、还带术语）与直投 UI 的 err.message 一起退役
    expect(exportVideo).not.toMatch(/unsupportedDetail/);
    expect(exportVideo).not.toMatch(/err\.message/);
    expect(exportVideo).toMatch(/failure: 'assets'/);
    expect(exportVideo).toMatch(/failure: 'unknown', container: target\.container/);
    expect(zh['preview.video.export.failedAssets']).toBeTruthy();
    expect(hook).toMatch(/preview\.video\.export\.failedAssets/);
    expect(hook).not.toMatch(/outcome\.detail/);
  });

  it('静音导出不占说明行：没有音轨，MP4 兼容性警告是假命题（探到 null ≠ 本机没有 AAC）', () => {
    expect(control).toMatch(/outcomeNote\(support, probing, spec\.container, spec\.muted\)/);
    expect(control).toMatch(/if \(muted\) return null;/);
  });

  it('文件名换算只有一份：生产路径走 exportSpec 的 videoExportBasename（单测钉的那份是活的）', () => {
    expect(exportVideo).toMatch(/videoExportBasename\(req\.suggestedBaseName, spec\.extension\)/);
    expect(exportVideo).not.toMatch(/suggestedName: `\$\{req\.suggestedBaseName\}/);
  });
});

describe('07 · 走实时录制的那条路没有回来（离线逐帧是主路）', () => {
  it('encode/ 里没有 MediaRecorder / captureStream', () => {
    const src = encodeFiles().map((rel) => readStripped(rel)).join('\n');
    expect(src).not.toMatch(/MediaRecorder/);
    expect(src).not.toMatch(/captureStream/);
  });

  it('扫描没扫空（免得文件改名后静默放行）', () => {
    expect(encodeFiles().length).toBeGreaterThanOrEqual(5);
    expect(frameDriver.length).toBeGreaterThan(500);
    expect(exportVideo.length).toBeGreaterThan(500);
  });
});

// 30：导出物最前面多一段**纯前置**开场（5.0s）。这几条盯的是"接线"，观感归原型目视验收。
describe('30 · 视频开场是纯前置段（不占谱面时间、不与前奏重叠）', () => {
  it('时间轴总长 = 开场 + 谱面时长（关掉开场时就是谱面时长）', () => {
    expect(exportVideo).toMatch(/buildExportTimeline\(req\.durationSeconds \+ openingSeconds\)/);
    expect(exportVideo).toMatch(/req\.opening \? OPENING_SECONDS : 0/);
  });

  it('音轨：轨长带上开场、BGM 从开场结束那刻起、键音整体 + 开场', () => {
    expect(exportVideo).toMatch(/openingSeconds,/);
    expect(renderAudio).toMatch(/audioFramesFor\(req\.durationSeconds \+ offset, sampleRate\)/);
    expect(renderAudio).toMatch(/src\.start\(offset\)/);
    expect(renderAudio).toMatch(/const at = evt\.time \+ offset/);
  });

  it('键音的过滤仍按**谱面时间**判（开场段不产生键音）', () => {
    expect(renderAudio).toMatch(/evt\.time >= req\.durationSeconds/);
    expect(renderAudio).not.toMatch(/evt\.time \+ offset >= req\.durationSeconds \+ offset/);
  });

  it('开场段的画面由 opening/ 那一层画（encode/ 不自己画装饰 / 白条 / 文字）', () => {
    const src = encodeFiles().map((rel) => readStripped(rel)).join('\n');
    expect(src).not.toMatch(/drawOpeningDecor\(/);
    expect(frameDriver).toMatch(/drawOpeningFrameAt\(/);
    // 开场段不进 drawSimFrameAt（负秒下它会画出正在接近的音符 / 带体）
    expect(frameDriver).toMatch(/openingSegmentAt\(t\)/);
  });
});
