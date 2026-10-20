# 09-GitHub 侧门禁（公开主仓库的分支 / tag / PR 检查）

Type: grilling
Status: claimed
Blocked by: —

**来源**：用户 2026-10-20 诉求「github 还是得配置一下门禁吧？毕竟对外公开的主仓库其实是 github」。ADR-0022 的分工里门禁全在 CNB，GitHub 只被单向推送；本票把 GitHub 侧从「零保护」补到与公开面孔相称。

## 症状

- GitHub 仓（public，README 下载 / 更新源 / clone 入口三处指向）`main` 无任何分支保护：无 PR 要求、无必过检查、无关停直推的机制。
- ADR-0022 §2 的回流路径（他人在 GitHub merge PR）零检查直达公开 `main`——CNB 门禁要等回流后才看得到，坏代码已公开过一轮。
- 发版通道无 tag 保护：任何 `v*` tag push（含被改指向）都能触发公开发布 workflow。
- 残留公开 `master` 分支（24 commit 旧脚手架；默认分支早已是 `main`）——名实不符。
- Actions 权限未收紧（默认值，未逐项核）。

## 根因

- ADR-0022 拍板时把「门禁」整个放在 CNB 侧（工作台语义），GitHub 定位「公开面孔」只承接镜像与发版；§8 否决「双边 CI」时未区分「常态路径双跑」与「罕见回流 PR 的门禁」——后者正是缺口。

## 定案（2026-10-20 用户拍板：tag 口径 = B + 发版 workflow 门禁兜底；其余为本轮实现口径，用户未异议）

1. **PR 门禁 workflow**：`.github/workflows/ci.yml`，`pull_request → main` → 单 job `gate` → `scripts/ci/ci-gate.sh`（与 CNB 同一脚本，口径一处定义）。必过检查名 = `gate`。镜像 push 不触发——不与 CNB 双边重复跑（§8 否决项的口径边界）。
2. **fork PR 语义**：素材快照仓 private（ADR-0022 §3），`ASSETS_SOURCE` 不在 fork PR 注入 → 门禁**明确失败并指路**（维护者把分支推入本仓后重跑，或走 CNB MR）。不静默跳过：红着比绿着安全，必过检查挡住合并正是门的语义。
3. **`main` 分支规则（ruleset「protect-main」）**：禁 force push / 禁删除；必须走 PR（required approvals = 0，单人仓自己合自己）；必过 `gate` 且分支最新；**不对管理员放开绕过**，bypass 只放镜像 PAT（镜像照常快进，其余直推被拒）。
4. **`v*` tag 规则（ruleset「protect-release-tags」）**：授权身份 = 镜像 PAT **+ 仓库管理员**（用户 2026-10-20 拍板 B：直推灵活性要保留——应急能直推）；禁更新、禁删除（对齐 ADR-0022 §2「tag 只推不删不覆盖」）。直推的对价见定案 7。
5. **Actions 权限**：workflow 默认 read-only（release.yml 自提 `contents: write` 不动）；关闭「允许 Actions 创建 / 批准 PR」；保留首次贡献者审批默认。
6. **存量清理**：删除 GitHub 残留 `master`。
7. **发版 workflow 门禁兜底**（用户 2026-10-20 拍板，B 的直接后果）：release.yml 原 `verify` job 升级为 `gate`——tag↔version 校验 + `ci-gate.sh` 三件套（ubuntu 单平台，job 级 `contents: read`），过才 `needs: gate` 进三平台矩阵；手动 dispatch 同样过。代价：常态发版（CNB 打 tag → 镜像）门禁跑两次（CNB + GitHub），用户接受——换「发布物必然过门禁」+「应急能直推」。

## 实现落点

- 新增 `.github/workflows/ci.yml`。
- `tests/static/ReleasePipeline.test.ts`：补 3 条锁（触发面唯一、复用 ci-gate.sh + 检查名 `gate`、fork 缺 secret 明确失败）+ ci.yml 进 Bestdori 扫描与凭据扫描两处。
- ADR-0022：§1 职责划分、§5 双侧同脚本与口径边界、§8 否决项边界注释、新增 §9；变更触发清单加「GitHub 侧门禁配置」。
- 双 README「仓库结构」段补门禁表述（双语静态锁测防腐烂）。
- `scripts/README.md` CI 表补 ci.yml 行。

