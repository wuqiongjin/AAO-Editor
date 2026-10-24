/**
 * 落地页与文档页共用的外观状态（语言见 useSiteLocale，走 VitePress i18n 路由）。
 */
import { onMounted, ref, type Ref } from 'vue'

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* 隐私模式下不可写，忽略 */
  }
}

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
    try {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: THEME_KEY,
          oldValue: next ? 'light' : 'dark',
          newValue: value,
          storageArea: window.localStorage,
        }),
      )
    } catch {
      /* 太老的浏览器没有 StorageEvent 构造函数 */
    }
  }

  onMounted(() => {
    isDark.value = document.documentElement.classList.contains('dark')
  })

  return { isDark, toggle: () => apply(!isDark.value) }
}
