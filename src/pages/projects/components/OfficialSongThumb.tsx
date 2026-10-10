// 「从官方谱面导入」目录行的封面缩略图（票 15，定案 B：48px 圆角）：
//   懒加载（滚到可见才取）→ 占位 → 图回来淡入 → 失败降级图标；
//   没有素材的曲子（合作曲在非首发服 / 索引里没有封面名）不请求网络，直接虚线框 + 音符图标。
//
// 两步才见图，各管一段：
//   ① 可见时经网关把封面收进素材缓存（cache-first：命中零网络，未命中下 97KB 左右）；
//   ② `<img>` 读本机只读协议（`tsugu-asset://thumb/…`）拿缩略图 —— 协议不联网。
// 没有 IntersectionObserver 的环境（jsdom / 老内核）直出：宁可多取一张，不空着。
import { useEffect, useRef, useState } from 'react';
import { ImageOff, Music4 } from 'lucide-react';
import type { SongCandidate } from '../../../community/bestdori/mapping';
import { ensureOfficialCoverCached, jacketThumbUrl } from '../../../community/bestdori/songs';
import type { CommunityTransport } from '../../../community/transport';

/** 提前一屏开始取（原型口径）：不等真正入视口，滚到附近就发起 —— 822 首的目录不能一开就全拉 */
const LAZY_ROOT_MARGIN = '160px 0px';

/**
 * waiting = 还没滚到；loading = 正在把封面收进缓存；
 * ready = 缓存有了、缩略图交给 `<img>`；empty = 平台没有这张图；failed = 取数失败
 */
type ThumbPhase = 'waiting' | 'loading' | 'ready' | 'empty' | 'failed';

export default function OfficialSongThumb({
  song,
  transport,
}: {
  song: SongCandidate;
  transport: CommunityTransport;
}) {
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<ThumbPhase>('waiting');
  const [broken, setBroken] = useState(false);
  const [fadedIn, setFadedIn] = useState(false);
  const hasJacket = song.jacketImage !== '';

  // 懒加载：滚到（或接近）可见才取图
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

  // 可见才取；并发去重与「命中零网络」都在能力层（ensureOfficialCoverCached）
  useEffect(() => {
    if (!visible || !hasJacket) return;
    let cancelled = false;
    setPhase('loading');
    void ensureOfficialCoverCached(transport, song)
      .then((staged) => {
        if (!cancelled) setPhase(staged == null ? 'empty' : 'ready');
      })
      .catch(() => {
        if (!cancelled) setPhase('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [visible, hasJacket, transport, song]);

  /** 没有素材（无封面名 / 平台没这张图）：虚线框 + 音符，跟「取数失败」分开画 */
  const noMaterial = !hasJacket || phase === 'empty';
  const failed = phase === 'failed' || broken;
  const showImage = phase === 'ready' && !broken;

  return (
    <span
      ref={hostRef}
      className={`off-row__thumb${noMaterial ? ' is-empty' : ''}`}
      aria-hidden
    >
      {noMaterial ? (
        <Music4 size={16} />
      ) : failed ? (
        <ImageOff size={14} />
      ) : (
        <>
          {!fadedIn && <span className="off-row__thumb-ph" />}
          {showImage && (
            <img
              src={jacketThumbUrl(song)}
              alt=""
              className={fadedIn ? 'is-in' : ''}
              onLoad={() => setFadedIn(true)}
              onError={() => setBroken(true)}
            />
          )}
        </>
      )}
    </span>
  );
}
