// PROTOTYPE（chart-projects 04 工程管理页 UI 原型，用完即弃）。
// 三个结构不同的变体挂在真实应用壳的「工程」页上，?variant=A|B|C 切换：
//   A 列表（内容壳 + 密集表格） / B 启动台（继续创作 + 新建来源 + 封面墙） / C 主从（左工程列表 + 右工程详情）
// 数据全在内存（projectsPrototypeStore），打开工程会真的跳到工作台，工作台顶栏的谱面切换器另有 ?switcher= 变体。
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Check, ChevronDown, Circle, Copy, FolderPlus, Globe, Lock, MoreHorizontal, Music2, Pencil,
  Play, Plus, Trash2, Upload,
} from 'lucide-react';
import AppPageShell from '../../layouts/AppPageShell';
import { useAppNav } from '../../layouts/AppNav';
import { PrototypeSwitcher, usePrototypeVariant, type PrototypeVariant } from '../PrototypeSwitcher';
import {
  DIFF_COLORS, DIFF_NAMES, DIFF_SHORT, SOURCE_LABEL, STATUS_LABEL, chartEffectiveTitle, chartStatus, projectDisplayName,
  projectUnfinished, protoActions, relTime, sortedProjects, useProtoState,
  type Diff, type ProtoChart, type ProtoProject,
} from './projectsPrototypeStore';
import './ProjectsPrototype.css';

const VARIANTS: PrototypeVariant[] = [
  { key: 'D', name: 'B 主页 + C 详情' },
  { key: 'A', name: '列表' },
  { key: 'B', name: '启动台' },
  { key: 'C', name: '主从' },
];

/* ---------------- 共享小件 ---------------- */

export function Cover({ project, size }: { project: ProtoProject; size: number }) {
  const ch = project.name?.trim()[0];
  return (
    <div
      className="pp-cover"
      style={{
        width: size, height: size, fontSize: size * 0.42,
        background: `linear-gradient(135deg, hsl(${project.hue} 70% 55%), hsl(${(project.hue + 40) % 360} 65% 35%))`,
      }}
    >
      {ch ? ch.toUpperCase() : <Music2 size={size * 0.42} />}
    </div>
  );
}

export function StatusIcon({ chart, size = 12 }: { chart: ProtoChart; size?: number }) {
  const s = chartStatus(chart);
  if (s === 'uploaded') return <Upload size={size} className="pp-st pp-st--uploaded" />;
  if (s === 'completed') return <Check size={size} className="pp-st pp-st--completed" />;
  return <Circle size={size - 2} className="pp-st pp-st--unfinished" />;
}

function ChartPill({ project, chart }: { project: ProtoProject; chart: ProtoChart }) {
  return (
    <span
      className="pp-pill"
      title={`${DIFF_NAMES[chart.diff]} ${chart.level ?? '?'} · ${chartEffectiveTitle(project, chart)} · ${STATUS_LABEL[chartStatus(chart)]}`}
    >
      <span className="pp-pill__diff" style={{ background: DIFF_COLORS[chart.diff] }}>{DIFF_SHORT[chart.diff]}</span>
      <span className="pp-pill__lv">{chart.level ?? '–'}</span>
      <StatusIcon chart={chart} />
    </span>
  );
}

