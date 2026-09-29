// useChartViewSession（架构深化评审候选 4）：谱面视口会话 —— 画布视口装配的单一所有者。
//
// 原 WorkspacePage L90-351 的五条手工接线里，属于「视口」的四条搬到这里：
//   1. 渲染面测量 —— useSurfaceSize + 消费方注入的实时门控（面板过渡 / 拖拽改宽）；
//   2. 几何生命周期 —— useChartSpace（issue 134：布局轴几何唯一一份，与画布 bind 同一引用）；
//   3. 滚动模型与它的 DOM 不变量 —— useScrollModel + `.virtual-content` 高度写入 / 首次置底（beat0）/
//      比例位回写 / 按秒重锚 / 滚动条回声识别（issue 75 / 98 / 134）；
//   4. 播放 RAF —— usePlaybackCoordinator（秒 → 画布 setScrollY + 滚动条 scrollTop 同源写入）。
//
// 不拥有（留消费方）：音频会话 / 音频桥 / 持久化 / 快捷键 / 只读闸门；播放头**秒数状态**仍归
// 消费方（工作台 = PlaybackContext）—— 会话经 onSecondsChange 上报，不造第二真相源。
//
// 依赖方向：playback → chart（布局 / 几何）与 playback 自身；**不 import pages / app、不读 Context**，
// 输入全部来自消费方。工作台页与将来的预览页（chart-preview 依赖规则：preview 不得 import pages/）
// consume 同一 interface —— 本票要消的就是「预览只能复制一份装配」的泄漏。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject, UIEvent } from 'react';
import type { ChartNote } from '../chart/types';
import type { ChartGeometry, SurfaceSize } from '../chart/geometry/ChartGeometry';
import { useChartSpace } from '../chart/geometry/ChartSpace';
import { useSurfaceSize } from '../chart/layout/useSurfaceSize';
import type { AudioEngine } from '../audio/AudioEngine';
import type { FinalVirtualCanvasHandle } from '../chart/components/canvas/FinalVirtualCanvas';
import { usePlaybackCoordinator } from './usePlaybackCoordinator';
import type { PlaybackScrollModel } from './PlaybackScrollModel';
import {
  isProgrammaticScrollEcho, registerScrollEcho, useScrollModel, type ProgrammaticScrollEcho,
} from './useScrollModel';

export interface UseChartViewSessionOptions {
  /** 滚动宿主（画布区的 `overflow: auto` 容器）ref：`.virtual-content` 与 scrollTop 的落点 */
  containerRef: RefObject<HTMLDivElement | null>;
  /** 画布 imperative 句柄 ref（setScrollY / setPlaybackActive / getMarkerSeconds） */
  canvasRef: RefObject<FinalVirtualCanvasHandle | null>;
  /** 谱面音符（布局轴几何输入） */
  notes: ChartNote[];
  /** 谱面长度（秒；有音频 = 音频时长，无音频 = 显式字段） */
  chartDuration: number;
  /** 纵向比例（设置 display.verticalRatio） */
  verticalRatio: number;
  /** 用户缩放（UI） */
  scale: number;
  /** 音频引擎（播放 RAF 用；无音频 = null） */
  engine: AudioEngine | null;
  /** 渲染面测量实时门控（面板过渡 / 拖拽改宽期间逐帧提交，见 useSurfaceSize） */
  live?: () => boolean;
  /** 播放头秒数写回（约 12.5Hz；工作台写 PlaybackContext） */
  onSecondsChange: (sec: number) => void;
  /** 播放状态写回 */
  onPlayingChange: (playing: boolean) => void;
  /** 谱面长度变更写回（无音频手动调长，经消费方写自己的真相源） */
  onChartDurationChange?: (sec: number) => void;
}

export interface ChartViewSession {
  /** 渲染面尺寸（null = ResizeObserver 尚未回调） */
  surface: SurfaceSize | null;
  /** 与画布 / 滚动模型同一份布局轴几何（issue 134） */
  geometry: ChartGeometry;
  /** 滚动模型单例：秒 ↔ scrollY ↔ 滚动条 的唯一数学 */
  scrollModel: PlaybackScrollModel;
  /** 虚拟内容高度（写 `.virtual-content`） */
  virtualHeight: number;
  /** 画布 onScrollChange 直连（虚拟高度 + 锚点观察） */
  onCanvasScrollChange: (scrollY: number, height: number) => void;
  /** 滚动宿主 onScroll 直连（回声识别 → 画布跟随 → seek） */
  onScrollbarScroll: (e: UIEvent<HTMLDivElement>) => void;
  /** 播放面（原 usePlaybackCoordinator 直出） */
  isPlaying: boolean;
  togglePlay: () => void;
  seek: (sec: number) => void;
  jumpToMarker: () => void;
  changeDuration: (sec: number) => void;
  stopPlayback: () => void;
}

