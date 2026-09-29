import { useMemo } from "react";
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
import NoteIconGlyph from '../../rendering/primitives/NoteIconGlyph';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '../../rendering/skin/noteSkin';
import { categoryShortcuts } from '../../chart/config/ShortcutConfig';
import { useConfig, useEditing, useUI } from '../../app/ProviderTree';
import type { ArmedTool } from '../../app/providers/UIProvider';
import IconButton from '../../ui/IconButton';
import ChartCodeEditor from '../../chart/components/code-editor/ChartCodeEditor';
import SectionHeader from './ToolbarSection';
import CurveConfigPanel from './CurveConfigPanel';
import { t, type MessageKey } from '../../i18n';
import './Toolbar.css';

// 工作台左侧工具栏（issue 22 + issue 28 + issue 49 阶段 3 迁出）：
//   - 折叠按钮 + 标题 + 当前工具 pill（顶栏）
//   - 3 段工具区：键型工具（3 列）/ 节拍吸附 / 编辑功能（2 列）
//   - 谱面代码（issue 37）入口按钮跨 2 列

// 工具 id → 快捷键类别（tooltip 按类别合并 切换/执行）
const toolCategory: Record<string, string> = {
  mouse: "mouse", bpm: "bpm", single: "single", flick: "flick",
  skill: "skill", ldirectional: "ldirectional", rdirectional: "rdirectional", slide: "slide", curve: "curve",
  copy: "copy", cut: "cut", paste: "paste", delete: "delete", mirror: "mirror",
  noteCode: "noteCode", undo: "undo", redo: "redo",
};

