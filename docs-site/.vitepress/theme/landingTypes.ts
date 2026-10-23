/** 落地页的图片规格：一份规格在 `landingMedia.ts` 里，alt / caption 存文案键、渲染时才解析。 */
import type { CopyKey } from './landingCopy'

export interface Shot {
  src: string
  alt: string
  caption: string
  width: number
  height: number
  /** 演示动图：窗口栏换成「录制中」样式 */
  demo?: boolean
}

/** 轮播项 = 一张图 + 一个图注 */
export type Slide = Shot

export interface ShotSpec {
  src: string
  altKey: CopyKey
  captionKey?: CopyKey
  width: number
  height: number
  demo?: boolean
}

/** 按当前语言把规格解析成可直接渲染的图片对象 */
export function resolveShots(t: Record<CopyKey, string>, specs: ShotSpec[]): Shot[] {
  return specs.map((spec) => ({
    src: spec.src,
    alt: t[spec.altKey],
    caption: spec.captionKey ? t[spec.captionKey] : '',
    width: spec.width,
    height: spec.height,
    demo: spec.demo,
  }))
}
