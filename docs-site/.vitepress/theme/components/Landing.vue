<script setup lang="ts">
/**
 * 落地页：页面骨架 + 页面级副作用（滚动进度、滚入显现、区块左缘线、导航高亮、
 * 首屏测高、playhead、灯箱）；语言 / 外观 / 轮播 / 受众轮换都在 composable 里。
 *
 * 注意别在这里抽子组件：`landing.css` 是 `<style scoped>` 载入的，只给本组件的模板节点
 * 打 `data-v`，子组件内部节点拿不到、样式会整片失效。要拆，先把 `landing.css` 的选择器
 * 全部前缀到 `.landing` 名下改成全局加载。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { withBase } from 'vitepress'
import { CNB_RELEASES_URL, ISSUES_URL, RELEASES_URL, REPO_URL } from '../../links'
import { bulletsOf, type CopyKey } from '../landingCopy'
import { resolveShots, type Shot, type Slide } from '../landingTypes'
import { CAP01_SLIDES, CAP02_SHOTS, CAP03_SLIDES, HERO_SHOT } from '../landingMedia'
import { useAppearance, useLocale } from '../composables/useSiteChrome'
import { useCarousel, type Carousel } from '../composables/useCarousel'
import { useRotor } from '../composables/useRotor'

// 顶栏品牌图标：直接复用 app 的 public/icon.png（相对路径，不依赖 config 里的别名）
import appIcon from '../../../../public/icon.png'

/** 人称配色 `--c1…--c6`（见 landing.css）：候选多于 6 条就从头再轮一圈 */
const AUDIENCE_COLORS = 6

const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/* ---------- 语言 / 外观（各自一个 composable） ---------- */
const { locale, t, setLocale } = useLocale()
const { isDark, toggle: toggleTheme } = useAppearance()

/* ---------- 图片（规格在 landingMedia.ts，alt / 图注按语言解析） ---------- */
const heroShot = computed<Shot>(() => resolveShots(t.value, [HERO_SHOT])[0])
const cap01Slides = computed<Slide[]>(() => resolveShots(t.value, CAP01_SLIDES))
const cap02Shots = computed<Shot[]>(() => resolveShots(t.value, CAP02_SHOTS))
const cap03Slides = computed<Slide[]>(() => resolveShots(t.value, CAP03_SLIDES))

/* ---------- 首屏受众轮换 ---------- */
const audience = computed(() => t.value.heroAudience.split('|'))
const {
  el: rotorEl,
  index: rotorIndex,
  width: rotorWidth,
  onResize: onRotorResize,
} = useRotor(audience, { reducedMotion })

/* ---------- 轮播：两块各一个实例，共用一份实现 ---------- */
const car01 = useCarousel(cap01Slides, reducedMotion)
const car03 = useCarousel(cap03Slides, reducedMotion)

/**
 * 三块能力：文案键统一由 `bulletsOf` 按编号收集，加一条要点只改文案、不动模板。
 * 媒体两种形态（轮播 / 定图）用 `kind` 区分，模板里只写一遍。
 */
interface CapBlock {
  key: string
  num: string
  title: string
  bullets: string[]
  media:
    | { kind: 'carousel'; carousel: Carousel; slides: Slide[] }
    | { kind: 'shots'; shots: Shot[] }
}

const capBlocks = computed<CapBlock[]>(() => [
  {
    key: 'cap01',
    num: t.value.capNum01,
    title: t.value.cap01Title,
    bullets: bulletsOf(t.value, 'cap01'),
    media: { kind: 'carousel', carousel: car01, slides: cap01Slides.value },
  },
  {
    key: 'cap02',
    num: t.value.capNum02,
    title: t.value.cap02Title,
    bullets: bulletsOf(t.value, 'cap02'),
    media: { kind: 'shots', shots: cap02Shots.value },
  },
  {
    key: 'cap03',
    num: t.value.capNum03,
    title: t.value.cap03Title,
    bullets: bulletsOf(t.value, 'cap03'),
    media: { kind: 'carousel', carousel: car03, slides: cap03Slides.value },
  },
])

