// 预览页的谱面切换器（ADR-0016 §4）：作用域条只管**工程**，谱面级定位是**本页自己的事**。
// 它列的是作用对象工程的谱面；换掉只改这一页在看哪张——不写作用域、不动当前工程。
//
// 浮层复用菜单壳（`.pp-menu__*`，定义在 ProjectsPage.css），照 ChartSwitcher / ScopePicker 的做法
// 显式 import 进来，别指望"反正工程管理页一定先挂载"。
// 已知债（第三份了）：portal + 遮罩 + 定位这三件在 ScopePicker / ChartSwitcher / 本文件各写一遍，
// 菜单壳本身也还住在 ProjectsPage.css —— 摘进 `ui/` 是正解，属另一次清理（票 22 已登记）。
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import type { ChartProject } from '../../project/ChartProject';
import { chartEffectiveTitle, DIFF_COLORS, DIFF_NAMES, DIFF_SHORT } from '../../project/projectCatalog';
import { chartStatus } from '../../project/workspaceProject';
import { ChartStatusIcon, untitledProjectLabel } from '../../project/ui/projectUi';
import { countChartNotes } from '../../chart/editing/NoteEditing';
import { t } from '../../i18n';
import '../projects/ProjectsPage.css';

export default function PreviewChartSwitcher({ project, chartId, onPick }: {
  project: ChartProject;
  chartId: string;
  /** 换这张谱面（页面内定位，交给 usePreviewScope 记） */
  onPick: (chartId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const close = useCallback(() => setOpen(false), []);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      if (!prev && btnRef.current) {
        const r = btnRef.current.getBoundingClientRect();
        setPos({ top: r.bottom + 4, left: r.left });
      }
      return !prev;
    });
  }, []);

  // Esc 关面板并把焦点还给触发钮（点面板外由遮罩负责）
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
      btnRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  const cur = project.charts.find((c) => c.id === chartId) ?? project.charts[0];

  return (
    <div className="preview-chart">
      <button
        ref={btnRef}
        type="button"
        className="preview-chart__trigger"
        title={t('preview.chart.triggerTitle')}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('preview.chart.triggerAria', {
          title: chartEffectiveTitle(project.name, cur.title, untitledProjectLabel()),
        })}
        onClick={toggle}
      >
        <span className="pp-pill__diff" style={{ background: DIFF_COLORS[cur.diff] }}>{DIFF_SHORT[cur.diff]}</span>
        <span className="preview-chart__name">{chartEffectiveTitle(project.name, cur.title, untitledProjectLabel())}</span>
        <span className="pp-muted">{cur.level ?? ''}</span>
        <ChevronDown size={14} className={`preview-chart__caret${open ? ' is-open' : ''}`} />
      </button>

      {open && createPortal(
        <>
          <span className="pp-menu__scrim" onClick={close} />
          <div
            className="pp-menu__panel is-portaled preview-chart__panel"
            style={{ top: pos.top, left: pos.left }}
            role="listbox"
            aria-label={t('preview.chart.panelAria')}
          >
            <div className="preview-chart__label">{t('preview.chart.listLabel', { count: project.charts.length })}</div>
            {project.charts.map((c) => {
              const status = chartStatus(c);
              return (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={c.id === cur.id}
                  className={`preview-chart__row${c.id === cur.id ? ' is-active' : ''}`}
                  onClick={() => { onPick(c.id); close(); }}
                >
                  <span className="pp-pill__diff" style={{ background: DIFF_COLORS[c.diff] }}>{DIFF_SHORT[c.diff]}</span>
                  <span className="preview-chart__row-text">
                    <b>{chartEffectiveTitle(project.name, c.title, untitledProjectLabel())}</b>
                    <small className="pp-muted">
                      {t('workspace.switcher.rowMeta', {
                        diff: DIFF_NAMES[c.diff],
                        level: c.level ?? '–',
                        count: countChartNotes(c.notes),
                      })}
                    </small>
                  </span>
                  <span className={`pp-badge pp-badge--${status}`}>
                    <ChartStatusIcon chart={c} size={11} />
                    {t(`projects.status.${status}` as 'projects.status.unfinished')}
                  </span>
                </button>
              );
            })}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
