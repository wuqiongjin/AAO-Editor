#!/usr/bin/env bash
# CNB → GitHub 代码镜像（ADR-0022 §2）：推 main + 全部 tags，**非 force**。
# 语义：没人往 GitHub 写时与 force 无差别；GitHub 侧出现未回流提交（如已合并 PR）时
# push 被拒绝 → job 响亮失败，绝不静默覆盖。纪律：GitHub 侧合并先回流 CNB 再推。
# 首次同步（抹掉 GitHub 上 24 commit 脚手架）由用户手动执行一次 force，此脚本不兜。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "ERROR: 未设置 CNB secret GITHUB_TOKEN（fine-grained PAT，contents:写，仅代码仓）" >&2
  exit 1
fi
MIRROR_REPO="${GITHUB_MIRROR_REPO:-wuqiongjin/AAO-Editor}"

REMOTE_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/${MIRROR_REPO}.git"
if git remote get-url github >/dev/null 2>&1; then
  git remote set-url github "$REMOTE_URL"
else
  git remote add github "$REMOTE_URL"
fi

# 只取要推的两个命名空间；不带 --force、不带 +refspec。
# heads 只能进 refs/remotes/：非 bare 仓 fetch 进已检出的 refs/heads/main 会被 git 拒绝
# （CNB runner 工作区检出 main，2026-10-19 镜像首跑实证：refusing to fetch into branch）。
git fetch --no-tags origin "refs/heads/main:refs/remotes/origin/main" "refs/tags/*:refs/tags/*"

echo "==> 镜像 main → github:${MIRROR_REPO}（非 force）"
git push github "refs/remotes/origin/main:refs/heads/main"

if [[ -n "$(git for-each-ref --format='%(refname)' refs/tags)" ]]; then
  echo "==> 镜像 tags → github:${MIRROR_REPO}（非 force，只推不删）"
  git push github "refs/tags/*:refs/tags/*"
else
  echo "==> 无 tag，跳过"
fi
echo "==> 镜像完成"
