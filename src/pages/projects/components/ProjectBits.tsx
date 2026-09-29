// 工程管理页的两个视图共用的小件（封面 / 状态徽标 / 难度等级徽标 / 卡片菜单）。
// 只被本页消费，不上升为跨页资产。
import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Music2 } from 'lucide-react';
import type { ChartDifficulty, ChartProject, ProjectChart } from '../../../project/ChartProject';
import { DIFF_COLORS, DIFF_NAMES, DIFF_SHORT, projectCoverHue } from '../../../project/projectCatalog';
import { chartStatus } from '../../../project/workspaceProject';
import { parseLevel } from '../../../project/ui/ChartInfoDialog';
import { ChartStatusIcon } from '../../../project/ui/projectUi';
import { useCoverUrl } from '../../../ui/CoverField';
import { showToast } from '../../../ui/Toast';
import { t } from '../../../i18n';
import { statusLabel } from '../projectFormat';

export function Cover({ project, size, fluid = false }: { project: ChartProject; size: number; fluid?: boolean }) {
  const url = useCoverUrl(project.coverBlob);
  const hue = projectCoverHue(project.id);
  const ch = project.name?.trim()[0];
  return (
    <div
      className={`pp-cover${fluid ? ' pp-cover--fluid' : ''}`}
      style={{
        // 流式档（issue 19 #5）：宽随列走、高由 aspect-ratio 撑；字号仍按名义 size 派生
        width: fluid ? '100%' : size,
        height: fluid ? undefined : size,
        fontSize: size * 0.42,
        // 只用 backgroundImage 长手，绝不混用 background 简写：React 按对象键序逐个赋值，
        // 简写先落地的渐变会被紧随其后的空 backgroundImage 整条抹掉，封面就成了空白（issue 11）。
        backgroundImage: url
          ? `url(${url})`
          : `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 40) % 360} 65% 35%))`,
      }}
    >
      {url ? null : (ch ? ch.toUpperCase() : <Music2 size={size * 0.42} />)}
    </div>
  );
}

export function StatusBadge({ chart }: { chart: ProjectChart }) {
  const s = chartStatus(chart);
  return <span className={`pp-badge pp-badge--${s}`}><ChartStatusIcon chart={chart} size={11} />{statusLabel(chart)}</span>;
}

/**
 * 难度+等级徽标（issue 19 #2）：点开就地小浮层直接改，不再绕道行尾铅笔。
 * - 点难度色块 = 即时提交；等级输入 Enter / 失焦提交（照 ADR-0008 §5 就地编辑口径）。
 * - 已上传谱面只读：点击只给 toast（复用 `projects.uploadedReadonly`），不弹浮层。
 * - 浮层照卡片菜单的 portal + scrim 范式定位，Esc / 点外部关闭。
 */
export function DiffLevelBadge({ chart, uploaded, onCommit }: {
  chart: ProjectChart;
  uploaded: boolean;
  onCommit: (patch: { diff: ChartDifficulty; level: number | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState('');
  const wrapRef = useRef<HTMLSpanElement>(null);
  const cancelledRef = useRef(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const openPopover = () => {
    if (uploaded) {
      showToast(t('projects.uploadedReadonly'), 'warn');
      return;
    }
    setLevel(chart.level != null ? String(chart.level) : '');
    cancelledRef.current = false;
    if (wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: r.left });
    }
    setOpen(true);
  };

  const commitLevel = () => {
    const parsed = parseLevel(level);
    if (parsed !== chart.level) onCommit({ diff: chart.diff, level: parsed });
  };

  return (
    <span className="pc-diff" ref={wrapRef}>
      <button
        type="button"
        className="pc-chart__diff"
        style={{ background: DIFF_COLORS[chart.diff] }}
        title={t('projects.diffLevelEdit')}
        aria-haspopup="dialog"
        onClick={(e) => { e.stopPropagation(); openPopover(); }}
      >
        {DIFF_NAMES[chart.diff]}<b>{chart.level ?? '–'}</b>
      </button>
      {open && createPortal(
        <>
          <span className="pp-menu__scrim" onClick={() => setOpen(false)} />
          <div className="pc-diff__panel is-portaled" style={{ top: pos.top, left: pos.left }} role="dialog" aria-label={t('projects.diffLevelEdit')}>
            <span className="pc-diff__row">
              {DIFF_NAMES.map((name, i) => (
                <button
                  key={name}
                  type="button"
                  className={`pc-diff__chip${i === chart.diff ? ' is-active' : ''}`}
                  style={{ background: DIFF_COLORS[i] }}
                  title={name}
                  onClick={() => onCommit({ diff: i as ChartDifficulty, level: chart.level })}
                >
                  {DIFF_SHORT[i]}
                </button>
              ))}
            </span>
            <label className="pc-diff__level">
              <span>{t('projects.level')}</span>
              <input
                value={level}
                inputMode="numeric"
                autoFocus
                onChange={(e) => setLevel(e.target.value)}
                onKeyDown={(e) => {
                  // Enter = 提交并收起（blur 会再触发一次提交，靠 parsed !== chart.level 去重）
                  if (e.key === 'Enter') { e.currentTarget.blur(); setOpen(false); return; }
                  if (e.key === 'Escape') { cancelledRef.current = true; setOpen(false); }
                }}
                onBlur={() => {
                  if (cancelledRef.current) { cancelledRef.current = false; return; }
                  commitLevel();
                }}
              />
            </label>
          </div>
        </>,
        document.body,
      )}
    </span>
  );
}

export function Menu({ trigger, children }: { trigger: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const toggle = () => {
    if (!open && wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    }
    setOpen((v) => !v);
  };
  return (
    <span className="pp-menu" ref={wrapRef}>
      <span onClick={toggle}>{trigger}</span>
      {open && createPortal(
        <>
          <span className="pp-menu__scrim" onClick={() => setOpen(false)} />
          <div className="pp-menu__panel is-portaled" style={{ top: pos.top, right: pos.right }} onClick={() => setOpen(false)}>
            {children}
          </div>
        </>,
        document.body,
      )}
    </span>
  );
}
