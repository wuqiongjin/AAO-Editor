import { useState, type ReactNode } from "react";
import {
  Music,
  Square,
  MousePointer,
  ZoomIn,
  ZoomOut,
  Copy,
  Scissors,
  Clipboard,
  Trash2,
  RotateCcw,
  Undo,
  Redo,
  Play,
  Pause,
} from "lucide-react";
import SpriteIcon, { NoteIcons } from './SpriteIcon';
import { categoryShortcuts, formatKey } from '../utils/ShortcutConfig';
import { useEditing, useUI, useConfig, usePlayback } from '../contexts';

interface ToolbarProps {
  // 仅留音频引擎相关的回调；UI/编辑/配置状态经 hooks 直读（ADR-0003 §7）
  onTogglePlay: () => void;
}

/** 区块标题（统一样式：小号大写灰字） */
function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <h3 style={{
      margin: '0 0 var(--space-2)', fontSize: 'var(--text-2xs)', fontWeight: 600,
      color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em',
    }}>{children}</h3>
  );
}

/** 通用工具栏按钮：带 hover / pressed / active / disabled / danger 态的令牌化样式 */
function ToolbarButton({
  onClick, disabled, title, active, outlined, danger, icon, label,
}: {
  onClick: () => void; disabled?: boolean; title?: string;
  active?: boolean; outlined?: boolean; danger?: boolean;
  icon?: ReactNode; label?: string;
}) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);

  let bg = 'transparent';
  let fg: string | undefined;
  let border = '1px solid transparent';
  if (active) {
    bg = 'var(--accent-soft)'; fg = 'var(--accent-text)'; border = '1px solid var(--accent)';
  } else if (danger) {
    bg = hover ? 'var(--danger-soft)' : 'transparent'; fg = 'var(--danger-text)';
  } else if (outlined) {
    bg = hover ? 'var(--bg-hover)' : 'var(--bg-inset)'; border = '1px solid var(--border)'; fg = 'var(--text)';
  } else {
    bg = hover ? 'var(--bg-hover)' : 'transparent'; fg = disabled ? 'var(--text-subtle)' : 'var(--text)';
  }

  return (
    <button
      style={{
        width: '100%',
        display: 'flex', alignItems: 'center', justifyContent: label ? 'flex-start' : 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-2) var(--space-3)',
        borderRadius: 'var(--radius-sm)',
        border,
        backgroundColor: bg,
        color: fg,
        cursor: disabled ? 'not-allowed' : 'pointer',
        textAlign: 'left',
        fontFamily: 'inherit', fontSize: 'var(--text-sm)',
        opacity: disabled ? 0.45 : 1,
        transform: pressed ? 'scale(0.98)' : undefined,
        transition: 'background-color var(--dur) var(--ease), color var(--dur) var(--ease), border-color var(--dur) var(--ease), transform var(--dur) var(--ease)',
      }}
      onClick={onClick}
      disabled={disabled}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPressed(false); }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
    >
      {icon && <span style={{ display: 'flex', flexShrink: 0 }}>{icon}</span>}
      {label && <span>{label}</span>}
    </button>
  );
}

