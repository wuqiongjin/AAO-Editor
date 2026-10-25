export type UpdateFailureKind = 'network' | 'checksum' | 'disk' | 'permission';

/** 网络 / HTTP 才提示换下载源；校验、磁盘、权限只说原因（ADR-0021 §2）。 */
export function classifyUpdateFailure(message: string | undefined): UpdateFailureKind {
  const m = String(message ?? '').toLowerCase();
  if (/sha512|checksum|code signature|not been signed|blockmap checksum/.test(m)) return 'checksum';
  if (/enospc|no space|disk full|edquot/.test(m)) return 'disk';
  if (/eacces|eperm|erofs|permission denied|access is denied/.test(m)) return 'permission';
  return 'network';
}
