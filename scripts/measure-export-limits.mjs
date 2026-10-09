// 导出链路与尺寸实测（chart-preview 06，research）：
//
// **定位：一次性探针，不是 CI 资产。** 它不在 `npm test` 里跑，也不约束产品代码；保留下来只有一个理由 ——
// 它是 `docs/research/chart-preview-export-limits.md` 里那组数字的**复算 / 复验入口**：换机器、换 Chromium 大版本、
// 改导出档或编码参数之后重跑一节，就能拿到与笔记同一口径、可直接对比的数。
// **已知会腐烂**：它 `import('/src/...')` 的是绝对路径，产品模块重命名 / 移动后这里就跑不起来
// —— 到那时删掉它或改两行路径都行，笔记里的数字不受影响（数字是当次环境的记录）。
//
//   1. limits    画布 / 位图的单边与面积上限 + 超限后 getImageData / toBlob / drawImage 的真实行为
//   2. sheet     3 分钟 / 5 分钟谱宽图导出的耗时与峰值内存（真渲染，不是 stub）
//   3. sim       仿真场单帧成本（真 canvas，1080p / 720p / dpr 1 与 2）+ worker + OffscreenCanvas 可用性
//   4. codecs    VideoEncoder / AudioEncoder 的 isConfigSupported 矩阵 + 真编码吞吐 + 离线逐帧端到端
//   5. recorder  MediaRecorder + captureStream 对照（本 effort 已选离线逐帧，此条只存档）
//
// 用法（需 dev server 已起：bash scripts/dev.sh）：
//   node scripts/measure-export-limits.mjs
//   node scripts/measure-export-limits.mjs --only=limits,codecs
//   node scripts/measure-export-limits.mjs --chart=docs/resource/SampleChartCode/Official/HOHSSP.json
//   node scripts/measure-export-limits.mjs --json=/tmp/export-limits.json
//
// 测量口径（重要）：**canvas 2D 的绘制命令是延迟光栅的**——只 `drawSimFrameAt` 然后计时，量到
// 的是「命令录制」（0.1ms 量级），真正的光栅要等 flush（读回 / 合成 / VideoFrame 快照）才发生。
// 所以每一帧都额外做一次 `getImageData(0,0,1,1)` 强制 flush，并单独量出这枚读回自身的开销减掉。
// 环境变量：URL=http://127.0.0.1:5173/（dev server 根）
//
// 探针页是 dev server 源上的一张空壳 HTML（route 拦截），这样 `await import('/src/...')`
// 能拿到 Vite 现场转译的真模块，同时不让应用本体启动来抢 CPU。
import { chromium } from 'playwright';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const only = argOf('only', 'env,limits,sheet,sim,codecs,recorder').split(',').map((s) => s.trim());
const url = argOf('url', process.env.URL ?? 'http://127.0.0.1:5173/');
const chartPath = argOf('chart', 'docs/resource/SampleChartCode/Official/HOHSSP.json');
const chartPath5 = argOf('chart5', 'docs/resource/SampleChartCode/Community/150030.json');
const jsonOut = argOf('json', '');
const chartCode = readFileSync(chartPath, 'utf8');
const chartCode5 = readFileSync(chartPath5, 'utf8');
const want = (s) => only.includes(s);

// ------------------------------------------------------------------ 进程 RSS（Linux /proc）
/** 读一个进程的 VmRSS（KB） */
function rssKbOf(pid) {
  try {
    const txt = readFileSync(`/proc/${pid}/status`, 'utf8');
    const m = txt.match(/VmRSS:\s+(\d+)\s+kB/);
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}
/** pid → ppid 表 */
function procTree() {
  const map = new Map();
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    let stat;
    try {
      stat = readFileSync(`/proc/${d}/stat`, 'utf8');
    } catch {
      continue;
    }
    const after = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    map.set(Number(d), Number(after[1]));
  }
  return map;
}
/** 找出 Playwright 启的浏览器根进程（launch 拿不到 pid，只能按 cmdline 认） */
function findBrowserRootPid() {
  const pids = [];
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    let cmd = '';
    try {
      cmd = readFileSync(`/proc/${d}/cmdline`, 'utf8');
    } catch {
      continue;
    }
    if (cmd.includes('ms-playwright') || cmd.includes('chrome-linux')) pids.push(Number(d));
  }
  const set = new Set(pids);
  return pids.find((p) => !set.has(procTree().get(p) ?? -1)) ?? pids[0] ?? 0;
}
/** 浏览器进程 + 全部后代的 RSS 合计（MB）——渲染进程的画布位图也落在里面 */
function treeRssMb(rootPid) {
  const tree = procTree();
  const kids = new Map();
  for (const [pid, ppid] of tree) {
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid).push(pid);
  }
  const stack = [rootPid];
  let total = 0;
  while (stack.length > 0) {
    const pid = stack.pop();
    total += rssKbOf(pid);
    for (const k of kids.get(pid) ?? []) stack.push(k);
  }
  return total / 1024;
}

const report = {};
const log = (...a) => console.log(...a);
const head = (title) => log(`\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}`);

const browser = await chromium.launch({
  args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') log('[console.error]', m.text());
});

await page.route('**/__measure.html', (route) =>
  route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>measure</title>' }),
);
await page.goto(new URL('__measure.html', url).href, { waitUntil: 'domcontentloaded' });

/** 尽力回收（上一节留下的大画布会把 RSS 基线抬高，污染下一节的峰值差） */
async function gcPage() {
  await page.evaluate(async () => {
    window.gc?.();
    await new Promise((r) => setTimeout(r, 300));
    window.gc?.();
  });
}

