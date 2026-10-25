# 42 · Windows 覆盖 cover.bin 时 rename EPERM

Type: bug
Status: resolved
Blocked by: —

**来源**：用户 2026-10-25 `npm run electron:dev`，`project:put` 写 `cover.bin`：`EPERM rename …cover.bin.tmp-… → cover.bin`。与 176 谱面名无关。

**根因**：原子写是 tmp + `rename` 覆盖。Win32 目标文件被占用（列表读封面 / 资源管理器 / 杀毒）时 rename 不能替换，报 EPERM。POSIX 无此问题。

**修法**：`atomicWrite.cjs` 增加 `renameOver`：EPERM/EACCES 时短暂重试（先卸目标再 rename）。`writeFileAtomic` / 同步版 / `copyCachedFile` 共用。

**锁测**：`AtomicWrite.test.ts` 覆盖已存在文件仍绿；静态断言源码含 EPERM 重试。真锁需要 Windows 句柄，本机 electron:dev 再验。
