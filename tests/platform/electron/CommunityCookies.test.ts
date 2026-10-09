// 票 07：会话 Cookie jar（主进程内存，renderer 永远拿不到）。
// 10 接登录时会用 snapshot() / restore() 把它落到 safeStorage；这里锁 jar 自己的语义。
import { describe, expect, it } from 'vitest';
import { createCookieJar, parseSetCookie } from '@/electron/communityCookies.cjs';

describe('票 07 · Set-Cookie 解析', () => {
  it('域 / 路径 / Max-Age 都认；缺 Domain 时用响应来源主机', () => {
    expect(parseSetCookie('token=abc', 'bestdori.com', '/api/user/login', 0)).toEqual({
      name: 'token',
      value: 'abc',
      domain: 'bestdori.com',
      path: '/api/user',
      expiresAt: null,
      secure: false,
      httpOnly: false,
    });

    expect(
      parseSetCookie('token=abc; Domain=.bestdori.com; Path=/; Max-Age=60; Secure; HttpOnly', 'bestdori.com', '/api/x', 1000),
    ).toEqual({
      name: 'token',
      value: 'abc',
      domain: 'bestdori.com',
      path: '/',
      expiresAt: 61_000,
      secure: true,
      httpOnly: true,
    });

    const withExpires = parseSetCookie('token=abc; Expires=Wed, 21 Oct 2026 07:28:00 GMT', 'bestdori.com', '/', 0);
    expect(withExpires?.expiresAt).toBe(Date.parse('Wed, 21 Oct 2026 07:28:00 GMT'));
  });

  it('没有 name 的脏条目直接丢', () => {
    expect(parseSetCookie('broken', 'bestdori.com', '/', 0)).toBeNull();
    expect(parseSetCookie('=abc', 'bestdori.com', '/', 0)).toBeNull();
  });
});

describe('票 07 · 附着与捕获', () => {
  it('捕获后同主机请求带着 Cookie；不改入参对象', () => {
    const jar = createCookieJar({ now: () => 1000 });
    jar.capture('https://bestdori.com/api/user/login', ['token=abc; Path=/; HttpOnly']);

    const headers = { accept: 'application/json' };
    const attached = jar.attach('https://bestdori.com/api/user/me', headers);
    expect(attached).toEqual({ accept: 'application/json', cookie: 'token=abc' });
    expect(headers).toEqual({ accept: 'application/json' });
  });

  it('主机与路径都要匹配才发（别的域不串味）', () => {
    const jar = createCookieJar({ now: () => 1000 });
    jar.capture('https://bestdori.com/api/user/login', ['token=abc']);
    expect(jar.attach('https://assets.bestdori.com/x', {}).cookie).toBeUndefined();
    expect(jar.attach('https://other.com/x', {}).cookie).toBeUndefined();

    const scoped = createCookieJar({ now: () => 1000 });
    scoped.capture('https://bestdori.com/api/user/login', ['token=abc; Path=/community']);
    expect(scoped.attach('https://bestdori.com/api/user/me', {}).cookie).toBeUndefined();
    expect(scoped.attach('https://bestdori.com/community/charts/1', {}).cookie).toBe('token=abc');
  });

  it('长路径优先；secure 只在 https 上发', () => {
    const jar = createCookieJar({ now: () => 1000 });
    jar.capture('https://bestdori.com/api/user/login', ['token=root; Path=/', 'token=deep; Path=/api/user', 'secret=s; Path=/; Secure']);
    expect(jar.attach('https://bestdori.com/api/user/me', {}).cookie).toBe('token=deep; token=root; secret=s');
    expect(jar.attach('http://bestdori.com/api/user/me', {}).cookie).not.toContain('secret');
  });

  it('Max-Age=0 与已过期即删；过期条目不再发', () => {
    let now = 1000;
    const jar = createCookieJar({ now: () => now });
    jar.capture('https://bestdori.com/api/x', ['token=abc; Path=/; Max-Age=60']);
    expect(jar.attach('https://bestdori.com/api/y', {}).cookie).toBe('token=abc');

    now = 1000 + 61_000;
    expect(jar.attach('https://bestdori.com/api/y', {}).cookie).toBeUndefined();

    jar.capture('https://bestdori.com/api/x', ['token=abc; Path=/; Max-Age=600']);
    jar.capture('https://bestdori.com/api/x', ['token=; Path=/; Max-Age=0']);
    expect(jar.snapshot()).toEqual([]);
  });

  it('clear 清空内存 jar（登出）', () => {
    const jar = createCookieJar({ now: () => 1000 });
    jar.capture('https://bestdori.com/api/x', ['token=abc; Path=/']);
    jar.clear();
    expect(jar.attach('https://bestdori.com/api/y', {}).cookie).toBeUndefined();
  });
});

describe('票 07 · 持久化接缝（10 接 safeStorage）', () => {
  it('snapshot → restore 往返；脏条目丢掉', () => {
    const first = createCookieJar({ now: () => 1000 });
    first.capture('https://bestdori.com/api/user/login', ['token=abc; Path=/; Max-Age=600']);
    const saved = first.snapshot();
    expect(saved).toHaveLength(1);

    const second = createCookieJar({ now: () => 1000 });
    second.restore([...saved, null, { name: 1 }, { name: 'x', domain: 'bestdori.com' }]);
    expect(second.attach('https://bestdori.com/api/user/me', {}).cookie).toBe('token=abc');
  });

  it('restore 是替换而不是叠加', () => {
    const jar = createCookieJar({ now: () => 1000 });
    jar.capture('https://bestdori.com/api/x', ['old=1; Path=/']);
    jar.restore([{ name: 'new', value: '2', domain: 'bestdori.com', path: '/', expiresAt: null }]);
    expect(jar.attach('https://bestdori.com/api/y', {}).cookie).toBe('new=2');
  });
});
