#!/usr/bin/env bash
# CI 质量门禁（ADR-0022 §5）：CNB 门禁 job 在 push / MR / tag_push 上跑。
# 顺序：装依赖 → 取素材 → 测试 → 构建 → 取件复核。
# 「定义了就永远绿」：npm run lint 与 npm run test:types 有存量错（HANDOFF 记录在案），
# 不进门禁，另排 chore 票逐项清理——清一项收一项，不带着存量红上线。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

npm ci
bash "$CI_DIR/ci-assets.sh"
npm test
npm run build
npm run assets:check

echo "==> 门禁通过"
