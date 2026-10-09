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
  /** 作用对象工程；null = 记录还在路上（走下面的占位触发钮，见那里的注释） */
  project: ChartProject | null;
  chartId: string | null;
  /** 换这张谱面（页面内定位，交给 usePreviewScope 记） */
  onPick: (chartId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const close = useCallback(() => setOpen(false), []);

  /**
   * 量触发钮定面板位（贴左缘、纵向下缘 +4）；打开前与开着时窗口伸缩都走它。
   *
   * 不做视口夹取（ScopePicker / 设置面板那两处有）：它锚在工具栏左簇，`left` 就是页面左留白，
   * 而面板 `max-width: 360px` ⇒ 只有极窄视口（< ≈390px）才可能溢出 —— 那是既有口径，本票只补跟随。
   */
  const computePos = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const next = { top: r.bottom + 4, left: r.left };
    // 等值守卫：补测路径会反复调用，几何没变时别平白制造一次重渲
    setPos((prev) => (prev.top === next.top && prev.left === next.left ? prev : next));
  }, []);

  const toggle = useCallback(() => {
    if (!open) computePos();   // 先量再开：首帧就到位
    setOpen(!open);
  }, [open, computePos]);

  // 开着时跟随触发钮（issue 29）：它住工具栏**左簇**（左锚）—— 常规伸缩下左簇本来就不动，所以这条
  // 此前没人报；破口在跨 720 断点（页面 padding 24 → 16 / 顶 24 → 20）后触发钮挪 8px / 4px，不重新
  // 量的话面板留在原地与触发钮脱节（实测见票 29 的 Comments）。
  //
  // 跨帧补测 + 等值守卫照 `src/ui/ScopePicker.tsx` 那段（票 11 #1 同款病灶），理由见
  // `PreviewDisplayPanel.tsx` 里同段注释（那边是同一个病的重灾区）。
  useEffect(() => {
    if (!open) return;
    let raf1 = 0;
    let raf2 = 0;
    const onResize = () => {
      computePos();
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      raf1 = requestAnimationFrame(() => {
        computePos();
        raf2 = requestAnimationFrame(computePos);
      });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [open, computePos]);

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

  // 记录未到位（换作用域时旧记录已被丢掉）：占位触发钮与真身**同盒子**（同 class、同字体、
  // 同内边距、同样有那一枚难度徽标），只把内容换成中性骨架——不这么做工具栏会矮一截，
  // 下面的舞台跟着上下跳（2026-09-30 用户验收报的抖动）。
  if (project == null || chartId == null) {
    return (
      <div className="preview-chart">
        <button type="button" className="preview-chart__trigger is-pending" disabled aria-hidden="true">
          <span className="pp-pill__diff" style={{ background: 'var(--border)' }}>··</span>
          <span className="preview-chart__name">…</span>
          <ChevronDown size={14} className="preview-chart__caret" />
        </button>
      </div>
    );
  }

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
