<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import { useData } from 'vitepress'
import Landing from './components/Landing.vue'

const { frontmatter } = useData()
</script>

<template>
  <!-- 落地页自带导航与页脚（深色制谱台风格），不套文档布局；其余页面走默认主题。 -->
  <Landing v-if="frontmatter.landing" />
  <DefaultTheme.Layout v-else />
</template>
