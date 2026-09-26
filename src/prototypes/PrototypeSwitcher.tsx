// PROTOTYPE：原型变体切换浮条（dev only）。变体写进 URL search param，刷新可复现。
import { useCallback, useEffect, useState, type CSSProperties } from 'react';

export interface PrototypeVariant { key: string; name: string }

function readParam(param: string, fallback: string): string {
  return new URLSearchParams(window.location.search).get(param) ?? fallback;
}

export function usePrototypeVariant(param: string, variants: PrototypeVariant[]) {
  const [current, setCurrent] = useState(() => {
    const v = readParam(param, variants[0].key);
    return variants.some(x => x.key === v) ? v : variants[0].key;
  });
  const go = useCallback((key: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set(param, key);
    window.history.replaceState(null, '', url);
    setCurrent(key);
  }, [param]);
  return [current, go] as const;
}

export function PrototypeSwitcher({
  param, variants, current, onChange, active = true, bottom = 16, hint,
}: {
  param: string;
  variants: PrototypeVariant[];
  current: string;
  onChange: (key: string) => void;
  active?: boolean;
  bottom?: number;
  hint?: string;
}) {
  const idx = Math.max(0, variants.findIndex(v => v.key === current));
  const step = useCallback((d: number) => onChange(variants[(idx + d + variants.length) % variants.length].key), [idx, onChange, variants]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      e.preventDefault();
      step(e.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, step]);

  if (!import.meta.env.DEV) return null;
  const v = variants[idx];
  const btn: CSSProperties = {
    width: 28, height: 28, borderRadius: 999, border: 'none', cursor: 'pointer',
    background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 14, lineHeight: 1,
  };
  return (
    <div style={{
      position: 'fixed', left: '50%', bottom, transform: 'translateX(-50%)', zIndex: 9999,
      display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px',
      background: '#111', color: '#fff', borderRadius: 999, boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
      fontSize: 13, fontFamily: 'system-ui, sans-serif', userSelect: 'none',
    }}>
      <button type="button" style={btn} onClick={() => step(-1)} aria-label="上一个变体">←</button>
      <span style={{ minWidth: 180, textAlign: 'center' }}>
        <span style={{ opacity: 0.55 }}>{param}=</span><b>{v.key}</b> <span style={{ opacity: 0.85 }}>（{v.name}）</span>
        {hint && <span style={{ display: 'block', fontSize: 11, opacity: 0.5 }}>{hint}</span>}
      </span>
      <button type="button" style={btn} onClick={() => step(1)} aria-label="下一个变体">→</button>
    </div>
  );
}
