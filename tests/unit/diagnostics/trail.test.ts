import { describe, expect, it } from 'vitest';
import { createTrail, serializeTrailEvent, type TrailEvent } from '@/src/diagnostics/trail';

const AT = new Date('2026-10-19T07:32:00.000Z');

function event(partial: Omit<TrailEvent, 'ts'> & { ts?: string }): TrailEvent {
  return { ts: AT.toISOString(), ...partial };
}

describe('票 02 · 操作轨迹 ring', () => {
  it('容量 500：溢出丢最旧、保序', () => {
    const trail = createTrail({ now: () => AT, capacity: 500 });
    for (let n = 0; n < 501; n++) {
      trail.record({ module: 'nav', action: 'page', meta: { n } });
    }
    const snap = trail.snapshot();
    expect(snap).toHaveLength(500);
    expect(snap[0]).toEqual(event({ module: 'nav', action: 'page', meta: { n: 1 } }));
    expect(snap[499]).toEqual(event({ module: 'nav', action: 'page', meta: { n: 500 } }));
  });

  it('flush 只把尚未写出的条目交给 persist；再次 flush 不重复', () => {
    const persisted: TrailEvent[] = [];
    const trail = createTrail({
      now: () => AT,
      persist: (row) => persisted.push(row),
    });
    trail.record({ module: 'project', action: 'open', result: 'ok', meta: { projectId: 'p1' } });
    trail.record({ module: 'project', action: 'save', result: 'ok', meta: { projectId: 'p1' } });
    trail.flush();
    expect(persisted).toEqual([
      event({ module: 'project', action: 'open', result: 'ok', meta: { projectId: 'p1' } }),
      event({ module: 'project', action: 'save', result: 'ok', meta: { projectId: 'p1' } }),
    ]);
    trail.flush();
    expect(persisted).toHaveLength(2);
    trail.record({ module: 'settings', action: 'change', meta: { keys: ['theme'] } });
    trail.flush();
    expect(persisted[2]).toEqual(event({ module: 'settings', action: 'change', meta: { keys: ['theme'] } }));
    expect(persisted).toHaveLength(3);
  });

  it('溢出已 flush 的条目后，下一次 flush 只写仍留在 ring 里的新条目', () => {
    const persisted: TrailEvent[] = [];
    const trail = createTrail({
      now: () => AT,
      persist: (row) => persisted.push(row),
      capacity: 2,
    });
    trail.record({ module: 'nav', action: 'page', meta: { n: 0 } });
    trail.record({ module: 'nav', action: 'page', meta: { n: 1 } });
    trail.flush();
    trail.record({ module: 'nav', action: 'page', meta: { n: 2 } });
    trail.flush();
    expect(persisted.map((row) => (row.meta as { n: number }).n)).toEqual([0, 1, 2]);
  });

  it('flush 返回的 Promise 在所有 persist 落盘后才 resolve；单条失败不拖垮整批', async () => {
    const order: string[] = [];
    const trail = createTrail({
      now: () => AT,
      persist: (row) =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            order.push(row.action);
            resolve();
          }, 5);
        }),
    });
    trail.record({ module: 'community', action: 'login-start' });
    trail.record({ module: 'community', action: 'login-end', result: 'ok' });
    const done = trail.flush();
    expect(order).toEqual([]);
    await done;
    expect(order).toEqual(['login-start', 'login-end']);

    const rejecting = createTrail({
      now: () => AT,
      persist: () => Promise.reject(new Error('ipc down')),
    });
    rejecting.record({ module: 'community', action: 'login-start' });
    await expect(rejecting.flush()).resolves.toBeUndefined();
  });

  it('上一次 flush 还没落盘时再来 flush：返回的 Promise 等前一次一起落盘', async () => {
    const landed: string[] = [];
    const trail = createTrail({
      now: () => AT,
      persist: (row) =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            landed.push(row.action);
            resolve();
          }, row.action === 'slow' ? 30 : 5),
        ),
    });
    trail.record({ module: 'community', action: 'slow' });
    const first = trail.flush();
    trail.record({ module: 'community', action: 'fast' });
    const second = trail.flush();

    await second;
    // 旧实现（不等前一次）在 fast 落盘后就 resolve，这里会看不到 slow
    expect(landed).toContain('slow');
    await first;
    expect(landed).toContain('fast');
  });
});

describe('票 02 · 事件结构序列化', () => {
  it('必填字段是 ts / module / action；可选字段缺省时不出现', () => {
    expect(serializeTrailEvent(event({ module: 'preview', action: 'export-start' }))).toBe(
      '{"ts":"2026-10-19T07:32:00.000Z","module":"preview","action":"export-start"}',
    );
  });

  it('result / durationMs / meta 按字面量进入 JSON', () => {
    expect(
      serializeTrailEvent(
        event({
          module: 'preview',
          action: 'export-end',
          result: 'ok',
          durationMs: 1200,
          meta: { container: 'mp4' },
        }),
      ),
    ).toBe(
      '{"ts":"2026-10-19T07:32:00.000Z","module":"preview","action":"export-end","result":"ok","durationMs":1200,"meta":{"container":"mp4"}}',
    );
  });
});
