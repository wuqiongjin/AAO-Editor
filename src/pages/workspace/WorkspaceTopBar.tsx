// 工作台顶栏（issue 170 → 票 180 换壳）：项目切换器 + 撤销 / 重做；右簇 = 吸附｜缩放｜显示设置｜谱面代码｜片段库。
// 当前 BPM 进了画布左下读数（票 179），顶栏不再重复。
import { Braces, LibraryBig, Minus, Plus, Redo2, Undo2 } from 'lucide-react';
import ChartSwitcher from './ChartSwitcher';
import BeatSnapCapsule from './BeatSnapCapsule';
import WorkspaceDisplayPanel from './WorkspaceDisplayPanel';
import { useChartCodeEditor } from '../../chart/components/code-editor/ChartCodeEditorProvider';
import { formatKey } from '../../chart/config/ShortcutConfig';
import { useConfig, useEditing, useUI } from '../../app/ProviderTree';
import { t } from '../../i18n';
import './WorkspaceTopBar.css';

const withKey = (label: string, binding: string | null) => (binding ? `${label} (${formatKey(binding)})` : label);

function ZoomCapsule() {
  const { scale, setScale } = useUI();
  return (
    <div
      className="ws-zoom-capsule"
      onWheel={(e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.1 : -0.1;
        setScale(prev => Math.min(3, Math.max(Math.round((prev + delta) * 10) / 10, 0.1)));
      }}
    >
      <button
        type="button"
        className="ws-zoom-capsule__btn"
        title={t('editor.zoomOut')}
        aria-label={t('editor.zoomOut')}
        onClick={() => setScale(prev => Math.max(prev - 0.1, 0.1))}
      >
        <Minus size={12} strokeWidth={2} />
      </button>
      <span
        className="ws-zoom-capsule__val"
        onDoubleClick={() => setScale(1)}
        title={t('editor.zoomReset')}
      >
        {Math.round(scale * 100)}%
      </span>
      <button
        type="button"
        className="ws-zoom-capsule__btn"
        title={t('editor.zoomIn')}
        aria-label={t('editor.zoomIn')}
        onClick={() => setScale(prev => Math.min(prev + 0.1, 3))}
      >
        <Plus size={12} strokeWidth={2} />
      </button>
    </div>
  );
}

export default function WorkspaceTopBar() {
  const { canUndo, canRedo, undo, redo } = useEditing();
  const { settings, setPatternDrawer } = useConfig();
  // issue 37 / 59 §2：谱面代码永远打开**完整**谱面，不看选区、不进工具轴（与「音符代码」工具各司其职）
  const { openChartCode } = useChartCodeEditor();
  const shortcuts = settings.shortcuts;
  const drawerOpen = settings.layout.patternDrawer.open;

  return (
    <header className="ws-topbar">
      <ChartSwitcher />

      <div className="ws-topbar-history">
        <button
          type="button"
          className="ws-topbar-ghost-btn"
          onClick={undo}
          disabled={!canUndo}
          aria-label={t('tool.undo')}
          title={withKey(t('tool.undo'), shortcuts.undo)}
        >
          <Undo2 size={15} />
        </button>
        <button
          type="button"
          className="ws-topbar-ghost-btn"
          onClick={redo}
          disabled={!canRedo}
          aria-label={t('tool.redo')}
          title={withKey(t('tool.redo'), shortcuts.redo)}
        >
          <Redo2 size={15} />
        </button>
      </div>

      <div className="ws-topbar-right">
        <BeatSnapCapsule />
        <ZoomCapsule />
        <WorkspaceDisplayPanel />
        <span className="ws-topbar-divider" />
        <button
          type="button"
          className="ws-topbar-icon-btn"
          onClick={openChartCode}
          aria-label={t('tool.chartCode')}
          title={t('chartCode.open')}
        >
          <Braces size={14} />
        </button>
        <button
          type="button"
          className={`ws-topbar-icon-btn${drawerOpen ? ' is-active' : ''}`}
          onClick={() => setPatternDrawer({ open: !drawerOpen })}
          aria-pressed={drawerOpen}
          aria-label={t('patternLibrary.toggle')}
          title={withKey(t('patternLibrary.toggle'), shortcuts.toggleSidebar)}
        >
          <LibraryBig size={14} />
        </button>
      </div>
    </header>
  );
}