/** 采样期间的 RSS 峰值（MB） */
async function withRssPeak(fn) {
  const root = findBrowserRootPid();
  const samples = [];
  let stop = false;
  const timer = setInterval(() => {
    if (stop || !root) return;
    samples.push(treeRssMb(root));
  }, 150);
  const base = root ? treeRssMb(root) : 0;
  try {
    return { result: await fn(), base, peak: Math.max(base, ...samples, 0) };
  } finally {
    stop = true;
    clearInterval(timer);
  }
}

// ================================================================== 1. 环境
if (want('env')) {
  head('1. 环境');
  const env = await page.evaluate(() => ({
    ua: navigator.userAgent,
    platform: navigator.platform,
    cores: navigator.hardwareConcurrency,
    deviceMemoryGB: navigator.deviceMemory ?? null,
    secureContext: window.isSecureContext,
    preciseMemory: 'memory' in performance,
    features: {
      VideoEncoder: typeof VideoEncoder,
      VideoFrame: typeof VideoFrame,
      AudioEncoder: typeof AudioEncoder,
      AudioData: typeof AudioData,
      OffscreenCanvas: typeof OffscreenCanvas,
      Worker: typeof Worker,
      MediaRecorder: typeof MediaRecorder,
      captureStream: typeof HTMLCanvasElement.prototype.captureStream,
      transferControlToOffscreen: typeof HTMLCanvasElement.prototype.transferControlToOffscreen,
      schedulerYield: typeof globalThis.scheduler?.yield,
      OfflineAudioContext: typeof OfflineAudioContext,
    },
  }));
  env.playwrightChromium = browser.version();
  // 光栅后端（headless 通常是 SwiftShader 软件光栅 —— 单帧成本是**最坏情况**，不是真机 GPU 的数）
  env.renderer = await page.evaluate(() => {
    try {
      const gl = document.createElement('canvas').getContext('webgl');
      if (!gl) return 'no webgl';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'webgl (renderer unknown)';
    } catch (e) {
      return `throw:${e.message.slice(0, 40)}`;
    }
  });
  report.env = env;
  log(env);
}

// ================================================================== 2. 画布 / 位图上限
if (want('limits')) {
  head('2. 画布 / 位图上限与超限行为');
  const limits = await page.evaluate(async () => {
    /** 建一张 w×h 画布，画 4×4 红块，读**左上角与右下角**两个像素判定分配成功 */
    function probe(w, h) {
      const r = { req: [w, h] };
      const c = document.createElement('canvas');
      try {
        c.width = w;
        c.height = h;
      } catch (e) {
        r.set = `throw:${e.name}`;
      }
      r.got = [c.width, c.height];
      let ctx = null;
      try {
        ctx = c.getContext('2d');
      } catch (e) {
        r.ctx = `throw:${e.name}`;
      }
      if (!ctx) return { ...r, allocated: false };
      try {
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(0, 0, 4, 4);
        ctx.fillStyle = '#00ff00';
        ctx.fillRect(w - 4, h - 4, 4, 4);
        const a = ctx.getImageData(0, 0, 1, 1).data;
        const b = ctx.getImageData(w - 1, h - 1, 1, 1).data;
        r.pxTL = [a[0], a[1], a[2], a[3]].join(',');
        r.pxBR = [b[0], b[1], b[2], b[3]].join(',');
        r.allocated = a[0] === 255 && b[1] === 255;
      } catch (e) {
        r.readback = `throw:${e.name}:${e.message.slice(0, 60)}`;
        r.allocated = false;
      }
      return r;
    }
    const ok = (w, h) => probe(w, h).allocated;
    /** 二分出「仍成功」的最大 n */
    function bisect(lo, hi, test) {
      while (lo < hi) {
        const mid = Math.floor((lo + hi + 1) / 2);
        if (test(mid)) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    }
    const maxSide = bisect(1, 1 << 21, (n) => ok(n, 4));
    const maxAreaSide = bisect(1, 1 << 17, (n) => ok(n, n));

    /** 超限画布的三种消费行为 */
    async function failureBehavior(w, h) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      const out = { req: [w, h], got: [c.width, c.height] };
      try {
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(0, 0, 8, 8);
        out.fillRect = 'no throw';
      } catch (e) {
        out.fillRect = `throw:${e.name}`;
      }
      try {
        out.getImageData = [...ctx.getImageData(0, 0, 1, 1).data].join(',');
      } catch (e) {
        out.getImageData = `throw:${e.name}:${e.message.slice(0, 50)}`;
      }
      try {
        const t = performance.now();
        const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
        out.toBlob = blob ? `${blob.size} B @ ${Math.round(performance.now() - t)}ms` : 'null';
      } catch (e) {
        out.toBlob = `throw:${e.name}`;
      }
      // 超限画布当源画进一张正常画布
      const dest = document.createElement('canvas');
      dest.width = 16;
      dest.height = 16;
      const dctx = dest.getContext('2d');
      try {
        dctx.drawImage(c, 0, 0, 16, 16);
        out.drawImage = [...dctx.getImageData(0, 0, 1, 1).data].join(',');
      } catch (e) {
        out.drawImage = `throw:${e.name}`;
      }
      return out;
    }

    /** 一张画布出 PNG 的耗时与字节 */
    async function pngOf(w, h) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#123456');
      g.addColorStop(1, '#abcdef');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      const t = performance.now();
      const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
      const ms = Math.round(performance.now() - t);
      const okDraw = [...ctx.getImageData(w - 1, h - 1, 1, 1).data].join(',');
      return { req: [w, h], allocated: okDraw !== '0,0,0,0', pngBytes: blob ? blob.size : null, ms };
    }

    return {
      maxSidePx: maxSide,
      maxAreaSidePx: maxAreaSide,
      maxAreaPx: maxAreaSide * maxAreaSide,
      areaVsLimit: maxAreaSide * maxAreaSide / 2 ** 28,
      probeMaxSide: probe(maxSide, 4),
      probeMaxSidePlus1: probe(maxSide + 1, 4),
      probeMaxArea: probe(maxAreaSide, maxAreaSide),
      probeMaxAreaPlus1: probe(maxAreaSide + 1, maxAreaSide + 1),
      failureSide: await failureBehavior(maxSide + 1, 4),
      failureArea: await failureBehavior(maxAreaSide + 1, maxAreaSide + 1),
      grid5850: await pngOf(5850, 537),
      grid5850dpr2: await pngOf(11700, 1074),
      sheet3min_dpr2: await pngOf(10982, 7324), // 19 面板（3 分钟）+ 440 头带 @dpr2
      sheet63panels_dpr2: probe(36414, 7324), // 63 面板 @dpr2 ≈ 266.7 MPix（面积上限边界内）
      sheet64panels_dpr2: probe(36992, 7324), // 64 面板 @dpr2 ≈ 270.9 MPix（越界 → 应失败）
      sheet226panels_dpr1: probe(65314, 3662), // 226 面板 @dpr1：单边 65,314 ≤ 65,535、面积 239.2 MPix
      sheet227panels_dpr1: probe(65603, 3662), // 227 面板 @dpr1：单边 65,603 > 65,535 → 应失败
      sheet72panels_dpr2NoHeader: probe(41616, 6444), // 72 面板 @dpr2 无头带：268.2 MPix（面积边界内）
      sheet73panels_dpr2NoHeader: probe(42194, 6444), // 73 面板 @dpr2 无头带：272.0 MPix → 应失败
    };
  });
  report.limits = limits;
  log(limits);
}