function StatusBadge({ chart }: { chart: ProtoChart }) {
  const s = chartStatus(chart);
  return <span className={`pp-badge pp-badge--${s}`}><StatusIcon chart={chart} size={11} />{STATUS_LABEL[s]}</span>;
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
    setOpen(v => !v);
  };
  return (
    <span className="pp-menu" ref={wrapRef}>
      <span onClick={toggle}>{trigger}</span>
      {open && createPortal(
        <>
          <span className="pp-menu__scrim" onClick={() => setOpen(false)} />
          <div
            className="pp-menu__panel is-portaled"
            style={{ top: pos.top, right: pos.right }}
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

export function MenuItem({ icon, label, onClick, danger, disabled, note }: {
  icon: ReactNode; label: string; onClick?: () => void; danger?: boolean; disabled?: boolean; note?: string;
}) {
  return (
    <button type="button" className={`pp-menu__item${danger ? ' is-danger' : ''}`} disabled={disabled} onClick={onClick}>
      {icon}<span>{label}</span>{note && <em>{note}</em>}
    </button>
  );
}

function confirmDelete(p: ProtoProject) {
  const uploaded = p.charts.filter(c => c.upload).length;
  const extra = uploaded ? `\n其中 ${uploaded} 张已上传到 Bestdori，删除工程不会影响已发的帖子。` : '';
  if (window.confirm(`删除工程「${projectDisplayName(p)}」？音频、封面和 ${p.charts.length} 张谱面都会删除。${extra}`)) {
    protoActions.deleteProject(p.id);
  }
}

/* ---------------- 新建 / 编辑对话框 ---------------- */

type NewSource = 'blank' | 'copy' | 'bestdori';

function NewProjectDialog({ initialSource, onClose, onDone }: {
  initialSource: NewSource; onClose: () => void; onDone: (projectId: string) => void;
}) {
  const s = useProtoState();
  const [source, setSource] = useState<NewSource>(initialSource);
  const [name, setName] = useState('');
  const [artist, setArtist] = useState('');
  const [diff, setDiff] = useState<Diff>(3);
  const [copyFrom, setCopyFrom] = useState(sortedProjects(s)[0]?.id ?? '');

  const submit = () => {
    if (source === 'copy') { onDone(protoActions.duplicateProject(copyFrom)); return; }
    if (source === 'bestdori') return;
    onDone(protoActions.create({ name, artist, diff, audioName: null, noteCount: 0 }));
  };

  const tabs: Array<{ id: NewSource; label: string; icon: ReactNode }> = [
    { id: 'blank', label: '空白', icon: <FolderPlus size={14} /> },
    { id: 'copy', label: '复制现有工程', icon: <Copy size={14} /> },
    { id: 'bestdori', label: '从 Bestdori', icon: <Globe size={14} /> },
  ];

  return (
    <div className="pp-dialog__scrim" onMouseDown={onClose}>
      <div className="pp-dialog" onMouseDown={e => e.stopPropagation()}>
        <h3>新建谱面工程</h3>
        <div className="pp-tabs">
          {tabs.map(t => (
            <button key={t.id} type="button" className={source === t.id ? 'is-active' : ''} onClick={() => setSource(t.id)}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        {source === 'bestdori' ? (
          <div className="pp-dialog__placeholder">
            BanG Dream 官方曲 / LLSIF 曲 / Community 社区帖三种来源。<br />
            等 Electron 网络层落地后做（chart-projects 07），静态演示版不显示此入口。
          </div>
        ) : source === 'copy' ? (
          <label className="pp-field">
            <span>复制哪个工程</span>
            <select value={copyFrom} onChange={e => setCopyFrom(e.target.value)}>
              {sortedProjects(s).map(p => <option key={p.id} value={p.id}>{projectDisplayName(p)}（{p.charts.length} 张谱面）</option>)}
            </select>
            <small>工程信息、音频、封面、全部谱面照搬；谱面状态不带（副本全部为未完成）。</small>
          </label>
        ) : (
          <>
            <div className="pp-field-row">
              <label className="pp-field"><span>工程名称</span><input value={name} placeholder="未命名工程" onChange={e => setName(e.target.value)} /></label>
              <label className="pp-field"><span>歌手</span><input value={artist} placeholder="可稍后填写" onChange={e => setArtist(e.target.value)} /></label>
            </div>
            <label className="pp-field">
              <span>第一张谱面的难度</span>
              <select value={diff} onChange={e => setDiff(Number(e.target.value) as Diff)}>
                {DIFF_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
              </select>
            </label>
            <small className="pp-muted">全部可不填。音频去音频页导入；封面、曲目来源在「编辑工程信息」里补。要贴谱面 JSON，建好后再「新增谱面」。</small>
          </>
        )}

        <div className="pp-dialog__actions">
          <button type="button" className="pp-btn" onClick={onClose}>取消</button>
          <button type="button" className="pp-btn pp-btn--primary" disabled={source === 'bestdori'} onClick={submit}>
            {source === 'copy' ? '复制' : '创建并打开'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditInfoDialog({ project, onClose }: { project: ProtoProject; onClose: () => void }) {
  const [name, setName] = useState(project.name ?? '');
  const [artist, setArtist] = useState(project.artist ?? '');
  return (
    <div className="pp-dialog__scrim" onMouseDown={onClose}>
      <div className="pp-dialog" onMouseDown={e => e.stopPropagation()}>
        <h3>编辑工程信息</h3>
        <div className="pp-field-row">
          <label className="pp-field"><span>工程名称</span><input value={name} placeholder="未命名工程" onChange={e => setName(e.target.value)} /></label>
          <label className="pp-field"><span>歌手</span><input value={artist} onChange={e => setArtist(e.target.value)} /></label>
        </div>
        <label className="pp-field"><span>曲目来源</span>
          <select defaultValue={project.source.type}>
            <option value="custom">自定义（上传时带音频与封面）</option>
            <option value="bandori">BanG Dream 官方曲（曲库 id）</option>
            <option value="llsif">LLSIF 曲（曲库 id）</option>
          </select>
        </label>
        <small className="pp-muted">未填谱面名称的谱面会跟着工程名称一起变。封面在这里上传（启动台封面墙用它）。音频请去音频页导入。</small>
        <div className="pp-dialog__actions">
          <button type="button" className="pp-btn" onClick={onClose}>取消</button>
          <button type="button" className="pp-btn pp-btn--primary" onClick={() => { protoActions.renameProject(project.id, name, artist); onClose(); }}>保存</button>
        </div>
      </div>
    </div>
  );
}

export function ChartInfoDialog({ project, chart, defaultDiff = 3, onClose }: {
  project: ProtoProject;
  chart: ProtoChart | null;
  defaultDiff?: Diff;
  onClose: () => void;
}) {
  const locked = !!chart?.upload;
  const [title, setTitle] = useState(chart?.title ?? '');
  const [diff, setDiff] = useState<Diff>(chart?.diff ?? defaultDiff);
  const [level, setLevel] = useState(chart?.level != null ? String(chart.level) : '');
  const [code, setCode] = useState('');
  const save = () => {
    const lv = level.trim() === '' ? null : Number(level);
    const parsed = lv != null && Number.isFinite(lv) ? lv : null;
    if (chart) {
      protoActions.updateChart(project.id, chart.id, { title: title.trim() || null, diff, level: parsed });
      onClose();
      return;
    }
    let noteCount = 0;
    if (code.trim()) {
      try {
        const arr = JSON.parse(code);
        if (!Array.isArray(arr)) throw new Error('根不是数组');
        noteCount = arr.length;
      } catch (e) {
        window.alert(`谱面代码无法应用：${(e as Error).message}（真实实现走 Apply 闸门）`);
        return;
      }
    }
    protoActions.addChart(project.id, diff, { title: title.trim() || null, level: parsed, noteCount });
    onClose();
  };
  return (
    <div className="pp-dialog__scrim" onMouseDown={onClose}>
      <div className="pp-dialog" onMouseDown={e => e.stopPropagation()}>
        <h3>{chart ? '编辑谱面信息' : '新增谱面'}</h3>
        {locked && <p className="pp-muted">已上传的谱面只读。要改就先复制这张谱面。</p>}
        <label className="pp-field">
          <span>谱面名称</span>
          <input value={title} placeholder={projectDisplayName(project)} disabled={locked} onChange={e => setTitle(e.target.value)} />
          <small>不填则跟随工程名称（现在是「{projectDisplayName(project)}」）。这是上传到 Bestdori 的 title。</small>
        </label>
        <div className="pp-field-row">
          <label className="pp-field">
            <span>难度</span>
            <select value={diff} disabled={locked} onChange={e => setDiff(Number(e.target.value) as Diff)}>
              {DIFF_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
            </select>
          </label>
          <label className="pp-field">
            <span>等级</span>
            <input value={level} placeholder="可稍后填写" disabled={locked} inputMode="numeric" onChange={e => setLevel(e.target.value)} />
            <small>Bestdori 前端默认 20；合法范围实现时再锁。</small>
          </label>
        </div>
        {!chart && (
          <label className="pp-field">
            <span>谱面代码（可选）</span>
            <textarea rows={4} value={code} placeholder='粘贴 Bestdori 风格 JSON，或留空建一张空谱面' onChange={e => setCode(e.target.value)} />
            <small>空白新建后也可以在工作台的谱面代码编辑器里贴。</small>
          </label>
        )}
        <div className="pp-dialog__actions">
          <button type="button" className="pp-btn" onClick={onClose}>取消</button>
          {!locked && <button type="button" className="pp-btn pp-btn--primary" onClick={save}>{chart ? '保存' : '添加'}</button>}
        </div>
      </div>
    </div>
  );
}

/* ---------------- 变体共享的动作钩子 ---------------- */

function usePageActions() {
  const { setActivePage } = useAppNav();
  const [newSource, setNewSource] = useState<NewSource | null>(null);
  const [editing, setEditing] = useState<ProtoProject | null>(null);
  const [chartForm, setChartForm] = useState<{ project: ProtoProject; chart: ProtoChart | null; defaultDiff?: Diff } | null>(null);
  const openProject = (id: string, chartId?: string) => { protoActions.open(id, chartId); setActivePage('workspace'); };
  const dialogs = (
    <>
      {newSource && (
        <NewProjectDialog
          initialSource={newSource}
          onClose={() => setNewSource(null)}
          onDone={id => { const src = newSource; setNewSource(null); if (src !== 'copy') openProject(id); }}
        />
      )}
      {editing && <EditInfoDialog project={editing} onClose={() => setEditing(null)} />}
      {chartForm && (
        <ChartInfoDialog
          project={chartForm.project}
          chart={chartForm.chart}
          defaultDiff={chartForm.defaultDiff}
          onClose={() => setChartForm(null)}
        />
      )}
    </>
  );
  return { openProject, newProject: setNewSource, editInfo: setEditing, chartForm: setChartForm, dialogs };
}

type Actions = ReturnType<typeof usePageActions>;

function NewButton({ actions, big }: { actions: Actions; big?: boolean }) {
  return (
    <span className="pp-split">
      <button type="button" className={`pp-btn pp-btn--primary${big ? ' pp-btn--lg' : ''}`} onClick={() => actions.newProject('blank')}>
        <Plus size={15} />新建工程
      </button>
      <Menu trigger={<button type="button" className={`pp-btn pp-btn--primary pp-split__caret${big ? ' pp-btn--lg' : ''}`}><ChevronDown size={15} /></button>}>
        <MenuItem icon={<FolderPlus size={14} />} label="空白新建" onClick={() => actions.newProject('blank')} />
        <MenuItem icon={<Copy size={14} />} label="复制现有工程" onClick={() => actions.newProject('copy')} />
        <MenuItem icon={<Globe size={14} />} label="从 Bestdori 新建" note="待 07" onClick={() => actions.newProject('bestdori')} />
      </Menu>
    </span>
  );
}

function ProjectMenu({ project, actions }: { project: ProtoProject; actions: Actions }) {
  return (
    <Menu trigger={<button type="button" className="pp-icon-btn" title="更多"><MoreHorizontal size={16} /></button>}>
      <MenuItem icon={<Pencil size={14} />} label="编辑工程信息" onClick={() => actions.editInfo(project)} />
      <MenuItem icon={<Copy size={14} />} label="复制工程" onClick={() => protoActions.duplicateProject(project.id)} />
      <MenuItem icon={<Trash2 size={14} />} label="删除工程" danger onClick={() => confirmDelete(project)} />
    </Menu>
  );
}

/* ---------------- 变体 A：列表（内容壳 + 密集表格） ---------------- */

function VariantA({ actions }: { actions: Actions }) {
  const s = useProtoState();
  const list = sortedProjects(s);
  return (
    <AppPageShell>
      <AppPageShell.Header eyebrow="Projects" title="谱面工程" description="按最近打开排序。一个工程是一首歌，下面挂若干张谱面。" />
      <AppPageShell.Body mode="default">
        <div className="pa-toolbar">
          <span className="pp-muted">{list.length} 个工程 · {list.filter(projectUnfinished).length} 个未完成</span>
          <NewButton actions={actions} />
        </div>
        <div className="pa-table" role="table">
          <div className="pa-row pa-row--head" role="row">
            <span /><span>工程</span><span>谱面</span><span>曲目来源</span><span>最近打开</span><span />
          </div>
          {list.map(p => (
            <div key={p.id} className={`pa-row${p.id === s.currentProjectId ? ' is-current' : ''}`} role="row" onDoubleClick={() => actions.openProject(p.id)}>
              <Cover project={p} size={40} />
              <span className="pa-name">
                <b className={p.name ? '' : 'pp-muted'}>{projectDisplayName(p)}</b>
                <small>{p.artist ?? '—'}{p.id === s.currentProjectId && <em className="pp-current-tag">当前</em>}</small>
              </span>
              <span className="pa-charts">{p.charts.map(c => <ChartPill key={c.id} project={p} chart={c} />)}</span>
              <span className="pp-muted">{SOURCE_LABEL(p.source)}</span>
              <span className="pp-muted">{relTime(p.lastOpened)}</span>
              <span className="pa-actions">
                <button type="button" className="pp-btn pp-btn--sm" onClick={() => actions.openProject(p.id)}><Play size={13} />打开</button>
                <ProjectMenu project={p} actions={actions} />
              </span>
            </div>
          ))}
        </div>
        <p className="pp-muted pa-legend">
          <Circle size={10} className="pp-st pp-st--unfinished" /> 未完成 &nbsp; <Check size={12} className="pp-st pp-st--completed" /> 已完成 &nbsp; <Upload size={12} className="pp-st pp-st--uploaded" /> 已上传（只读） &nbsp; · 双击行也能打开
        </p>
      </AppPageShell.Body>
    </AppPageShell>
  );
}

/* ---------------- 变体 B：启动台（继续创作 + 新建来源 + 封面墙） ---------------- */

function VariantB({ actions, onCardClick }: { actions: Actions; onCardClick?: (projectId: string) => void }) {
  const s = useProtoState();
  const list = sortedProjects(s);
  const resume = list.find(projectUnfinished);
  const tiles: Array<{ src: NewSource; icon: ReactNode; title: string; desc: string }> = [
    { src: 'blank', icon: <FolderPlus size={20} />, title: '空白新建', desc: '定个难度，马上开写；音频去音频页' },
    { src: 'copy', icon: <Copy size={20} />, title: '复制现有工程', desc: '留草稿 / 换音频的出路' },
    { src: 'bestdori', icon: <Globe size={20} />, title: '从 Bestdori', desc: '官方曲 / LLSIF / 社区帖（待做）' },
  ];
  return (
    <div className="pb-page">
      {resume && (
        <section className="pb-hero">
          <Cover project={resume} size={120} />
          <div className="pb-hero__body">
            <span className="pp-eyebrow">继续创作</span>
            <h2>
              {projectDisplayName(resume)}
              {onCardClick && <button type="button" className="pb-hero__detail" onClick={() => onCardClick(resume.id)}>详情 ›</button>}
            </h2>
            <p className="pp-muted">{resume.artist ?? '未填歌手'} · 上次打开 {relTime(resume.lastOpened)}</p>
            <div className="pb-hero__charts">
              {resume.charts.map(c => (
                <button key={c.id} type="button" className="pb-chart-btn" onClick={() => actions.openProject(resume.id, c.id)}>
                  <span className="pp-pill__diff" style={{ background: DIFF_COLORS[c.diff] }}>{DIFF_SHORT[c.diff]}</span>
                  {chartEffectiveTitle(resume, c) !== projectDisplayName(resume) && <span>{c.title}</span>}
                  <StatusBadge chart={c} />
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="pp-btn pp-btn--primary pp-btn--lg pb-hero__go" onClick={() => actions.openProject(resume.id)}>
            <Play size={16} />进入工作台
          </button>
        </section>
      )}

      <section>
        <h3 className="pb-h">新建</h3>
        <div className="pb-tiles">
          {tiles.map(t => (
            <button key={t.src} type="button" className={`pb-tile${t.src === 'bestdori' ? ' is-disabled' : ''}`} onClick={() => actions.newProject(t.src)}>
              {t.icon}<b>{t.title}</b><small>{t.desc}</small>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="pb-h">全部工程 <span className="pp-muted">{list.length}</span></h3>
        <div className="pb-grid">
          {list.map(p => (
            <div key={p.id} className={`pb-card${p.id === s.currentProjectId ? ' is-current' : ''}`} onClick={() => (onCardClick ? onCardClick(p.id) : actions.openProject(p.id))}>
              <div className="pb-card__cover">
                <Cover project={p} size={172} />
                <span className="pb-card__menu" onClick={e => e.stopPropagation()}><ProjectMenu project={p} actions={actions} /></span>
                {onCardClick && (
                  <button type="button" className="pb-card__play" title="直接进工作台" onClick={e => { e.stopPropagation(); actions.openProject(p.id); }}>
                    <Play size={16} />
                  </button>
                )}
              </div>
              <b className={p.name ? '' : 'pp-muted'}>{projectDisplayName(p)}</b>
              <small className="pp-muted">{p.artist ?? '—'} · {relTime(p.lastOpened)}</small>
              <span className="pb-card__dots">
                {p.charts.map(c => (
                  <span key={c.id} className={`pb-dot pb-dot--${chartStatus(c)}`} style={{ '--c': DIFF_COLORS[c.diff] } as CSSProperties} title={`${DIFF_NAMES[c.diff]} · ${STATUS_LABEL[chartStatus(c)]}`}>
                    {DIFF_SHORT[c.diff]}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ---------------- 变体 C：主从（左工程列表 + 右工程详情） ---------------- */

function VariantC({ actions, initialId, onBack }: { actions: Actions; initialId?: string; onBack?: () => void }) {
  const s = useProtoState();
  const list = sortedProjects(s);
  const [selId, setSelId] = useState(initialId ?? s.currentProjectId);
  const sel = list.find(p => p.id === selId) ?? list[0];
  const uploads = useMemo(() => sel.charts.filter(c => c.upload), [sel]);
  const locked = uploads.length > 0;

  return (
    <div className="pc-page">
      <aside className="pc-list">
        <div className="pc-list__head">
          {onBack ? <button type="button" className="pp-btn pp-btn--sm" onClick={onBack}>← 主页</button> : <b>谱面工程</b>}
          <NewButton actions={actions} />
        </div>
        {list.map(p => {
          const n = p.charts.length;
          const done = p.charts.filter(c => chartStatus(c) !== 'unfinished').length;
          return (
            <button key={p.id} type="button" className={`pc-item${p.id === sel.id ? ' is-selected' : ''}`} onClick={() => setSelId(p.id)} onDoubleClick={() => actions.openProject(p.id)}>
              <Cover project={p} size={36} />
              <span className="pc-item__text">
                <b className={p.name ? '' : 'pp-muted'}>{projectDisplayName(p)}{p.id === s.currentProjectId && <em className="pp-current-tag">当前</em>}</b>
                <small className="pp-muted">{done}/{n} 完成 · {relTime(p.lastOpened)}</small>
              </span>
              <span className="pc-item__bar"><span style={{ width: `${(done / n) * 100}%` }} /></span>
            </button>
          );
        })}
      </aside>

      <main className="pc-detail">
        <header className="pc-detail__head">
          <Cover project={sel} size={96} />
          <div>
            <h2 className={sel.name ? '' : 'pp-muted'}>{projectDisplayName(sel)}</h2>
            <p className="pp-muted">{sel.artist ?? '未填歌手'} · {SOURCE_LABEL(sel.source)}</p>
            <p className="pp-muted"><Music2 size={12} /> {sel.audioName ?? '无音频'} · {Math.floor(sel.durationSec / 60)}:{String(sel.durationSec % 60).padStart(2, '0')}
              {locked && <span className="pp-lock-note"><Lock size={11} />有已上传谱面，音频与时长已锁定</span>}
            </p>
          </div>
          <div className="pc-detail__actions">
            <button type="button" className="pp-btn pp-btn--primary" onClick={() => actions.openProject(sel.id)}><Play size={14} />在工作台打开</button>
            <button type="button" className="pp-btn" onClick={() => actions.editInfo(sel)}><Pencil size={14} />编辑信息</button>
            <button type="button" className="pp-btn" onClick={() => protoActions.duplicateProject(sel.id)}><Copy size={14} />复制工程</button>
            <button type="button" className="pp-icon-btn is-danger" title="删除工程" onClick={() => confirmDelete(sel)}><Trash2 size={15} /></button>
          </div>
        </header>

        <section>
          <h3 className="pb-h">谱面 <span className="pp-muted">{sel.charts.length}</span></h3>
          <div className="pc-charts">
            {sel.charts.map(c => {
              const up = chartStatus(c) === 'uploaded';
              return (
                <div key={c.id} className="pc-chart">
                  <span className="pc-chart__diff" style={{ background: DIFF_COLORS[c.diff] }}>{DIFF_NAMES[c.diff]}<b>{c.level ?? '–'}</b></span>
                  <span className="pc-chart__title">
                    <b>{chartEffectiveTitle(sel, c)}</b>
                    <small className="pp-muted">{c.noteCount} 音符 · {relTime(c.lastModified)}</small>
                  </span>
                  <StatusBadge chart={c} />
                  <span className="pc-chart__actions">
                    <button type="button" className="pp-btn pp-btn--sm" onClick={() => actions.openProject(sel.id, c.id)}><Play size={12} />打开</button>
                    <button type="button" className="pp-btn pp-btn--sm" disabled={up} onClick={() => protoActions.toggleCompleted(sel.id, c.id)}>
                      {c.completed ? '撤销完成' : '标为完成'}
                    </button>
                    <button type="button" className="pp-icon-btn" title="编辑谱面信息" onClick={() => actions.chartForm({ project: sel, chart: c })}><Pencil size={14} /></button>
                    <button type="button" className="pp-icon-btn" title="复制谱面（副本不带状态）" onClick={() => protoActions.duplicateChart(sel.id, c.id)}><Copy size={14} /></button>
                    <button type="button" className="pp-icon-btn" title={up ? 'Bestdori 上传（已上传）' : '上传到 Bestdori（待 bestdori-integration）'} disabled={up}><Upload size={14} /></button>
                    <button type="button" className="pp-icon-btn is-danger" title="删除谱面" onClick={() => protoActions.deleteChart(sel.id, c.id)}><Trash2 size={14} /></button>
                  </span>
                </div>
              );
            })}
          </div>
          <div className="pc-add">
            <button type="button" className="pp-btn" onClick={() => actions.chartForm({ project: sel, chart: null, defaultDiff: 3 })}>
              <Plus size={14} />新增谱面
            </button>
          </div>
        </section>

        <section>
          <h3 className="pb-h">上传记录</h3>
          {uploads.length === 0 ? <p className="pp-muted">还没有谱面上传到 Bestdori。</p> : (
            <ul className="pc-uploads">
              {uploads.map(c => (
                <li key={c.id}>
                  <span className="pp-pill__diff" style={{ background: DIFF_COLORS[c.diff] }}>{DIFF_SHORT[c.diff]}</span>
                  {chartEffectiveTitle(sel, c)} → <a href={`https://bestdori.com/community/charts/${c.upload!.postId}`} target="_blank" rel="noreferrer">帖子 {c.upload!.postId}</a>
                  <span className="pp-muted">{relTime(c.upload!.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

/* ---------------- 变体 D：B 当主页，点卡片下钻到 C 当工程详情 ---------------- */

function VariantD({ actions }: { actions: Actions }) {
  const [detailId, setDetailId] = useState<string | null>(null);
  return detailId
    ? <VariantC key={detailId} actions={actions} initialId={detailId} onBack={() => setDetailId(null)} />
    : <VariantB actions={actions} onCardClick={setDetailId} />;
}

/* ---------------- 页面入口 ---------------- */

export default function ProjectsPrototype({ active = false }: { active?: boolean }) {
  const [variant, setVariant] = usePrototypeVariant('variant', VARIANTS);
  const actions = usePageActions();
  return (
    <div className="pp-root">
      {variant === 'A' && <VariantA actions={actions} />}
      {variant === 'B' && <VariantB actions={actions} />}
      {variant === 'C' && <VariantC actions={actions} />}
      {variant === 'D' && <VariantD actions={actions} />}
      {actions.dialogs}
      <PrototypeSwitcher param="variant" variants={VARIANTS} current={variant} onChange={setVariant} active={active} hint="工程管理页 · ← → 切换" />
    </div>
  );
}
