#!/usr/bin/env bash
# issue 257 · GitHub macos-latest 无界面冒烟（挂在现有打包 job，不给每次 PR 加 Mac）：
#   1) 空闲 ≥ 30s（issue 210 的 AudioEngine.IDLE_SUSPEND_DELAY_MS）后不再持有 PreventUserIdleSystemSleep；
#   2) 系统级 ⌘Q 后进程消失。禁止用 AppleScript `quit` / `app.quit()` 冒充 ⌘Q 已通。
# 冒烟对象 = 源码模式 `electron .`（与 dmg 分发包有差异，已记在 257 票内）。
set -euo pipefail

IDLE_SECONDS=40
ELECTRON_BIN="node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
RUN_TMP="${RUNNER_TEMP:-/tmp}"
LOG_FILE="$RUN_TMP/aao-macos-smoke.log"
OSA_LOG="$RUN_TMP/aao-macos-smoke-osa.log"

fail() { echo "::error::$1"; exit 1; }
dump_log() {
  echo "::group::$1"
  cat "$2" || true
  echo "::endgroup::"
}

[[ "$(uname -s)" == "Darwin" ]] || fail "此冒烟只能在 macOS runner 上运行"
[[ -x "$ELECTRON_BIN" ]] || fail "找不到 Electron 二进制：${ELECTRON_BIN}（先执行 npm ci）"

echo "启动源码模式 Electron（pid 待记录）"
"$ELECTRON_BIN" . >"$LOG_FILE" 2>&1 &
APP_PID=$!
# 保留原始退出码：trap 内的 kill 成功不能把脚本失败洗成 0（假绿）
trap 'SMOKE_RC=$?; kill "$APP_PID" 2>/dev/null || true; exit "$SMOKE_RC"' EXIT

process_alive() {
  kill -0 "$APP_PID" 2>/dev/null || return 1
  # 子进程未被 shell 回收时 kill -0 对僵尸进程仍成功，按已退出处理
  [[ "$(ps -p "$APP_PID" -o stat= 2>/dev/null | tr -d ' ')" == Z* ]] && return 1
  return 0
}

sleep 5
process_alive || { dump_log "Electron 启动日志" "$LOG_FILE"; fail "Electron 启动后立即退出"; }
dump_log "Electron 启动日志" "$LOG_FILE"

echo "空闲 ${IDLE_SECONDS}s（≥ 30s IDLE_SUSPEND_DELAY_MS）后读 pmset"
sleep "$IDLE_SECONDS"
ASSERTIONS="$(pmset -g assertions 2>&1)"
echo "::group::pmset -g assertions"
printf '%s\n' "$ASSERTIONS"
echo "::endgroup::"

# 先记录电源锁结论、不立即退出：两项断言独立，锁还在时也要把 ⌘Q 退出通道跑完并回报。
# 只认本应用持有的断言：GitHub runner 上 Anka(「Anka sleeplessness」) 与 powerd 常驻
# PreventUserIdleSystemSleep=1，系统汇总值恒为 1，判它等于判 runner 自己的电源策略。
APP_LOCK_LINES="$(printf '%s\n' "$ASSERTIONS" | grep -iE 'aao editor|electron' | grep 'PreventUserIdleSystemSleep' || true)"
LOCK_VALUE="$(printf '%s\n' "$ASSERTIONS" | awk '/^[[:space:]]*PreventUserIdleSystemSleep[[:space:]]+[0-9]+/ {print $2; exit}')"
LOCK_PROBLEM=""
if [[ -n "$APP_LOCK_LINES" ]]; then
  LOCK_PROBLEM="进程级断言仍列出本应用持有 PreventUserIdleSystemSleep：${APP_LOCK_LINES}"
elif [[ -z "$LOCK_VALUE" ]]; then
  LOCK_PROBLEM="pmset 输出没有 PreventUserIdleSystemSleep 汇总行，无法判定"
fi
echo "::group::电源锁判定"
echo "系统汇总 PreventUserIdleSystemSleep=${LOCK_VALUE:-<无>}；本应用持有断言=${APP_LOCK_LINES:-<无>}（runner 基础设施持有不计入）"
echo "::endgroup::"
if [[ -n "$LOCK_PROBLEM" ]]; then echo "::warning::$LOCK_PROBLEM"; fi

echo "探测 System Events 辅助功能权限（issue 257 开工确认：先探权限再决定是否注入）"
AX_STATE="$(osascript -e 'tell application "System Events" to get UI elements enabled' 2>&1 || true)"
echo "System Events UI elements enabled=${AX_STATE}"
if [[ "$AX_STATE" != "true" ]]; then
  fail "runner 未授予 System Events 辅助功能权限（UI elements enabled=${AX_STATE}），无法注入系统级 ⌘Q；实测结论需回报用户后再定，禁止改用 AppleScript quit 冒充"
fi

echo "注入系统级 ⌘Q（不使用 AppleScript quit / app.quit()）"
# 冒烟对象是源码模式 electron .，进程名是 Electron（不是 release/ 里打出来的 AAO Editor.app）；
# 按 pid 置前，避免 LaunchServices 把刚打好的 App 拉起来、⌘Q 打偏目标。
if ! osascript \
  -e "tell application \"System Events\" to set frontmost of first process whose unix id is ${APP_PID} to true" \
  -e 'delay 1' \
  -e 'tell application "System Events" to keystroke "q" using command down' \
  >"$OSA_LOG" 2>&1; then
  dump_log "osascript 注入错误" "$OSA_LOG"
  fail "系统级 ⌘Q 注入失败（常见原因：runner 未授予辅助功能权限）；实测结论需回报用户后再定，禁止改用 AppleScript quit 冒充"
fi

EXITED=0
for _ in $(seq 1 15); do
  if ! process_alive; then EXITED=1; break; fi
  sleep 1
done
if [[ "$EXITED" != "1" ]]; then
  dump_log "Electron 运行日志" "$LOG_FILE"
  fail "系统级 ⌘Q 后进程仍在（pid=${APP_PID}）"
fi

# 退出通道验完再判电源锁，保证首次真机跑即使锁没清也能拿到 ⌘Q 结论
[[ -z "$LOCK_PROBLEM" ]] || fail "$LOCK_PROBLEM"
echo "冒烟通过：空闲后无 PreventUserIdleSystemSleep，系统级 ⌘Q 后进程退出"
