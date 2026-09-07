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
import SpriteIcon, { NoteIcons } from '../../ui/SpriteIcon';
import { categoryShortcuts } from '../../chart/config/ShortcutConfig';
import { useConfig, useEditing, useUI } from '../../app/ProviderTree';
import type { ArmedTool } from '../../app/providers/UIProvider';
import IconButton from '../../ui/IconButton';
import ChartCodeEditor from '../../chart/components/code-editor/ChartCodeEditor';
import './Toolbar.css';

// 工作台左侧工具栏（issue 22 + issue 28 + issue 49 阶段 3 迁出）：
//   - 折叠按钮 + 标题 + 当前工具 pill（顶栏）
//   - 3 段工具区：键型工具（3 列）/ 节拍吸附 / 编辑功能（2 列）
//   - 谱面代码（issue 37）入口按钮跨 2 列

/** 区块标题（统一样式：小号大写灰字） */
function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <h3 className="toolbar__section-header">{children}</h3>
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
    armedTool, setArmedTool, beatDisplay, setBeatDisplay,
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
  // 持工具态（ADR-0008 §1）：null = 指针底态（工具条首位 "鼠标" 即高亮项）
  const currentToolLabel = armedTool === null ? '指针' : (tools.find(t => t.id === armedTool)?.label ?? armedTool);
  const armOrRelease = (id: string) => {
    if (id === 'mouse') { setArmedTool(null); return; }
    // 退出三出口之一（§2 原则 3）：点击当前高亮工具 = 落回指针
    setArmedTool(armedTool === id ? null : id as ArmedTool);
  };

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
    <div className="toolbar">
      {/* 工具栏头部：折叠按钮 + 标题 + 当前工具提示 */}
      <div className="toolbar__head">
        <IconButton
          onClick={toggleLeftPanel}
          title="收起左侧工具栏"
          width="auto"
          icon={<ChevronLeft size={14} />}
        />
        <span className="toolbar__title">工具栏</span>
        <span className="toolbar__current-tool">{currentToolLabel}</span>
      </div>

      {/* 工具栏内容 - 可滚动 */}
      <div className="toolbar__body">
        {/* 主工具：键型选择（紧凑 3 列网格，选中态 + 完整 tooltip） */}
        <div>
          <SectionHeader>键型工具</SectionHeader>
          <div className="toolbar__grid toolbar__grid--3">
            {tools.map((tool) => (
              <IconButton
                key={tool.id}
                active={armedTool === null ? tool.id === 'mouse' : armedTool === tool.id}
                icon={tool.icon}
                onClick={() => armOrRelease(tool.id)}
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
            className="toolbar__beat-select"
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
          <div className="toolbar__grid toolbar__grid--2">
            <IconButton icon={<Copy size={16} />} label="复制" onClick={copy} disabled={!canCopy} title={tooltipForCategory(toolCategory.copy)} />
            <IconButton icon={<Scissors size={16} />} label="剪切" onClick={cut} disabled={!canCopy} title="剪切 (Ctrl+X)" />
            <IconButton icon={<Clipboard size={16} />} label="粘贴" onClick={() => mousePosition && paste(mousePosition)} disabled={!canPaste} title={tooltipForCategory(toolCategory.paste)} />
            <IconButton icon={<Trash2 size={16} />} label="删除" onClick={deleteSelected} disabled={!canCopy} danger title="删除 (Delete)" />
            <IconButton icon={<RotateCcw size={16} />} label="镜像" onClick={mirror} disabled={!canCopy} title={tooltipForCategory(toolCategory.mirror)} />
            <IconButton icon={<Undo size={16} />} label="撤销" onClick={undo} disabled={!canUndo} title="撤销 (Ctrl+Z)" />
            <IconButton icon={<Redo size={16} />} label="还原" onClick={redo} disabled={!canRedo} title={tooltipForCategory(toolCategory.redo)} />
            {/* issue 37：谱面代码改按需弹窗——入口按钮（点击才打开弹窗，常驻无代码同步成本），跨 2 列 */}
            <div className="toolbar__grid-full">
              <ChartCodeEditor />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