export function useChartViewSession(opts: UseChartViewSessionOptions): ChartViewSession {
  const {
    containerRef, canvasRef, notes, chartDuration, verticalRatio, scale, engine,
    live, onSecondsChange, onPlayingChange, onChartDurationChange,
  } = opts;

  // === 流 1：渲染面测量（候选 2 拆出，issue 36 / 38 不变量保留） ===
  // 实时门控由消费方注入（工作台：展开/收起侧栏的 200ms width 过渡或拖拽改宽面板期间，
  // 令测量逐帧提交，使画布缓冲始终贴合容器实时宽度 —— 否则合并器在过渡后半段冻结提交，
  // 缓冲被 CSS 拉伸，轨道出现"瞬间偏宽再回弹"；同一根因也影响拖拽）。
  const surface = useSurfaceSize(containerRef, { live });

  // === 流 2：布局轴几何唯一生命周期（issue 134：画布 + 滚动模型 bind 同一引用） ===
  const { geometry, chartEndKey } = useChartSpace({
    notes, ctxDuration: chartDuration, surface, verticalRatio,
  });

  // === 流 3：滚动模型（候选 1 拆出；候选 2 再做生命周期封装） ===
  const { scrollModel, consumePendingReAnchor } = useScrollModel({
    geometry, scale, chartEndKey,
  });

  // === 流 4：播放协调（RAF + togglePlay/seek/jumpToMarker） ===
  const playback = usePlaybackCoordinator({
    engine,
    scrollModel,
    scrollContainerRef: containerRef,
    canvasRef,
    ctxDuration: chartDuration,
    setChartDuration: (sec) => onChartDurationChange?.(sec),
    setCurrentSeconds: onSecondsChange,
    setIsPlaying: onPlayingChange,
  });

  // === DOM 不变量：virtualHeight 写入 / 首次置底 / 比例位回写 / 按秒重锚 / 滚动条回声 ===
  // 画布 onScrollChange：写虚拟高度 + 喂滚动模型做锚点观察（SKIP 保护由模型内处理）
  // lastCanvasScrollYRef：画布侧最新 scrollY，供 virtualHeight 落地后重写滚动条比例位（见下方 effect）
  const [virtualHeight, setVirtualHeight] = useState(0);
  const lastCanvasScrollYRef = useRef(0);
  // issue 98：程序化 scrollTop 写入的期望值登记（见 isProgrammaticScrollEcho）。
  const programmaticScrollTopRef = useRef<ProgrammaticScrollEcho | null>(null);

  const onCanvasScrollChange = useCallback((scrollY: number, height: number) => {
    lastCanvasScrollYRef.current = scrollY;
    setVirtualHeight(height);
    scrollModel.noteScrollObserved(scrollY);
  }, [scrollModel]);

  // 设置虚拟内容高度 + 首次置底（初始滚动 = beat0/起点）
  const initialScrollDone = useRef(false);
  useEffect(() => {
    const scrollContainer = containerRef.current;
    if (!scrollContainer || virtualHeight <= 0) return;
    const contentElement = scrollContainer.querySelector('.virtual-content') as HTMLElement;
    if (!contentElement) return;
    contentElement.style.height = `${virtualHeight}px`;
    if (!initialScrollDone.current) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight - scrollContainer.clientHeight;
      initialScrollDone.current = true;
      scrollModel.markInitialized();
    } else {
      // 缩放（Ctrl+滚轮/工具栏）/谱长/渲染面变化都会改变 scrollHeight：旧 scrollTop 与新滚动范围
      // 不再对应同一谱面位置——若越界，浏览器会钳制 scrollTop 并触发 scroll 事件，把画布 scrollY
      // 拉回端点（"起始线/首拍 BPM 线缩放漂移后回弹"的次生通路）。这里在高度落地后按画布 scrollY
      // 重写滚动条比例位（与播放 RAF 同款 0.5px 守卫）；滚动条来源的滚动不经过此分支（高度不变）。
      const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
      const targetScrollTop = scrollModel.canvasScrollYToScrollTop(lastCanvasScrollYRef.current, maxScroll);
      if (Math.abs(targetScrollTop - scrollContainer.scrollTop) > 0.5) {
        scrollContainer.scrollTop = targetScrollTop;
      }
      // 无论是否实际写入都登记期望值：浏览器可能把写入值取整存储，回声事件据此识别并吞掉
      programmaticScrollTopRef.current = registerScrollEcho(targetScrollTop);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [virtualHeight]);

  // virtualHeight 就绪后消费待重锚项（候选 1 不变量：谱面末端变化后按秒重锚，判定线处秒数稳定）。
  // 依赖须含 chartEndKey：仅宽度类 surface 变化（不改 virtualHeight）也会置位待重锚，若只在
  // virtualHeight 变化时消费，标记会潜伏到下一次缩放才发作，把鼠标锚定的视图强拉回锚点秒
  //（宽度-only 变化时重锚为恒等操作，此处消费是无害 no-op）。
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const maxScroll = container.scrollHeight - container.clientHeight;
    const target = consumePendingReAnchor(maxScroll);
    if (!target) return;
    canvas.setScrollY(target.scrollY);
    container.scrollTop = target.scrollTop;
    programmaticScrollTopRef.current = registerScrollEcho(target.scrollTop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [virtualHeight, chartEndKey]);

  // 滚动条 onScroll：唯一滚动来源；播放中锁定避免双向反馈自锁（ADR-0004 §1 修订）
  const onScrollbarScroll = (e: UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const scrollTop = target.scrollTop;
    // issue 98：程序化 scrollTop 回声（±1px）在 TTL 内吞掉；过期后同一位置当手滚。
    if (isProgrammaticScrollEcho(scrollTop, programmaticScrollTopRef.current)) return;
    const maxScroll = target.scrollHeight - target.clientHeight;
    if (maxScroll <= 0 || !canvasRef.current) return;
    if (playback.isPlaying) return;
    const canvasScrollY = scrollModel.scrollTopToCanvasScrollY(scrollTop, maxScroll);
    canvasRef.current.setScrollY(canvasScrollY);
    const seconds = scrollModel.secondsForScrollY(canvasScrollY);
    scrollModel.noteScrollObserved(canvasScrollY);
    engine?.seek(seconds);
    onSecondsChange(seconds);
  };

  return {
    surface,
    geometry,
    scrollModel,
    virtualHeight,
    onCanvasScrollChange,
    onScrollbarScroll,
    ...playback,
  };
}