// ================================================================== 3. 宽图导出实测
if (want('sheet')) {
  head('3. 宽图导出实测（真渲染，离屏逐面板）');
  for (const [target, code] of [[180, chartCode], [300, chartCode5]]) {
    log(`\n--- 目标谱长 ${target}s（${target / 60} 分钟）`);
    await gcPage();
    const { result, base, peak } = await withRssPeak(() =>
      page.evaluate(
        async ([codeText, targetSeconds]) => {
          const [converter, exportMod, settingsMod, timing, spriteMod] = await Promise.all([
            import('/src/chart/editing/ChartConverter.ts'),
            import('/src/preview/static/exportPanels.ts'),
            import('/src/chart/config/AppSettings.ts'),
            import('/src/audio/AudioTiming.ts'),
            import('/src/ui/CanvasSpriteIcon.tsx'),
          ]);
          const CanvasSpriteIcon = spriteMod.default;
          const parsed = converter.parseCodeText(codeText);
          if (!parsed.ok) return { error: '谱面代码解析失败', errors: parsed.errors.slice(0, 3) };

          /** 一份谱面的最后 beat（滑条取连接的最后结点） */
          const lastBeatOf = (arr) => {
            let m = 0;
            for (const n of arr) {
              if (typeof n.beat === 'number') m = Math.max(m, n.beat);
              if (Array.isArray(n.connections)) {
                for (const c of n.connections) if (typeof c.beat === 'number') m = Math.max(m, c.beat);
              }
            }
            return m;
          };
          const baseNotes = converter.convertChartCodeToNotes(parsed.code);
          const bpmEvents = timing.getBpmEvents(baseNotes);
          const baseEnd = timing.beatToSeconds(bpmEvents, lastBeatOf(parsed.code));
          const lastBeat = lastBeatOf(parsed.code);
          const step = lastBeat + 8; // 每份之间留 8 拍空档
          const copies = Math.max(1, Math.ceil(targetSeconds / Math.max(1, baseEnd)));
          // 平铺：整体平移 beat（纯 JSON 层，不碰投影）
          const shift = (node, delta) => {
            if (typeof node.beat === 'number') node.beat += delta;
            if (Array.isArray(node.connections)) for (const c of node.connections) shift(c, delta);
          };
          const tiled = [];
          for (let k = 0; k < copies; k++) {
            for (const n of parsed.code) {
              const clone = JSON.parse(JSON.stringify(n));
              shift(clone, k * step);
              tiled.push(clone);
            }
          }
          const notes = converter.convertChartCodeToNotes(tiled);
          const defaults = settingsMod.defaultSettings('en');
          const scene = {
            notes,
            chartDuration: targetSeconds,
            verticalRatio: defaults.display.verticalRatio ?? 1,
            beatDisplay: defaults.display.beatDisplay ?? 4,
            settingsDisplay: defaults.display,
            noteSkin: defaults.visual.noteSkin,
          };
          const header = {
            projectName: '测量工程',
            chartTitle: '导出实测',
            difficulty: 'EXP 32',
            difficultyColor: null,
            durationSeconds: targetSeconds,
            noteCount: notes.length,
            bpms: timing.getBpmEvents(notes).map((e) => e.bpm),
            exportedAt: Date.now(),
            fields: settingsMod.DEFAULT_EXPORT_FIELDS,
            cover: null,
            coverHue: 200,
          };
          const heapBefore = performance.memory?.usedJSHeapSize ?? 0;
          const t0 = performance.now();
          const rendered = await exportMod.renderSheet({ scene, header, suggestedName: 'measure.png' });
          const renderMs = Math.round(performance.now() - t0);
          if (!rendered.ok) return { error: 'planSheet 拒绝', plan: rendered.plan, renderMs };
          const canvas = rendered.canvas;
          const t1 = performance.now();
          const bytes = await exportMod.canvasToPngBytes(canvas);
          const pngMs = Math.round(performance.now() - t1);
          const heapAfter = performance.memory?.usedJSHeapSize ?? 0;
          const out = {
            baseChartSeconds: Math.round(baseEnd * 10) / 10,
            copies,
            noteCount: notes.length,
            panelCount: rendered.panelCount,
            secondsPerPanel: Math.round(rendered.secondsPerPanel * 100) / 100,
            sheetCss: [rendered.plan.sheetW, rendered.plan.sheetH],
            buffer: [canvas.width, canvas.height],
            dpr: rendered.plan.dpr,
            bufferMB: Math.round((canvas.width * canvas.height * 4) / 1048576),
            renderMs,
            pngMs,
            totalMs: renderMs + pngMs,
            pngMB: Math.round((bytes.byteLength / 1048576) * 10) / 10,
            heapDeltaMB: Math.round(((heapAfter - heapBefore) / 1048576) * 10) / 10,
          };
          canvas.width = 0;
          canvas.height = 0;
          await CanvasSpriteIcon.ensureImagesLoaded([]).catch(() => undefined);
          return out;
        },
        [code, target],
      ),
    );
    log({ ...result, rssBaseMB: Math.round(base), rssPeakMB: Math.round(peak), rssDeltaMB: Math.round(peak - base) });
    report[`sheet${target}s`] = { ...result, rssBaseMB: Math.round(base), rssPeakMB: Math.round(peak) };
  }
}

