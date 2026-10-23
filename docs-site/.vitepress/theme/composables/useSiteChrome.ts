/**
 * 落地页的两件「外壳」状态：语言与外观。
 *
 * 两者形状一样（读上次选择 → 写 localStorage → 顺手改一下 document），所以各出一个
 * composable，共用一个安全的读写函数。
 */
import { computed, onMounted, ref, watch, type ComputedRef, type Ref } from 'vue'
import { COPY, type CopyKey, type Locale } from '../landingCopy'

/** 隐私模式下 localStorage 不可写，写入失败不影响页面 */
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* 隐私模式下不可写，忽略 */
  }
}

function load(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/* ---------- 语言 ---------- */

const LOCALE_KEY = 'aao-lang'

export interface SiteLocale {
  locale: Ref<Locale>
  t: ComputedRef<Record<CopyKey, string>>
  setLocale: (next: Locale) => void
}

export function useLocale(): SiteLocale {
  const locale = ref<Locale>('zh-CN')
  const t = computed(() => COPY[locale.value] as Record<CopyKey, string>)

  function apply(next: Locale) {
    document.documentElement.lang = next === 'en' ? 'en' : 'zh-CN'
    const meta = document.querySelector('meta[name="description"]')
    if (meta) meta.setAttribute('content', COPY[next].docDesc)
    save(LOCALE_KEY, next)
  }

  onMounted(() => {
    const saved = load(LOCALE_KEY)
    if (saved === 'en' || saved === 'zh-CN') locale.value = saved
    apply(locale.value)
  })

  watch(locale, apply)

  return { locale, t, setLocale: (next: Locale) => (locale.value = next) }
}

/* ---------- 外观 ---------- */

/** 与 VitePress 文档页共用一个键：落地页改了，进文档页也生效 */
const THEME_KEY = 'vitepress-theme-appearance'

export interface SiteAppearance {
  isDark: Ref<boolean>
  toggle: () => void
}

export function useAppearance(): SiteAppearance {
  const isDark = ref(true)

  function apply(next: boolean) {
    isDark.value = next
    const value = next ? 'dark' : 'light'
    document.documentElement.classList.toggle('dark', next)
    save(THEME_KEY, value)
    /**
     * 文档页的开关由 VitePress（`useDark` → VueUse `useStorage`）维护，
     * 它只监听 window 的 storage 事件，同页写 localStorage 不会触发。
     * 手动派发一帧同形状的事件，让两处开关保持一致。
     */
    try {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: THEME_KEY,
          oldValue: next ? 'light' : 'dark',
          newValue: value,
          storageArea: window.localStorage,
        })
      )
    } catch {
      /* 太老的浏览器没有 StorageEvent 构造函数，退化成只改 class */
    }
  }

  onMounted(() => {
    // VitePress 已在首屏前按存档写好 html.dark，这里只同步开关状态
    isDark.value = document.documentElement.classList.contains('dark')
  })

  return { isDark, toggle: () => apply(!isDark.value) }
}
