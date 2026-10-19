#!/usr/bin/env bash
# 素材取件（CI 用，ADR-0022 §3）——门禁 job 与 GitHub Actions 发版共用。
# 来源：ASSETS_SOURCE（显式地址，本地目录 / 带凭据 git 地址）> assets-sync.mjs 内置默认源
# （内置源是 CNB 地址时，环境里的 CNB_TOKEN 会自动拼成凭据——注意：CNB 流水线内置的
#  CNB_TOKEN 作用域仅限当前仓，读不了私有快照仓；CI 里 ASSETS_SOURCE 走密钥仓 env.yml
#  注入，本地 export 个人访问令牌（需有快照仓读权限）亦可）。
# 锁测：tests/static/ReleasePipeline.test.ts
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

SOURCE="${ASSETS_SOURCE:-}"
if [[ -n "$SOURCE" ]]; then
  echo "==> 素材取件（外部来源）"
  node scripts/assets-sync.mjs --from "$SOURCE"
else
  echo "==> 素材取件（默认来源；CNB_TOKEN 在时会自动拼凭据）"
  npm run assets:sync
fi
