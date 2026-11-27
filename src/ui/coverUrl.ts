// 封面 Blob → objectURL 的共享缓存（issue 19 #3）。
//
// 工程页封面、编辑工程信息、发布弹窗共用这一份：
// - 已有封面走 useCoverUrl：同一 Blob 跨视图复用同一 URL，引用计数 + 微任务延迟回收；
// - 刚选的 File 走 useEphemeralCoverUrl：随挂载建 / 撤，不进共享缓存。
import { useEffect, useState } from 'react';

interface CoverUrlEntry {
  url: string;
  refs: number;
  revokeScheduled: boolean;
}

const sharedCoverUrls = new WeakMap<Blob, CoverUrlEntry>();

function coverUrlEntry(blob: Blob): CoverUrlEntry {
  let entry = sharedCoverUrls.get(blob);
  if (!entry) {
    entry = { url: URL.createObjectURL(blob), refs: 0, revokeScheduled: false };
    sharedCoverUrls.set(blob, entry);
  }
  return entry;
}

/** 既有封面：首帧同步给 URL，按 Blob 身份跨视图复用。空 Blob 当无封面。 */
export function useCoverUrl(blob?: Blob): string | null {
  const valid = blob && blob.size > 0 ? blob : null;
  useEffect(() => {
    if (!valid) return;
    const entry = coverUrlEntry(valid);
    entry.refs += 1;
    return () => {
      entry.refs -= 1;
      if (entry.refs > 0 || entry.revokeScheduled) return;
      entry.revokeScheduled = true;
      queueMicrotask(() => {
        entry.revokeScheduled = false;
        if (entry.refs > 0) return;
        if (sharedCoverUrls.get(valid) === entry) sharedCoverUrls.delete(valid);
        URL.revokeObjectURL(entry.url);
      });
    };
  }, [valid]);
  return valid ? coverUrlEntry(valid).url : null;
}

/** 刚选的 File 等一次性预览：建 / 撤随挂载走，不进共享缓存（否则会把废弃文件钉到页面结束）。 */
export function useEphemeralCoverUrl(blob?: Blob): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob || blob.size === 0) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}
