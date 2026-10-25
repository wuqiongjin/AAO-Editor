import { describe, expect, it } from 'vitest';
import { classifyUpdateFailure } from '@/src/app/updateFailure';

describe('ADR-0021 · 更新失败分类', () => {
  it('网络 / HTTP 算 network', () => {
    expect(classifyUpdateFailure('net::ERR_CONNECTION_TIMED_OUT')).toBe('network');
    expect(classifyUpdateFailure('HttpError: 404 Not Found')).toBe('network');
    expect(classifyUpdateFailure('getaddrinfo ENOTFOUND github.com')).toBe('network');
    expect(classifyUpdateFailure('')).toBe('network');
  });

  it('校验、磁盘、权限不算 network', () => {
    expect(classifyUpdateFailure('sha512 checksum mismatch')).toBe('checksum');
    expect(classifyUpdateFailure('ENOSPC: no space left on device')).toBe('disk');
    expect(classifyUpdateFailure('EACCES: permission denied')).toBe('permission');
  });
});
