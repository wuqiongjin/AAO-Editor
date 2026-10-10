// 「从官方谱面导入」目录行的封面缩略图（票 15 定案 B：48px 圆角；票 17 改取图策略）：
//
//   行可见 → ① 先试**本机缩略图**（上一轮已收进缓存的话：零网络、秒出）
//            ② 本机没有就落回**直链原图**（浏览器自己并发 + 站点 4h HTTP 缓存，体感同原型）
//            ③ 两个都拿不到（平台没这张图 / 网络断）才降级成图标
//   同时 ④ 后台经网关把封面收进素材缓存（素材档 4 并发）—— 下一轮进列表就吃 ①。
//
// 为什么不「先经网关取整图、回来再显示」（票 15 的原设计）：那条路串在一条队列上，
// 跨境一张 ~7s（还会 stall），首屏就是一分钟量级 —— 见票 17。直链显示是**既有口径**
// （预览区一直这么干，songs.ts 的「就地预览直链」那段写明了它不是「渲染进程直连平台」的禁区）。
//
// 没有 IntersectionObserver 的环境（jsdom / 老内核）直出：宁可多取一张，不空着。
import { useEffect, useRef, useState } from 'react';
import { ImageOff, Music4 } from 'lucide-react';
import type { SongCandidate } from '../../../community/bestdori/mapping';
import {
  ensureOfficialCoverCached,
  jacketPreviewUrl,
  jacketThumbUrl,
} from '../../../community/bestdori/songs';
import type { CommunityTransport } from '../../../community/transport';

/** 提前一屏开始取（原型口径）：不等真正入视口，滚到附近就发起 —— 822 首的目录不能一开就全拉 */
const LAZY_ROOT_MARGIN = '160px 0px';

export default function OfficialSongThumb({
  song,
  transport,
}: {
  song: SongCandidate;
  transport: CommunityTransport;
}) {
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const [visible, setVisible] = useState(false);
  /** 本机缩略图没取到（还没进缓存 / 产不出来）→ 落回直链原图 */
  const [useDirect, setUseDirect] = useState(false);
  /** 直链也没成 → 断图图标 */
  const [broken, setBroken] = useState(false);
  /** 平台根本没有这张图（后台取数回了 null）→ 音符图标，别画成「失败」 */
  const [noMaterial, setNoMaterial] = useState(false);
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

  // 后台把封面收进素材缓存（命中零网络；同一首歌并发只发一次，见能力层）
  useEffect(() => {
    if (!visible || !hasJacket) return;
    let cancelled = false;
    void ensureOfficialCoverCached(transport, song)
      .then((staged) => {
        if (!cancelled && staged == null) setNoMaterial(true);
      })
      .catch(() => {
        // 取不到就保持现状：显示那条路走的是直链，不受这里影响
      });
    return () => {
      cancelled = true;
    };
  }, [visible, hasJacket, transport, song]);

  const showIcon = !hasJacket || noMaterial;
  const showBroken = !showIcon && broken;
  const src = useDirect ? jacketPreviewUrl(song) : jacketThumbUrl(song);

  return (
    <span
      ref={hostRef}
      className={`off-row__thumb${showIcon ? ' is-empty' : ''}`}
      aria-hidden
    >
      {showIcon ? (
        <Music4 size={16} />
      ) : showBroken ? (
        <ImageOff size={14} />
      ) : (
        <>
          {!fadedIn && <span className="off-row__thumb-ph" />}
          {visible && (
            <img
              src={src}
              alt=""
              className={fadedIn ? 'is-in' : ''}
              onLoad={() => setFadedIn(true)}
              onError={() => {
                // 本机没有 → 退直链；直链也不成 → 断图图标
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