/* ---------- 灯箱 ---------- */
const lightboxEl = ref<HTMLDialogElement | null>(null)
const lightboxSlide = ref<Shot | null>(null)

function openZoom(shot: Shot) {
  lightboxSlide.value = shot
  const el = lightboxEl.value
  if (!el) return
  if (typeof el.showModal === 'function') el.showModal()
  else el.setAttribute('open', '')
}

function closeZoom() {
  lightboxEl.value?.close()
}

function onLightboxClick(event: MouseEvent) {
  if (event.target === lightboxEl.value) closeZoom()
}

/* ---------- 滚动状态 ---------- */
const progress = ref(0)
const scrolled = ref(false)
const activeSection = ref('')

function onScroll() {
  const doc = document.documentElement
  const max = doc.scrollHeight - doc.clientHeight
  const top = window.scrollY || doc.scrollTop
  progress.value = max > 0 ? top / max : 0
  scrolled.value = top > 8
}

const root = ref<HTMLElement | null>(null)
const heroSection = ref<HTMLElement | null>(null)
const heroFigure = ref<HTMLElement | null>(null)
const playhead = ref<HTMLElement | null>(null)

let ioReveal: IntersectionObserver | undefined
let ioEdge: IntersectionObserver | undefined
let ioSpy: IntersectionObserver | undefined

/** 扫过距离必须取 hero 自己的宽度：取整页宽度会在宽屏多扫出一截，把页面撑出横向滚动条 */
function sizePlayhead() {
  if (playhead.value && heroSection.value) {
    // 减 1px：扫到最右端时留一线，避免亚像素取整把页面撑出 1px 横向滚动
    playhead.value.style.setProperty('--ph-travel', `${Math.max(0, heroSection.value.clientWidth - 1)}px`)
  }
}

/**
 * 首屏高度：直接用实测的视口高度写 `--hero-vh`。
 * `100svh` 在普通浏览器里没问题，但嵌在预览 iframe 里、或系统缩放比较大时可能算不准，
 * 结果就是首屏没撑满、下一节又漏进来。
 */
function sizeHero() {
  document.documentElement.style.setProperty('--hero-vh', `${window.innerHeight}px`)
}

function scrollToFeatures() {
  document.getElementById('features')?.scrollIntoView({
    behavior: reducedMotion ? 'auto' : 'smooth',
    block: 'start',
  })
}

/* ---------- Hero 主图指针微倾斜 ---------- */
function onFigureMove(event: PointerEvent) {
  const figure = heroFigure.value
  if (!figure) return
  const rect = figure.getBoundingClientRect()
  const x = (event.clientX - rect.left) / rect.width - 0.5
  const y = (event.clientY - rect.top) / rect.height - 0.5
  figure.style.transform = `perspective(1400px) rotateX(${(-y * 2.5).toFixed(2)}deg) rotateY(${(x * 2.5).toFixed(2)}deg)`
}

function onFigureLeave() {
  if (heroFigure.value) heroFigure.value.style.transform = ''
}

onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })

  sizePlayhead()
  sizeHero()
  window.addEventListener('resize', sizePlayhead)
  window.addEventListener('resize', sizeHero)
  window.addEventListener('resize', onRotorResize)
  window.addEventListener('orientationchange', sizeHero)

  const rootEl = root.value
  if (!rootEl) return

  // 滚入显现
  const reveals = Array.from(rootEl.querySelectorAll<HTMLElement>('.reveal, .stagger'))
  if ('IntersectionObserver' in window) {
    ioReveal = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('in')
          ioReveal?.unobserve(entry.target)
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -48px 0px' }
    )
    reveals.forEach((el) => ioReveal?.observe(el))
  } else {
    reveals.forEach((el) => el.classList.add('in'))
  }

  // 区块左缘播放线
  const edges = Array.from(rootEl.querySelectorAll<HTMLElement>('[data-edge]'))
  if ('IntersectionObserver' in window && edges.length > 0) {
    ioEdge = new IntersectionObserver(
      (entries) => {
        let entered: HTMLElement | null = null
        for (const entry of entries) {
          if (entry.isIntersecting) entered = entry.target as HTMLElement
        }
        if (entered) edges.forEach((el) => el.classList.toggle('edge-on', el === entered))
        else entries.forEach((entry) => entry.target.classList.remove('edge-on'))
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 }
    )
    edges.forEach((el) => ioEdge?.observe(el))
  }

  // 导航滚动高亮
  const spyLinks = new Map<string, HTMLAnchorElement>()
  rootEl.querySelectorAll<HTMLAnchorElement>('.nav a[href^="#"]').forEach((a) => {
    spyLinks.set(a.getAttribute('href')!.slice(1), a)
  })
  if ('IntersectionObserver' in window && spyLinks.size > 0) {
    ioSpy = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const link = spyLinks.get(entry.target.id)
          if (!link) continue
          spyLinks.forEach((el) => el.classList.remove('active'))
          link.classList.add('active')
          activeSection.value = entry.target.id
        }
      },
      { rootMargin: '-40% 0px -55% 0px' }
    )
    spyLinks.forEach((_, id) => {
      const section = document.getElementById(id)
      if (section) ioSpy?.observe(section)
    })
  }

  const fine = window.matchMedia('(hover:hover) and (pointer:fine)').matches
  if (heroFigure.value && fine && !reducedMotion) {
    heroFigure.value.addEventListener('pointermove', onFigureMove)
    heroFigure.value.addEventListener('pointerleave', onFigureLeave)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', sizePlayhead)
  window.removeEventListener('resize', sizeHero)
  window.removeEventListener('resize', onRotorResize)
  window.removeEventListener('orientationchange', sizeHero)
  ioReveal?.disconnect()
  ioEdge?.disconnect()
  ioSpy?.disconnect()
  const figure = heroFigure.value
  if (figure) {
    figure.removeEventListener('pointermove', onFigureMove)
    figure.removeEventListener('pointerleave', onFigureLeave)
  }
})

/** 圆点的无障碍标签：`carDot1 / carDot2 / carDot3` */
function dotLabel(index: number): string {
  return t.value[`carDot${index + 1}` as CopyKey]
}

/** 人称配色：`--c1 … --c6` */
function audienceColor(index: number): string {
  return `var(--c${(index % AUDIENCE_COLORS) + 1})`
}
</script>