// ================================================================== 4. 仿真场单帧成本
if (want('sim')) {
  head('4. 仿真场单帧成本（真 canvas）+ worker / OffscreenCanvas');
  const simRes = await page.evaluate(
    async ([codeText]) => {
      const [sim, geom, skinMod, spriteMod, converter, settingsMod, timing] = await Promise.all([
        import('/src/preview/video/sim/index.ts'),
        import('/src/preview/video/sim/simGeometry.ts'),
        import('/src/rendering/skin/noteSkin.ts'),
        import('/src/ui/CanvasSpriteIcon.tsx'),
        import('/src/chart/editing/ChartConverter.ts'),
        import('/src/chart/config/AppSettings.ts'),
        import('/src/audio/AudioTiming.ts'),
      ]);
      const CanvasSpriteIcon = spriteMod.default;
      const parsed = converter.parseCodeText(codeText);
      if (!parsed.ok) return { error: '谱面代码解析失败', errors: parsed.errors.slice(0, 3) };
      const lastBeatOf = (arr) => {
        let m = 0;
        for (const n of arr) {
          if (typeof n.beat === 'number') m = Math.max(m, n.beat);
          if (Array.isArray(n.connections)) for (const c of n.connections) m = Math.max(m, c.beat);
        }
        return m;
      };
      const baseNotes = converter.convertChartCodeToNotes(parsed.code);
      const baseEnd = timing.beatToSeconds(timing.getBpmEvents(baseNotes), lastBeatOf(parsed.code));
      const step = lastBeatOf(parsed.code) + 8;
      const copies = Math.max(1, Math.ceil(180 / Math.max(1, baseEnd))); // 铺到 ~3 分钟
      const shift = (node, delta) => {
        if (typeof node.beat === 'number') node.beat += delta;
        if (Array.isArray(node.connections)) for (const c of node.connections) shift(c, delta);
      };
      const tiled = [];
      for (let k = 0; k < copies; k++) {
        for (const n of parsed.code) {
          const clone = JSON.parse(JSON.stringify(n));
          shift(clone, k * step);
          tiled.push(clone);
        }
      }
      const notes = converter.convertChartCodeToNotes(tiled);
      const defaults = settingsMod.defaultSettings('en');
      const noteIcons = skinMod.buildActiveNoteIcons(skinMod.normalizeNoteSkinSelection(defaults.visual.noteSkin));
      await CanvasSpriteIcon.ensureImagesLoaded(noteIcons.preloadSrcs()).catch(() => undefined);
      const assets = await sim.loadSimAssets({
        bandSrc: noteIcons.slideBand.src,
        bandSpSrc: noteIcons.slideBandSp.src,
      });
      const scene = {
        notes,
        beatDisplay: defaults.display.beatDisplay ?? 4,
        noteSpeed: defaults.preview.noteSpeed,
        noteSize: defaults.display.noteSize,
        slideOpacity: defaults.display.slideOpacity,
        simultaneousClickLines: defaults.display.simultaneousClickLines,
        colorAssist: defaults.display.colorAssist,
        mirror: defaults.preview.mirror,
      };
      const chart = sim.buildSimChart(scene, noteIcons);
      const spriteIcon = new CanvasSpriteIcon();

      /**
       * 一组帧的耗时统计。每帧三段计时：
       *   record = 命令录制（clearRect + drawSimFrameAt）——**不含光栅**
       *   raster = 强制 flush 的 `getImageData(0,0,1,1)`（减掉空白画布的同款开销）——真正的光栅
       */
      function run(width, height, dpr, mode, frames = 90) {
        const metrics = geom.fitDesignSurface(width, height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(metrics.w * dpr);
        canvas.height = Math.round(metrics.h * dpr);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const input = { chart, scene, metrics, assets, noteIcons, spriteIcon };

        // flush 探针自身的开销（空白画布上读一个像素）
        const flushBase = [];
        for (let i = 0; i < 20; i++) {
          const t = performance.now();
          ctx.getImageData(0, 0, 1, 1);
          flushBase.push(performance.now() - t);
        }
        flushBase.sort((a, b) => a - b);
        const flushOverhead = flushBase[Math.floor(flushBase.length / 2)];

        const T = chart.approachS;
        const secondsAt = (i) =>
          mode === 'dense'
            ? denseStart + i / 60 // 最密那一段（可视元素最多）
            : 5 + ((i * 7) % Math.max(1, Math.floor(chartSeconds - 10))); // 全谱均匀抽样
        // 预热 5 帧（不计时）
        for (let i = 0; i < 5; i++) {
          ctx.clearRect(0, 0, metrics.w, metrics.h);
          sim.drawSimFrameAt(ctx, input, secondsAt(i));
          ctx.getImageData(0, 0, 1, 1);
        }
        const rec = [];
        const ras = [];
        for (let i = 0; i < frames; i++) {
          const t0 = performance.now();
          ctx.clearRect(0, 0, metrics.w, metrics.h);
          sim.drawSimFrameAt(ctx, input, secondsAt(i));
          const t1 = performance.now();
          ctx.getImageData(0, 0, 1, 1); // 强制光栅
          const t2 = performance.now();
          rec.push(t1 - t0);
          ras.push(Math.max(0, t2 - t1 - flushOverhead));
        }
        const stat = (arr) => {
          const s = [...arr].sort((a, b) => a - b);
          const pick = (p) => Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 100) / 100;
          return { p50: pick(0.5), p95: pick(0.95), max: Math.round(s[s.length - 1] * 100) / 100 };
        };
        const r = stat(rec);
        const g = stat(ras);
        const total = r.p50 + g.p50;
        const out = {
          field: [metrics.w, metrics.h],
          buffer: [canvas.width, canvas.height],
          dpr,
          frames,
          recordMs: r,
          rasterMs: g,
          totalMs: Math.round(total * 100) / 100,
          fps: Math.round(1000 / total),
          budget60pct: Math.round((total / 16.667) * 100),
        };
        canvas.width = 0;
        canvas.height = 0;
        return out;
      }

      /** 可视元素最多的一秒窗口（双指针扫已升序的 elements） */
      const dense = (() => {
        const els = chart.elements;
        let best = { count: 0, t: 0 };
        let j = 0;
        for (let i = 0; i < els.length; i++) {
          const t = els[i].time;
          while (j < els.length && els[j].time <= t + chart.approachS) j++;
          if (j - i > best.count) best = { count: j - i, t };
        }
        return best;
      })();
      const denseStart = dense.t;
      const chartSeconds = Math.round(baseEnd * copies * 10) / 10;

      const out = {
        noteCount: notes.length,
        elements: chart.elements.length,
        bands: chart.bands.length,
        chartSeconds,
        approachSeconds: Math.round(chart.approachS * 100) / 100,
        denseWindow: { visibleElements: dense.count, atSeconds: Math.round(dense.t * 10) / 10 },
        assetsMissing: !!assets.missing,
        spritesLoaded: !!assets.sprites,
        runs: {
          '1080p dpr1 · 密段': run(1920, 1080, 1, 'dense'),
          '1080p dpr1 · 全谱抽样': run(1920, 1080, 1, 'sample'),
          '1080p dpr2 · 密段': run(1920, 1080, 2, 'dense'),
          '720p dpr1 · 密段': run(1280, 720, 1, 'dense'),
          '540p dpr1 · 密段': run(960, 540, 1, 'dense'),
        },
      };
      // 一帧画完之后的 readback 成本（导出要喂 VideoFrame，可能要 getImageData / convertToBlob）
      const metrics = geom.fitDesignSurface(1920, 1080);
      const canvas = document.createElement('canvas');
      canvas.width = metrics.w;
      canvas.height = metrics.h;
      const ctx = canvas.getContext('2d');
      const input = { chart, scene, metrics, assets, noteIcons, spriteIcon };
      sim.drawSimFrameAt(ctx, input, 30);
      const t2 = performance.now();
      ctx.getImageData(0, 0, canvas.width, canvas.height);
      out.readback = { getImageDataFullMs: Math.round(performance.now() - t2) };
      const t3 = performance.now();
      await new Promise((r) => canvas.toBlob(r, 'image/png'));
      out.readback.toBlobMs = Math.round(performance.now() - t3);
      // VideoFrame 快照（07 喂编码器的那一步；它同时会强制光栅）
      const ts = [];
      for (let i = 0; i < 10; i++) {
        const t = performance.now();
        const f = new VideoFrame(canvas, { timestamp: i * 16667 });
        ts.push(performance.now() - t);
        f.close();
      }
      ts.sort((a, b) => a - b);
      out.readback.videoFrameMs = { p50: Math.round(ts[5] * 100) / 100, min: Math.round(ts[0] * 100) / 100 };
      canvas.width = 0;
      canvas.height = 0;
      return out;
    },
    [chartCode],
  );
  report.sim = simRes;
  log(simRes);

  const workerRes = await page.evaluate(async () => {
    const atlasBytes = await fetch('/assets/skins/skin00/RhythmGameSprites.png')
      .then((r) => r.arrayBuffer())
      .catch(() => null);
    const src = `
      self.onmessage = async (e) => {
        self.__atlas = e.data;
        const out = {};
        out.hasOffscreen = typeof OffscreenCanvas;
        out.hasVideoEncoder = typeof VideoEncoder;
        out.hasAudioEncoder = typeof AudioEncoder;
        out.hasDOMImage = typeof Image;
        try {
          const oc = new OffscreenCanvas(1920, 1080);
          const ctx = oc.getContext('2d');
          ctx.fillStyle = '#f00'; ctx.fillRect(0, 0, 8, 8);
          out.offscreen2d = [...ctx.getImageData(0, 0, 1, 1).data].join(',');
        } catch (e) { out.offscreen2d = 'throw:' + e.message; }
        try {
          const oc = new OffscreenCanvas(1920, 1080);
          const ctx = oc.getContext('2d');
          ctx.fillStyle = '#0f0'; ctx.fillRect(0, 0, 64, 64);
          const bmp = await createImageBitmap(oc);
          const oc2 = new OffscreenCanvas(1920, 1080);
          const c2 = oc2.getContext('2d');
          c2.drawImage(bmp, 0, 0);
          out.imageBitmapDraw = [...c2.getImageData(0, 0, 1, 1).data].join(',');
        } catch (e) { out.imageBitmapDraw = 'throw:' + e.message; }
        try {
          const oc = new OffscreenCanvas(1920, 1080);
          const c = oc.getContext('2d');
          c.fillStyle = '#00f'; c.fillRect(0, 0, 64, 64);
          const blob = await oc.convertToBlob({ type: 'image/png' });
          out.convertToBlobBytes = blob.size;
        } catch (e) { out.convertToBlobBytes = 'throw:' + e.message; }
        try {
          const s = await VideoEncoder.isConfigSupported({ codec: 'avc1.640028', width: 1920, height: 1080, bitrate: 8e6 });
          out.avcSupported = s.supported;
        } catch (e) { out.avcSupported = 'throw:' + e.message; }
        try {
          const oc = new OffscreenCanvas(1920, 1080);
          const c = oc.getContext('2d');
          c.fillStyle = '#00f'; c.fillRect(0, 0, 64, 64);
          const f = new VideoFrame(oc, { timestamp: 0 });
          out.videoFrameFromOffscreen = true;
          f.close();
        } catch (e) { out.videoFrameFromOffscreen = 'throw:' + e.message; }
        // 精灵能不能进 worker（CanvasSpriteIcon 现在只吃 HTMLImageElement）：
        // 字节由主线程 fetch 好再传进来（blob: worker 的 origin 是 opaque，fetch 会被挡）
        try {
          const bmp = await createImageBitmap(new Blob([self.__atlas]));
          out.imageBitmapFromAtlasBytes = bmp.width + 'x' + bmp.height;
        } catch (e) { out.imageBitmapFromAtlasBytes = 'throw:' + e.message.slice(0, 60); }
        self.postMessage(out);
      };
    `;
    const blobUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const res = await new Promise((resolve, reject) => {
      const w = new Worker(blobUrl);
      const timer = setTimeout(() => reject(new Error('worker timeout')), 20000);
      w.onmessage = (e) => {
        clearTimeout(timer);
        w.terminate();
        URL.revokeObjectURL(blobUrl);
        resolve(e.data);
      };
      w.onerror = (e) => {
        clearTimeout(timer);
        reject(new Error('worker error: ' + e.message));
      };
      w.postMessage(atlasBytes, atlasBytes ? [atlasBytes] : []);
    });
    return { ...res, atlasBytes: atlasBytes ? atlasBytes.byteLength : null };
  });
  report.worker = workerRes;
  log('\nworker / OffscreenCanvas：', workerRes);
}

