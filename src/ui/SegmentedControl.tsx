import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import './ui.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/**
 * 两档（或少数几档）互斥选择：滑块跟过去，不要原生 `<select>`。
 * 图像品质那种三档长名单仍走 `.select-control`（issue 39 已否过分段）。
 */
export default function SegmentedControl<T extends string>({
  value, options, onChange, label, labelledBy, disabled = false, size = 'md',
}: {
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  /** `radiogroup` 的可访问名；有 `labelledBy` 时可以省 */
  label?: string;
  labelledBy?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  const [ready, setReady] = useState(false);

  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const active = root.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]');
    if (!active) return;
    const next = { x: active.offsetLeft, w: active.offsetWidth };
    setThumb((prev) => (prev && prev.x === next.x && prev.w === next.w ? prev : next));
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [measure, value, options, disabled, size]);

  useLayoutEffect(() => {
    if (!thumb) return;
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, [thumb]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(root);
    return () => ro.disconnect();
  }, [measure]);

  const classes = ['seg', `seg--${size}`];
  if (ready) classes.push('is-ready');
  if (disabled) classes.push('is-disabled');

  return (
    <div
      ref={rootRef}
      role="radiogroup"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      className={classes.join(' ')}
    >
      {thumb ? (
        <span
          className="seg__thumb"
          aria-hidden="true"
          style={{ transform: `translate3d(${thumb.x}px,0,0)`, width: thumb.w }}
        />
      ) : null}
      {options.map((opt) => {
        const on = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            className={`seg__opt${on ? ' is-active' : ''}`}
            onClick={() => { if (!disabled && !on) onChange(opt.value); }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
