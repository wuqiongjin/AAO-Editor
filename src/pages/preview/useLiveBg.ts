// 预览页的自定义表演背景（票 42 / ADR-0018 §4）：懒加载 sidecar、导入、启用开关。
//
// 像素只在预览页挂载期间进内存；离开 / 换作用域必须 close ImageBitmap。
// 网格缩略用已缩小的位图，不 objectURL 原图。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCurrentProject } from '../../app/providers/CurrentProjectProvider';
import { mutateProject } from '../../project/ChartProjectRecord';
import type { ChartProject } from '../../project/ChartProject';
import {
  LIVE_BG_ACCEPT,
  importLiveBgImage,
  projectHasLiveBg,
  projectUsesCustomLiveBg,
  readLiveBgFit,
  type LiveBgFit,
} from '../../project/liveBgImport';
import { showToast } from '../../ui/Toast';
import { t } from '../../i18n';

const THUMB_W = 304;

export interface LiveBgSlotState {
  available: boolean;
  hasImage: boolean;
  useCustom: boolean;
  fit: LiveBgFit;
  name: string | null;
  thumb: ImageBitmap | null;
  /** hover 大预览用：已解码的原位图，没有则回落 thumb */
  image: ImageBitmap | null;
}

export interface LiveBgSlotHandlers {
  onPickFile: (file: File) => void;
  onSelectCustom: () => void;
  /** 点了内置包：停用自定义，图留在工程里 */
  onSelectPack: () => void;
  onClear: () => void;
  onFit: (fit: LiveBgFit) => void;
}

export interface LiveBgController {
  slot: LiveBgSlotState;
  handlers: LiveBgSlotHandlers;
  /** 选中自定义且解码成功时给 scene / loadSimAssets */
  customLiveBg: ImageBitmap | null;
  pending: boolean;
  accept: string;
}

async function thumbOf(blob: Blob, source: ImageBitmap): Promise<ImageBitmap> {
  const w = Math.max(1, Math.min(THUMB_W, source.width));
  const h = Math.max(1, Math.round(source.height * (w / source.width)));
  try {
    return await createImageBitmap(blob, {
      resizeWidth: w,
      resizeHeight: h,
      resizeQuality: 'medium',
      imageOrientation: 'from-image',
    });
  } catch {
    return source;
  }
}

export function useLiveBg(project: ChartProject | null, active = true): LiveBgController {
  const { store, flushPersist, notifyCatalogChanged, catalogEpoch } = useCurrentProject();
  const [full, setFull] = useState<ImageBitmap | null>(null);
  const [thumb, setThumb] = useState<ImageBitmap | null>(null);
  const [failed, setFailed] = useState(false);
  const held = useRef<{ full: ImageBitmap | null; thumb: ImageBitmap | null }>({ full: null, thumb: null });

  const projectId = project?.id ?? null;
  const liveBgName = project?.liveBgName ?? null;
  const useCustom = project != null && projectUsesCustomLiveBg(project);
  const hasMeta = project != null && projectHasLiveBg(project);
  const fit = readLiveBgFit(project?.liveBgFit);

  useEffect(() => {
    let cancelled = false;
    const release = (keepThumb?: ImageBitmap | null) => {
      const prev = held.current;
      if (prev.full && prev.full !== keepThumb) prev.full.close();
      if (prev.thumb && prev.thumb !== keepThumb && prev.thumb !== prev.full) prev.thumb.close();
      held.current = { full: null, thumb: keepThumb ?? null };
    };
    if (!active || !projectId || !hasMeta) {
      release();
      setFull(null);
      setThumb(null);
      setFailed(false);
      return;
    }
    void store.getLiveBg(projectId).then(async (blob) => {
      if (cancelled) return;
      if (!blob) {
        release();
        setFull(null);
        setThumb(null);
        setFailed(true);
        return;
      }
      try {
        const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
        if (cancelled) {
          bmp.close();
          return;
        }
        const nextThumb = await thumbOf(blob, bmp);
        if (cancelled) {
          bmp.close();
          if (nextThumb !== bmp) nextThumb.close();
          return;
        }
        const keepFull = useCustom ? bmp : null;
        if (!keepFull && nextThumb !== bmp) bmp.close();
        release(nextThumb === bmp ? bmp : nextThumb);
        held.current = { full: keepFull, thumb: nextThumb };
        setFull(keepFull);
        setThumb(nextThumb);
        setFailed(false);
      } catch {
        if (!cancelled) {
          release();
          setFull(null);
          setThumb(null);
          setFailed(true);
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [active, projectId, liveBgName, useCustom, catalogEpoch, hasMeta, store]);

  useEffect(() => () => {
    const prev = held.current;
    prev.full?.close();
    if (prev.thumb && prev.thumb !== prev.full) prev.thumb.close();
    held.current = { full: null, thumb: null };
  }, []);

  const mutate = useCallback(async (fn: (p: ChartProject) => ChartProject | null) => {
    if (!projectId) return;
    await mutateProject(
      { store, flush: flushPersist, notify: notifyCatalogChanged },
      projectId,
      fn,
    );
  }, [projectId, store, flushPersist, notifyCatalogChanged]);

  const onPickFile = useCallback((file: File) => {
    void (async () => {
      const result = await importLiveBgImage(file);
      if (!result.ok) {
        const key = result.reason === 'size'
          ? 'preview.display.liveBg.sizeError'
          : result.reason === 'type'
            ? 'preview.display.liveBg.typeError'
            : 'preview.display.liveBg.decodeError';
        showToast(t(key), 'danger');
        return;
      }
      await mutate((p) => ({
        ...p,
        liveBgName: file.name,
        liveBgMime: result.mime,
        liveBgUseCustom: true,
        liveBgFit: readLiveBgFit(p.liveBgFit),
        liveBgBlob: result.blob,
      }));
    })();
  }, [mutate]);

  const onSelectCustom = useCallback(() => {
    void mutate((p) => (projectHasLiveBg(p) && !p.liveBgUseCustom ? { ...p, liveBgUseCustom: true } : null));
  }, [mutate]);

  const onSelectPack = useCallback(() => {
    void mutate((p) => (p.liveBgUseCustom ? { ...p, liveBgUseCustom: false } : null));
  }, [mutate]);

  const onClear = useCallback(() => {
    void mutate((p) => ({
      ...p,
      liveBgName: null,
      liveBgMime: null,
      liveBgUseCustom: false,
      liveBgFit: 'cover',
      liveBgBlob: undefined,
    }));
  }, [mutate]);

  const onFit = useCallback((next: LiveBgFit) => {
    void mutate((p) => ({ ...p, liveBgFit: next }));
  }, [mutate]);

  const hasImage = hasMeta && !failed;
  // 不把 `active` 算进 pending：保活切走会 close 位图，但舞台还挂着。
  // 若 pending 随 active 变 false，隐藏的舞台会按「没用自定义」去取内置包，切回来先闪包图。
  const pending = Boolean(projectId && useCustom && hasImage && full == null);
  const slot = useMemo<LiveBgSlotState>(() => ({
    available: projectId != null,
    hasImage,
    useCustom: useCustom && hasImage,
    fit,
    name: hasImage ? (liveBgName ?? null) : null,
    thumb,
    image: full ?? thumb,
  }), [projectId, hasImage, useCustom, fit, liveBgName, thumb, full]);

  return {
    slot,
    handlers: { onPickFile, onSelectCustom, onSelectPack, onClear, onFit },
    customLiveBg: slot.useCustom ? full : null,
    pending,
    accept: LIVE_BG_ACCEPT,
  };
}