// ================================================================== 5. 编码可用性 + 吞吐
if (want('codecs')) {
  head('5. WebCodecs 编码可用性 + 实测吞吐');
  const codecs = await page.evaluate(async () => {
    const out = { video: {}, audio: {}, encode: {}, audioEncode: null };
    const vcodecs = [
      'avc1.42001f', 'avc1.4d0028', 'avc1.640028', 'avc1.640033',
      'vp8', 'vp09.00.10.08', 'vp09.00.31.08', 'av01.0.04M.08',
    ];
    for (const c of vcodecs) {
      try {
        const r = await VideoEncoder.isConfigSupported({
          codec: c, width: 1920, height: 1080, bitrate: 8_000_000, framerate: 60,
        });
        out.video[c] = r.supported;
      } catch (e) {
        out.video[c] = `throw:${e.message.slice(0, 40)}`;
      }
    }
    for (const c of ['opus', 'mp4a.40.2', 'mp4a.40.5', 'flac', 'alaw', 'ulaw']) {
      try {
        const r = await AudioEncoder.isConfigSupported({
          codec: c, sampleRate: 48000, numberOfChannels: 2, bitrate: 128000,
        });
        out.audio[c] = r.supported;
      } catch (e) {
        out.audio[c] = `throw:${e.message.slice(0, 40)}`;
      }
    }

    /** 纯编码吞吐：合成图（渐变 + 噪声）喂 VideoFrame */
    async function encodeRun(codec, { width, height, frames, bitrate, fps, latencyMode }) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      let bytes = 0;
      let chunks = 0;
      let failed = null;
      const enc = new VideoEncoder({
        output: (chunk) => { bytes += chunk.byteLength; chunks++; chunk.close?.(); },
        error: (e) => { failed = e.message; },
      });
      const cfg = { codec, width, height, bitrate, framerate: fps, latencyMode };
      const support = await VideoEncoder.isConfigSupported(cfg);
      if (!support.supported) return { supported: false };
      enc.configure(cfg);
      const t0 = performance.now();
      for (let i = 0; i < frames; i++) {
        const g = ctx.createLinearGradient(0, 0, width, height);
        g.addColorStop(0, `hsl(${i * 7 % 360} 70% 45%)`);
        g.addColorStop(1, '#101820');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#fff';
        ctx.fillRect((i * 37) % width, (i * 53) % height, 120, 80);
        const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps) });
        enc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
        frame.close();
        // 背压：队列太长就让一拍（避免无限堆积，也是真实导出该有的节流）
        let guard = 0;
        while (enc.encodeQueueSize > 6 && guard++ < 400) await new Promise((r) => setTimeout(r, 0));
      }
      await enc.flush();
      const ms = performance.now() - t0;
      enc.close();
      return {
        supported: true,
        frames,
        ms: Math.round(ms),
        fps: Math.round((frames / (ms / 1000)) * 10) / 10,
        mbitPerSec: Math.round((bytes * 8) / ms / 1000 * 10) / 10,
        chunks,
        bytes,
        failed,
      };
    }

    for (const codec of ['avc1.640028', 'vp09.00.10.08', 'vp8', 'av01.0.04M.08']) {
      out.encode[`${codec} · 1080p · quality`] = await encodeRun(codec, {
        width: 1920, height: 1080, frames: 60, bitrate: 8_000_000, fps: 60, latencyMode: 'quality',
      });
    }
    out.encode['avc1.640028 · 1080p · realtime'] = await encodeRun('avc1.640028', {
      width: 1920, height: 1080, frames: 60, bitrate: 8_000_000, fps: 60, latencyMode: 'realtime',
    });
    out.encode['avc1.640028 · 720p · quality'] = await encodeRun('avc1.640028', {
      width: 1280, height: 720, frames: 60, bitrate: 4_000_000, fps: 60, latencyMode: 'quality',
    });

    // Opus 音轨：1 秒 48k 立体声
    try {
      const enc = new AudioEncoder({
        output: (chunk) => { out.audioEncode = { ...(out.audioEncode ?? {}), bytes: (out.audioEncode?.bytes ?? 0) + chunk.byteLength, chunks: (out.audioEncode?.chunks ?? 0) + 1 }; },
        error: (e) => { out.audioEncode = { error: e.message }; },
      });
      enc.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 });
      const pcm = new Float32Array(48000 * 2);
      for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin((i / 48000) * 440 * Math.PI * 2) * 0.2;
      const data = new AudioData({
        format: 'f32', sampleRate: 48000, numberOfFrames: 48000, numberOfChannels: 2, timestamp: 0,
        data: pcm,
      });
      enc.encode(data);
      await enc.flush();
      enc.close();
      out.audioEncode = { ...(out.audioEncode ?? {}), ok: true };
    } catch (e) {
      out.audioEncode = { error: `${e.name}:${e.message.slice(0, 60)}` };
    }
    return out;
  });
  report.codecs = codecs;
  log(codecs);

  // 端到端：仿真场出帧 + 编码（真实导出的主循环形态）
  head('5b. 端到端：仿真场出帧 + VideoEncoder（1080p / 60fps 目标）');
  const e2e = await page.evaluate(
    async ([codeText]) => {
      const [sim, geom, skinMod, spriteMod, converter, settingsMod, timing] = await Promise.all([
        import('/src/preview/video/sim/index.ts'),
        import('/src/preview/video/sim/simGeometry.ts'),
        import('/src/rendering/skin/noteSkin.ts'),
        import('/src/ui/CanvasSpriteIcon.tsx'),
        import('/src/chart/editing/ChartConverter.ts'),
        import('/src/chart/config/AppSettings.ts'),
        import('/src/audio/AudioTiming.ts'),
      ]);
      const CanvasSpriteIcon = spriteMod.default;
      const parsed = converter.parseCodeText(codeText);
      const notes = converter.convertChartCodeToNotes(parsed.code);
      const defaults = settingsMod.defaultSettings('en');
      const noteIcons = skinMod.buildActiveNoteIcons(skinMod.normalizeNoteSkinSelection(defaults.visual.noteSkin));
      await CanvasSpriteIcon.ensureImagesLoaded(noteIcons.preloadSrcs()).catch(() => undefined);
      const assets = await sim.loadSimAssets({ bandSrc: noteIcons.slideBand.src, bandSpSrc: noteIcons.slideBandSp.src });
      const scene = {
        notes,
        beatDisplay: defaults.display.beatDisplay ?? 4,
        noteSpeed: defaults.preview.noteSpeed,
        noteSize: defaults.display.noteSize,
        slideOpacity: defaults.display.slideOpacity,
        simultaneousClickLines: defaults.display.simultaneousClickLines,
        colorAssist: defaults.display.colorAssist,
        mirror: false,
      };
      const chart = sim.buildSimChart(scene, noteIcons);
      const spriteIcon = new CanvasSpriteIcon();
      // 最密窗口（与 §4 同一口径）：端到端也在最重的那一段上跑
      const denseStart = (() => {
        const els = chart.elements;
        let best = { count: 0, t: 0 };
        let j = 0;
        for (let i = 0; i < els.length; i++) {
          const t = els[i].time;
          while (j < els.length && els[j].time <= t + chart.approachS) j++;
          if (j - i > best.count) best = { count: j - i, t };
        }
        return best.t;
      })();

      async function run(codec, width, height, dpr, frames, bitrate, roundEven = false) {
        const metrics = geom.fitDesignSurface(width, height);
        // H.264 要求偶数边长（4:2:0）：`fitDesignSurface` 给的高常常是奇数（1080 → 1079），
        // 直接拿去 configure 会被判 unsupported —— 导出尺寸必须自己取整到偶数。
        const bw = Math.round(metrics.w * dpr);
        const bh = roundEven ? Math.round(metrics.h * dpr) & ~1 : Math.round(metrics.h * dpr);
        const canvas = document.createElement('canvas');
        canvas.width = bw;
        canvas.height = bh;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const input = { chart, scene, metrics, assets, noteIcons, spriteIcon };
        let bytes = 0;
        let err = null;
        const enc = new VideoEncoder({
          output: (c) => { bytes += c.byteLength; c.close?.(); },
          error: (e) => { err = e.message; },
        });
        const cfg = { codec, width: bw, height: bh, bitrate, framerate: 60, latencyMode: 'quality' };
        const support = await VideoEncoder.isConfigSupported(cfg);
        if (!support.supported) return { supported: false, codec, buffer: [bw, bh] };
        enc.configure(cfg);
        const fps = 60;
        const t0 = performance.now();
        let drawMs = 0;
        let snapMs = 0;
        for (let i = 0; i < frames; i++) {
          let t = performance.now();
          ctx.clearRect(0, 0, metrics.w, metrics.h);
          sim.drawSimFrameAt(ctx, input, denseStart + i / fps);
          drawMs += performance.now() - t;
          t = performance.now();
          const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps) });
          snapMs += performance.now() - t; // 快照 = 强制光栅 + 拷一份给编码器
          enc.encode(frame, { keyFrame: i % 60 === 0 });
          frame.close();
          let guard = 0;
          while (enc.encodeQueueSize > 6 && guard++ < 400) await new Promise((r) => setTimeout(r, 0));
        }
        await enc.flush();
        const ms = performance.now() - t0;
        enc.close();
        canvas.width = 0;
        canvas.height = 0;
        return {
          supported: true,
          codec,
          buffer: [bw, bh],
          frames,
          totalMs: Math.round(ms),
          drawMsAvg: Math.round((drawMs / frames) * 100) / 100,
          snapshotMsAvg: Math.round((snapMs / frames) * 100) / 100,
          encodeMsAvg: Math.round(((ms - drawMs - snapMs) / frames) * 100) / 100,
          fps: Math.round((frames / (ms / 1000)) * 10) / 10,
          realtimeRatio: Math.round((frames / fps / (ms / 1000)) * 100) / 100,
          mbitPerSec: Math.round((bytes * 8) / ms / 1000 * 10) / 10,
          err,
        };
      }
      return {
        // 1920×1079（fitDesignSurface 原样）→ H.264 判不支持：奇数是硬门槛
        'H.264 1080p（1079 奇高）': await run('avc1.640028', 1920, 1080, 1, 90, 8_000_000),
        'H.264 1080p（1078 偶高）': await run('avc1.640028', 1920, 1080, 1, 90, 8_000_000, true),
        'VP9 1080p（1079 奇高）': await run('vp09.00.10.08', 1920, 1080, 1, 90, 8_000_000),
        'H.264 720p': await run('avc1.640028', 1280, 720, 1, 90, 4_000_000),
        'H.264 540p': await run('avc1.640028', 960, 540, 1, 90, 2_500_000),
      };
    },
    [chartCode],
  );
  report.e2e = e2e;
  log(e2e);
}

