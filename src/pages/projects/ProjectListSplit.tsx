// 工程详情页左栏（工程列表）宽度的拖拽调节（issue 23 #2）。
//
// 形状对齐工作台的面板分隔条（6px 命中区、col-resize、hover/拖动高亮 accent），
// 但**刻意不复用那套实现**：工作台的宽度状态住在 UIProvider（Provider 级 state +
// Provider 里的全局 mousemove effect），宽度以**内联 CSS 变量**喂给 flex 面板；
// 这里是 CSS Grid 的一列、宽度来自 settings。两者的夹取范围也本质不同
// （工作台随视口 20vw / 50vw 伸缩，详情页是导航列表、绝对区间 220..420）。
// 抽公共抽象的收益（约 30 行）抵不上把详情页拖进工作台 UI 状态的代价 —— 详见 issue 23
// 的「被否决方案」。等出现第三个可拖拽分栏再抽。
import { useCallback, useEffect, useRef, useState } from 'react';
import { clampProjectListWidth, PROJECT_LIST_WIDTH } from '../../chart/config/AppSettings';

export interface ProjectListSplitProps {
  /** 当前宽度（来自 settings.layout.projectList.width，已夹取） */
  width: number;
  /** 拖拽中与结束后回写（已夹取；调用方不必再夹） */
  onChange: (width: number) => void;
}

export default function ProjectListSplit({ width, onChange }: ProjectListSplitProps) {
  const [dragging, setDragging] = useState(false);
  const startRef = useRef<{ x: number; width: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    startRef.current = { x: e.clientX, width };
    setDragging(true);
  }, [width]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const start = startRef.current;
      if (!start) return;
      onChange(clampProjectListWidth(start.width + (e.clientX - start.x)));
    };
    const stop = () => {
      setDragging(false);
      startRef.current = null;
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', stop);
    document.addEventListener('pointercancel', stop);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', stop);
      document.removeEventListener('pointercancel', stop);
    };
  }, [dragging, onChange]);

  return (
    <div
      className={`pc-split${dragging ? ' is-dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="调整工程列表宽度"
      aria-valuenow={width}
      aria-valuemin={PROJECT_LIST_WIDTH.min}
      aria-valuemax={PROJECT_LIST_WIDTH.max}
      onPointerDown={onPointerDown}
      // 双击复位：工作台面板没有这一手，但详情页宽度是个"随手拖一下"的量，
      // 拖歪了要能一键回到默认，不必靠精确拖回 300。
      onDoubleClick={() => onChange(PROJECT_LIST_WIDTH.default)}
    />
  );
}
