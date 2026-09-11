import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import {
  Check, Copy, Crosshair, Eraser, FileImage, HelpCircle, Trash2, ZoomIn, ZoomOut,
} from 'lucide-react';
import {
  clamp,
  clampRect,
  computeInkInsets,
  formatRegistryEntry,
  hitTestHandle,
  isInside,
  moveRect,
  normalizeRect,
  pickGridSteps,
  pointInRect,
  resizeRect,
  roundRect,
  type PixelRect,
  type ResizeHandle,
  unionInside,
} from './locator';

/**
 * 精灵图可视化定位工具（issue 41，独立入口页）。
 * 加载 skins 下的精灵图，支持：
 * - hover 像素坐标
 * - 滚轮缩放 / 空格或中键拖拽平移
 * - 拖拽框选 / 选区点击激活 / 8 向手柄调整 / 键盘微调 / 数值输入微调
 * - 输出 BaseSpriteIcons 注册表条目（issue 40 格式）
 */

// issue 86：legacy 素材目录（./assets/skins/legacy/*）已删；预设改指向**正式皮肤包产物**
// （scripts/build-note-skins.mjs 生成，与渲染器同源同图，避免为工具再留一份 legacy 副本）
const SKIN_FILES: Array<{ label: string; url: string }> = [
  { label: 'RhythmGameSprites.png', url: './assets/skins/skin00/RhythmGameSprites.png' },
  { label: 'DirectionalFlickSprites.png', url: './assets/skins/directionalflickskin00/DirectionalFlickSprites.png' },
  { label: 'longNoteLine.png', url: './assets/skins/skin00/longNoteLine.png' },
  { label: 'longNoteLine2.png', url: './assets/skins/skin00/longNoteLine2.png' },
];

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
const MAX_CANVAS_PIXELS = 32_000_000;
const PAD = 28;
const HANDLE_KEYS: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_OFFSETS: Record<ResizeHandle, [number, number]> = {
  nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5],
};

interface Region {
  id: number;
  name: string;
  rect: PixelRect;
  isInk: boolean;
}

type DragMode =
  | { kind: 'none' }
  | { kind: 'select'; start: { x: number; y: number } }
  | { kind: 'move'; regionId: number; start: { x: number; y: number }; origin: PixelRect }
  | { kind: 'resize'; regionId: number; handle: ResizeHandle; start: { x: number; y: number }; origin: PixelRect }
  | { kind: 'pan'; startClientX: number; startClientY: number; scrollLeft: number; scrollTop: number };

let regionSeq = 0;

function isEditableField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function computeFitZoom(img: HTMLImageElement, viewport: { w: number; h: number }): number {
  const fw = (viewport.w - PAD * 2) / img.naturalWidth;
  const fh = (viewport.h - PAD * 2) / img.naturalHeight;
  return clamp(Math.min(fw, fh), MIN_ZOOM, MAX_ZOOM);
}

function getHandleStyle(handle: ResizeHandle, rect: PixelRect): CSSProperties {
  const [ox, oy] = HANDLE_OFFSETS[handle];
  const left = rect.x + rect.w * ox;
  const top = rect.y + rect.h * oy;
  return { left, top };
}