// 曲线工具配置项的选项表已随面板抽到 `CurveConfigPanel.tsx`（issue 114）。

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
    curveConfig, setCurveConfig,
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
    const catLabel = t(`tool.cat.${cat}` as MessageKey);
    const lines = categoryShortcuts(shortcutConfig, cat);
    return lines.length > 0 ? t('toolbar.tooltip', { cat: catLabel, lines: lines.map(l => l.mode + ' ' + l.key).join(' / ') }) : catLabel;
  };

  const tools = [
    { id: "mouse", icon: <MousePointer size={18} />, labelKey: "tool.mouse" as MessageKey },
    { id: "bpm", icon: <Music size={18} />, labelKey: "tool.bpm" as MessageKey },
    { id: "single", icon: <NoteIconGlyph icons={noteIcons} item="tap" size={28} />, labelKey: "tool.single" as MessageKey },
    { id: "flick", icon: <NoteIconGlyph icons={noteIcons} item="flick" size={28} />, labelKey: "tool.flick" as MessageKey },
    { id: "skill", icon: <NoteIconGlyph icons={noteIcons} item="skill" size={28} />, labelKey: "tool.skill" as MessageKey },
    { id: "ldirectional", icon: <NoteIconGlyph icons={noteIcons} item="dirL" size={28} />, labelKey: "tool.dirL.short" as MessageKey },
    { id: "rdirectional", icon: <NoteIconGlyph icons={noteIcons} item="dirR" size={28} />, labelKey: "tool.dirR.short" as MessageKey },
    { id: "slide", icon: <NoteIconGlyph icons={noteIcons} item="slide" size={28} />, labelKey: "tool.slide" as MessageKey },
    { id: "curve", icon: <NoteIconGlyph icons={noteIcons} item="curve" size={28} />, labelKey: "tool.curve" as MessageKey },
  ];
  const armLabels: Record<string, MessageKey> = { delete: 'tool.delete', mirror: 'tool.mirror', paste: 'tool.paste', noteCode: 'tool.noteCode' };
  const currentToolLabel = armedTool === null
    ? t('tool.pointer')
    : (armedTool === 'ldirectional' ? t('tool.dirL.short')
      : armedTool === 'rdirectional' ? t('tool.dirR.short')
      : (tools.find(t0 => t0.id === armedTool) ? t(tools.find(t0 => t0.id === armedTool)!.labelKey) : (armLabels[armedTool] ? t(armLabels[armedTool]) : armedTool)));
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
          title={t('toolbar.collapseLeft')}
          width="auto"
          icon={<ChevronLeft size={14} />}
        />
        <span className="toolbar__title">{t('toolbar.title')}</span>
        <span className="toolbar__current-tool">{currentToolLabel}</span>
      </div>

      {/* 工具栏内容 - 可滚动 */}
      <div className="toolbar__body">
        {/* 主工具：键型选择（紧凑 3 列网格，选中态 + 完整 tooltip） */}
        <div>
          <SectionHeader>{t('toolbar.noteTools')}</SectionHeader>
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
          <SectionHeader>{t('toolbar.beatSnap')}</SectionHeader>
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

        {/* issue 09 S2：曲线工具配置（仅曲线持工具态时出现）。
            issue 114：面板抽到 CurveConfigPanel（表驱动）；配置持久化于 settings.curve、跨会话沿用 */}
        {armedTool === "curve" && (
          <CurveConfigPanel config={curveConfig} onChange={setCurveConfig} />
        )}

        {/* 编辑功能（对选中对象/剪贴板）：2 列网格，谱面代码铺满 */}
        <div>
          <SectionHeader>{t('toolbar.edit')}</SectionHeader>
          <div className="toolbar__grid toolbar__grid--2">
            <IconButton icon={<Copy size={16} />} label={t('tool.copy')} onClick={copy} disabled={!canCopy} title={tooltipForCategory(toolCategory.copy)} />
            <IconButton icon={<Scissors size={16} />} label={t('tool.cut')} onClick={cut} disabled={!canCopy} title={tooltipForCategory(toolCategory.cut)} />
            {/* 粘贴 = 持工具态 arm/释放（§2.1 六轮）：与 v 键归位，悬停预览 + 单击粘贴并驻留（连续粘贴）；
                空剪贴板 → 置灰（进态无意义）+ tooltip 说明；v 键同步不进态 */}
            <IconButton
                icon={<Clipboard size={16} />}
                label={t('tool.paste')}
                onClick={() => armOrRelease('paste')}
                active={armedTool === 'paste'}
                disabled={!canPaste}
                title={canPaste ? tooltipForCategory(toolCategory.paste) : t('toolbar.pasteEmpty')}
            />
            {/* 删除/镜像 = 持工具态入口（方案 A）：单击进态，音符上点谁删/镜谁、框选批量；
                再点按钮/Esc/切换工具退出。即时执行选区仍走 Delete/Ctrl+T、Ctrl+Q 执行键 */}
            <IconButton icon={<Trash2 size={16} />} label={t('tool.delete')} onClick={() => armOrRelease('delete')} active={armedTool === 'delete'} danger title={tooltipForCategory(toolCategory.delete)} />
            {/* issue 86：#2 镜像图标：原 RotateCcw（逆时针旋转 = 重置/撤销语义）→ FlipHorizontal2（左右镜像） */}
            <IconButton icon={<FlipHorizontal2 size={16} />} label={t('tool.mirror')} onClick={() => armOrRelease('mirror')} active={armedTool === 'mirror'} title={tooltipForCategory(toolCategory.mirror)} />
            <IconButton icon={<Undo size={16} />} label={t('tool.undo')} onClick={undo} disabled={!canUndo} title={tooltipForCategory(toolCategory.undo)} />
            <IconButton icon={<Redo size={16} />} label={t('tool.redo')} onClick={redo} disabled={!canRedo} title={tooltipForCategory(toolCategory.redo)} />
            {/* issue 59 §2：「音符代码」= 持工具态（与删除/镜像同构），点音符即看其代码、弹窗关闭后态驻留；
                Ctrl+B = 看光标处音符的代码（不切工具）。与下面的「谱面代码」（永远完整谱面）各司其职 */}
            <IconButton
                icon={<FileCode size={16} />}
                label={t('tool.noteCode')}
                onClick={() => armOrRelease('noteCode')}
                active={armedTool === 'noteCode'}
                title={t('toolbar.noteCodeHint', { tooltip: tooltipForCategory(toolCategory.noteCode) })}
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
