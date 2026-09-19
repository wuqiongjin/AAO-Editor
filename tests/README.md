# tests/ 目录约定

> 本目录的分组方式服务于两个目标：
> 1. **按被测领域找得到** —— 目录镜像 `src/` 的领域划分，不是"一个大平层"。
> 2. **按测试类型分得开** —— 纯函数单测、平台测试、性能回归、源码结构锁各自有家，
>    未来接新平台（Web / 移动端…）可以整目录新增，而不是往同一个文件夹里继续堆。

## 目录结构

```
tests/
├── support/            测试基建（共享替身），不含 .test.ts，不参与收集
│   ├── canvas.ts       假 2d context（记录型 / 计数型）与假离屏位图
│   ├── source.ts       静态源码断言工具：repoRoot / readSource / stripComments
│   ├── storage.ts      内存版 Storage（只认 bangdream.settings.v1）
│   └── fs.ts           临时目录
│
├── unit/               纯函数单测，子目录镜像 src/ 的领域
│   ├── audio/          src/audio
│   ├── chart/
│   │   ├── code/       谱面代码解析 / 序列化（ChartConverter 一族）
│   │   ├── config/     AppSettings 相关（面板宽度、曲线配置、界面语言…）
│   │   ├── editing/    编辑操作纯函数（最大的一组）
│   │   ├── geometry/   ChartGeometry / BpmTimeline
│   │   ├── layout/     SurfaceSizeMerger 等布局
│   │   └── project/    工程持久化
│   ├── layouts/        src/layouts 外壳几何
│   ├── playback/       播放条 / 滚动模型
│   ├── settings/       快捷键配置与索引筛选
│   ├── tools/          tools/ 下的独立脚本（sprite-locator）
│   ├── ui/             src/ui 通用组件
│   └── visual/
│       ├── cache/      瓦片 / 静态层缓存
│       ├── hitTest/    命中测试
│       ├── render/     render* 绘制纯函数
│       └── skin/       音符皮肤与字形
│
├── platform/           依赖具体平台的测试（脱离该平台即无意义）
│   ├── electron/       electron/*.cjs 主进程纯函数 + 数据根 / 窗体状态 / IPC 桥
│   └── browser/        浏览器专属行为（如 dpr 缩放探针）
│
├── perf/               性能回归：断言"调用次数 / 重建块数"，不断言像素
└── static/             源码结构锁：不 import 被测模块，读源码文本断言接线事实
```

## 各类型的取舍

| 类型 | 什么时候用 | 例子 |
| --- | --- | --- |
| `unit/` | 被测对象是纯函数 / 可注入依赖的类，node 环境能直接跑 | `visual/render/GridStyle.test.ts` |
| `platform/` | 结论只在某个平台上成立（Electron 数据根、浏览器 dpr） | `platform/electron/ElectronDataRoot.test.ts` |
| `perf/` | 关心"画了多少次、重建了几块"，不关心画成什么样 | `perf/RendererPerf.test.ts` |
| `static/` | 结论是**接线事实**（preload 必须暴露某 IPC、某文件不得出现 localStorage），组件无法脱离 DOM 单测 | `static/EditorAudioSessionRefactor.test.ts` |

`static/` 是本仓应对"没有 React/DOM 测试基建"的过渡手段，能写成真单测的不要放这里。

## 命名约定

- 文件名用 **PascalCase**，描述**被测的行为 / 领域**，不是被测文件名：
  `HiddenNode.test.ts`、`NegativeBpm.test.ts`（一个测试文件可以跨多个模块）。
- 平台归属靠**目录**表达，不再用 `.electron.test.ts` 这类后缀。
- `describe` 标题里保留 `issue NN ·` 前缀可以，但**不要**用 issue 号当文件名——issue 会关，领域不会。

## 引用被测代码

一律用仓库根别名，**不要用相对路径**：

```ts
import { renderChart } from '@/src/visual/render';
import { loadWindowStateSync } from '@/electron/windowState.cjs';
import { repoRoot } from '@/tests/support/source';
```

别名在 `vitest.config.ts`（`resolve.alias`）与 `tsconfig.test.json`（`paths`）各配一份。
这样做的原因：测试目录会继续按领域分层、加深度，相对路径每挪一次就要全改一遍。

**新增大类目录**（如 `tests/e2e`）需要在 `vitest.config.ts` 的 `test.include` 里显式登记，
否则不会进入默认全量跑 —— 这是有意的：慢测试不该悄悄混进日常回归。

## 环境

- `environment: 'node'`。没有 jsdom / happy-dom 依赖，也没有 `setupFiles`。
- 目前没有任何测试真的访问 `window` / `document` / `AudioContext`；
  渲染类测试靠 `support/canvas.ts` 的假 2d context + 生产代码留的注入点
  （`__setTileCanvasFactoryForTests` 等）。
- 若将来要引入真实 DOM 渲染测试，需要新增 jsdom 依赖，并给那部分测试单独配 `environment`，
  不要全局改成 jsdom。

## 常用命令

```bash
npm test              # vitest run（unit + platform + static + perf）
npm run test:watch
npm run test:types    # 仅类型检查 tests/（当前有存量报错，见下）
npx vitest run tests/unit/chart/editing   # 只跑某个领域
```

## 已知欠账

`npm run test:types` 有 **28 个存量类型错误**（原 70），原因是测试里的 fixture
没跟上 `src/` 的类型演进（如 `DragAnchor.layerSegment`）。

**当前口径：tests 不做类型检查，这是有意的选择，不是忘了修。**

- 这 30 条**不影响任何测试通过**——vitest 只做运行时检查，`tests/` 也不在 `tsc -b` 里。
- 其中约 23 条无法批量修：`CanvasGesture` / `CurveTool` 是**故意**只传关心的字段（`cx`/`cy`
  运行时为 `undefined`），为过类型检查补 `cx: 0` 会把 `undefined` 变成 `0`，**反而改了测试行为**。
- 因此 `tsconfig.test.json` **不接入**根 `tsconfig.json` 的 references，也**不进 CI**。

**什么时候该回来处理**：要把 tests 纳入类型门禁时（`tsc -b` 或 CI required check）。
在那之前这 30 条属于"已知、接受"，新增代码不必为它让路，但也别再新增。

`tests/tsconfig.json` 存在的唯一目的：让编辑器能解析 `@/` 别名（tsserver 只认最近祖先的
`tsconfig.json`，根目录那份是 `files: []` 的 solution 风格、不收 tests）。它**不是**门禁配置。
