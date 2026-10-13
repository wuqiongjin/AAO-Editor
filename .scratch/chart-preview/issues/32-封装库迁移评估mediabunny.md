# 32-封装库迁移评估：mediabunny 取代 mp4-muxer / webm-muxer

Type: research
Status: resolved（调研已毕 2026-10-11；**结论待用户拍板** —— 用户倾向"跟上游走"，实测数字倾向"缓办"）

**来源**：`npm ci` 的两条 `npm warn deprecated` —— `mp4-muxer@5.2.2` / `webm-muxer@5.1.4` 都写明 "superseded by Mediabunny"；用户 2026-10-11 表示"我认可更新，如果有必要可以建个 issue"。

## 现状（要被改的面有多大）

- 两个封装库是 07 的**运行时**依赖（不是构建期）：`src/preview/video/encode/muxer.ts` 按容器**动态 import**，一次导出只加载当选容器那一份；差异被 `MuxerLike` / `MuxerModule` 两个接口关在这一个文件里。
- 受影响的面很小，共三处：
  - `muxer.ts`：动态 import 的两个模块名 + muxer 选项 + `fastStart: 'in-memory'`；
  - `exportSpec.ts`：`muxerCodec` 的 `V_VP9` / `A_OPUS` / `avc` 字符串 + `muxerAudioCodecFor` 归一；
  - 锁这两处的测试：`tests/static/VideoExportWiring.test.ts`（断言两个依赖在 `package.json`、动态 import 写法、`muxerAudioCodecFor` 归一）、`tests/unit/preview/video/ExportTimeline.test.ts`（`muxerAudioCodecFor` 断言）。
- 既有体积记账：`docs/research/chart-preview-export-limits.md` §5（`mp4-muxer` 5.2.2 = 69,011 B raw / 14,345 B gzip、`webm-muxer` 5.1.4 = 64,944 B / 11,825 B，**协议 = 未压缩 ESM 文件**）。

## 实测体积（2026-10-11，本仓 node 24 / esbuild 0.25.10）

协议统一为 **bundle + minify + gzip**（`--bundle --minify --format=esm --target=es2022`，再 `gzip -c | wc -c`），四行同协议可比；**不要**与上文那份"未压缩 ESM"的旧账交叉比。入口 = 每行括注的最小用法（"建槽 + 喂 chunk"）。

| 入口 | raw | gzip |
| --- | --- | --- |
| `webm-muxer@5.1.4`（`Muxer` + `ArrayBufferTarget`） | 27.8 KB | **7.7 KB** |
| `mp4-muxer@5.2.2`（同上 + `fastStart: 'in-memory'`） | 31.2 KB | **9.1 KB** |
| `mediabunny@1.61.3`（`Output` + `Mp4OutputFormat` + `WebMOutputFormat` + `BufferTarget` + 两类 `EncodedXxxPacketSource` + `EncodedPacket.fromEncodedChunk`） | 150.6 KB | **39.5 KB** |
| `mediabunny@1.61.3`（只 mp4 一份） | 119.2 KB | **31.7 KB** |

- mediabunny **可 tree-shake**（它的 ESM 入口是一棵 71 个模块 / 2.06 MB raw / 392 KB gzip 的树，官方 min bundle 全量 691 KB / 177 KB gzip；上面 150 KB 是摇完的结果）——但还是现方案单容器的 **≈4.3×（gzip）**。
- 现方案"按容器动态 import、一次只付一份"在 mediabunny 上省不掉等价的东西：两种格式同在一个包、共享同一份核心，任何一份都带核心。
- **兼容性核对通过**：`Output` / `Mp4OutputFormat({ fastStart: 'in-memory' })` / `WebMOutputFormat` / `BufferTarget` / `EncodedVideoPacketSource` / `EncodedAudioPacketSource` / `EncodedPacket.fromEncodedChunk` 在 1.61.3 的 `dist/mediabunny.d.ts` 里全部存在 ⇒ 迁移是"改一个文件 + 改 spec 里的 codec 字符串 + 改两条断言"的量级，**不是重写**。

## 结论与建议

- **可行**：接口面对得上、桥接方法现成、动态 import 结构可平移。这不是"技术上做不到"的问题。
- **但收益 = 0、成本 = gzip +30 KB（3.5~4.3×）**：两个旧库都没有已知缺陷（0 运行时依赖、单文件、离线导出路径不碰网络），"deprecated" 的唯一含义是上游把作者精力搬去了 mediabunny。本仓对体积是**记账到 gzip 字节**的口径（07 的票面要求 + research §5），为一个纯噪音的警告把封装成本抬到 4 倍不划算。
- **本轮实现口径（待用户拍板）**：**不迁移**，本条按"已知 + 已记账"存档；`npm ci` 的那两条 deprecated 警告当噪音。**用户 2026-10-11 说过"我认可更新"，若就此要跟上游走，说一声即按下面的落点执行——票不重开。**
- **唯一值得为之重开迁移的情形**：需要 mediabunny 独有的**流式落盘**能力 —— 它有 `StreamTarget` / `AppendOnlyStreamTarget`，能边封装边写；当前 `ArrayBufferTarget` 是整条视频在内存里攒完再另存（research §3 记过长谱导出峰值 RSS +500 / +735 MB）。若长谱导出撞到内存上限、或要做"边导边落盘"，那时体积不是主要矛盾，回来做。

## 若是要迁移：落点清单

1. `src/preview/video/encode/muxer.ts` —— 换成 `Output` + `XxxOutputFormat` + `EncodedXxxPacketSource`，`addVideoChunk` / `addAudioChunk` 改 `source.add(EncodedPacket.fromEncodedChunk(chunk))`；
2. `src/preview/video/encode/exportSpec.ts` —— `muxerCodec` 的字符串改形（mediabunny 按 codec 标识建 source），`muxerAudioCodecFor` 保留与否看新 API；
3. `package.json` 去掉两个库、加 `mediabunny`，`package-lock.json` 随之更新；
4. 两处锁测（`VideoExportWiring` / `ExportTimeline`）按新写法重写；
5. `docs/research/chart-preview-export-limits.md` §5 的体积表补 mediabunny 一行（标协议），并在 07 票内记一次新的体积账。

## 复算

```bash
mkdir -p /tmp/mbsize && cd /tmp/mbsize
npm i --silent mediabunny@1.61.3 && npm i --silent webm-muxer@5.1.4 mp4-muxer@5.2.2
# e_mb.js / e_mp4.js 见上表括注的最小用法
/workspace/node_modules/.bin/esbuild e_mb.js --bundle --minify --format=esm --target=es2022 --outfile=out.js
gzip -c out.js | wc -c    # → 39,460（mediabunny 两种格式）；mp4-muxer 单独 = 9,125
```

（esbuild 由本仓 vite 链自带；±10% 与最终 rollup 产物可能不同，量级不受影响。）

## Comments

### 2026-10-11 开票

用户问"mediabunny 可以修复吧"。本轮把"能不能修"和"值不值得修"分开实测：**修得了，但按本仓的体积口径不该现在修**。数字与协议都写在正文，未动任何代码。用户若拍板要迁，正文的落点清单可直接执行，本票状态改 claimed 即可。
