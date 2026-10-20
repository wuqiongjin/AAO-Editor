# scripts/ci/ 共用前导：定位仓库根并切过去（CI 脚本不依赖调用 cwd）。
# 由本目录下各脚本 source；勿在此处 set -e（各脚本自管）。
# 锁测：tests/static/ReleasePipeline.test.ts
CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$CI_DIR/../.." && pwd)"
cd "$REPO_ROOT"
