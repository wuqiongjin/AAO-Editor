<script setup lang="ts">
import { useAppearance } from '../composables/useSiteChrome'
import { useSiteLocale } from '../composables/useSiteLocale'

const { isDark, toggle } = useAppearance()
const { t } = useSiteLocale()
</script>

<template>
  <button
    class="aao-theme-btn"
    type="button"
    :aria-label="isDark ? t.themeToLight : t.themeToDark"
    :title="isDark ? t.themeToLight : t.themeToDark"
    @click="toggle"
  >
    <svg
      v-if="isDark"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
    </svg>
    <svg
      v-else
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.2 8.2 0 1 0 10.2 10.2Z" />
    </svg>
  </button>
</template>
