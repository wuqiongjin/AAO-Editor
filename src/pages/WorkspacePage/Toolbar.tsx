import { type ReactNode, useMemo } from "react";
import {
  Music,
  MousePointer,
  Copy,
  Scissors,
  Clipboard,
  Trash2,
  FlipHorizontal2,
  Undo,
  Redo,
  ChevronLeft,
  FileCode,
} from "lucide-react";
import NoteIconGlyph from '../../chart/rendering/NoteIconGlyph';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '../../visual/noteSkin';
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
  noteCode: "音符代码", undo: "撤销", redo: "重做",
};

export default function Toolbar() {
  const editing = useEditing();
  const ui = useUI();
  const { settings } = useConfig();
  const shortcutConfig = settings.shortcuts;
  // issue 86：工具栏音符图标直接读当前音符皮肤（六条目）→ 与素材页 / 画布**同一套素材与绘制器**，
  // 素材页换肤即时联动（旧实现走 src/ui/SpriteIcon.tsx 的 legacy 素材，既糊又不联动）
  const noteIcons = useMemo(
    () => buildActiveNoteIcons(normalizeNoteSkinSelection(settings.visual?.noteSkin)),
    [settings.visual?.noteSkin],
  );

  const {
    selectedItems, clipboard, canUndo, canRedo,
    copy, cut, undo, redo,
  } = editing;
  const {
    armedTool, setArmedTool, beatDisplay, setBeatDisplay,
    toggleLeftPanel,
  } = ui;
  const canCopy = selectedItems.length > 0;
  // §2.1（六轮）：粘贴 = 持工具态（悬停整组预览 + 单击粘贴并驻留 = 连续粘贴）。
  // **空剪贴板 = 不可进态**：粘贴是唯一"前提缺失即完全空转"的工具——无剪贴板时单击无事发生、
  // 悬停预览也为空（删除/镜像无选区时点中音符仍立即生效，键型/BPM/Slide 是放置、永远有产物）。
  // 故按钮置灰并在 tooltip 说明原因；`V` 键同步（Editor.runFunction）以保持键鼠一致。
  // 注：只判剪贴板，**不判光标**——光标不在画布只是"落点非法→无事发生"（§1），不该阻止进态。
  const canPaste = clipboard.length > 0;

  // 工具 tooltip：合并 切换/执行 两类快捷键
  const tooltipForCategory = (cat: string): string => {
    const lines = categoryShortcuts(shortcutConfig, cat);
    return lines.length > 0 ? [`${cat}（${lines.map(l => l.mode + ' ' + l.key).join(' / ')}）`].join('\n') : cat;
  };

  const tools = [
    { id: "mouse", icon: <MousePointer size={18} />, label: "鼠标" },
    { id: "bpm", icon: <Music size={18} />, label: "BPM" },
    { id: "single", icon: <NoteIconGlyph icons={noteIcons} item="tap" size={28} />, label: "单键" },
    { id: "flick", icon: <NoteIconGlyph icons={noteIcons} item="flick" size={28} />, label: "滑键" },
    { id: "skill", icon: <NoteIconGlyph icons={noteIcons} item="skill" size={28} />, label: "技能" },
    { id: "ldirectional", icon: <NoteIconGlyph icons={noteIcons} item="dirL" size={28} />, label: "左滑" },
    { id: "rdirectional", icon: <NoteIconGlyph icons={noteIcons} item="dirR" size={28} />, label: "右滑" },
    { id: "slide", icon: <NoteIconGlyph icons={noteIcons} item="slide" size={28} />, label: "滑条" },
  ];
  // 持工具态（ADR-0008 §1）：null = 指针底态（工具条首位 "鼠标" 即高亮项）。
  // 动作类持工具态（方案 A，issue 55 三轮：删除/镜像）标签供顶部 pill 显示
  const armLabels: Record<string, string> = { delete: '删除', mirror: '镜像', paste: '粘贴', noteCode: '音符代码' };
  const currentToolLabel = armedTool === null
    ? '指针'
    : (tools.find(t => t.id === armedTool)?.label ?? armLabels[armedTool] ?? armedTool);
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
            <IconButton icon={<Scissors size={16} />} label="剪切" onClick={cut} disabled={!canCopy} title={tooltipForCategory(toolCategory.cut)} />
            {/* 粘贴 = 持工具态 arm/释放（§2.1 六轮）：与 v 键归位，悬停预览 + 单击粘贴并驻留（连续粘贴）；
                空剪贴板 → 置灰（进态无意义）+ tooltip 说明；v 键同步不进态 */}
            <IconButton
                icon={<Clipboard size={16} />}
                label="粘贴"
                onClick={() => armOrRelease('paste')}
                active={armedTool === 'paste'}
                disabled={!canPaste}
                title={canPaste ? tooltipForCategory(toolCategory.paste) : '粘贴（剪贴板为空，先 Ctrl+C 复制）'}
            />
            {/* 删除/镜像 = 持工具态入口（方案 A）：单击进态，音符上点谁删/镜谁、框选批量；
                再点按钮/Esc/切换工具退出。即时执行选区仍走 Delete/Ctrl+T、Ctrl+Q 执行键 */}
            <IconButton icon={<Trash2 size={16} />} label="删除" onClick={() => armOrRelease('delete')} active={armedTool === 'delete'} danger title={tooltipForCategory(toolCategory.delete)} />
            {/* issue 86：#2 镜像图标：原 RotateCcw（逆时针旋转 = 重置/撤销语义）→ FlipHorizontal2（左右镜像） */}
            <IconButton icon={<FlipHorizontal2 size={16} />} label="镜像" onClick={() => armOrRelease('mirror')} active={armedTool === 'mirror'} title={tooltipForCategory(toolCategory.mirror)} />
            <IconButton icon={<Undo size={16} />} label="撤销" onClick={undo} disabled={!canUndo} title={tooltipForCategory(toolCategory.undo)} />
            <IconButton icon={<Redo size={16} />} label="还原" onClick={redo} disabled={!canRedo} title={tooltipForCategory(toolCategory.redo)} />
            {/* issue 59 §2：「音符代码」= 持工具态（与删除/镜像同构），点音符即看其代码、弹窗关闭后态驻留；
                Ctrl+B = 看光标处音符的代码（不切工具）。与下面的「谱面代码」（永远完整谱面）各司其职 */}
            <IconButton
                icon={<FileCode size={16} />}
                label="音符代码"
                onClick={() => armOrRelease('noteCode')}
                active={armedTool === 'noteCode'}
                title={`${tooltipForCategory(toolCategory.noteCode)}\n点音符查看其代码；Ctrl+B 看光标处音符`}
            />
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
