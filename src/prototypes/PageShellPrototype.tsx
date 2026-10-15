import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Check,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  CircleHelp,
  Clock3,
  Download,
  FileMusic,
  Keyboard,
  LayoutDashboard,
  MonitorCog,
  MousePointer2,
  Music2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  Search,
  Settings2,
  SkipBack,
  SlidersHorizontal,
  Undo2,
  Upload,
  Volume2,
} from 'lucide-react';
import './PageShellPrototype.css';

type PageId = 'workspace' | 'audio' | 'settings' | 'shortcuts';
type ThemeChoice = 'light' | 'dark';

interface NavItem {
  id: PageId;
  label: string;
  shortcut: string;
  icon: typeof LayoutDashboard;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'workspace', label: '工作台', shortcut: '⇧⌘1', icon: LayoutDashboard },
  { id: 'audio', label: '音频', shortcut: '⇧⌘2', icon: Music2 },
  { id: 'settings', label: '设置', shortcut: '⇧⌘3', icon: Settings2 },
  { id: 'shortcuts', label: '快捷键', shortcut: '⇧⌘4', icon: Keyboard },
];

const PAGE_COPY: Record<PageId, { title: string; description: string }> = {
  workspace: { title: '工作台', description: '谱面编辑、工具、属性和播放集中在这里' },
  audio: { title: '音频', description: '管理当前谱面工程的音频与时长' },
  settings: { title: '设置', description: '调整应用外观、布局和配置数据' },
  shortcuts: { title: '快捷键', description: '查找并修改编辑功能的按键绑定' },
};

const TOOLS = ['选择', '单键', '滑键', '技能', '方向', '滑条', 'BPM'];
const SHORTCUT_ROWS = [
  { group: '工具', action: '切换到选择工具', keys: 'V' },
  { group: '工具', action: '切换到单键工具', keys: 'S' },
  { group: '编辑', action: '撤销', keys: 'Ctrl  Z' },
  { group: '编辑', action: '重做', keys: 'Ctrl  Shift  Z' },
  { group: '播放', action: '播放 / 暂停', keys: 'Space' },
  { group: '播放', action: '从临时起点播放', keys: 'Ctrl  Space' },
];

