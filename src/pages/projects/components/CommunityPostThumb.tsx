// 社区帖目录行的封面缩略图（票 09）：custom 帖用帖内封面，bandori 帖复用官方曲库那条链。
//
//   custom：① 本机缩略图（导入过 / 后台收过缓存：零网络）→ ② 直链原图 → ③ 图标
//           同时 ④ 后台经网关收进素材缓存（同一帖并发只发一次，见 posts.ts）
//   bandori：直接用 OfficialSongThumb（官方 jacket 的「本机缩略图 → 直链 → 图标 + 后台缓存」
//           与 custom 完全同构，不另写一份）；曲库候选没到手（曲库还没拉到 / 曲已下架）退图标。
//
// 懒加载口径照票 15：提前一屏开始取；没有 IntersectionObserver 的环境（jsdom）直出。
import { useEffect, useRef, useState } from 'react';
import { ImageOff, Music4 } from 'lucide-react';
import type { PostCandidate, SongCandidate } from '../../../community/bestdori/mapping';
import {
  customCoverThumbUrl,
  ensureCustomCoverCached,
} from '../../../community/bestdori/posts';
import type { CommunityTransport } from '../../../community/transport';
import LoadingShimmer, { useSlowLoading } from '../../../ui/LoadingShimmer';
import OfficialSongThumb from './OfficialSongThumb';

const LAZY_ROOT_MARGIN = '160px 0px';

function CustomCoverThumb({ post, transport }: { post: PostCandidate; transport: CommunityTransport }) {
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [useDirect, setUseDirect] = useState(false);
  const [broken, setBroken] = useState(false);
  const [noMaterial, setNoMaterial] = useState(false);
  const [fadedIn, setFadedIn] = useState(false);
  const thumbUrl = customCoverThumbUrl(post);
  const hasCover = thumbUrl !== '';

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const node = hostRef.current;
    if (node == null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: LAZY_ROOT_MARGIN },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // 后台把帖内封面收进素材缓存（同一帖并发只发一次）：预览大图与导入都吃这条缓存
  useEffect(() => {
    if (!visible || !hasCover) return;
    let cancelled = false;
    void ensureCustomCoverCached(transport, post).then((staged) => {
      if (!cancelled && staged == null) setNoMaterial(true);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [visible, hasCover, transport, post]);

  const showIcon = !hasCover || noMaterial;
  const showBroken = !showIcon && broken;
  const slow = useSlowLoading(fadedIn || broken || showIcon || !visible, `${thumbUrl}:${visible}`);

  return (
    <span ref={hostRef} className={`off-row__thumb${showIcon ? ' is-empty' : ''}`} aria-hidden>
      {showIcon ? (
        <Music4 size={16} />
      ) : showBroken ? (
        <ImageOff size={14} />
      ) : (
        <>
          {!fadedIn && slow && <LoadingShimmer />}
          {visible && (
            <img
              src={useDirect
                ? post.song.kind === 'custom' ? post.song.coverUrl ?? '' : ''
                : thumbUrl}
              alt=""
              className={fadedIn ? 'is-in' : ''}
              onLoad={() => setFadedIn(true)}
              onError={() => {
                if (useDirect) setBroken(true);
                else setUseDirect(true);
              }}
            />
          )}
        </>
      )}
    </span>
  );
}

export default function CommunityPostThumb({
  post,
  song,
  transport,
}: {
  post: PostCandidate;
  /** bandori 帖的曲库候选（面板拉到曲库后按 songId 配上）；custom 帖不传 */
  song?: SongCandidate;
  transport: CommunityTransport;
}) {
  if (post.song.kind === 'bandori') {
    if (song == null) {
      return <span className="off-row__thumb is-empty" aria-hidden><Music4 size={16} /></span>;
    }
    return <OfficialSongThumb song={song} transport={transport} />;
  }
  return <CustomCoverThumb post={post} transport={transport} />;
}
