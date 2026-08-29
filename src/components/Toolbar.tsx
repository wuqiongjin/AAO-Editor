import { type ReactNode } from "react";
import {
  Music,
  MousePointer,
  Copy,
  Scissors,
  Clipboard,
  Trash2,
  RotateCcw,
  Undo,
  Redo,
  ChevronLeft,
} from "lucide-react";
import SpriteIcon, { NoteIcons } from './SpriteIcon';
import { categoryShortcuts } from '../chart/config/ShortcutConfig';
import { useConfig, useEditing, useUI } from '../app/ProviderTree';
import IconButton from './IconButton';
import ChartCodeEditor from './ChartCodeEditor';

/** 区块标题（统一样式：小号大写灰字） */
function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <h3 style={{
      margin: '0 0 var(--space-2)', fontSize: 'var(--text-2xs)', fontWeight: 600,
      color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em',
    }}>{children}</h3>
  );
}

// 工具 id → 快捷键类别（tooltip 按类别合并 切换/执行）
const toolCategory: Record<string, string> = {
  mouse: "鼠标", bpm: "BPM", single: "单键", flick: "滑键",
  skill: "技能", ldirectional: "左滑", rdirectional: "右滑", slide: "滑条",
  copy: "复制", cut: "剪切", paste: "粘贴", delete: "删除", mirror: "镜像",
  undo: "撤销", redo: "重做",
};

export default function Toolbar() {
  const editing = useEditing();
  const ui = useUI();
  const { settings } = useConfig();
  const shortcutConfig = settings.shortcuts;

  const {
    selectedItems, clipboard, canUndo, canRedo,
    copy, cut, paste, deleteSelected, mirror, undo, redo,
  } = editing;
  const {
    selectedTool, setSelectedTool, beatDisplay, setBeatDisplay,
    mousePosition, toggleLeftPanel,
  } = ui;
  const canCopy = selectedItems.length > 0;
  const canPaste = clipboard.length > 0 && mousePosition !== null;

  // 工具 tooltip：合并 切换/执行 两类快捷键
  const tooltipForCategory = (cat: string): string => {
    const lines = categoryShortcuts(shortcutConfig, cat);
    return lines.length > 0 ? [`${cat}（${lines.map(l => l.mode + ' ' + l.key).join(' / ')}）`].join('\n') : cat;
  };

  const tools = [
    { id: "mouse", icon: <MousePointer size={18} />, label: "鼠标" },
    { id: "bpm", icon: <Music size={18} />, label: "BPM" },
    { id: "single", icon: <SpriteIcon {...NoteIcons.tap} size={18} />, label: "单键" },
    { id: "flick", icon: <SpriteIcon {...NoteIcons.flick} size={18} />, label: "滑键" },
    { id: "skill", icon: <SpriteIcon {...NoteIcons.skill} size={18} />, label: "技能" },
    { id: "ldirectional", icon: <SpriteIcon {...NoteIcons.leftFlick} size={18} />, label: "左滑" },
    { id: "rdirectional", icon: <SpriteIcon {...NoteIcons.rightFlick} size={18} />, label: "右滑" },
    { id: "slide", icon: <SpriteIcon {...NoteIcons.slide} size={18} />, label: "滑条" },
  ];
  const currentToolLabel = tools.find(t => t.id === selectedTool)?.label ?? selectedTool;

  const beatOptions = [
    { value: 1, label: "1/1" },
    { value: 2, label: "1/2" },
    { value: 3, label: "1/3" },
    { value: 4, label: "1/4" },
    { value: 6, label: "1/6" },
    { value: 8, label: "1/8" },
    { value: 12, label: "1/12" },
    { value: 16, label: "1/16" },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* 工具栏头部：折叠按钮 + 标题 + 当前工具提示 */}
      <div style={{
        height: 'var(--panel-header-h)', padding: '0 var(--space-2)',
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        borderBottom: '1px solid var(--border)', backgroundColor: 'var(--bg)', flexShrink: 0,
      }}>
        <IconButton
          onClick={toggleLeftPanel}
          title="收起左侧工具栏"
          width="auto"
          icon={<ChevronLeft size={14} />}
        />
        <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>工具栏</span>
        <span style={{
          marginLeft: 'auto', fontSize: 'var(--text-xs)', color: 'var(--accent-text)',
          backgroundColor: 'var(--accent-soft)', padding: '2px var(--space-2)',
          borderRadius: 'var(--radius-sm)', maxWidth: 90, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{currentToolLabel}</span>
      </div>

      {/* 工具栏内容 - 可滚动 */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: 'var(--space-4)',
        display: 'flex', flexDirection: 'column', gap: 'var(--space-6)',
      }}>
        {/* 主工具：键型选择（紧凑 2 列网格，选中态 + 完整 tooltip） */}
        <div>
          <SectionHeader>键型工具</SectionHeader>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-1)' }}>
            {tools.map((tool) => (
              <IconButton
                key={tool.id}
                active={selectedTool === tool.id}
                icon={tool.icon}
                onClick={() => setSelectedTool(tool.id)}
                title={tooltipForCategory(toolCategory[tool.id])}
              />
            ))}
          </div>
        </div>

        {/* 节拍吸附 */}
        <div>
          <SectionHeader>节拍吸附</SectionHeader>
          <select
            value={beatDisplay}
            onChange={(e) => setBeatDisplay(Number(e.target.value))}
            style={{
              width: '100%', padding: 'var(--space-2)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-sm)', fontFamily: 'inherit',
              backgroundColor: 'var(--bg-inset)', color: 'var(--text)', cursor: 'pointer',
              transition: 'border-color var(--dur) var(--ease), background-color var(--dur) var(--ease)',
            }}
          >
            {beatOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* 编辑功能（对选中对象/剪贴板）：2 列网格，谱面代码铺满 */}
        <div>
          <SectionHeader>编辑</SectionHeader>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-1)' }}>
            <IconButton icon={<Copy size={16} />} label="复制" onClick={copy} disabled={!canCopy} title={tooltipForCategory(toolCategory.copy)} />
            <IconButton icon={<Scissors size={16} />} label="剪切" onClick={cut} disabled={!canCopy} title="剪切 (Ctrl+X)" />
            <IconButton icon={<Clipboard size={16} />} label="粘贴" onClick={() => mousePosition && paste(mousePosition)} disabled={!canPaste} title={tooltipForCategory(toolCategory.paste)} />
            <IconButton icon={<Trash2 size={16} />} label="删除" onClick={deleteSelected} disabled={!canCopy} danger title="删除 (Delete)" />
            <IconButton icon={<RotateCcw size={16} />} label="镜像" onClick={mirror} disabled={!canCopy} title={tooltipForCategory(toolCategory.mirror)} />
            <IconButton icon={<Undo size={16} />} label="撤销" onClick={undo} disabled={!canUndo} title="撤销 (Ctrl+Z)" />
            <IconButton icon={<Redo size={16} />} label="还原" onClick={redo} disabled={!canRedo} title={tooltipForCategory(toolCategory.redo)} />
            {/* issue 37：谱面代码改按需弹窗——入口按钮（点击才打开弹窗，常驻无代码同步成本），跨 2 列 */}
            <div style={{ gridColumn: '1 / -1' }}>
              <ChartCodeEditor />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