function PageShellPrototype() {
  const [activePage, setActivePage] = useState<PageId>('workspace');
  const [theme, setTheme] = useState<ThemeChoice>('light');
  const [navCollapsed, setNavCollapsed] = useState(true);
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [activeTool, setActiveTool] = useState('选择');

  const selectPage = (next: PageId) => {
    if (next !== 'workspace') setPlaying(false);
    setActivePage(next);
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [theme]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return;
      const index = Number(event.key) - 1;
      const next = NAV_ITEMS[index];
      if (!next) return;
      event.preventDefault();
      selectPage(next.id);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const pageCopy = PAGE_COPY[activePage];

  return (
    <div className={`page-prototype${navCollapsed ? ' is-nav-collapsed' : ''}`}>
      <aside className="app-nav" aria-label="应用页面导航">
        <div className="app-mark" title="AAO Editor · Advanced Arrangement Organizer" aria-label="AAO Editor">AAO</div>
        <nav className="app-nav-items">
          {NAV_ITEMS.map(({ id, label, shortcut, icon: Icon }) => (
            <button
              key={id}
              className={`app-nav-item${activePage === id ? ' is-active' : ''}`}
              type="button"
              onClick={() => selectPage(id)}
              aria-current={activePage === id ? 'page' : undefined}
              title={`${label} · ${shortcut}`}
            >
              <Icon size={19} strokeWidth={1.8} />
              <span>{label}</span>
              <kbd>{shortcut}</kbd>
            </button>
          ))}
        </nav>
        <button className="app-nav-help" type="button" title="原型说明">
          <CircleHelp size={18} strokeWidth={1.8} />
          <span>说明</span>
        </button>
        <button
          className="app-nav-toggle"
          type="button"
          onClick={() => setNavCollapsed((value) => !value)}
          title={navCollapsed ? '展开应用导航' : '折叠应用导航'}
        >
          {navCollapsed ? <ChevronsRight size={18} strokeWidth={1.8} /> : <ChevronsLeft size={18} strokeWidth={1.8} />}
        </button>
      </aside>

      <section className="app-surface">
        <header className="app-header">
          <div>
            <div className="page-title-row">
              <h1>{pageCopy.title}</h1>
              <span className="prototype-badge">布局原型</span>
            </div>
            <p>{pageCopy.description}</p>
          </div>
          <div className="prototype-status">
            <span className="status-dot" />
            仅演示布局，不写入配置
          </div>
        </header>

        <main className="page-viewport">
          <MountedPage active={activePage === 'workspace'}>
            <WorkspacePage
              activeTool={activeTool}
              leftPanelOpen={leftPanelOpen}
              rightPanelOpen={rightPanelOpen}
              playing={playing}
              onToolChange={setActiveTool}
              onToggleLeft={() => setLeftPanelOpen((value) => !value)}
              onToggleRight={() => setRightPanelOpen((value) => !value)}
              onTogglePlay={() => setPlaying((value) => !value)}
            />
          </MountedPage>
          <MountedPage active={activePage === 'audio'}>
            <AudioPage />
          </MountedPage>
          <MountedPage active={activePage === 'settings'}>
            <SettingsPage theme={theme} onThemeChange={setTheme} />
          </MountedPage>
          <MountedPage active={activePage === 'shortcuts'}>
            <ShortcutsPage />
          </MountedPage>
        </main>
      </section>
    </div>
  );
}

function MountedPage({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <section className={`mounted-page${active ? ' is-active' : ''}`} aria-hidden={!active}>
      {children}
    </section>
  );
}

interface WorkspacePageProps {
  activeTool: string;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  playing: boolean;
  onToolChange: (tool: string) => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onTogglePlay: () => void;
}

function WorkspacePage({
  activeTool,
  leftPanelOpen,
  rightPanelOpen,
  playing,
  onToolChange,
  onToggleLeft,
  onToggleRight,
  onTogglePlay,
}: WorkspacePageProps) {
  return (
    <div
      className={`workspace-layout${leftPanelOpen ? '' : ' has-left-rail'}${rightPanelOpen ? '' : ' has-right-rail'}`}
    >
      {leftPanelOpen ? (
        <aside className="workspace-panel tool-panel">
          <PanelHeader title="工具" actionLabel="收起工具面板" onAction={onToggleLeft}>
            <PanelLeftClose size={16} />
          </PanelHeader>
          <div className="tool-list">
            {TOOLS.map((tool, index) => (
              <button
                key={tool}
                className={activeTool === tool ? 'is-active' : ''}
                type="button"
                onClick={() => onToolChange(tool)}
              >
                <span className="tool-icon">{index + 1}</span>
                <span>{tool}</span>
                <kbd>{index < 6 ? String(index + 1) : 'B'}</kbd>
              </button>
            ))}
          </div>
          <div className="panel-group">
            <span className="panel-group-label">编辑</span>
            <div className="compact-actions">
              <button type="button" title="撤销"><Undo2 size={16} />撤销</button>
              <button type="button" title="重做"><Redo2 size={16} />重做</button>
            </div>
          </div>
        </aside>
      ) : (
        <CollapsedRail side="left" onOpen={onToggleLeft} />
      )}

      <section className="chart-workspace">
        <div className="chart-toolbar">
          <div className="chart-name">
            <FileMusic size={16} />
            <span>未命名谱面</span>
            <span className="saved-state"><Check size={12} />已保存</span>
          </div>
          <div className="chart-stats">
            <span>BPM 120</span>
            <span>4 / 4</span>
          </div>
        </div>

        <div className="chart-stage" aria-label="谱面画布示意">
          <div className="beat-ruler">
            <span>12</span><span>11</span><span>10</span><span>9</span><span>8</span><span>7</span>
          </div>
          <div className="lane-field">
            {Array.from({ length: 7 }, (_, index) => <span key={index} className="lane-line" />)}
            <span className="demo-note note-a" />
            <span className="demo-note note-b" />
            <span className="demo-note note-c" />
            <span className="demo-note note-d" />
            <span className="demo-slide" />
            <span className="judgment-line" />
          </div>
        </div>

        <div className="playbar">
          <button className="transport-button secondary" type="button" title="回到起点"><SkipBack size={17} /></button>
          <button className="transport-button primary" type="button" onClick={onTogglePlay} title={playing ? '暂停' : '播放'}>
            {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
          </button>
          <span className="timecode">00:08.420</span>
          <div className="timeline"><span style={{ width: '28%' }} /></div>
          <span className="timecode muted">00:30.000</span>
          <Volume2 size={16} className="volume-icon" />
          <div className="volume-track"><span /></div>
        </div>
      </section>

      {rightPanelOpen ? (
        <aside className="workspace-panel property-panel">
          <PanelHeader title="属性" actionLabel="收起属性面板" onAction={onToggleRight}>
            <PanelRightClose size={16} />
          </PanelHeader>
          <div className="selection-summary">
            <span className="selection-icon"><MousePointer2 size={16} /></span>
            <div><strong>已选择 1 个音符</strong><span>单键 · 第 4 轨</span></div>
          </div>
          <div className="property-section">
            <span className="panel-group-label">位置</span>
            <PropertyRow label="小节" value="8" />
            <PropertyRow label="细分" value="2 / 4" />
            <PropertyRow label="轨道" value="4" />
          </div>
          <div className="property-section">
            <span className="panel-group-label">类型</span>
            <button className="select-field" type="button">单键 <ChevronDown size={14} /></button>
          </div>
          <div className="property-hint">选择画布中的音符后，可在此精确修改属性。</div>
        </aside>
      ) : (
        <CollapsedRail side="right" onOpen={onToggleRight} />
      )}
    </div>
  );
}

function CollapsedRail({ side, onOpen }: { side: 'left' | 'right'; onOpen: () => void }) {
  const isLeft = side === 'left';
  return (
    <aside className={`workspace-rail ${isLeft ? 'left-rail' : 'right-rail'}`} aria-label={`${isLeft ? '工具' : '属性'}面板已折叠`}>
      <button type="button" onClick={onOpen} title={`展开${isLeft ? '工具' : '属性'}面板`}>
        {isLeft ? <PanelLeftOpen size={16} /> : <PanelRightOpen size={16} />}
      </button>
    </aside>
  );
}

function PanelHeader({ title, actionLabel, onAction, children }: {
  title: string;
  actionLabel: string;
  onAction: () => void;
  children: ReactNode;
}) {
  return (
    <div className="panel-header">
      <strong>{title}</strong>
      <button type="button" onClick={onAction} title={actionLabel}>{children}</button>
    </div>
  );
}

function PropertyRow({ label, value }: { label: string; value: string }) {
  return (
    <label className="property-row">
      <span>{label}</span>
      <input value={value} readOnly />
    </label>
  );
}

function AudioPage() {
  const [hasAudio, setHasAudio] = useState(true);

  return (
    <PageContent>
      <PageIntro
        eyebrow="当前谱面工程"
        title="音频与谱面时长"
        description="音频是可选素材。清除音频后仍可继续制谱，并能手动调整谱面时长。"
      />
      <div className="audio-layout">
        <section className="audio-primary surface-section">
          <div className="section-heading">
            <div>
              <h2>音频素材</h2>
              <p>支持浏览器可解码的常见音频格式</p>
            </div>
            <span className={`state-label${hasAudio ? ' success' : ''}`}>{hasAudio ? '已加载' : '无音频'}</span>
          </div>
          <div className="audio-file">
            <span className="audio-file-icon"><Music2 size={22} /></span>
            <div>
              <strong>{hasAudio ? 'star-beat-instrumental.ogg' : '尚未导入音频'}</strong>
              <span>{hasAudio ? '02:14.680 · 8.4 MB' : '无音频模式可正常编辑和预览谱面'}</span>
            </div>
            {hasAudio && <button type="button" onClick={() => setHasAudio(false)}>清除</button>}
          </div>
          <div className="section-actions">
            <button className="button-primary" type="button" onClick={() => setHasAudio(true)}>
              <Upload size={16} />{hasAudio ? '更换音频' : '导入音频'}
            </button>
            <span>导入后，谱面时长将跟随音频长度。</span>
          </div>
        </section>

        <aside className="audio-side surface-section">
          <Clock3 size={20} />
          <div>
            <h2>谱面时长</h2>
            <p>{hasAudio ? '由当前音频锁定' : '无音频时可手动修改'}</p>
          </div>
          <div className="duration-field">
            <input value={hasAudio ? '134.680' : '30.000'} readOnly={hasAudio} onChange={() => undefined} />
            <span>秒</span>
          </div>
          <span className="field-help">{hasAudio ? '清除音频后即可编辑' : '至少 1 秒，自动保存'}</span>
        </aside>
      </div>
      <div className="flow-note"><Check size={15} />切换到此页面时，工作台会保留当前位置；若正在播放则自动暂停。</div>
    </PageContent>
  );
}

function SettingsPage({ theme, onThemeChange }: { theme: ThemeChoice; onThemeChange: (theme: ThemeChoice) => void }) {
  const [settingSection, setSettingSection] = useState<'appearance' | 'layout' | 'data'>('appearance');

  return (
    <PageContent>
      <PageIntro eyebrow="应用设置" title="设置" description="管理应用外观偏好、界面语言与本地数据存储。" />
      <div className="settings-layout">
        <aside className="settings-index">
          <button className={settingSection === 'appearance' ? 'is-active' : ''} type="button" onClick={() => setSettingSection('appearance')}><MonitorCog size={17} />外观</button>
          <button className={settingSection === 'layout' ? 'is-active' : ''} type="button" onClick={() => setSettingSection('layout')}><SlidersHorizontal size={17} />布局</button>
          <button className={settingSection === 'data' ? 'is-active' : ''} type="button" onClick={() => setSettingSection('data')}><Download size={17} />配置数据</button>
        </aside>
        <section className="settings-detail surface-section">
          {settingSection === 'appearance' && (
            <>
              <SettingsHeading title="外观" description="选择应用 chrome 的显示主题；谱面画布始终保持深色。" />
              <div className="theme-options">
                <ThemeOption value="light" current={theme} onChange={onThemeChange} label="亮色" swatch="light" />
                <ThemeOption value="dark" current={theme} onChange={onThemeChange} label="暗色" swatch="dark" />
              </div>
              <div className="settings-row">
                <div><strong>跟随系统</strong><span>系统主题改变时自动切换</span></div>
                <button className="switch" type="button" aria-label="跟随系统"><span /></button>
              </div>
            </>
          )}
          {settingSection === 'layout' && (
            <>
              <SettingsHeading title="布局" description="保存面板开合、宽度和画布缩放。" />
              <div className="settings-row"><div><strong>启动时恢复面板布局</strong><span>记住工具和属性面板的开合状态</span></div><button className="switch is-on" type="button"><span /></button></div>
              <div className="settings-row"><div><strong>界面密度</strong><span>影响页面与控件间距，不影响画布比例</span></div><button className="select-button" type="button">紧凑 <ChevronDown size={14} /></button></div>
            </>
          )}
          {settingSection === 'data' && (
            <>
              <SettingsHeading title="配置数据" description="导入或导出主题、布局、音频偏好和快捷键。" />
              <div className="data-actions"><button className="button-secondary" type="button"><Download size={16} />导出全部配置</button><button className="button-secondary" type="button"><Upload size={16} />导入配置</button></div>
              <div className="danger-row"><div><strong>恢复默认设置</strong><span>不会删除谱面工程</span></div><button type="button"><RotateCcw size={15} />恢复默认</button></div>
            </>
          )}
        </section>
      </div>
    </PageContent>
  );
}

function SettingsHeading({ title, description }: { title: string; description: string }) {
  return <div className="settings-heading"><h2>{title}</h2><p>{description}</p></div>;
}

function ThemeOption({ value, current, onChange, label, swatch }: {
  value: ThemeChoice;
  current: ThemeChoice;
  onChange: (theme: ThemeChoice) => void;
  label: string;
  swatch: string;
}) {
  const active = current === value;
  return (
    <button className={`theme-option${active ? ' is-active' : ''}`} type="button" onClick={() => onChange(value)}>
      <span className={`theme-preview ${swatch}`}><i /><i /><i /></span>
      <span>{label}</span>
      <span className="radio-mark">{active && <Check size={13} />}</span>
    </button>
  );
}

function ShortcutsPage() {
  const [query, setQuery] = useState('');
  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return SHORTCUT_ROWS;
    return SHORTCUT_ROWS.filter((row) => `${row.group}${row.action}${row.keys}`.toLowerCase().includes(normalized));
  }, [query]);

  return (
    <PageContent wide>
      <PageIntro eyebrow="输入与效率" title="快捷键" description="搜索功能，点击键位后直接录入新的组合键。冲突会在保存前提示。" />
      <section className="shortcut-surface surface-section">
        <div className="shortcut-toolbar">
          <label className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索功能或按键" /></label>
          <button className="button-secondary" type="button"><RotateCcw size={15} />恢复默认</button>
        </div>
        <div className="shortcut-table" role="table" aria-label="快捷键列表">
          <div className="shortcut-row shortcut-head" role="row"><span>类别</span><span>功能</span><span>快捷键</span><span>启用</span></div>
          {visibleRows.map((row) => (
            <div className="shortcut-row" role="row" key={row.action}>
              <span className="shortcut-group">{row.group}</span>
              <strong>{row.action}</strong>
              <button className="key-binding" type="button">{row.keys.split('  ').map((part) => <kbd key={part}>{part}</kbd>)}</button>
              <button className="switch is-on compact" type="button" aria-label={`启用${row.action}`}><span /></button>
            </div>
          ))}
          {visibleRows.length === 0 && <div className="empty-result">没有匹配的功能</div>}
        </div>
      </section>
    </PageContent>
  );
}

function PageContent({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <div className={`page-content${wide ? ' is-wide' : ''}`}>{children}</div>;
}

function PageIntro({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <header className="page-intro">
      <span>{eyebrow}</span>
      <h2>{title}</h2>
      <p>{description}</p>
    </header>
  );
}

export default PageShellPrototype;