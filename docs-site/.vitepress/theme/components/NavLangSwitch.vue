<script setup lang="ts">
import { useSiteLocale } from '../composables/useSiteLocale'

const { locale, setLocale } = useSiteLocale()
</script>

<template>
  <div class="aao-lang aao-nav-lang" role="group" aria-label="语言 / Language">
    <button
      type="button"
      :class="{ active: locale === 'zh-CN' }"
      :aria-pressed="locale === 'zh-CN'"
      @click="setLocale('zh-CN')"
    >
      中文
    </button>
    <button
      type="button"
      :class="{ active: locale === 'en' }"
      :aria-pressed="locale === 'en'"
      @click="setLocale('en')"
    >
      EN
    </button>
  </div>
</template>
