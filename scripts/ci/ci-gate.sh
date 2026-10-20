#!/usr/bin/env bash
# CI 质量门禁（ADR-0022 §5）：CNB 门禁 job 在 push / MR / tag_push 上跑；
# pull_request 段走 --stub-assets 桩驱动例外（无快照环境，见下与 ADR-0022 §5）。
# 顺序：装依赖 → 取素材 → 测试 → 构建 → 取件复核。
# --stub-assets（release-pipeline 10）：无素材快照的环境（PR 事件不注入密钥仓库）
#   以最小合法桩顶替取件并跳过取件复核，其余步骤与口径不变。
# 「定义了就永远绿」：npm run lint 与 npm run test:types 有存量错（HANDOFF 记录在案），
# 不进门禁，另排 chore 票逐项清理——清一项收一项，不带着存量红上线。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

STUB_ASSETS=0
for arg in "$@"; do
  case "$arg" in
    --stub-assets) STUB_ASSETS=1 ;;
    *) echo "未知参数：$arg" >&2; exit 2 ;;
  esac
done

npm ci
if [[ "$STUB_ASSETS" == "1" ]]; then
  node scripts/ci/ci-stub-gen.mjs
else
  bash "$CI_DIR/ci-assets.sh"
fi
npm test
npm run build
if [[ "$STUB_ASSETS" == "0" ]]; then
  npm run assets:check
fi

echo "==> 门禁通过"
