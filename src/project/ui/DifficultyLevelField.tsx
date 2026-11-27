/**
 * 难度 + 等级复合字段（票 61）：一处替换原生 `<select>` 的难看下拉。
 *
 * 形态：一枚共用描边的控件 —— 左侧 5 个短码 chip（EZ/NM/HD/EX/SP，短码是本仓既有词汇），
 * 右侧接等级输入（Lv. 前缀 + 分隔线）。选中 chip 用该难度色描边 + 淡色底，
 * 不把整块填成高饱和色（黄/绿底上的白字过不了可读性）。
 *
 * 三处消费方：发布弹窗、编辑谱面信息弹窗、新建工程的首张谱面难度。
 * `showLevel={false}` 时只画 chip 行（新建工程还没有等级）。
 */
import type { CSSProperties } from 'react';
import type { ChartDifficulty } from '../ChartProject';
import { DIFF_COLORS, DIFF_NAMES, DIFF_SHORT } from '../projectCatalog';
import { t } from '../../i18n';
import './DifficultyLevelField.css';

export interface DifficultyLevelFieldProps {
  diff: ChartDifficulty;
  onDiffChange: (diff: ChartDifficulty) => void;
  /** 等级输入值（字符串，保留空 / 半截输入） */
  level?: string;
  onLevelChange?: (value: string) => void;
  levelPlaceholder?: string;
  /** 等级为空 / 越界：输入框标红（不阻止继续输入） */
  levelInvalid?: boolean;
  disabled?: boolean;
  /** 只画难度 chip 行（新建工程还没有等级） */
  showLevel?: boolean;
}

export default function DifficultyLevelField({
  diff,
  onDiffChange,
  level = '',
  onLevelChange,
  levelPlaceholder,
  levelInvalid = false,
  disabled = false,
  showLevel = true,
}: DifficultyLevelFieldProps) {
  return (
    <div className={`diff-level${disabled ? ' is-disabled' : ''}`}>
      <div className="diff-level__chips" role="radiogroup" aria-label={t('projects.diff')}>
        {DIFF_SHORT.map((short, index) => {
          const active = index === diff;
          return (
            <button
              key={short}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={DIFF_NAMES[index]}
              title={DIFF_NAMES[index]}
              className={`diff-level__chip${active ? ' is-active' : ''}`}
              style={active ? ({ '--diff-color': DIFF_COLORS[index] } as CSSProperties) : undefined}
              disabled={disabled}
              onClick={() => {
                if (!active) onDiffChange(index as ChartDifficulty);
              }}
            >
              {short}
            </button>
          );
        })}
      </div>
      {showLevel && (
        <>
          <span className="diff-level__sep" aria-hidden="true" />
          <label className="diff-level__level">
            <span className="diff-level__level-k" aria-hidden="true">Lv.</span>
            <input
              type="text"
              inputMode="numeric"
              className={levelInvalid ? 'is-missing' : undefined}
              value={level}
              disabled={disabled}
              placeholder={levelPlaceholder ?? t('projects.levelPlaceholder')}
              aria-label={t('projects.level')}
              onChange={(event) => onLevelChange?.(event.target.value)}
            />
          </label>
        </>
      )}
    </div>
  );
}
