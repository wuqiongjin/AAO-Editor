<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import { useData } from 'vitepress'
import Landing from './components/Landing.vue'
import NavLangSwitch from './components/NavLangSwitch.vue'

const { frontmatter } = useData()
</script>

<template>
  <!-- 落地页自带导航与页脚（深色制谱台风格），不套文档布局；其余页面走默认主题。 -->
  <Landing v-if="frontmatter.landing" />
  <DefaultTheme.Layout v-else>
    <!-- 外观开关用 VitePress 原生的（票 07 · 2026-10-24 用户拍板 B：样式在 style.css
         重置为站点 chrome 圆形），DOM 上排在语言胶囊之前；这里只放自定义语言胶囊 -->
    <template #nav-bar-content-after>
      <div class="aao-topbar-utilities aao-nav-utilities">
        <NavLangSwitch />
      </div>
    </template>
  </DefaultTheme.Layout>
</template>
