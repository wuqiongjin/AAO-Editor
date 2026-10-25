/**
 * 轮播：一个块一份状态，01 / 03 两块各拿一个实例。
 *
 * 首尾各挂一张克隆实现无缝回绕：pos 1..n 是真实张，0 / n+1 是克隆，回绕动画结束后
 * 无过渡地跳回真实张。自动播放与 hover / focus 暂停、滑动手势、圆点跳转都在这里。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, type ComputedRef } from 'vue'
import type { Slide } from '../landingTypes'

/** 回绕动画的时长：与 CSS `.car-track` 的 transition 时长一致，超时后才回到真实张 */
const WRAP_MS = 700
const AUTOPLAY_MS = 5500
/** 手势判定阈值（px） */
const SWIPE_PX = 40

export interface Carousel {
  /** 首尾各挂一张克隆后的轨道内容 */
  track: ComputedRef<{ slide: Slide; clone: boolean }[]>
  trackStyle: ComputedRef<{ transform: string; transition: string }>
  /** 当前真实张的下标（0 起） */
  dot: ComputedRef<number>
  next: () => void
  prev: () => void
  step: (dir: 1 | -1) => void
  jumpTo: (index: number) => void
  start: () => void
  stop: () => void
  onTrackEnd: (event: TransitionEvent) => void
  onPointerDown: (event: PointerEvent) => void
  onPointerUp: (event: PointerEvent) => void
}

export function useCarousel(slides: ComputedRef<Slide[]>, reducedMotion = false): Carousel {
  const pos = ref(1)
  const animate = ref(true)
  const busy = ref(false)
  let timer: number | null = null
  let pointerStart: number | null = null

  const total = computed(() => slides.value.length)

  /** 首尾各克隆一张 → pos 1..n 是真实张，0 / n+1 是克隆，用于无缝循环 */
  const track = computed(() => {
    const list = slides.value
    if (list.length < 2) return list.map((slide) => ({ slide, clone: false }))
    return [
      { slide: list[list.length - 1], clone: true },
      ...list.map((slide) => ({ slide, clone: false })),
      { slide: list[0], clone: true },
    ]
  })

  const trackStyle = computed(() => ({
    transform: `translateX(${-pos.value * 100}%)`,
    transition: animate.value ? '' : 'none',
  }))

  const dot = computed(() => ((pos.value - 1) % total.value + total.value) % total.value)

  function setPos(next: number, withAnim: boolean) {
    animate.value = withAnim
    pos.value = next
    if (!withAnim) {
      void nextTick(() => {
        // 关掉过渡后立刻改 transform 不会补间；下一帧再恢复过渡
        requestAnimationFrame(() => {
          animate.value = true
        })
      })
    }
  }

  function finishWrap() {
    if (pos.value === total.value + 1) setPos(1, false)
    else if (pos.value === 0) setPos(total.value, false)
    busy.value = false
  }

  function wrapTo(next: number) {
    busy.value = true
    setPos(next, true)
    window.setTimeout(finishWrap, WRAP_MS)
  }

  function next() {
    if (busy.value) return
    if (pos.value >= total.value + 1) return setPos(2, true)
    if (pos.value === total.value) return wrapTo(total.value + 1)
    setPos(pos.value + 1, true)
  }

  function prev() {
    if (busy.value) return
    if (pos.value <= 0) return setPos(total.value - 1, true)
    if (pos.value === 1) return wrapTo(0)
    setPos(pos.value - 1, true)
  }

  function stop() {
    if (timer !== null) window.clearInterval(timer)
    timer = null
  }

  function start() {
    if (reducedMotion) return
    stop()
    timer = window.setInterval(next, AUTOPLAY_MS)
  }

  /** 手动按钮：切完重新计时，免得刚点完就自动跳 */
  function step(dir: 1 | -1) {
    if (dir === 1) next()
    else prev()
    start()
  }

  function jumpTo(index: number) {
    if (busy.value) return
    setPos(index + 1, true)
    start()
  }

  function onTrackEnd(event: TransitionEvent) {
    if (event.propertyName !== 'transform' || !busy.value) return
    finishWrap()
  }

  function onPointerDown(event: PointerEvent) {
    pointerStart = event.clientX
  }

  function onPointerUp(event: PointerEvent) {
    const start = pointerStart
    pointerStart = null
    if (start === null) return
    const delta = event.clientX - start
    if (delta > SWIPE_PX) step(-1)
    else if (delta < -SWIPE_PX) step(1)
  }

  onMounted(start)
  onBeforeUnmount(stop)

  /**
   * `track` / `trackStyle` / `dot` 是 computed，模板里非顶层引用不会自动解包，
   * 用的时候要写 `.value`（`block.media.carousel.track.value`）。
   */
  return { track, trackStyle, dot, next, prev, step, jumpTo, start, stop, onTrackEnd, onPointerDown, onPointerUp }
}