export default function Toolbar({ onTogglePlay }: ToolbarProps) {
  // M1 收口：按 ADR-0003 §7 拆分——三域直读 hooks
  const editing = useEditing();
  const ui = useUI();
  const { settings } = useConfig();
  const { isPlaying, canPlay } = usePlayback();
  const shortcutConfig = settings.shortcuts;

  const {
    selectedItems, clipboard, canUndo, canRedo,
    copy, cut, paste, deleteSelected, mirror, undo, redo,
  } = editing;
  const {
    selectedTool, setSelectedTool, beatDisplay, setBeatDisplay,
    scale, setScale, isCombinationMode, setCombinationMode,
    mousePosition,
  } = ui;
  const canCopy = selectedItems.length > 0;
  const canPaste = clipboard.length > 0 && mousePosition !== null;

  // 工具 id → 快捷键类别（tooltip 按类别合并 切换/执行）
  const toolCategory: Record<string, string> = {
    mouse: "鼠标", bpm: "BPM", single: "单键", flick: "滑键",
    skill: "技能", ldirectional: "左滑", rdirectional: "右滑", slide: "滑条",
    copy: "复制", cut: "剪切", paste: "粘贴", delete: "删除", mirror: "镜像",
    undo: "撤销", redo: "重做",
  };
  const tooltipForCategory = (cat: string): string => {
    const lines = categoryShortcuts(shortcutConfig, cat);
    if (lines.length === 0) return cat;
    return [cat, ...lines.map(l => `${l.mode}  ${l.key}`)].join("\n");
  };
  const tools = [
    { id: "mouse", icon: <MousePointer size={20} />, label: "鼠标状态" },
    { id: "bpm", icon: <Music size={20} />, label: "BPM键型" },
    { id: "single", icon: <SpriteIcon {...NoteIcons.tap} size={20} />, label: "单键音符" },
    { id: "flick", icon: <SpriteIcon {...NoteIcons.flick} size={20} />, label: "滑键音符" },
    { id: "skill", icon: <SpriteIcon {...NoteIcons.skill} size={20} />, label: "技能音符" },
    { id: "ldirectional", icon: <SpriteIcon {...NoteIcons.leftFlick} size={20} />, label: "左方向滑键" },
    { id: "rdirectional", icon: <SpriteIcon {...NoteIcons.rightFlick} size={20} />, label: "右方向滑键" },
    { id: "slide", icon: <SpriteIcon {...NoteIcons.slide} size={20} />, label: "滑条音符" },
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
      {/* 工具栏头部：标题 + 当前工具提示（右侧留白避开 Editor 的折叠按钮） */}
      <div style={{
        height: 'var(--panel-header-h)', padding: '0 var(--space-3)', paddingRight: 44,
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        borderBottom: '1px solid var(--border)', backgroundColor: 'var(--bg)', flexShrink: 0,
      }}>
        <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>工具栏</span>
        <span style={{
          marginLeft: 'auto', fontSize: 'var(--text-xs)', color: 'var(--accent-text)',
          backgroundColor: 'var(--accent-soft)', padding: '2px var(--space-2)',
          borderRadius: 'var(--radius-sm)', maxWidth: 140, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{currentToolLabel}</span>
      </div>

      {/* 工具栏内容 - 可滚动 */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: 'var(--space-4)',
        display: 'flex', flexDirection: 'column', gap: 'var(--space-6)',
      }}>
        {/* 工具选择 */}
        <div>
          <SectionHeader>基础键型</SectionHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {tools.map((tool) => (
              <ToolbarButton
                key={tool.id}
                active={selectedTool === tool.id}
                icon={tool.icon}
                label={tool.label}
                onClick={() => setSelectedTool(tool.id)}
                title={tooltipForCategory(toolCategory[tool.id])}
              />
            ))}
          </div>
        </div>

        {/* 节拍显示工具 */}
        <div>
          <SectionHeader>节拍显示</SectionHeader>
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

        {/* 缩放控制 */}
        <div>
          <SectionHeader>缩放</SectionHeader>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <div style={{ flex: 1 }}>
              <ToolbarButton
                outlined
                icon={<ZoomIn size={16} />}
                onClick={() => setScale(prev => Math.min(prev + 0.1, 3))}
                title="放大"
              />
            </div>
            <div style={{ flex: 1 }}>
              <ToolbarButton
                outlined
                icon={<ZoomOut size={16} />}
                onClick={() => setScale(prev => Math.max(prev - 0.1, 0.1))}
                title="缩小"
              />
            </div>
          </div>
          <div style={{
            fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
            marginTop: 'var(--space-2)', textAlign: 'center', fontVariantNumeric: 'tabular-nums',
          }}>
            {Math.round(scale * 100)}%
          </div>
        </div>

        {/* 编辑功能 */}
        <div>
          <SectionHeader>编辑</SectionHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <ToolbarButton icon={<Copy size={16} />} label="复制" onClick={copy} disabled={!canCopy} title={tooltipForCategory(toolCategory.copy)} />
            <ToolbarButton icon={<Scissors size={16} />} label="剪切" onClick={cut} disabled={!canCopy} title="剪切 (Ctrl+X)" />
            <ToolbarButton icon={<Clipboard size={16} />} label="粘贴" onClick={() => mousePosition && paste(mousePosition)} disabled={!canPaste} title={tooltipForCategory(toolCategory.paste)} />
            <ToolbarButton icon={<Trash2 size={16} />} label="删除" onClick={deleteSelected} disabled={!canCopy} danger title="删除 (Delete)" />
            <ToolbarButton icon={<RotateCcw size={16} />} label="镜像" onClick={mirror} disabled={!canCopy} title={tooltipForCategory(toolCategory.mirror)} />
            <ToolbarButton icon={<Undo size={16} />} label="撤销" onClick={undo} disabled={!canUndo} title="撤销 (Ctrl+Z)" />
            <ToolbarButton icon={<Redo size={16} />} label="还原" onClick={redo} disabled={!canRedo} title={tooltipForCategory(toolCategory.redo)} />
          </div>
        </div>

        {/* 组合状态 */}
        <div>
          <SectionHeader>状态</SectionHeader>
          <ToolbarButton
            active={isCombinationMode}
            icon={<Square size={16} />}
            label="组合状态"
            onClick={() => setCombinationMode(!isCombinationMode)}
            title="组合状态 - 支持多选音符"
          />
        </div>

        {/* 播放控制（ticket 14 已接通：AudioEngine 播放/暂停 + 预览线 + 按键音） */}
        <div>
          <SectionHeader>播放</SectionHeader>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <div style={{ flex: 1 }}>
              <ToolbarButton
                outlined
                icon={isPlaying ? <Pause size={16} /> : <Play size={16} />}
                onClick={onTogglePlay}
                disabled={!canPlay}
                title={canPlay ? `播放/暂停（${formatKey(shortcutConfig.play)}）` : "未加载音乐，无法播放"}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
