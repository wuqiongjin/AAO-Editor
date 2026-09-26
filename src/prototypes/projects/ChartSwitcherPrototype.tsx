// PROTOTYPE（chart-projects 05 工作台谱面切换器 UI 原型，用完即弃）。
// 顶替工作台画布顶栏左侧的「谱面画布」标题；?switcher=A|B|C 切换：
//   A 标签条 / B 面包屑下拉 / C 难度色块
import { useState, useRef, createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronRight, Copy, FolderOpen, Lock, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useAppNav } from '../../layouts/AppNav';
import { PrototypeSwitcher, usePrototypeVariant, type PrototypeVariant } from '../PrototypeSwitcher';
import { Menu, MenuItem, StatusIcon, ChartInfoDialog } from './ProjectsPrototype';
import {
  DIFF_COLORS, DIFF_NAMES, DIFF_SHORT, STATUS_LABEL, chartEffectiveTitle, chartStatus, chartSwitchLabel, currentChart,
  currentProject, projectDisplayName, protoActions, useProtoState, type Diff, type ProtoChart, type ProtoProject,
} from './projectsPrototypeStore';
import './ProjectsPrototype.css';

const VARIANTS: PrototypeVariant[] = [
  { key: 'B', name: '面包屑下拉' },
  { key: 'A', name: '标签条' },
  { key: 'C', name: '难度色块' },
];

type ChartForm = { chart: ProtoChart | null; defaultDiff?: Diff };
const ChartFormCtx = createContext<(v: ChartForm) => void>(() => {});

function AddChartMenu({ trigger }: { project?: ProtoProject; trigger: ReactNode }) {
  const openForm = useContext(ChartFormCtx);
  return (
    <Menu trigger={trigger}>
      {DIFF_NAMES.map((n, i) => (
        <MenuItem key={n} icon={<span className="pp-pill__diff" style={{ background: DIFF_COLORS[i] }}>{DIFF_SHORT[i]}</span>}
          label={`新增 ${n} 谱面`} onClick={() => openForm({ chart: null, defaultDiff: i as Diff })} />
      ))}
    </Menu>
  );
}

function ChartActions({ project, chart, trigger }: { project: ProtoProject; chart: ProtoChart; trigger: ReactNode }) {
  const up = chartStatus(chart) === 'uploaded';
  const openForm = useContext(ChartFormCtx);
  return (
    <Menu trigger={trigger}>
      <MenuItem icon={<Copy size={14} />} label="复制这张谱面" note="副本不带状态" onClick={() => protoActions.duplicateChart(project.id, chart.id)} />
      <MenuItem icon={<Check size={14} />} label={chart.completed ? '撤销完成' : '标为完成'} disabled={up} onClick={() => protoActions.toggleCompleted(project.id, chart.id)} />
      <MenuItem icon={<Pencil size={14} />} label="编辑谱面信息" note="名称 / 难度 / 等级" onClick={() => openForm({ chart })} />
      <MenuItem icon={<Trash2 size={14} />} label="删除谱面" danger onClick={() => { if (window.confirm('删除这张谱面？')) protoActions.deleteChart(project.id, chart.id); }} />
    </Menu>
  );
}

function ReadOnlyNotice({ project, chart }: { project: ProtoProject; chart: ProtoChart }) {
  if (chartStatus(chart) !== 'uploaded') return null;
  return (
    <span className="cs-readonly">
      <Lock size={12} />已上传 · 只读
      <button type="button" onClick={() => protoActions.duplicateChart(project.id, chart.id)}>复制这张谱面来改</button>
    </span>
  );
}

/* A 标签条：工程名 › 每张谱面一个标签，当前标签带 ⋯ */
function SwitcherA() {
  const s = useProtoState();
  const { setActivePage } = useAppNav();
  const p = currentProject(s);
  const cur = currentChart(s);
  return (
    <div className="cs-a">
      <button type="button" className="cs-project" onClick={() => setActivePage('projects')} title="回工程管理页（⇧⌘0）">
        <FolderOpen size={14} /><span>{projectDisplayName(p)}</span><ChevronRight size={13} />
      </button>
      <div className="cs-a__tabs">
        {p.charts.map(c => (
          <span key={c.id} className={`cs-tab${c.id === cur.id ? ' is-active' : ''}`} style={{ '--c': DIFF_COLORS[c.diff] } as CSSProperties}>
            <button type="button" onClick={() => protoActions.selectChart(c.id)} title={`${chartEffectiveTitle(p, c)} · ${STATUS_LABEL[chartStatus(c)]}`}>
              {chartSwitchLabel(p, c)}
              {chartStatus(c) === 'uploaded' ? <Lock size={11} className="pp-st pp-st--uploaded" /> : <StatusIcon chart={c} size={11} />}
            </button>
            {c.id === cur.id && <ChartActions project={p} chart={c} trigger={<button type="button" className="cs-tab__more"><MoreHorizontal size={13} /></button>} />}
          </span>
        ))}
        <AddChartMenu project={p} trigger={<button type="button" className="cs-add" title="新增谱面"><Plus size={14} /></button>} />
      </div>
      <ReadOnlyNotice project={p} chart={cur} />
    </div>
  );
}