export default function SpriteLocator() {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [srcEntry, setSrcEntry] = useState('');
  const [imgError, setImgError] = useState<string | null>(null);
  const [presetValue, setPresetValue] = useState('');

  const [zoom, setZoom] = useState(1);
  const [autoFit, setAutoFit] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showRulers, setShowRulers] = useState(true);
  const [showChecker, setShowChecker] = useState(true);
  const [viewportSize, setViewportSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [selections, setSelections] = useState<Region[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [draft, setDraft] = useState<PixelRect | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('区域 1');
  const [dragMode, setDragMode] = useState<DragMode>({ kind: 'none' });

  const viewportRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const zoomRef = useRef(zoom);
  const imageRef = useRef(image);
  const maxZoomRef = useRef(MAX_ZOOM);
  const spaceDownRef = useRef(false);
  const draftRef = useRef<PixelRect | null>(null);
  const selectionsRef = useRef(selections);
  const activeIdRef = useRef(activeId);

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { imageRef.current = image; }, [image]);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => { selectionsRef.current = selections; }, [selections]);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => {
    maxZoomRef.current = image
      ? Math.min(MAX_ZOOM, Math.sqrt(MAX_CANVAS_PIXELS / (image.naturalWidth * image.naturalHeight)))
      : MAX_ZOOM;
  }, [image]);

  const loadImage = useCallback((url: string, srcForEntry: string) => {
    setImgError(null);
    setSelections([]);
    setActiveId(null);
    setDraft(null);
    setHover(null);
    const img = new Image();
    img.onload = () => {
      setImage(img);
      setImageUrl(url);
      setSrcEntry(srcForEntry);
      setAutoFit(true);
      setZoom(1);
      setPresetValue(url);
    };
    img.onerror = () => {
      setImgError(`图片加载失败：${srcForEntry}`);
      setImage(null);
      setImageUrl(null);
    };
    img.src = url;
  }, []);

  const handlePresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const url = e.target.value;
    setPresetValue(url);
    if (!url) return;
    const file = SKIN_FILES.find((f) => f.url === url);
    loadImage(url, file ? `./assets/skins/${file.label}` : url);
  };

  const handleLocalFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      loadImage(url, file.name);
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) setViewportSize({ w: Math.round(width), h: Math.round(height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!autoFit || !image || viewportSize.w <= 0) return;
    setZoom(computeFitZoom(image, viewportSize));
  }, [autoFit, image, viewportSize]);

  const displayW = image ? Math.round(image.naturalWidth * zoom) : 0;
  const displayH = image ? Math.round(image.naturalHeight * zoom) : 0;
  const stageW = image ? Math.max(viewportSize.w, displayW + PAD * 2) : 0;
  const stageH = image ? Math.max(viewportSize.h, displayH + PAD * 2) : 0;
  const checkerCell = Math.max(6, Math.round(8 * zoom));

  const drawGrid = (ctx: CanvasRenderingContext2D, w: number, h: number, step: number, z: number, alpha: number) => {
    const sp = step * z;
    if (!(sp >= 2)) return;
    ctx.save();
    ctx.globalCompositeOperation = 'difference';
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    for (let x = 0; x <= w; x += sp) ctx.fillRect(Math.round(x), 0, 1, h);
    for (let y = 0; y <= h; y += sp) ctx.fillRect(0, Math.round(y), w, 1);
    ctx.restore();
  };

  const drawRulers = (ctx: CanvasRenderingContext2D, w: number, h: number, z: number, major: number) => {
    const sp = major * z;
    if (!(sp >= 20)) return;
    ctx.save();
    ctx.font = '10px "SF Mono", Consolas, Menlo, monospace';
    ctx.textBaseline = 'middle';
    for (let x = 0; x <= w; x += sp) {
      const text = String(Math.round(x / z));
      const tw = ctx.measureText(text).width;
      const cx = Math.round(x);
      ctx.fillStyle = 'rgba(12, 14, 17, 0.68)';
      ctx.fillRect(cx - tw / 2 - 3, 2, tw + 6, 15);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillText(text, cx - tw / 2, 9.5);
    }
    for (let y = 0; y <= h; y += sp) {
      const text = String(Math.round(y / z));
      const tw = ctx.measureText(text).width;
      const cy = Math.round(y);
      ctx.fillStyle = 'rgba(12, 14, 17, 0.68)';
      ctx.fillRect(2, cy - 7.5, tw + 6, 15);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillText(text, 5, cy);
    }
    ctx.restore();
  };

  const drawRegion = (ctx: CanvasRenderingContext2D, region: Region, z: number) => {
    const { rect } = region;
    const x = rect.x * z;
    const y = rect.y * z;
    const w = rect.w * z;
    const h = rect.h * z;
    ctx.save();
    ctx.fillStyle = region.isInk ? 'rgba(224, 137, 0, 0.16)' : 'rgba(13, 159, 214, 0.13)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = region.isInk ? '#e08900' : '#0d9fd6';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.75, y + 0.75, Math.max(0, w - 1.5), Math.max(0, h - 1.5));
    const text = region.name;
    ctx.font = '10px "SF Mono", Consolas, Menlo, monospace';
    const tw = ctx.measureText(text).width;
    const chipW = tw + 8;
    const chipH = 15;
    ctx.fillStyle = region.isInk ? 'rgba(112, 70, 0, 0.85)' : 'rgba(5, 74, 103, 0.85)';
    ctx.fillRect(x, y, chipW, chipH);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 4, y + chipH / 2 + 0.5);
    ctx.restore();
  };

  const redraw = useCallback(() => {
    const canvas = overlayRef.current;
    if (!canvas || !image) return;
    const z = zoom;
    const w = Math.round(image.naturalWidth * z);
    const h = Math.round(image.naturalHeight * z);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);

    if (showGrid) {
      const { minor, major } = pickGridSteps(z);
      drawGrid(ctx, w, h, minor, z, 0.35);
      drawGrid(ctx, w, h, major, z, 1);
      if (showRulers) drawRulers(ctx, w, h, z, major);
    }
    for (const region of selections) drawRegion(ctx, region, z);

    if (draft) {
      const x = draft.x * z;
      const y = draft.y * z;
      const dw = draft.w * z;
      const dh = draft.h * z;
      ctx.save();
      ctx.fillStyle = 'rgba(13, 159, 214, 0.10)';
      ctx.fillRect(x, y, dw, dh);
      ctx.strokeStyle = '#0d9fd6';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(x + 0.75, y + 0.75, Math.max(0, dw - 1.5), Math.max(0, dh - 1.5));
      ctx.restore();
    }

    if (hover && !draft && dragMode.kind === 'none') {
      const px = hover.x * z;
      const py = hover.y * z;
      ctx.save();
      ctx.strokeStyle = 'rgba(13, 159, 214, 0.9)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
      ctx.stroke();
      ctx.restore();
    }
  }, [draft, dragMode.kind, hover, image, selections, showGrid, showRulers, zoom]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (e: WheelEvent) => {
      const img = imageRef.current;
      const stack = stackRef.current;
      if (!img || !stack) return;
      e.preventDefault();
      const rect = stack.getBoundingClientRect();
      const z = zoomRef.current;
      const imgX = (e.clientX - rect.left) / z;
      const imgY = (e.clientY - rect.top) / z;
      const next = clamp(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15), MIN_ZOOM, maxZoomRef.current);
      if (next === z) return;
      zoomRef.current = next;
      setZoom(next);
      setAutoFit(false);
      requestAnimationFrame(() => {
        const stW = Math.max(viewport.clientWidth, img.naturalWidth * next + PAD * 2);
        const stH = Math.max(viewport.clientHeight, img.naturalHeight * next + PAD * 2);
        viewport.scrollLeft = clamp(imgX * next - (e.clientX - rect.left), 0, Math.max(0, stW - viewport.clientWidth));
        viewport.scrollTop = clamp(imgY * next - (e.clientY - rect.top), 0, Math.max(0, stH - viewport.clientHeight));
      });
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isEditableField(e.target)) {
        spaceDownRef.current = true;
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDownRef.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const imagePointFromEvent = (e: ReactPointerEvent): { x: number; y: number } | null => {
    const img = imageRef.current;
    const stack = stackRef.current;
    if (!img || !stack) return null;
    const rect = stack.getBoundingClientRect();
    const z = zoomRef.current;
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: clamp((e.clientX - rect.left) / z, 0, img.naturalWidth),
      y: clamp((e.clientY - rect.top) / z, 0, img.naturalHeight),
    };
  };

  const findRegionAt = (px: number, py: number): Region | null => {
    for (let i = selectionsRef.current.length - 1; i >= 0; i -= 1) {
      const region = selectionsRef.current[i];
      if (pointInRect(region.rect, px, py)) return region;
    }
    return null;
  };

  const updateRegion = (id: number, updater: (rect: PixelRect) => PixelRect) => {
    setSelections((prev) => prev.map((r) => (r.id === id ? { ...r, rect: updater(r.rect) } : r)));
  };

  const finalizeSelection = (rect: PixelRect) => {
    if (!image) return;
    const clamped = clampRect(roundRect(rect), image.naturalWidth, image.naturalHeight);
    if (clamped.w < 2 && clamped.h < 2) return;
    const id = ++regionSeq;
    const nextName = `区域 ${id}`;
    setSelections((prev) => [...prev, { id, name: nextName, rect: clamped, isInk: false }]);
    setActiveId(id);
    setDraftName(nextName);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport || !image) return;
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    const pt = imagePointFromEvent(e);
    if (!pt) return;
    viewport.setPointerCapture(e.pointerId);

    if (e.button === 1 || spaceDownRef.current) {
      setDragMode({ kind: 'pan', startClientX: e.clientX, startClientY: e.clientY, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop });
      return;
    }

    const active = activeIdRef.current ? selectionsRef.current.find((r) => r.id === activeIdRef.current) ?? null : null;
    if (active) {
      const handle = hitTestHandle(active.rect, pt.x, pt.y, Math.max(6, 8 / zoomRef.current));
      if (handle) {
        setDragMode({ kind: 'resize', regionId: active.id, handle, start: pt, origin: { ...active.rect } });
        return;
      }
      if (pointInRect(active.rect, pt.x, pt.y)) {
        setDragMode({ kind: 'move', regionId: active.id, start: pt, origin: { ...active.rect } });
        return;
      }
    }

    const hit = findRegionAt(pt.x, pt.y);
    if (hit) {
      setActiveId(hit.id);
      setDraftName(hit.name);
      const handle = hitTestHandle(hit.rect, pt.x, pt.y, Math.max(6, 8 / zoomRef.current));
      if (handle) setDragMode({ kind: 'resize', regionId: hit.id, handle, start: pt, origin: { ...hit.rect } });
      else setDragMode({ kind: 'move', regionId: hit.id, start: pt, origin: { ...hit.rect } });
      return;
    }

    setActiveId(null);
    setDragMode({ kind: 'select', start: pt });
    const r = normalizeRect(pt.x, pt.y, pt.x, pt.y);
    draftRef.current = r;
    setDraft(r);
    setHover(null);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport || !image) return;
    const mode = dragMode.kind;
    const pt = imagePointFromEvent(e);

    if (mode === 'pan') {
      viewport.scrollLeft = dragMode.scrollLeft - (e.clientX - dragMode.startClientX);
      viewport.scrollTop = dragMode.scrollTop - (e.clientY - dragMode.startClientY);
      return;
    }

    if (!pt) return;
    if (mode === 'select') {
      const r = normalizeRect(dragMode.start.x, dragMode.start.y, pt.x, pt.y);
      draftRef.current = r;
      setDraft(r);
      setHover(null);
      return;
    }

    if (mode === 'move') {
      const dx = Math.round(pt.x - dragMode.start.x);
      const dy = Math.round(pt.y - dragMode.start.y);
      updateRegion(dragMode.regionId, () => moveRect(dragMode.origin, dx, dy, image.naturalWidth, image.naturalHeight));
      return;
    }

    if (mode === 'resize') {
      const dx = Math.round(pt.x - dragMode.start.x);
      const dy = Math.round(pt.y - dragMode.start.y);
      updateRegion(dragMode.regionId, () => resizeRect(dragMode.origin, dragMode.handle, dx, dy, image.naturalWidth, image.naturalHeight));
      return;
    }

    setHover(pt);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragMode;
    const viewport = viewportRef.current;
    setDragMode({ kind: 'none' });
    if (viewport?.hasPointerCapture(e.pointerId)) viewport.releasePointerCapture(e.pointerId);
    if (drag.kind !== 'select' || !image) {
      setDraft(null);
      draftRef.current = null;
      return;
    }
    const r = draftRef.current;
    setDraft(null);
    draftRef.current = null;
    if (!r) return;
    finalizeSelection(r);
  };

  const handlePointerLeave = () => setHover(null);

  const activeRegion = useMemo(() => selections.find((r) => r.id === activeId) ?? null, [activeId, selections]);
  const canMarkInk = (region: Region): boolean => !region.isInk && selections.some((o) => o.id !== region.id && isInside(region.rect, o.rect));

  const renameRegion = (id: number, name: string) => setSelections((prev) => prev.map((r) => (r.id === id ? { ...r, name } : r)));
  const removeRegion = (id: number) => {
    setSelections((prev) => prev.filter((r) => r.id !== id));
    if (activeIdRef.current === id) setActiveId(null);
  };
  const setRegionInk = (id: number, isInk: boolean) => setSelections((prev) => prev.map((r) => (r.id === id ? { ...r, isInk } : r)));
  const clearAll = () => {
    setSelections([]);
    setActiveId(null);
    setDraft(null);
    setHover(null);
  };

  const frameEntry = useCallback((frame: Region): string | null => {
    if (frame.isInk) return null;
    const inks = selections.filter((r) => r.isInk && isInside(r.rect, frame.rect));
    const union = unionInside(frame.rect, inks.map((r) => r.rect));
    const ink = union ? computeInkInsets(frame.rect, union) : null;
    return formatRegistryEntry(frame.name, srcEntry, frame.rect, ink);
  }, [selections, srcEntry]);

  const outputText = useMemo(() => {
    if (!srcEntry) return '';
    return selections.filter((r) => !r.isInk).map((r) => frameEntry(r) ?? '').filter(Boolean).join('\n\n');
  }, [selections, srcEntry, frameEntry]);

  const flashCopied = (key: string | null) => {
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1200);
  };

  const handleCopyAll = async () => {
    if (!outputText) return;
    if (await copyText(outputText)) flashCopied('__all__');
  };

  const handleCopyRegion = async (region: Region) => {
    const entry = region.isInk
      ? formatRegistryEntry(region.name, srcEntry, region.rect)
      : frameEntry(region);
    if (!entry) return;
    if (await copyText(entry)) flashCopied(String(region.id));
  };

  const zoomStep = (dir: 1 | -1) => {
    const next = clamp(zoomRef.current * (dir > 0 ? 1.25 : 1 / 1.25), MIN_ZOOM, maxZoomRef.current);
    zoomRef.current = next;
    setZoom(next);
    setAutoFit(false);
  };

  const fitView = () => {
    if (!image) return;
    setZoom(computeFitZoom(image, viewportSize));
    setAutoFit(false);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableField(e.target)) return;
      const img = imageRef.current;
      const id = activeIdRef.current;
      if (!img || id == null) return;
      const region = selectionsRef.current.find((r) => r.id === id);
      if (!region) return;
      const step = e.shiftKey ? 10 : 1;
      const apply = (next: PixelRect) => {
        setSelections((prev) => prev.map((r) => (r.id === id ? { ...r, rect: next } : r)));
      };
      let handled = true;
      switch (e.key) {
        case 'ArrowUp':
          apply(e.altKey
            ? resizeRect(region.rect, 'n', 0, -step, img.naturalWidth, img.naturalHeight)
            : moveRect(region.rect, 0, -step, img.naturalWidth, img.naturalHeight));
          break;
        case 'ArrowDown':
          apply(e.altKey
            ? resizeRect(region.rect, 's', 0, step, img.naturalWidth, img.naturalHeight)
            : moveRect(region.rect, 0, step, img.naturalWidth, img.naturalHeight));
          break;
        case 'ArrowLeft':
          apply(e.altKey
            ? resizeRect(region.rect, 'w', -step, 0, img.naturalWidth, img.naturalHeight)
            : moveRect(region.rect, -step, 0, img.naturalWidth, img.naturalHeight));
          break;
        case 'ArrowRight':
          apply(e.altKey
            ? resizeRect(region.rect, 'e', step, 0, img.naturalWidth, img.naturalHeight)
            : moveRect(region.rect, step, 0, img.naturalWidth, img.naturalHeight));
          break;
        case 'Escape':
          setActiveId(null);
          break;
        default:
          handled = false;
      }
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleActiveFieldChange = (field: keyof PixelRect, value: string) => {
    const num = Number(value);
    if (Number.isNaN(num) || !activeRegion || !image) return;
    setSelections((prev) => prev.map((r) => {
      if (r.id !== activeRegion.id) return r;
      const nextRect = { ...r.rect, [field]: Math.round(num) } as PixelRect;
      return { ...r, rect: clampRect(nextRect, image.naturalWidth, image.naturalHeight) };
    }));
  };

  const cursor = dragMode.kind === 'pan' ? 'grabbing' : spaceDownRef.current ? 'grab' : 'crosshair';

  return (
    <div className="sprite-shell">
      <header className="page-intro">
        <span>独立入口</span>
        <h1>精灵图定位工具</h1>
        <p>
          在 skin 大图上点选/框选音符区域，直接生成可粘贴进 <code>BaseSpriteIcons</code> 注册表的坐标条目（issue 40 像素矩形格式）。
          后续新增音符款式/皮肤时，用本工具从图上量取坐标。本页不随主应用发布。
        </p>
      </header>

      <div className="sprite-layout">
        <section className="sprite-canvas">
          <div className="sprite-toolbar">
            <div className="sprite-toolbar-group">
              <span className="sprite-toolbar-label">图片</span>
              <select value={presetValue} onChange={handlePresetChange} aria-label="选择预设精灵图">
                <option value="">选择预设…</option>
                {SKIN_FILES.map((f) => <option key={f.url} value={f.url}>{f.label}</option>)}
              </select>
              <button type="button" className="sprite-btn" onClick={() => fileInputRef.current?.click()}>
                <FileImage size={14} />本地图片…
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleLocalFile} />
            </div>
            <div className="sprite-toolbar-group">
              <span className="sprite-toolbar-label">视图</span>
              <button type="button" className="sprite-btn" onClick={() => zoomStep(-1)} title="缩小"><ZoomOut size={14} /></button>
              <span className="sprite-zoom-value" onDoubleClick={fitView} title="双击复原适应窗口">{Math.round(zoom * 100)}%</span>
              <button type="button" className="sprite-btn" onClick={() => zoomStep(1)} title="放大"><ZoomIn size={14} /></button>
              <button type="button" className="sprite-btn" onClick={fitView}>适应</button>
              <label className="sprite-check"><input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />网格</label>
              <label className="sprite-check"><input type="checkbox" checked={showRulers} onChange={(e) => setShowRulers(e.target.checked)} />标尺</label>
              <label className="sprite-check"><input type="checkbox" checked={showChecker} onChange={(e) => setShowChecker(e.target.checked)} />透明</label>
            </div>
          </div>

          <div
            className="sprite-viewport"
            ref={viewportRef}
            style={{ cursor }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerLeave}
          >
            {image && (
              <div className="sprite-stage" style={{ width: stageW, height: stageH }}>
                <div className="sprite-stack" ref={stackRef} style={{ width: displayW, height: displayH }}>
                  {showChecker && <div className="sprite-checker" style={{ backgroundSize: `${checkerCell * 2}px ${checkerCell * 2}px` }} />}
                  <img src={imageUrl ?? undefined} alt="精灵图" draggable={false} style={{ width: displayW, height: displayH }} />
                  <canvas ref={overlayRef} style={{ width: displayW, height: displayH }} />
                  {activeRegion && image && HANDLE_KEYS.map((handle) => (
                    <button
                      key={handle}
                      type="button"
                      className={`sprite-handle${handle === 'n' || handle === 's' || handle === 'e' || handle === 'w' ? ' is-edge' : ''}`}
                      style={getHandleStyle(handle, activeRegion.rect)}
                      title={`拖拽 ${handle} 手柄微调`}
                      aria-label={`${handle} 手柄`}
                      onPointerDown={(ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        const viewport = viewportRef.current;
                        const stack = stackRef.current;
                        if (!stack || !viewport) return;
                        viewport.setPointerCapture(ev.pointerId);
                        const rect = stack.getBoundingClientRect();
                        const z = zoomRef.current;
                        const x = (ev.clientX - rect.left) / z;
                        const y = (ev.clientY - rect.top) / z;
                        setDragMode({
                          kind: 'resize',
                          regionId: activeRegion.id,
                          handle,
                          start: { x, y },
                          origin: { ...activeRegion.rect },
                        });
                      }}
                    />
                  ))}
                  {activeRegion && <div className="sprite-ghost" style={{ left: activeRegion.rect.x * zoom, top: activeRegion.rect.y * zoom, width: activeRegion.rect.w * zoom, height: activeRegion.rect.h * zoom }} />}
                </div>
              </div>
            )}
            {!image && (
              <div className="sprite-empty">
                <Crosshair size={30} strokeWidth={1.5} />
                <p>选择一张精灵图开始定位<br />（上方下拉预设，或「本地图片…」加载任意 PNG）</p>
              </div>
            )}
            {imgError && (
              <div className="error-banner" role="alert">
                <strong>加载失败</strong>
                <span>{imgError}</span>
              </div>
            )}
          </div>

          <div className="sprite-status">
            <span>悬停坐标：{hover ? `x ${Math.floor(hover.x)} · y ${Math.floor(hover.y)}` : '—'}</span>
            <span>图片：{image ? `${image.naturalWidth} × ${image.naturalHeight}` : '—'}</span>
            <span>缩放：{Math.round(zoom * 100)}%</span>
            <span>选区：{selections.length}</span>
            <span className="sprite-status-hint">滚轮缩放 · 空格/中键拖拽平移 · 拖拽框选 · 选区点击后可微调</span>
          </div>
        </section>

        <aside className="sprite-side">
          <section className="sprite-side-section">
            <div className="section-heading">
              <div>
                <h2>选区</h2>
                <p>点击选区后可用手柄 / 键盘 / 数值输入微调</p>
              </div>
              <span className="state-label">{selections.length}</span>
            </div>

            {selections.length === 0 ? (
              <p className="sprite-empty-note">尚无选区。在图上按住鼠标拖出矩形即可框选一个音符区域。</p>
            ) : (
              <ul className="sprite-region-list">
                {selections.map((region) => (
                  <li key={region.id} className={`sprite-region${region.id === activeId ? ' is-active' : ''}`}>
                    <div className="sprite-region-head">
                      <input
                        className="sprite-region-name"
                        value={region.id === activeId ? draftName : region.name}
                        onFocus={() => { setActiveId(region.id); setDraftName(region.name); }}
                        onChange={(e) => {
                          setDraftName(e.target.value);
                          renameRegion(region.id, e.target.value);
                        }}
                        aria-label="选区名称"
                      />
                      <span className="sprite-region-rect">x {region.rect.x} · y {region.rect.y} · {region.rect.w}×{region.rect.h}</span>
                      <button type="button" className="sprite-icon-btn" title="复制该条目" aria-label="复制该条目" onClick={() => handleCopyRegion(region)}>
                        {copiedKey === String(region.id) ? <Check size={13} /> : <Copy size={13} />}
                      </button>
                      <button type="button" className="sprite-icon-btn" title="删除选区" aria-label="删除选区" onClick={() => removeRegion(region.id)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <div className="sprite-region-foot">
                      {canMarkInk(region) ? (
                        <label className="sprite-check">
                          <input type="checkbox" checked={region.isInk} onChange={(e) => setRegionInk(region.id, e.target.checked)} />
                          墨迹（框内可见墨迹，输出时折算 inkLeft/inkRight）
                        </label>
                      ) : (
                        <span className="sprite-hint-text">{region.isInk ? '墨迹选区（不单独输出条目）' : '框架条目'}</span>
                      )}
                    </div>
                    {region.id === activeId && (
                      <div className="sprite-footer-hint">
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
                          {(['x', 'y', 'w', 'h'] as const).map((field) => (
                            <label key={field} className="sprite-check" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 3 }}>
                              <span style={{ color: 'var(--sl-text-muted)', fontSize: 10 }}> {field.toUpperCase()} </span>
                              <input
                                className="sprite-region-name"
                                style={{ width: '100%', flex: 'none' }}
                                type="number"
                                value={region.rect[field]}
                                onChange={(e) => handleActiveFieldChange(field, e.target.value)}
                              />
                            </label>
                          ))}
                        </div>
                        <div style={{ marginTop: 6, color: 'var(--sl-text-muted)' }}>键盘：方向键 1px，Shift+方向键 10px，Alt+方向键按对应边缩放。</div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <div className="sprite-side-actions">
              <button type="button" className="sprite-btn" onClick={clearAll} disabled={selections.length === 0}>
                <Eraser size={14} />清空选区
              </button>
            </div>
          </section>

          <section className="sprite-side-section">
            <div className="section-heading">
              <div>
                <h2>输出</h2>
                <p>BaseSpriteIcons 注册表条目（issue 40 格式）</p>
              </div>
            </div>
            <pre className="sprite-output"><code>{outputText || '（先框选一个区域）'}</code></pre>
            <div className="sprite-side-actions">
              <button type="button" className="sprite-btn" onClick={handleCopyAll} disabled={!outputText}>
                <Copy size={14} />复制全部条目
              </button>
            </div>
            <p className="sprite-copied" aria-live="polite">{copiedKey ? '已复制到剪贴板' : ''}</p>
          </section>

          <details className="sprite-help">
            <summary><HelpCircle size={14} />使用说明</summary>
            <ol>
              <li>选择精灵图（RhythmGameSprites.png 等预设，或本地 PNG）。</li>
              <li>滚轮缩放、空格（或中键）拖拽平移；网格可辅助对齐，标尺显示像素刻度。</li>
              <li>按住鼠标拖拽框选一个音符区域；悬停时状态栏实时显示像素坐标。</li>
              <li>点击某个选区后，可用手柄、方向键 / Shift 方向键 / Alt 方向键，或右侧 x/y/w/h 数值输入微调。</li>
              <li>若选区在另一个选区内部，可勾选「墨迹」——输出时自动折算 <code>inkLeft/inkRight</code>（连接线贴合墨迹用）。</li>
              <li>「复制全部条目」得到可直接粘贴进 <code>BaseSpriteIcons</code> 的代码，粘贴后仅需核对 src 路径。</li>
            </ol>
            <p className="sprite-help-note">
              提示：本期目标之一是从 RhythmGameSprites.png 框出虚拍 tap 图标，将 x/y/w/h 填入 <code>BaseSpriteIcons.tapVirtual</code>。
              <code>out</code> 字段（收紧源矩形时的目标屏幕尺寸）按 issue 40 规则另行补写，本工具不生成。
            </p>
          </details>
        </aside>
      </div>
    </div>
  );
}
