// 工作台窄工具轨（issue 177 Q2 / Q10 / Q11，票 180）：固定宽、不折叠、不拖宽；15 键 5 组。
// 节拍吸附在顶栏（票 178）、曲线配置在画布左上角胶囊（票 179）、撤销 / 重做与谱面代码在顶栏。
import { memo, useMemo, type ReactNode } from 'react';
import { MousePointer2, Music, Copy, Scissors, Clipboard, Trash2, FlipHorizontal2, FileCode } from 'lucide-react';
import NoteIconGlyph from '../../rendering/primitives/NoteIconGlyph';
import type { ToolGlyphItem } from '../../rendering/primitives/noteGlyph';
import { buildActiveNoteIcons, normalizeNoteSkinSelection } from '../../rendering/skin/noteSkin';
import { categoryShortcuts } from '../../chart/config/ShortcutConfig';
import { useConfig, useEditing, useUI } from '../../app/ProviderTree';
import type { ArmedTool } from '../../app/providers/UIProvider';
import { t, type MessageKey } from '../../i18n';
import './WorkspaceToolRail.css';

interface RailTool {
  /** 工具轴 id，同时也是快捷键类别（`categoryShortcuts`） */
  id: string;
  icon: ReactNode;
  labelKey: MessageKey;
  danger?: boolean;
  /** 即时动作：点一下就执行，不进持工具态、无高亮（ADR-0008 §2.1 六轮：复制 / 剪切不占工具轴） */
  action?: () => void;
  disabled?: boolean;
  disabledTip?: string;
}

export default memo(function WorkspaceToolRail() {
  const { armedTool, setArmedTool } = useUI();
  const { settings } = useConfig();
  const { clipboard, selectedItems, copy, cut } = useEditing();
  // issue 86：音符图标直接读当前音符皮肤 → 与素材页 / 画布同一套素材与绘制器，换肤即时联动
  const noteIcons = useMemo(
    () => buildActiveNoteIcons(normalizeNoteSkinSelection(settings.visual?.noteSkin)),
    [settings.visual?.noteSkin],
  );

  const hasSelection = selectedItems.length > 0;
  const glyph = (item: ToolGlyphItem) => <NoteIconGlyph icons={noteIcons} item={item} size={26} />;
  const groups: RailTool[][] = [
    [{ id: 'mouse', icon: <MousePointer2 size={18} />, labelKey: 'tool.pointer' }],
    [
      { id: 'single', icon: glyph('tap'), labelKey: 'tool.single' },
      { id: 'flick', icon: glyph('flick'), labelKey: 'tool.flick' },
      { id: 'skill', icon: glyph('skill'), labelKey: 'tool.skill' },
      { id: 'ldirectional', icon: glyph('dirL'), labelKey: 'tool.dirL.full' },
      { id: 'rdirectional', icon: glyph('dirR'), labelKey: 'tool.dirR.full' },
      { id: 'slide', icon: glyph('slide'), labelKey: 'tool.slide' },
      { id: 'curve', icon: glyph('curve'), labelKey: 'tool.curve' },
    ],
    [{ id: 'bpm', icon: <Music size={18} />, labelKey: 'tool.bpm' }],
    [
      { id: 'copy', icon: <Copy size={17} />, labelKey: 'tool.copy', action: copy, disabled: !hasSelection, disabledTip: t('toolbar.copyNeedsSelection') },
      { id: 'cut', icon: <Scissors size={17} />, labelKey: 'tool.cut', action: cut, disabled: !hasSelection, disabledTip: t('toolbar.cutNeedsSelection') },
      // §2.1（六轮）：粘贴 = 持工具态；空剪贴板 = 不可进态（唯一"前提缺失即完全空转"的工具），`V` 键同步
      { id: 'paste', icon: <Clipboard size={17} />, labelKey: 'tool.paste', disabled: clipboard.length === 0, disabledTip: t('toolbar.pasteEmpty') },
    ],
    [
      { id: 'delete', icon: <Trash2 size={17} />, labelKey: 'tool.delete', danger: true },
      // issue 86 #2：镜像用 FlipHorizontal2（左右镜像），不用 RotateCcw（重置 / 撤销语义）
      { id: 'mirror', icon: <FlipHorizontal2 size={17} />, labelKey: 'tool.mirror' },
      { id: 'noteCode', icon: <FileCode size={17} />, labelKey: 'tool.noteCode' },
    ],
  ];

  const keysOf = (id: string) => [...new Set(categoryShortcuts(settings.shortcuts, id).map((l) => l.key))];
  const isActive = (tool: RailTool) => !tool.action && (armedTool === null ? tool.id === 'mouse' : armedTool === tool.id);
  const armOrRelease = (tool: RailTool) => {
    if (tool.action) { tool.action(); return; }
    if (tool.id === 'mouse') { setArmedTool(null); return; }
    // 退出三出口之一（§2 原则 3）：点击当前高亮工具 = 落回指针
    setArmedTool(armedTool === tool.id ? null : (tool.id as ArmedTool));
  };

  return (
    <nav className="wtr ws-island" aria-label={t('toolbar.title')}>
      {groups.map((group, gi) => (
        <div key={gi} className="wtr__group">
          {group.map((tool) => {
            const active = isActive(tool);
            const keys = tool.disabled ? [] : keysOf(tool.id);
            return (
              <button
                key={tool.id}
                type="button"
                className={`wtr__btn${active ? ' is-active' : ''}${tool.danger ? ' is-danger' : ''}`}
                disabled={tool.disabled}
                aria-pressed={tool.action ? undefined : active}
                aria-label={t(tool.labelKey)}
                onClick={() => armOrRelease(tool)}
              >
                {tool.icon}
                <span className="wtr__tip" role="tooltip">
                  <span>{tool.disabled && tool.disabledTip ? tool.disabledTip : t(tool.labelKey)}</span>
                  {keys.length > 0 && (
                    <span className="wtr__tip-keys">{keys.map((k) => <kbd key={k}>{k}</kbd>)}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
});
