import { computed, nextTick } from 'vue'
import { useData, useRouter, withBase } from 'vitepress'
import { COPY, type CopyKey, type Locale } from '../landingCopy'

function ensureStartingSlash(path: string) {
  return path.startsWith('/') ? path : `/${path}`
}

function scrollTopFromScrollToArgs(x?: ScrollToOptions | number, y?: number): number {
  if (typeof x === 'object' && x !== null) return x.top ?? 0
  if (typeof y === 'number') return y
  if (typeof x === 'number') return x
  return 0
}

/**
 * VitePress 在 router.go 后会 scrollTo(0)。切换语言时拦截「滚到顶部」，
 * 结束后瞬时恢复到原位置（不受 html { scroll-behavior: smooth } 影响）。
 */
function guardScrollDuringLocaleSwitch(preserveY: number): () => void {
  const native = window.scrollTo.bind(window)

  window.scrollTo = ((x?: ScrollToOptions | number, y?: number) => {
    if (scrollTopFromScrollToArgs(x, y) === 0) return
    return native(x as ScrollToOptions | number, y as number)
  }) as typeof window.scrollTo

  return () => {
    const html = document.documentElement
    const prevBehavior = html.style.scrollBehavior
    html.style.scrollBehavior = 'auto'
    window.scrollTo = native
    native({ top: preserveY, left: 0, behavior: 'instant' })
    html.style.scrollBehavior = prevBehavior
  }
}

async function finishLocaleNavigation(restoreScroll: () => void) {
  await nextTick()
  await nextTick()
  restoreScroll()
}

export function useSiteLocale() {
  const { site, localeIndex, page, theme, hash } = useData()
  const router = useRouter()

  const locale = computed<Locale>(() => (localeIndex.value === 'en' ? 'en' : 'zh-CN'))

  const t = computed(() => COPY[locale.value] as Record<CopyKey, string>)

  function hrefForLocaleKey(targetKey: string) {
    const target = site.value.locales[targetKey]
    if (!target) return '/'

    const link = target.link || (targetKey === 'root' ? '/' : `/${targetKey}/`)
    const current = site.value.locales[localeIndex.value]
    const currentLink =
      current?.link || (localeIndex.value === 'root' ? '/' : `/${localeIndex.value}/`)

    const pathTail = page.value.relativePath.slice(Math.max(0, currentLink.length - 1))
    const addPath = theme.value.i18nRouting !== false
    const addExt = !site.value.cleanUrls

    const href = addPath
      ? link.replace(/\/$/, '') +
        ensureStartingSlash(
          pathTail
            .replace(/(^|\/)index\.md$/, '$1')
            .replace(/\.md$/, addExt ? '.html' : ''),
        )
      : link

    // href 必须带 base：VitePress 的 router.go 会把 href 原样 pushState，
    // 且 pathToFile 映射页面 chunk 前会切掉 base——不带 base 会跳去域名根目录 404
    // （与 Landing.vue 的 guideHref 同一范式）。
    return withBase(href + hash.value)
  }

  function setLocale(next: Locale) {
    const targetKey = next === 'en' ? 'en' : 'root'
    if (localeIndex.value === targetKey) return

    const href = hrefForLocaleKey(targetKey).replace(/#.*$/, '')

    if (typeof window === 'undefined') {
      void router.go(href)
      return
    }

    const preserveY = window.scrollY
    const restoreScroll = guardScrollDuringLocaleSwitch(preserveY)
    void router.go(href).finally(() => {
      void finishLocaleNavigation(restoreScroll)
    })
  }

  return { locale, t, setLocale }
}