// ================================================================== 6. MediaRecorder 对照
if (want('recorder')) {
  head('6. MediaRecorder + captureStream 对照（存档，不是主路）');
  const rec = await page.evaluate(
    async ([codeText]) => {
      const [sim, geom, skinMod, spriteMod, converter, settingsMod] = await Promise.all([
        import('/src/preview/video/sim/index.ts'),
        import('/src/preview/video/sim/simGeometry.ts'),
        import('/src/rendering/skin/noteSkin.ts'),
        import('/src/ui/CanvasSpriteIcon.tsx'),
        import('/src/chart/editing/ChartConverter.ts'),
        import('/src/chart/config/AppSettings.ts'),
      ]);
      const CanvasSpriteIcon = spriteMod.default;
      const parsed = converter.parseCodeText(codeText);
      const notes = converter.convertChartCodeToNotes(parsed.code);
      const defaults = settingsMod.defaultSettings('en');
      const noteIcons = skinMod.buildActiveNoteIcons(skinMod.normalizeNoteSkinSelection(defaults.visual.noteSkin));
      await CanvasSpriteIcon.ensureImagesLoaded(noteIcons.preloadSrcs()).catch(() => undefined);
      const assets = await sim.loadSimAssets({ bandSrc: noteIcons.slideBand.src, bandSpSrc: noteIcons.slideBandSp.src });
      const scene = {
        notes,
        beatDisplay: defaults.display.beatDisplay ?? 4,
        noteSpeed: defaults.preview.noteSpeed,
        noteSize: defaults.display.noteSize,
        slideOpacity: defaults.display.slideOpacity,
        simultaneousClickLines: defaults.display.simultaneousClickLines,
        colorAssist: defaults.display.colorAssist,
        mirror: false,
      };
      const chart = sim.buildSimChart(scene, noteIcons);
      const spriteIcon = new CanvasSpriteIcon();
      const metrics = geom.fitDesignSurface(1920, 1080);
      const canvas = document.createElement('canvas');
      canvas.width = metrics.w;
      canvas.height = metrics.h;
      const ctx = canvas.getContext('2d');
      const input = { chart, scene, metrics, assets, noteIcons, spriteIcon };

      const mimeCandidates = [
        'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm;codecs=h264',
        'video/mp4;codecs=avc1.640028', 'video/mp4',
      ];
      const support = {};
      for (const m of mimeCandidates) support[m] = MediaRecorder.isTypeSupported(m);

      /** 实时录制 seconds 秒（rAF 驱动，仿真场按真实经过的秒出帧） */
      async function record(mime, seconds, fps) {
        const stream = canvas.captureStream(fps);
        const settings = stream.getVideoTracks()[0]?.getSettings?.() ?? {};
        let err = null;
        const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
        const parts = [];
        rec.ondataavailable = (e) => { if (e.data.size > 0) parts.push(e.data); };
        rec.onerror = (e) => { err = String(e.error ?? e); };
        const t0 = performance.now();
        rec.start();
        let drawn = 0;
        const startSeconds = 20;
        await new Promise((resolve) => {
          const tick = () => {
            const elapsed = (performance.now() - t0) / 1000;
            ctx.clearRect(0, 0, metrics.w, metrics.h);
            sim.drawSimFrameAt(ctx, input, startSeconds + elapsed);
            drawn++;
            if (elapsed >= seconds) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        const wall = performance.now() - t0;
        rec.stop();
        await new Promise((r) => { rec.onstop = r; });
        const blob = new Blob(parts, { type: mime });
        return {
          mime,
          requestedFps: fps,
          trackFps: settings.frameRate ?? null,
          wallMs: Math.round(wall),
          drawnFrames: drawn,
          drawnFps: Math.round((drawn / (wall / 1000)) * 10) / 10,
          bytes: blob.size,
          mbitPerSec: Math.round((blob.size * 8) / wall / 1000 * 10) / 10,
          err,
        };
      }
      return {
        support,
        runs: [
          await record('video/webm;codecs=vp9', 5, 60),
          await record('video/webm;codecs=vp8', 5, 60),
          await record('video/mp4;codecs=avc1.640028', 5, 60),
        ],
      };
    },
    [chartCode],
  );
  report.recorder = rec;
  log(rec);
}

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(report, null, 2));
  log(`\n[json] ${jsonOut}`);
}

await browser.close();
log('\n[done]');
