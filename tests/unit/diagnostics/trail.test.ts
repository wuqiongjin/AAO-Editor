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