<template>
  <div ref="root" class="landing js" :lang="locale">
    <div class="progress" aria-hidden="true" :style="{ transform: `scaleX(${progress})` }" />

    <header class="topbar" :class="{ scrolled }">
      <a class="brand" href="#top">
        <img
          class="brand-logo"
          :src="appIcon"
          alt=""
          width="26"
          height="26"
          aria-hidden="true"
        />
        <strong>AAO Editor</strong><span>{{ t.brandSub }}</span>
      </a>
      <nav class="nav" aria-label="页面导航">
        <a href="#features" :class="{ active: activeSection === 'features' }">{{ t.navFeatures }}</a>
        <a href="#download" :class="{ active: activeSection === 'download' }">{{ t.navDownload }}</a>
        <a :href="withBase('/guide/')">{{ t.navGuide }}</a>
        <a :href="REPO_URL" target="_blank" rel="noreferrer noopener">GitHub</a>
      </nav>
      <div class="lang" role="group" aria-label="语言 / Language">
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
      <button
        class="theme-btn"
        type="button"
        :aria-label="isDark ? t.themeToLight : t.themeToDark"
        :title="isDark ? t.themeToLight : t.themeToDark"
        @click="toggleTheme"
      >
        <svg v-if="isDark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.2 8.2 0 1 0 10.2 10.2Z" /></svg>
      </button>
    </header>

    <main id="top">
      <!-- Hero（左文右图） -->
      <section ref="heroSection" class="hero hero-anim">
        <p class="eyebrow">{{ t.eyebrow }}</p>
        <div class="hero-grid">
          <div class="hero-copy">
            <h1>
              <span class="hero-lead">
                <!-- 读屏拿一句稳定的完整句；视觉行整段是装饰性的轮换 -->
                <span class="sr-only">{{ t.heroLeadSr }}</span>
                <span class="lead-line" aria-hidden="true">
                  <span>{{ t.leadPre }}</span>
                  <span
                    ref="rotorEl"
                    class="rotor"
                    :style="rotorWidth === null ? undefined : { width: `${rotorWidth}px` }"
                  >
                    <span
                      v-for="(item, index) in audience"
                      :key="item"
                      class="rotor-item"
                      :class="{ on: rotorIndex === index }"
                      :style="{ '--c': audienceColor(index) }"
                      v-html="item"
                    />
                  </span>
                  <span v-if="t.leadPost">{{ t.leadPost }}</span>
                </span>
              </span>
              <span class="hero-main" v-html="t.heroMain" />
            </h1>
            <p class="lede" v-html="t.heroLede" />
            <div class="cta-row">
              <a
                class="btn btn-primary"
                :href="RELEASES_URL"
                target="_blank"
                rel="noreferrer noopener"
                >{{ t.ctaDownload }}</a
              >
              <!-- 平台徽标与主按钮同行；「桌面安装包」只留给读屏，不再占一行文字宽度 -->
              <p class="cta-note" :aria-label="t.ctaNoteLabel">
                <span class="plat">Windows</span><span class="plat">macOS</span
                ><span class="plat">Linux</span>
              </p>
            </div>
          </div>
          <div class="hero-visual">
            <figure ref="heroFigure" class="shot hero-figure">
              <div class="win" aria-hidden="true"><i /><i /><i /></div>
              <button class="zoom" type="button" @click="openZoom(heroShot)">
                <img
                  :src="heroShot.src"
                  :alt="heroShot.alt"
                  :width="heroShot.width"
                  :height="heroShot.height"
                />
                <svg class="zoom-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4H4v5" /><path d="M15 4h5v5" /><path d="M15 20h5v-5" /><path d="M9 20H4v-5" /></svg>
              </button>
              <figcaption>{{ heroShot.caption }}</figcaption>
            </figure>
          </div>
        </div>
        <button
          class="scroll-cue"
          type="button"
          :aria-label="t.cueDown"
          :title="t.cueDown"
          @click="scrollToFeatures"
        >
          <svg class="cue-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 9 7 7 7-7" /></svg>
        </button>
        <div ref="playhead" class="playhead" aria-hidden="true" />
      </section>

      <!-- 功能特性 -->
      <section id="features" class="section">
        <div class="section-head reveal">
          <p class="kicker">{{ t.kickerFeatures }}</p>
          <h2 class="section-title">{{ t.featuresTitle }}</h2>
          <p class="section-sub">{{ t.featuresSub }}</p>
        </div>

        <article v-for="block in capBlocks" :key="block.key" class="cap reveal" data-edge>
          <div class="edge-line" aria-hidden="true" />
          <div class="cap-text">
            <p class="cap-num">{{ block.num }}</p>
            <h3>{{ block.title }}</h3>
            <ul class="cap-list">
              <li v-for="(bullet, index) in block.bullets" :key="index" v-html="bullet" />
            </ul>
          </div>
          <div class="cap-media">
            <!-- 01 / 03：轮播 -->
            <div
              v-if="block.media.kind === 'carousel'"
              class="carousel"
              role="group"
              aria-roledescription="carousel"
              :aria-label="t.carAria"
              @mouseenter="block.media.carousel.stop()"
              @mouseleave="block.media.carousel.start()"
              @focusin="block.media.carousel.stop()"
              @focusout="block.media.carousel.start()"
              @pointerdown="block.media.carousel.onPointerDown($event)"
              @pointerup="block.media.carousel.onPointerUp($event)"
            >
              <div class="car-viewport">
                <div
                  class="car-track"
                  :style="block.media.carousel.trackStyle.value"
                  @transitionend="block.media.carousel.onTrackEnd($event)"
                >
                  <figure
                    v-for="(item, index) in block.media.carousel.track.value"
                    :key="`${block.key}-${index}`"
                    class="shot car-slide"
                    :aria-hidden="item.clone ? 'true' : undefined"
                  >
                    <div class="win" aria-hidden="true"><i /><i /><i /></div>
                    <button
                      class="zoom car-shot"
                      type="button"
                      :tabindex="item.clone ? -1 : 0"
                      @click="openZoom(item.slide)"
                    >
                      <img
                        :src="item.slide.src"
                        :alt="item.slide.alt"
                        :width="item.slide.width"
                        :height="item.slide.height"
                        :loading="index === 1 ? 'eager' : 'lazy'"
                      />
                      <svg class="zoom-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4H4v5" /><path d="M15 4h5v5" /><path d="M15 20h5v-5" /><path d="M9 20H4v-5" /></svg>
                    </button>
                    <figcaption>{{ item.slide.caption }}</figcaption>
                  </figure>
                </div>
                <div class="car-dots">
                  <button
                    v-for="(slide, index) in block.media.slides"
                    :key="`${block.key}-dot-${index}`"
                    class="car-dot"
                    :class="{ active: block.media.carousel.dot.value === index }"
                    type="button"
                    :aria-label="dotLabel(index)"
                    :aria-current="block.media.carousel.dot.value === index ? 'true' : 'false'"
                    @click="block.media.carousel.jumpTo(index)"
                  />
                </div>
              </div>
              <button
                class="car-btn car-prev"
                type="button"
                :aria-label="t.carPrevAria"
                @click="block.media.carousel.step(-1)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
              </button>
              <button
                class="car-btn car-next"
                type="button"
                :aria-label="t.carNextAria"
                @click="block.media.carousel.step(1)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
              </button>
            </div>

            <!-- 02：主图 + 演示动图 -->
            <template v-else>
              <figure v-if="block.media.shots[0]" class="shot">
                <div class="win" aria-hidden="true"><i /><i /><i /></div>
                <button class="zoom" type="button" @click="openZoom(block.media.shots[0])">
                  <img
                    :src="block.media.shots[0].src"
                    :alt="block.media.shots[0].alt"
                    :width="block.media.shots[0].width"
                    :height="block.media.shots[0].height"
                    loading="lazy"
                  />
                  <svg class="zoom-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4H4v5" /><path d="M15 4h5v5" /><path d="M15 20h5v-5" /><path d="M9 20H4v-5" /></svg>
                </button>
                <figcaption>{{ block.media.shots[0].caption }}</figcaption>
              </figure>
              <div class="shot-row">
                <figure v-for="shot in block.media.shots.slice(1)" :key="shot.src" class="shot">
                  <div class="win win--demo" aria-hidden="true">
                    <span class="demo-dot" /><span class="demo-label">{{ t.demoLabel }}</span>
                  </div>
                  <button class="zoom" type="button" @click="openZoom(shot)">
                    <img
                      :src="shot.src"
                      :alt="shot.alt"
                      :width="shot.width"
                      :height="shot.height"
                      loading="lazy"
                    />
                    <svg class="zoom-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4H4v5" /><path d="M15 4h5v5" /><path d="M15 20h5v-5" /><path d="M9 20H4v-5" /></svg>
                  </button>
                  <figcaption>{{ shot.caption }}</figcaption>
                </figure>
              </div>
            </template>
          </div>
        </article>
      </section>

      <!-- 本地优先 -->
      <div class="trust" data-edge>
        <div class="edge-line" aria-hidden="true" />
        <div class="trust-inner stagger">
          <dl>
            <dt>
              <span class="ic-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="12" width="18" height="8" rx="2" /><path d="M6 12.2 7.6 6.8A2 2 0 0 1 9.5 5.5h5a2 2 0 0 1 1.9 1.3l1.6 5.4" /><circle cx="16.5" cy="16" r="1" fill="currentColor" stroke="none" /></svg></span>{{ t.trustLocal }}
            </dt>
            <dd>{{ t.trustLocalD }}</dd>
          </dl>
          <dl>
            <dt>
              <span class="ic-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18a4 4 0 0 1 .5-8 5.5 5.5 0 0 1 10-3 3.5 3.5 0 0 1-.5 11Z" /><path d="M4.5 4.5 19.5 19.5" /></svg></span>{{ t.trustNoTel }}
            </dt>
            <dd>{{ t.trustNoTelD }}</dd>
          </dl>
          <dl>
            <dt>
              <span class="ic-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h13" /><path d="m14 5 3 3-3 3" /><path d="M20 16H7" /><path d="m10 13-3 3 3 3" /></svg></span>{{ t.trustPort }}
            </dt>
            <dd>{{ t.trustPortD }}</dd>
          </dl>
        </div>
      </div>

      <!-- 下载 -->
      <section id="download" class="section" data-edge>
        <div class="edge-line" aria-hidden="true" />
        <div class="section-head reveal">
          <p class="kicker">{{ t.kickerDownload }}</p>
          <h2 class="section-title">{{ t.downloadTitle }}</h2>
        </div>
        <div class="dl-grid stagger">
          <div class="dl-card dl-card--primary">
            <span class="dl-tag">{{ t.dlTagPrimary }}</span>
            <h3>GitHub Releases</h3>
            <p>{{ t.dlGhP1 }}</p>
            <a class="btn btn-primary" :href="RELEASES_URL" target="_blank" rel="noreferrer noopener">{{ t.dlGhBtn }}</a>
          </div>
          <div class="dl-card">
            <span class="dl-tag">{{ t.dlTagMirror }}</span>
            <h3>CNB Releases</h3>
            <p>{{ t.dlCnbP1 }}</p>
            <a class="btn btn-secondary" :href="CNB_RELEASES_URL" target="_blank" rel="noreferrer noopener">{{ t.dlCnbBtn }}</a>
          </div>
        </div>
      </section>
    </main>

    <footer class="footer">
      <div class="footer-inner stagger">
        <div>
          <h2>{{ t.footTitle }}</h2>
          <p class="disclaimer">{{ t.footLead }}</p>
          <p class="disclaimer">{{ t.footAssets }}</p>
          <p class="disclaimer">
            {{ t.footReport1 }}<a :href="ISSUES_URL" target="_blank" rel="noreferrer noopener">GitHub Issues</a>{{ t.footReport2 }}
          </p>
        </div>
        <ul class="footer-links">
          <li><a :href="withBase('/guide/')">{{ t.footGuide }}</a></li>
          <li><a :href="REPO_URL" target="_blank" rel="noreferrer noopener">{{ t.footRepo }}</a></li>
          <li><a :href="RELEASES_URL" target="_blank" rel="noreferrer noopener">Releases</a></li>
          <li><a :href="ISSUES_URL" target="_blank" rel="noreferrer noopener">{{ t.footIssues }}</a></li>
          <li><a :href="CNB_RELEASES_URL" target="_blank" rel="noreferrer noopener">CNB Releases</a></li>
        </ul>
      </div>
    </footer>

    <!-- 灯箱 -->
    <dialog ref="lightboxEl" class="lightbox" :aria-label="t.lbAria" @click="onLightboxClick">
      <button class="lb-close" type="button" :aria-label="t.lbCloseAria" @click="closeZoom">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12" /><path d="M18 6 6 18" /></svg>
      </button>
      <figure class="lb-figure">
        <img :src="lightboxSlide?.src ?? ''" :alt="lightboxSlide?.alt ?? ''" />
        <figcaption class="lb-cap">{{ lightboxSlide?.caption }}</figcaption>
      </figure>
    </dialog>
  </div>
</template>

<style scoped src="../landing.css"></style>