/* B 面包屑下拉：工程名 / 当前谱面 ▾，下拉里列全部谱面与操作 */
function SwitcherB() {
  const s = useProtoState();
  const { setActivePage } = useAppNav();
  const openForm = useContext(ChartFormCtx);
  const p = currentProject(s);
  const cur = currentChart(s);
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    }
    setOpen(v => !v);
  };
  return (
    <div className="cs-b">
      <button type="button" className="cs-crumb" onClick={() => setActivePage('projects')} title="回工程管理页（⇧⌘0）">{projectDisplayName(p)}</button>
      <span className="pp-muted">/</span>
      <button ref={btnRef} type="button" className="cs-b__current" onClick={toggle}>
        <span className="pp-pill__diff" style={{ background: DIFF_COLORS[cur.diff] }}>{DIFF_SHORT[cur.diff]}</span>
        {chartSwitchLabel(p, cur)}<span className="pp-muted">{cur.level ?? ''}</span><ChevronDown size={14} />
      </button>
      {open && createPortal(
        <>
          <span className="pp-menu__scrim" onClick={() => setOpen(false)} />
          <div className="pp-menu__panel is-portaled cs-b__panel" style={{ top: pos.top, left: pos.left }}>
            <div className="cs-b__label">这个工程的谱面（{p.charts.length}）</div>
            {p.charts.map(c => (
              <button key={c.id} type="button" className={`cs-b__row${c.id === cur.id ? ' is-active' : ''}`} onClick={() => { protoActions.selectChart(c.id); setOpen(false); }}>
                <span className="pp-pill__diff" style={{ background: DIFF_COLORS[c.diff] }}>{DIFF_SHORT[c.diff]}</span>
                <span className="cs-b__title">{chartEffectiveTitle(p, c)}<small className="pp-muted">{DIFF_NAMES[c.diff]} {c.level ?? '–'} · {c.noteCount} 音符</small></span>
                <span className={`pp-badge pp-badge--${chartStatus(c)}`}><StatusIcon chart={c} size={11} />{STATUS_LABEL[chartStatus(c)]}</span>
              </button>
            ))}
            <div className="cs-b__sep" />
            <MenuItem icon={<Copy size={14} />} label="复制当前谱面" note="副本不带状态" onClick={() => { protoActions.duplicateChart(p.id, cur.id); setOpen(false); }} />
            <MenuItem icon={<Check size={14} />} label={cur.completed ? '撤销完成' : '当前谱面标为完成'} disabled={chartStatus(cur) === 'uploaded'} onClick={() => { protoActions.toggleCompleted(p.id, cur.id); setOpen(false); }} />
            <MenuItem icon={<Pencil size={14} />} label="编辑当前谱面信息" onClick={() => { openForm({ chart: cur }); setOpen(false); }} />
            <MenuItem icon={<Plus size={14} />} label="新增谱面" onClick={() => { openForm({ chart: null, defaultDiff: 3 }); setOpen(false); }} />
            <MenuItem icon={<FolderOpen size={14} />} label="回工程管理页" onClick={() => { setOpen(false); setActivePage('projects'); }} />
          </div>
        </>,
        document.body,
      )}
      <ReadOnlyNotice project={p} chart={cur} />
    </div>
  );
}

/* C 难度色块：游戏选难度式的紧凑色块，同难度多张加序号 */
function SwitcherC() {
  const s = useProtoState();
  const { setActivePage } = useAppNav();
  const p = currentProject(s);
  const cur = currentChart(s);
  const seen: Record<number, number> = {};
  const dupTotal = (d: number) => p.charts.filter(c => c.diff === d).length;
  return (
    <div className="cs-c">
      <button type="button" className="cs-c__project" onClick={() => setActivePage('projects')} title="回工程管理页（⇧⌘0）">
        <small className="pp-muted">工程</small>{projectDisplayName(p)}
      </button>
      <div className="cs-c__blocks">
        {p.charts.map(c => {
          seen[c.diff] = (seen[c.diff] ?? 0) + 1;
          const idx = dupTotal(c.diff) > 1 ? seen[c.diff] : null;
          const st = chartStatus(c);
          return (
            <button key={c.id} type="button" className={`cs-block cs-block--${st}${c.id === cur.id ? ' is-active' : ''}`}
              style={{ '--c': DIFF_COLORS[c.diff] } as CSSProperties}
              onClick={() => protoActions.selectChart(c.id)}
              title={`${chartSwitchLabel(p, c)} · Lv ${c.level ?? '?'} · ${STATUS_LABEL[st]}`}>
              <b>{DIFF_SHORT[c.diff]}{idx && <sup>{idx}</sup>}</b>
              <span>{c.level ?? '–'}</span>
              {st === 'uploaded' && <Lock size={9} className="cs-block__lock" />}
              {st === 'completed' && <Check size={9} className="cs-block__lock" />}
            </button>
          );
        })}
        <AddChartMenu project={p} trigger={<button type="button" className="cs-block cs-block--add" title="新增谱面"><Plus size={14} /></button>} />
      </div>
      <span className="cs-c__title">{chartEffectiveTitle(p, cur)}</span>
      <ChartActions project={p} chart={cur} trigger={<button type="button" className="pp-icon-btn"><MoreHorizontal size={15} /></button>} />
      <ReadOnlyNotice project={p} chart={cur} />
    </div>
  );
}

export default function ChartSwitcherPrototype({ active }: { active: boolean }) {
  const [variant, setVariant] = usePrototypeVariant('switcher', VARIANTS);
  const s = useProtoState();
  const p = currentProject(s);
  const [form, setForm] = useState<ChartForm | null>(null);
  return (
    <ChartFormCtx.Provider value={setForm}>
      {variant === 'A' && <SwitcherA />}
      {variant === 'B' && <SwitcherB />}
      {variant === 'C' && <SwitcherC />}
      {form && <ChartInfoDialog project={p} chart={form.chart} defaultDiff={form.defaultDiff} onClose={() => setForm(null)} />}
      <PrototypeSwitcher param="switcher" variants={VARIANTS} current={variant} onChange={setVariant} active={active} bottom={84} hint="工作台谱面切换器 · ← → 切换" />
    </ChartFormCtx.Provider>
  );
}
