// 倍速控件（chart-preview 20 起，58 抽到 `src/playback/` 供工作台与动态预览共用）。
// 受控件：`value` / `onChange` 由消费方从共享单点（`usePlaybackRate`）接入 —— 组件自己不持倍速值，
// 只持"正在手填"的草稿态。触钮 = 播放条那一排的同款图标钮（速度表图标 + 当前倍速），
// 点开在它上方给一列常用档 + 一个自定义输入。
//
// 手填**敲一下就生效**（范围内立刻应用；越界 / 半截输入不动，等失焦或回车才钳回）；
// 回车只是"确认"，不关面板。上下限取引擎的 `PLAYBACK_RATE_RANGE`；只改回放速度，
// 不碰进度条量程（由消费方保证）。值区间 / 常用档 / 归一化都在 `./playbackRateState`。
import { useCallback, useEffect, useRef, useState } from 'react';
import { Gauge } from 'lucide-react';
import IconButton from '../ui/IconButton';
import { t } from '../i18n';
import {
  PLAYBACK_RATE_RANGE,
  SIM_PLAYBACK_RATE_PRESETS,
  SIM_PLAYBACK_RATE_STEP,
  normalizePlaybackRate,
} from './playbackRateState';
import './PlaybackRate.css';

/** 浮点噪声收味：0.1 的倍数本身不精确，"自定义值 + 步进"混用会攒出 1.3000000000000003 一类的尾巴 */
function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/** 倍速文案：整数不带小数（`1×` / `2×`），手填的值原样（`1.35×`） */
function formatRate(rate: number): string {
  return `${rate}×`;
}

export interface PlaybackRateProps {
  /** 当前倍速（受控，来自共享单点） */
  value: number;
  /** 改倍速（写回共享单点，再由消费方转发到各自引擎） */
  onChange: (rate: number) => void;
}

export default function PlaybackRate({ value, onChange }: PlaybackRateProps) {
  const [draft, setDraft] = useState(() => String(value));
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  /** 正在手填（见组件头注：此刻不让 `value` 覆盖草稿） */
  const editingRef = useRef(false);
  const { min, max } = PLAYBACK_RATE_RANGE;

  // 选档 / 外部改值 → 输入框跟着走；手填期间不动
  useEffect(() => {
    if (editingRef.current) return;
    setDraft(String(value));
  }, [value]);

  // 面板：点外面 / Esc 收起（照站内浮层的口径，不做"焦点陷阱"）
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const togglePanel = useCallback(() => {
    if (!open) {
      // 每次打开都是干净的那一次：上次没确认的输入不留着误导人
      editingRef.current = false;
      setDraft(String(value));
    }
    setOpen((prev) => !prev);
  }, [open, value]);

  /** 手填：范围内立刻生效；空的 / 半截的 / 越界的都不动（等确认时再钳回，免得刚敲下就被拉回去） */
  const applyLive = useCallback((raw: string) => {
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n)) return;
    if (n < PLAYBACK_RATE_RANGE.min || n > PLAYBACK_RATE_RANGE.max) return;
    if (n === value) return;
    onChange(n);
  }, [onChange, value]);

  /** 确认（失焦 / 回车）：非法输入回落当前值，越界就地钳回，并把钳后值回显进输入框 */
  const commit = useCallback((raw: string) => {
    const next = normalizePlaybackRate(raw, value);
    editingRef.current = false;
    onChange(next);
    setDraft(String(next));
  }, [onChange, value]);

  const step = useCallback((dir: 1 | -1) => {
    const next = normalizePlaybackRate(round4(value + dir * SIM_PLAYBACK_RATE_STEP), value);
    setDraft(String(next)); // 手填中按 ↑↓ 也要让输入框跟着走
    onChange(next);
  }, [onChange, value]);

  /** 手填值在范围外：给个"确认时会被拉回来"的提示色 */
  const draftNumber = Number(draft);
  const outOfRange = draft.trim() !== '' && Number.isFinite(draftNumber) && (draftNumber < min || draftNumber > max);

  return (
    <div className="pv-rate" ref={rootRef}>
      {/* 不做"选中"态：当前倍速就写在钮上；它是菜单不是开关，不该带 `aria-pressed` 语义 */}
      <IconButton
        width="auto"
        size="sm"
        icon={<Gauge size={15} />}
        label={formatRate(value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('preview.video.rate')}
        onClick={togglePanel}
      />

      {open && (
        <div className="pv-rate__panel" role="menu" aria-label={t('preview.video.rate')}>
          {SIM_PLAYBACK_RATE_PRESETS.map((r) => (
            <button
              key={r}
              type="button"
              role="menuitem"
              className={`pv-rate__option${r === value ? ' is-active' : ''}`}
              aria-current={r === value}
              onClick={() => {
                onChange(r);
                setOpen(false);
              }}
            >
              {formatRate(r)}
            </button>
          ))}

          <label className="pv-rate__custom">
            <span className="pv-rate__custom-label">{t('preview.video.rate.custom')}</span>
            <input
              className={`pv-rate__value${outOfRange ? ' is-out-of-range' : ''}`}
              type="number"
              inputMode="decimal"
              min={min}
              max={max}
              // 不是 `step={SIM_PLAYBACK_RATE_STEP}`：那样浏览器会把 1.35 这类手填值判成 step 不匹配
              // （`:invalid` + 原生箭头把值吸到网格上）。步长由 ↑↓ 自己按那个常量走。
              step="any"
              value={draft}
              onFocus={(e) => {
                editingRef.current = true;
                e.currentTarget.select(); // 聚焦即全选：直接覆写，不用手动删
              }}
              onChange={(e) => {
                editingRef.current = true;
                setDraft(e.target.value);
                applyLive(e.target.value);
              }}
              onBlur={() => commit(draft)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commit(draft); // 回车 = 确认（越界的钳回），面板不关，方便连着试
                } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  step(e.key === 'ArrowUp' ? 1 : -1);
                }
              }}
            />
            <span className="pv-rate__unit" aria-hidden="true">×</span>
          </label>
        </div>
      )}
    </div>
  );
}