## 锁测

- `tests/static/ReleasePipeline.test.ts` 新增 3 条：`PR 门禁 workflow 只监听 pull_request → main`（含禁 `pull_request_target`——base 上下文带 secret 跑 fork 代码是凭据外泄面）/ `PR 门禁复用 ci-gate.sh，必过检查名 = gate` / `PR 门禁取素材凭据走 secret，fork PR 缺 secret 明确失败`。
- 既有锁不受影响：release.yml 仍 tag-only 断言、镜像双触发、门禁三件套、素材仓名扫描（`.github` 整树在扫范围内，ci.yml 自动纳入）。

## 人工步骤（用户执行，配置写法由本票给出）

1. GitHub repo → Settings → Rules → Rulesets → **New branch ruleset**（名 `protect-main`，目标 `main`）：Block force pushes / Block deletions / Require a pull request before merging（required approvals = 0）/ Require status checks（加 `gate`，勾 Require branches to be up to date）/ Require conversation resolution；**Bypass list 只加镜像 PAT**（fine-grained PAT 身份，按 PAT 名搜索）。
2. **New tag ruleset**（名 `protect-release-tags`，目标 `v*`）：Restrict creations（bypass list = 镜像 PAT + 仓库管理员）/ Restrict updates / Restrict deletions。
3. Settings → Actions → General：Workflow permissions 保持 read-only；取消「Allow GitHub Actions to create and approve pull requests」；Fork PR 审批保留默认（首次贡献者需批准）。
4. 删除残留分支：`git push github --delete master`（本地未加 remote 则先 `git remote add github https://github.com/wuqiongjin/AAO-Editor.git`）。
5. 冒烟：本仓开一个分支提 PR（改一行无关文案）→ `gate` 跑绿 → 合并 → 确认 CNB 镜像快进不受规则影响（PAT bypass 生效）。

## Comments

### 2026-10-20 诉求与实现口径

- 用户原话点出本质：ADR-0022 的门禁全在 CNB，但对外公开的主仓库是 GitHub——公开 `main` 不能只靠「镜像非 force 会响亮失败」做事后保护。
- 关键口径边界（已写进 ADR-0022 §5 / §8）：§8 否决的「双边 CI」指常态路径两边重复跑；GitHub PR 门禁只服务罕见回流 PR，镜像 push 不触发 GitHub workflow，常态仍是单边 CI。
- fork PR 红检而非跳过：素材仓 private 是既定决策（ADR-0022 §3），fork 拿不到 `ASSETS_SOURCE` 是物理事实；给出「推分支进本仓重跑 / 走 CNB MR」两条明路。
- 待用户确认项（默认值已按上述口径落地，可调）：required approvals = 0 vs 1；bypass 名单是否额外放仓库管理员（直推 emergency 路径）；tag 规则是否本期就上。

### 2026-10-20 tag 口径拍板：B + 发版门禁兜底

- 用户原话：「B 吧。肯定要保留直推的灵活性。不然就给 github 的 ci 也加上，当 push tag 的时候，强制跑一下门禁，这样能防止发布的版本跑不过门禁。」
- 追问「PAT 是什么 / 流程」后用户理解了镜像机器人身份与两把钥匙（PAT + 管理员）的模型，据此拍板。
- 落地：tag 规则 bypass = PAT + 管理员（灵活性保留）；release.yml `verify` job → `gate` job（tag↔version + `ci-gate.sh` 三件套，ubuntu 单平台，矩阵 `needs: gate`）——直推的 tag 没过 CNB 门禁，由 GitHub 侧兜底，跑不过门禁的 tag 发不出正式 Release。
- 口径边界回写 ADR-0022 §5 / §8：§8 否决的「双边 CI」唯一例外 = tag 发版路径双跑（换直推灵活性的对价，非疏漏）；PR 路径仍只 GitHub 跑，镜像 push 仍不触发。
- 剩余待应用项（用户）：分支 / tag 规则、Actions 权限、删 `master`（「人工步骤」节）。
