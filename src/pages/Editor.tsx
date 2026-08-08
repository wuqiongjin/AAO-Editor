import React, { useState, useRef, useEffect } from 'react';
import type { ChartNote } from '../notes/Charts';
import Toolbar from '../components/Toolbar';
import FinalVirtualCanvas from '../components/FinalVirtualCanvas';
import NoteInfoPanel from '../components/NoteInfoPanel';

interface EditorProps {
  song: File;
}

const Editor: React.FC<EditorProps> = ({ song }) => {
  // 状态管理
  const [notes, setNotes] = useState<ChartNote[]>([]);
  const [selectedNotes, setSelectedNotes] = useState<number[]>([]);
  const [selectedTool, setSelectedTool] = useState<string>('select');
  const [clipboard, setClipboard] = useState<ChartNote[]>([]);
  const [beatDisplay, setBeatDisplay] = useState(4);
  const [currentBpm, setCurrentBpm] = useState(120);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [isCombinationMode, setIsCombinationMode] = useState(false);
  
  // 历史记录
  const [history, setHistory] = useState<ChartNote[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  
  // 虚拟画布相关状态
  const [virtualScrollY, setVirtualScrollY] = useState(0);
  const [virtualHeight, setVirtualHeight] = useState(0);
  
  // 滚动同步相关
  const isScrollingFromVirtual = useRef(false);
  const isScrollingFromScrollbar = useRef(false);
  const scrollSyncTimeout = useRef<number | null>(null);
  
  // 区域宽度状态
  const [leftPanelWidth, setLeftPanelWidth] = useState(470);
  const [rightPanelWidth, setRightPanelWidth] = useState(300);
  const [isDragging, setIsDragging] = useState<'left' | 'right' | null>(null);
  
  // 谱面画布容器引用
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const virtualCanvasRef = useRef<any>(null);
  
  // 处理虚拟画布滚动变化
  const handleVirtualScrollChange = (scrollY: number, height: number) => {
    setVirtualScrollY(scrollY);
    setVirtualHeight(height);
    
    // 如果是从滚动条触发的滚动，跳过同步
    if (isScrollingFromScrollbar.current) return;
    
    // 清除之前的防抖定时器
    if (scrollSyncTimeout.current) {
      clearTimeout(scrollSyncTimeout.current);
    }
    
    // 使用防抖机制，避免频繁同步
    scrollSyncTimeout.current = setTimeout(() => {
      // 同步虚拟画布滚动到谱面画布滚动条
      if (chartAreaRef.current && height > 0) {
        isScrollingFromVirtual.current = true;
        const scrollContainer = chartAreaRef.current;
        if (scrollContainer) {
          const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
          if (maxScroll > 0) {
            const scrollRatio = scrollY / (height - scrollContainer.clientHeight);
            const newScrollTop = scrollRatio * maxScroll;
            scrollContainer.scrollTop = newScrollTop;
          }
        }
        
        // 延迟重置标志，避免立即触发滚动条的回调
        setTimeout(() => {
          isScrollingFromVirtual.current = false;
        }, 5); // 减少延迟时间
      }
    }, 8); // 减少防抖间隔，提高响应性
  };
  
  // 设置虚拟内容高度
  useEffect(() => {
    if (chartAreaRef.current && virtualHeight > 0) {
      const scrollContainer = chartAreaRef.current;
      const contentElement = scrollContainer.querySelector('.virtual-content') as HTMLElement;
      if (contentElement) {
        contentElement.style.height = `${virtualHeight + 1000}px`; // 增加额外高度确保能滚动到最下面
      }
    }
  }, [virtualHeight]);
  
  // 处理滚动条变化
  const handleScrollbarChange = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const scrollTop = target.scrollTop;
    
    // 如果是从虚拟画布触发的滚动，跳过处理
    if (isScrollingFromVirtual.current) return;
    
    // 清除之前的防抖定时器
    if (scrollSyncTimeout.current) {
      clearTimeout(scrollSyncTimeout.current);
    }
    
    // 使用防抖机制，避免频繁同步
    scrollSyncTimeout.current = setTimeout(() => {
      // 计算滚动比例并同步到虚拟画布
      if (virtualCanvasRef.current && virtualCanvasRef.current.setScrollY && virtualHeight > 0) {
        isScrollingFromScrollbar.current = true;
        
        const maxScroll = target.scrollHeight - target.clientHeight;
        const scrollRatio = maxScroll > 0 ? scrollTop / maxScroll : 0;
        const virtualScrollY = scrollRatio * (virtualHeight - target.clientHeight);
        
        virtualCanvasRef.current.setScrollY(virtualScrollY);
        
        // 延迟重置标志，避免立即触发虚拟画布的回调
        setTimeout(() => {
          isScrollingFromScrollbar.current = false;
        }, 5); // 减少延迟时间
      }
    }, 8); // 减少防抖间隔，提高响应性
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
  
  // 清理定时器
  useEffect(() => {
    return () => {
      if (scrollSyncTimeout.current) {
        clearTimeout(scrollSyncTimeout.current);
      }
    };
  }, []);
  
  const addToHistory = (newNotes: ChartNote[]) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push([...newNotes]);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };
  
  const undo = () => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
      setNotes(history[historyIndex - 1]);
    }
  };
  
  const redo = () => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
      setNotes(history[historyIndex + 1]);
    }
  };
  
  const handleNotesChange = (newNotes: ChartNote[]) => {
    setNotes(newNotes);
    addToHistory(newNotes);
  };
  
  // 编辑功能
  const copySelected = () => {
    if (selectedNotes.length > 0) {
      const copiedNotes = selectedNotes.map(index => notes[index]).filter(Boolean);
      setClipboard(copiedNotes);
    }
  };
  
  const cutSelected = () => {
    if (selectedNotes.length > 0) {
      copySelected();
      const newNotes = notes.filter((_, index) => !selectedNotes.includes(index));
      handleNotesChange(newNotes);
      setSelectedNotes([]);
    }
  };
  
  const pasteNotes = () => {
    if (clipboard.length > 0) {
      const newNotes = [...notes, ...clipboard];
      handleNotesChange(newNotes);
    }
  };
  
  const deleteSelectedNotes = () => {
    if (selectedNotes.length > 0) {
      const newNotes = notes.filter((_, index) => !selectedNotes.includes(index));
      handleNotesChange(newNotes);
      setSelectedNotes([]);
    }
  };
  
  const selectAllNotes = () => {
    setSelectedNotes(notes.map((_, index) => index));
  };
  
  const deselectAllNotes = () => {
    setSelectedNotes([]);
  };
  
  // 音符操作
  const handleAddNote = (note: ChartNote) => {
    const newNotes = [...notes, note];
    handleNotesChange(newNotes);
  };
  
  const handleUpdateNote = (index: number, updatedNote: ChartNote) => {
    const newNotes = [...notes];
    newNotes[index] = updatedNote;
    handleNotesChange(newNotes);
  };
  
  const handleDeleteNote = (index: number) => {
    const newNotes = notes.filter((_, i) => i !== index);
    handleNotesChange(newNotes);
    setSelectedNotes(selectedNotes.filter(i => i !== index));
  };
  
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
            onMirror={() => {}}
            canCopy={selectedNotes.length > 0}
            canPaste={clipboard.length > 0}
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
            height: virtualHeight > 0 ? `${virtualHeight + 1000}px` : 'auto',
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
              selectedNotes={selectedNotes}
              setSelectedNotes={setSelectedNotes}
              beatDisplay={beatDisplay}
              onMousePositionChange={(position) => {
                if (position) {
                  setMousePosition({ x: position.lane, y: position.beat });
                }
              }}
              scale={scale}
              isCombinationMode={isCombinationMode}
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
            <span style={{ fontSize: '14px' }}>已选中 {selectedNotes.length}</span>
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
            selectedNotes={selectedNotes}
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