// 素材快照可用性判别（release-pipeline 10）。
//
// 快照由外部镜像仓提供、不入 git（scripts/assets-sync.mjs 取件到
// src/audio/gen、src/rendering/skin/gen 等 .gitignore 目录）。PR 事件流水线不注入
// 密钥仓库，取件改用最小合法桩（scripts/ci/ci-stub-gen.mjs）；仅对真实快照数据
// 有效的守约套件据此跳过，push / tag_push 门禁有真快照，全量执行。
//
// 判别法：全部注册表文件均存在且不带 CI-STUB 桩标记——与 ci-stub-gen.mjs 逐文件
// 写入的口径对齐（任一项缺失 / 是桩 → 非就绪，守约套件跳过）。assets:sync 取件为
// 整根替换，真快照落地后标记自然消失，无需额外清理。
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REGISTRIES = [
  resolve(repoRoot, 'src/audio/gen/keySoundRegistry.gen.ts'),
  resolve(repoRoot, 'src/rendering/skin/gen/noteSkinRegistry.gen.ts'),
  resolve(repoRoot, 'src/preview/video/sim/gen/simAssetPacks.gen.ts'),
];

export const hasAssetSnapshot: boolean = REGISTRIES.every(
  (file) => existsSync(file) && !readFileSync(file, 'utf8').includes('CI-STUB'),
);
