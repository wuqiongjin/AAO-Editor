/**
 * 首屏受众轮换：不把用户群锁死在一种说法上。
 *
 * 句子骨架是 `为 [ 人称 ] 打造的`，这里只负责换中间那个人称。所有候选同时渲染
 * （非当前的绝对定位 + 逐字透明），容器宽度量当前条后写死并过渡，这样后面的
 * 「打造的」不会每轮左右横跳。
 *
 * 动效是逐字柔焦：候选按字拆成 `<span class="ch">`（`--i` 记序号），由 CSS 按序号
 * 错开做「模糊 → 清晰」的入场；离场不带错开，整体快速虚化，避免两段字叠在一起。
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch, type ComputedRef, type Ref } from 'vue'

const DEFAULT_INTERVAL = 4200

export interface Rotor {
  /** 挂到候选容器上，拆字与量宽都在这个元素内部进行 */
  el: Ref<HTMLElement | null>
  index: Ref<number>
  /** 容器宽度（px）；为 null 时交给 CSS 自己撑开 */
  width: Ref<number | null>
  onResize: () => void
}

export function useRotor(
  items: ComputedRef<string[]>,
  options: { reducedMotion?: boolean; interval?: number } = {}
): Rotor {
  const el = ref<HTMLElement | null>(null)
  const index = ref(0)
  const width = ref<number | null>(null)
  const interval = options.interval ?? DEFAULT_INTERVAL
  const reducedMotion = options.reducedMotion ?? false
  let timer: number | null = null

  /** 把一条候选里的文本节点拆成 `<span class="ch">字</span>`，保留原有的强调色 span。 */
  function splitChars(item: HTMLElement) {
    const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if ((node.parentElement as HTMLElement | null)?.closest('.ch')) continue
      nodes.push(node as Text)
    }
    let order = 0
    for (const node of nodes) {
      const text = node.textContent ?? ''
      if (!text) continue
      const frag = document.createDocumentFragment()
      for (const ch of Array.from(text)) {
        if (!ch.trim()) {
          frag.appendChild(document.createTextNode(ch))
          continue
        }
        const span = document.createElement('span')
        span.className = 'ch'
        span.textContent = ch
        span.style.setProperty('--i', String(order))
        order += 1
        frag.appendChild(span)
      }
      node.replaceWith(frag)
    }
  }

  function splitAll() {
    el.value?.querySelectorAll<HTMLElement>('.rotor-item').forEach(splitChars)
  }

  function measure(at = index.value, animate = true) {
    const host = el.value
    const item = host?.querySelectorAll<HTMLElement>('.rotor-item')[at]
    if (!host || !item) return
    const next = item.offsetWidth
    if (!animate) {
      const prev = host.style.transition
      host.style.transition = 'none'
      width.value = next
      void host.offsetWidth
      host.style.transition = prev
      return
    }
    width.value = next
  }

  function stop() {
    if (timer !== null) window.clearInterval(timer)
    timer = null
  }

  function start() {
    stop()
    if (reducedMotion || items.value.length < 2) return
    timer = window.setInterval(() => {
      const total = items.value.length
      const next = (index.value + 1) % total
      // 先量下一条再切（此刻它还是 absolute，offsetWidth 即内容宽度）
      measure(next)
      index.value = next
    }, interval)
  }

  function onResize() {
    measure(undefined, false)
  }

  /** 换语言：候选整体换掉，重新拆字、重置到第一条 */
  watch(items, () => {
    index.value = 0
    void nextTick(() => {
      splitAll()
      measure(0, false)
      start()
    })
  })

  onMounted(() => {
    // 拆字 → 量宽 → 起循环（量之前宽度是 auto，靠 `.on` 那条撑开）
    splitAll()
    measure(0, false)
    start()
  })

  onBeforeUnmount(stop)

  return { el, index, width, onResize }
}
