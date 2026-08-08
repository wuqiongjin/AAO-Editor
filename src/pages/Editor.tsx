import React, { useState, useRef, useEffect } from 'react';
import type { ChartNote, SelectionItem } from '../notes/Charts';
import Toolbar from '../components/Toolbar';
import FinalVirtualCanvas from '../components/FinalVirtualCanvas';
import NoteInfoPanel from '../components/NoteInfoPanel';
import { shiftGroupToAnchor } from '../utils/NoteEditing';
import { deleteSelection, copySelection, cutSelection, mirrorSelection, selectionNoteIndices } from '../utils/SelectionEditing';

interface EditorProps {
  song: File;
}

const Editor: React.FC<EditorProps> = () => {
  // 状态管理
  const [notes, setNotes] = useState<ChartNote[]>([]);
  const [selectedItems, setSelectedItems] = useState<SelectionItem[]>([]);
  const [selectedTool, setSelectedTool] = useState<string>('mouse');
  const [clipboard, setClipboard] = useState<ChartNote[]>([]);
  const [beatDisplay, setBeatDisplay] = useState(4);
  const [currentBpm, _setCurrentBpm] = useState(120);
  const [mousePosition, setMousePosition] = useState<{ lane: number; beat: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [isCombinationMode, setIsCombinationMode] = useState(false);
  
  // 历史记录
  const [history, setHistory] = useState<ChartNote[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  
  // 虚拟画布相关状态
  const [virtualHeight, setVirtualHeight] = useState(0);
  
  // 滚动同步相关：滚动条是滚动位置的唯一来源，虚拟画布只跟随滚动条
  const initialScrollDone = useRef(false); // 是否已做初始滚动（滚动条默认在最下面）
  
  // 区域宽度状态
  const [leftPanelWidth, setLeftPanelWidth] = useState(470);
  const [rightPanelWidth, setRightPanelWidth] = useState(300);
  const [isDragging, setIsDragging] = useState<'left' | 'right' | null>(null);
  
  // 谱面画布容器引用
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const virtualCanvasRef = useRef<any>(null);
  
  // 处理虚拟画布滚动变化：仅记录虚拟高度，配合滚动条映射
  const handleVirtualScrollChange = (_scrollY: number, height: number) => {
    setVirtualHeight(height);
  };
  
  // 设置虚拟内容高度，并在首次设置时把滚动条放到最底部（起始拍位置）
  useEffect(() => {
    const scrollContainer = chartAreaRef.current;
    if (!scrollContainer || virtualHeight <= 0) return;
    const contentElement = scrollContainer.querySelector('.virtual-content') as HTMLElement;
    if (!contentElement) return;
    contentElement.style.height = `${virtualHeight}px`;
    if (!initialScrollDone.current) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight - scrollContainer.clientHeight;
      initialScrollDone.current = true;
    }
  }, [virtualHeight]);
  
  // 处理滚动条变化：滚动条是唯一滚动来源，把其位置按比例映射到虚拟画布
  const handleScrollbarChange = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const scrollTop = target.scrollTop;
    const maxScroll = target.scrollHeight - target.clientHeight;
    if (maxScroll <= 0 || !virtualCanvasRef.current || !virtualHeight) return;
    // 虚拟画布滚动范围与滚动条滚动范围呈线性映射
    const maxCanvasScroll = virtualCanvasRef.current.getMaxScrollY?.() ?? virtualHeight;
    const scrollRatio = Math.max(0, Math.min(1, scrollTop / maxScroll));
    virtualCanvasRef.current.setScrollY(scrollRatio * maxCanvasScroll);
  };
  
  // 拖拽处理函数
  const handleMouseDown = (e: React.MouseEvent, type: 'left' | 'right') => {
    e.preventDefault();
    setIsDragging(type);
  };
  
  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging) return;
    
    const containerWidth = window.innerWidth;
    const newLeftWidth = isDragging === 'left' ? e.clientX : leftPanelWidth;
    const newRightWidth = isDragging === 'right' ? containerWidth - e.clientX : rightPanelWidth;
    
    // 设置最小和最大宽度限制
    const minWidth = 200;
    const maxWidth = containerWidth * 0.5;
    
    if (isDragging === 'left') {
      const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newLeftWidth));
      setLeftPanelWidth(clampedWidth);
    } else if (isDragging === 'right') {
      const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newRightWidth));
      setRightPanelWidth(clampedWidth);
    }
  };
  
  const handleMouseUp = () => {
    setIsDragging(null);
  };
  
  // 添加全局鼠标事件监听
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, leftPanelWidth, rightPanelWidth]);
  
  const addToHistory = (newNotes: ChartNote[]) => {
    const newHistory = history.slice(0, historyIndex + 1);
    // 规则4（ADR-0001）：历史快照必须深拷贝，防止对象就地变异泄漏到多份快照，
    // 使方向键 length 与滑条结点变更可逐步 Ctrl+Z/Y 回退
    newHistory.push(structuredClone(newNotes));
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };
  
  const undo = () => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
      setNotes(history[historyIndex - 1]);
      setSelectedItems([]);
    }
  };
  
  const redo = () => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
      setNotes(history[historyIndex + 1]);
      setSelectedItems([]);
    }
  };
  
  const handleNotesChange = (newNotes: ChartNote[]) => {
    setNotes(newNotes);
    addToHistory(newNotes);
  };
  
  // 编辑功能
  const copySelected = () => {
    if (selectedItems.length > 0) {
      setClipboard(copySelection(notes, selectedItems));
    }
  };
  
  const cutSelected = () => {
    if (selectedItems.length > 0) {
      const { clipboard, newNotes } = cutSelection(notes, selectedItems);
      setClipboard(clipboard);
      handleNotesChange(newNotes);
      setSelectedItems([]);
    }
  };
  
  const pasteNotes = () => {
    if (clipboard.length === 0 || !mousePosition) return;
    // 以剪贴板组"左上角"(最小 beat/lane) 为锚点，粘贴到鼠标所在 lane/beat，保持组内相对位移
    const pasted = shiftGroupToAnchor(clipboard, mousePosition.beat, mousePosition.lane);
    const newNotes = [...notes, ...pasted];
    handleNotesChange(newNotes);
    // 粘贴后选中新粘贴的音符
    const startIndex = notes.length;
    setSelectedItems(pasted.map((_, i) => ({ kind: 'note', noteIndex: startIndex + i })));
  };
  
  const deleteSelectedNotes = () => {
    if (selectedItems.length > 0) {
      handleNotesChange(deleteSelection(notes, selectedItems));
      setSelectedItems([]);
    }
  };

  // 镜像：作用于选择条目（整条音符整体镜像；滑条子部分只翻转其 lane）
  const mirrorSelected = () => {
    if (selectedItems.length === 0) return;
    handleNotesChange(mirrorSelection(notes, selectedItems));
  };

  // 键盘快捷键（作用域：画布编辑；焦点在输入元素/代码编辑器时放行原生行为）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "c") { e.preventDefault(); copySelected(); }
      else if (mod && key === "x") { e.preventDefault(); cutSelected(); }
      else if (mod && key === "v") { e.preventDefault(); pasteNotes(); }
      else if (mod && key === "z") { e.preventDefault(); undo(); }
      else if (mod && key === "y") { e.preventDefault(); redo(); }
      else if (mod && key === "a") { e.preventDefault(); setSelectedItems(notes.map((_, i) => ({ kind: 'note', noteIndex: i }))); }
      else if (mod && key === "m") { e.preventDefault(); mirrorSelected(); }
      else if (mod && key === "d") { e.preventDefault(); deleteSelectedNotes(); }
      else if (key === "delete" || key === "backspace") { e.preventDefault(); deleteSelectedNotes(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [notes, selectedItems, clipboard, mousePosition, history, historyIndex]);
  
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* 左侧工具栏区域 */}
      <div style={{
        width: `${leftPanelWidth}px`,
        backgroundColor: '#f3f4f6',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        minWidth: `${leftPanelWidth}px`,
        zIndex: 10,
        position: 'relative'
      }}>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <Toolbar
            selectedTool={selectedTool}
            setSelectedTool={setSelectedTool}
            beatDisplay={beatDisplay}
            setBeatDisplay={setBeatDisplay}
            onUndo={undo}
            onRedo={redo}
            canUndo={historyIndex > 0}
            canRedo={historyIndex < history.length - 1}
            onCopy={copySelected}
            onCut={cutSelected}
            onPaste={pasteNotes}
            onDelete={deleteSelectedNotes}
            onMirror={mirrorSelected}
            canCopy={selectedItems.length > 0}
            canPaste={clipboard.length > 0 && mousePosition !== null}
            scale={scale}
            onZoomIn={() => setScale(prev => Math.min(prev + 0.1, 3))}
            onZoomOut={() => setScale(prev => Math.max(prev - 0.1, 0.1))}
            isCombinationMode={isCombinationMode}
            setCombinationMode={setIsCombinationMode}
          />
        </div>
      </div>
      
      {/* 左侧拖拽分隔条 */}
      <div
        style={{
          width: '4px',
          backgroundColor: isDragging === 'left' ? '#3b82f6' : '#e5e7eb',
          cursor: 'col-resize',
          flexShrink: 0,
          transition: 'background-color 0.2s',
          zIndex: 10,
          position: 'relative'
        }}
        onMouseDown={(e) => handleMouseDown(e, 'left')}
      />
      
      {/* 中间谱面画布区域 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#000000' }}>
        {/* 顶部控制栏 */}
        <div style={{
          height: '32px',
          backgroundColor: '#e5e7eb',
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          borderBottom: '1px solid #333333',
          flexShrink: 0,
          width: 'calc(100% - 20px)',
          position: 'relative',
          overflow: 'visible'
        }}>
          <span style={{
            flexShrink: 0,
            minWidth: '60px'
          }}>谱面画布</span>
          <div style={{
            position: 'absolute',
            right: '20px',
            top: '50%',
            transform: 'translateY(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <span style={{ color: '#374151', fontSize: '14px' }}>BPM {currentBpm}</span>
            <span style={{ color: '#374151', fontSize: '14px' }}>节拍: {beatDisplay}/4</span>
          </div>
        </div>
        
        {/* 谱面画布滚动容器 */}
        <div ref={chartAreaRef} style={{
          flex: 1,
          overflow: 'auto',
          overflowX: 'hidden',
          backgroundColor: '#000000',
          position: 'relative'
        }} onScroll={handleScrollbarChange}>
          {/* 虚拟内容区域 - 用于控制滚动条长度，适配虚拟画布高度 */}
          <div className="virtual-content" style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: virtualHeight > 0 ? `${virtualHeight}px` : 'auto',
            pointerEvents: 'none'
          }} />
          
          {/* 谱面画布 - 使用sticky定位，固定在视口中 */}
          <div style={{
            position: 'sticky',
            top: '0px',
            width: '100%',
            height: '100vh',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: '#000000',
            padding: '20px',
            zIndex: 1
          }}>
            <FinalVirtualCanvas
              ref={virtualCanvasRef}
              notes={notes}
              setNotes={handleNotesChange}
              selectedTool={selectedTool}
              selectedItems={selectedItems}
              setSelectedItems={setSelectedItems}
              beatDisplay={beatDisplay}
              onMousePositionChange={setMousePosition}
              scale={scale}
              onScrollChange={handleVirtualScrollChange}
            />
          </div>
        </div>
      </div>
      
      {/* 右侧拖拽分隔条 */}
      <div
        style={{
          width: '4px',
          backgroundColor: isDragging === 'right' ? '#3b82f6' : '#e5e7eb',
          cursor: 'col-resize',
          flexShrink: 0,
          transition: 'background-color 0.2s',
          zIndex: 10,
          position: 'relative'
        }}
        onMouseDown={(e) => handleMouseDown(e, 'right')}
      />
      
      {/* 右侧信息面板区域 */}
      <div style={{
        width: `${rightPanelWidth}px`,
        backgroundColor: '#f3f4f6',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        minWidth: `${rightPanelWidth}px`,
        zIndex: 10,
        position: 'relative'
      }}>
        <div style={{
          height: '32px',
          backgroundColor: '#e5e7eb',
          color: '#374151',
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          borderBottom: '1px solid #333333',
          flexShrink: 0
        }}>
          <span style={{ fontWeight: 'bold' }}>音符</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '14px' }}>
              <input type="checkbox" /> 组
            </label>
            <span style={{ fontSize: '14px' }}>已选中 {selectedItems.length}</span>
            <button style={{
              backgroundColor: '#ef4444',
              color: 'white',
              padding: '4px 8px',
              borderRadius: '4px',
              fontSize: '12px',
              border: 'none',
              cursor: 'pointer'
            }} onClick={deleteSelectedNotes}>删</button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
          <NoteInfoPanel
            selectedNotes={selectionNoteIndices(selectedItems)}
            notes={notes}
            onNotesChange={handleNotesChange}
          />
        </div>
        <div style={{
          height: '32px',
          backgroundColor: '#e5e7eb',
          color: '#374151',
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          borderTop: '1px solid #333333',
          flexShrink: 0
        }}>
          <span style={{ fontWeight: 'bold' }}>谱面</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px' }}>[ ] {notes.length}</span>
            <button style={{
              backgroundColor: '#3b82f6',
              color: 'white',
              padding: '4px 8px',
              borderRadius: '4px',
              fontSize: '12px',
              border: 'none',
              cursor: 'pointer'
            }}>应</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Editor;