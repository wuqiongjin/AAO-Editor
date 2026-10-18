// 工程管理页的两个视图共用的小件（封面 / 状态徽标 / 难度等级徽标 / 卡片菜单）。
// 只被本页消费，不上升为跨页资产。
import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Circle, Music2 } from 'lucide-react';
import type { ChartDifficulty, ChartProject, ProjectChart } from '../../../project/ChartProject';
import { DIFF_COLORS, DIFF_NAMES, DIFF_SHORT, projectCoverHue } from '../../../project/projectCatalog';
import { chartStatus } from '../../../project/workspaceProject';
import { readChartLevelInput } from '../../../project/ui/ChartInfoDialog';
import { ChartStatusIcon, ProjectMenuItem } from '../../../project/ui/projectUi';
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

/**
 * 状态徽标。默认只读（hub hero / 切换器下拉行等一切既有消费方不受影响）；
 * `interactive` 时徽标即控件（票 41）：点开垂直小菜单就地切「未完成 / 已完成」——
 * 与同行 DiffLevelBadge「徽标即控件」同构，撤掉详情页行尾独立文字按钮后这里是唯一状态入口。
 *
 * - 只列两个**可选**态；「已上传」是上传记录派生的，任何形态下都不可操作
 *   （interactive 也不挂——素色徽标不假装能点，无需 toast 兜底）。
 * - 点当前态是 no-op（菜单照常收起）：翻转交给 `toggleChartCompleted`，守卫放这里与消费方各一道。
 * - 每行图标 = **状态图标**（○ / ✓，与触发徽标同一套 `ChartStatusIcon` 图标学），各司其职：
 *   图标说"这行是什么态"，当前态由 `is-active`（底色 + 字重）说——勾不再兼任"当前"标记
 *   （2026-10-18 验收反馈细化定案 1：原"当前态打 ✓"改为状态图标 + 底色标活）。
 * - 浮层走本文件 `Menu`（portal + scrim，与卡片 ⋯ 菜单同一套语言），触发器用函数形态如实写 aria；
 *   面板收内容宽（`pp-menu__panel--status`）——两条 4 字标签撑不满全局 200px。
 */
export function StatusBadge({ chart, interactive = false, onSelect }: {
  chart: ProjectChart;
  interactive?: boolean;
  /** 选中目标态（true = 已完成）；仅在目标态 ≠ 当前态时触发 */
  onSelect?: (completed: boolean) => void;
}) {
  const s = chartStatus(chart);
  const badge = (
    <>
      <ChartStatusIcon chart={chart} size={11} />
      {statusLabel(chart)}
    </>
  );
  if (!interactive || s === 'uploaded') {
    return <span className={`pp-badge pp-badge--${s}`}>{badge}</span>;
  }
  return (
    <Menu placement="down" align="start" panelClass="pp-menu__panel--status" trigger={(open) => (
      <button
        type="button"
        className={`pp-badge pp-badge--${s} pp-badge--action`}
        title={t('projects.statusEdit')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {badge}
      </button>
    )}>
      <ProjectMenuItem
        icon={<Circle size={14} className="pp-st pp-st--unfinished" />}
        label={t('projects.status.unfinished')}
        active={s === 'unfinished'}
        onClick={() => { if (chart.completed) onSelect?.(false); }}
      />
      <ProjectMenuItem
        icon={<Check size={14} className="pp-st pp-st--completed" />}
        label={t('projects.status.completed')}
        active={s === 'completed'}
        onClick={() => { if (!chart.completed) onSelect?.(true); }}
      />
    </Menu>
  );
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

  const levelInput = readChartLevelInput(level);
  const commitLevel = () => {
    if (!levelInput.persist) return;
    if (levelInput.level !== chart.level) onCommit({ diff: chart.diff, level: levelInput.level });
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
                className={levelInput.persist ? undefined : 'is-missing'}
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

/** 面板的落点：竖档取 `top` 或 `bottom`，横档取 `left` 或 `right`（没取的键不写进内联样式） */
type MenuPos = { top?: number; bottom?: number; left?: number; right?: number };

/**
 * 卡片 / 工具条上的小菜单（portal 到 body）。
 *
 * `placement`（票 39 Q29，additive，默认仍是 `down`，既有消费方一个都不受影响）：
 * 左栏**最底部**的账号区只能往上弹 —— 向下弹会顶到窗口外。`up` 时改用 `bottom` 定位
 * （面板底边贴在触发器上缘），坐标仍由触发器实测的 `getBoundingClientRect()` 给。
 *
 * `align`（票 39 回修，用户 2026-10-14 验收）：贴触发器的**左缘**还是右缘。默认 `end`
 * 是既有的右对齐（卡片行尾的 ⋯ 菜单就锚在右边）。账号区必须 `start`：它在左栏最左边，
 * 面板又是 `min-width: 200px` 的**收缩宽度**（宽随内容），右对齐会把面板左缘挂在"内容宽度"
 * 上 —— 昵称一长，面板就朝左长出去压住导航条、更长的还会出屏。
 *
 * `trigger` 可以是 `(open: boolean) => ReactNode`：账号行的「已登录」态要在触发键上
 * 如实写 `aria-expanded`，而那一位由菜单自己持有 —— 没有这条函数形态就得多造一份 state。
 *
 * 触发键外面那层 `<span>` 有稳定的类名 `pp-menu__trigger`：`.pp-menu` 是 `inline-flex`
 * （工具条里的小菜单要按内容宽贴住按钮），但账号行是**满宽列表行**，得由消费方把它铺开
 * （见 ProjectsPage.css 的 `.pc-account .pp-menu`）—— 没有这个类名就只能靠 `:first-child` 去猜。
 */
export function Menu({ trigger, placement = 'down', align = 'end', panelClass, children }: {
  trigger: ReactNode | ((open: boolean) => ReactNode);
  placement?: 'down' | 'up';
  align?: 'start' | 'end';
  /** 面板附加类（票 41 状态菜单用它收内容宽 `pp-menu__panel--status`；其余菜单不传，200px 下限不动） */
  panelClass?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<MenuPos>({ right: 0 });
  const toggle = () => {
    if (!open && wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      setPos({
        ...(align === 'start'
          ? { left: Math.max(8, r.left) }
          : { right: Math.max(8, window.innerWidth - r.right) }),
        ...(placement === 'up'
          ? { bottom: window.innerHeight - r.top + 4 }
          : { top: r.bottom + 4 }),
      });
    }
    setOpen((v) => !v);
  };
  const panel = typeof trigger === 'function' ? trigger(open) : trigger;
  return (
    <span className="pp-menu" ref={wrapRef}>
      <span className="pp-menu__trigger" onClick={toggle}>{panel}</span>
      {open && createPortal(
        <>
          <span className="pp-menu__scrim" onClick={() => setOpen(false)} />
          {/* `pos` 的键就是 CSS 属性名，没测过的那一档不写（`undefined` 会被 React 跳过） */}
          <div
            className={`pp-menu__panel is-portaled${panelClass ? ` ${panelClass}` : ''}`}
            style={pos}
            onClick={() => setOpen(false)}
          >
            {children}
          </div>
        </>,
        document.body,
      )}
    </span>
  );
}
