<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { withBase } from 'vitepress'
import { CNB_RELEASES_URL, ISSUES_URL, RELEASES_URL, REPO_URL } from '../../links'
import { COPY, type Locale } from '../landingCopy'

// 顶栏品牌图标：直接复用 app 的 public/icon.png（相对路径，不依赖 config 里的别名）
import appIcon from '../../../../public/icon.png'
import createFromOfficialChart from '@shots/create-from-official-chart.png'
import curveTool from '@shots/curve-tool.gif'
import placeSlide from '@shots/place-slide.gif'
import projectDetail from '@shots/project-detail.png'
import projectHub from '@shots/project-hub.png'
import sheetExport from '@shots/sheet-export.png'
import simulation from '@shots/simulation.png'
import staticPreview from '@shots/static-preview.png'
import workspace from '@shots/workspace.png'

interface Slide {
  src: string
  alt: string
  caption: string
  width: number
  height: number
}

interface CarouselState {
  pos: number
  animate: boolean
  busy: boolean
}

const root = ref<HTMLElement | null>(null)
const heroSection = ref<HTMLElement | null>(null)
const playhead = ref<HTMLElement | null>(null)
const heroFigure = ref<HTMLElement | null>(null)
const card01Track = ref<HTMLElement | null>(null)
const card03Track = ref<HTMLElement | null>(null)

/** 语言：跟随原型的中 / EN 切换，localStorage 记忆。 */
const storageKey = 'aao-lang'
const locale = ref<Locale>('zh-CN')
const t = computed(() => COPY[locale.value])

function setLocale(next: Locale) {
  locale.value = next
}

const car01Slides = computed<Slide[]>(() => [
  {
    src: createFromOfficialChart,
    alt: t.value.altOfficialChart,
    caption: t.value.cap01Shot1Cap,
    width: 1920,
    height: 1001,
  },
  {
    src: projectDetail,
    alt: t.value.altProjectDetail,
    caption: t.value.cap01Shot2Cap,
    width: 1920,
    height: 1001,
  },
  {
    src: projectHub,
    alt: t.value.altProjectHub,
    caption: t.value.cap01Shot3Cap,
    width: 1920,
    height: 1001,
  },
])

const car03Slides = computed<Slide[]>(() => [
  {
    src: staticPreview,
    alt: t.value.altStaticPreview,
    caption: t.value.cap03Shot1Cap,
    width: 1920,
    height: 1001,
  },
  {
    src: simulation,
    alt: t.value.altSimulation,
    caption: t.value.cap03Shot2Cap,
    width: 1920,
    height: 1001,
  },
  {
    src: sheetExport,
    alt: t.value.altSheetExport,
    caption: t.value.cap03Shot3Cap,
    width: 1006,
    height: 976,
  },
])

/** 首尾各克隆一张 → pos 1..n 是真实张，0 / n+1 是克隆，用于无缝循环。 */
function withClones(slides: Slide[]) {
  if (slides.length < 2) return slides.map((slide) => ({ slide, clone: false }))
  return [
    { slide: slides[slides.length - 1], clone: true },
    ...slides.map((slide) => ({ slide, clone: false })),
    { slide: slides[0], clone: true },
  ]
}

const car01TrackSlides = computed(() => withClones(car01Slides.value))
const car03TrackSlides = computed(() => withClones(car03Slides.value))

const car01 = reactive<CarouselState>({ pos: 1, animate: true, busy: false })
const car03 = reactive<CarouselState>({ pos: 1, animate: true, busy: false })

const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function trackStyle(car: CarouselState) {
  return {
    transform: `translateX(${-car.pos * 100}%)`,
    transition: car.animate ? '' : 'none',
  }
}

function dotIndex(car: CarouselState, total: number) {
  return ((car.pos - 1) % total + total) % total
}

function setPos(car: CarouselState, pos: number, animate: boolean) {
  car.animate = animate
  car.pos = pos
  if (!animate) {
    void nextTick(() => {
      // 关掉过渡后立刻改 transform 不会补间；下一帧再恢复过渡
      requestAnimationFrame(() => {
        car.animate = true
      })
    })
  }
}

function finishWrap(car: CarouselState, total: number) {
  if (car.pos === total + 1) setPos(car, 1, false)
  else if (car.pos === 0) setPos(car, total, false)
  car.busy = false
}

function wrapTo(car: CarouselState, total: number, pos: number) {
  car.busy = true
  setPos(car, pos, true)
  window.setTimeout(() => finishWrap(car, total), 700)
}

function next(car: CarouselState, total: number) {
  if (car.busy) return
  if (car.pos >= total + 1) return setPos(car, 2, true)
  if (car.pos === total) return wrapTo(car, total, total + 1)
  setPos(car, car.pos + 1, true)
}

function prev(car: CarouselState, total: number) {
  if (car.busy) return
  if (car.pos <= 0) return setPos(car, total - 1, true)
  if (car.pos === 1) return wrapTo(car, total, 0)
  setPos(car, car.pos - 1, true)
}

function onTrackEnd(car: CarouselState, total: number, event: TransitionEvent) {
  if (event.propertyName !== 'transform' || !car.busy) return
  finishWrap(car, total)
}

/* ---------- 轮播自动播放：hover / focus 内暂停，离开续播 ---------- */
const timers: Record<'car01' | 'car03', number | null> = { car01: null, car03: null }

function startAuto(key: 'car01' | 'car03', car: CarouselState, total: number) {
  if (reducedMotion) return
  stopAuto(key)
  timers[key] = window.setInterval(() => next(car, total), 5500)
}

function stopAuto(key: 'car01' | 'car03') {
  const timer = timers[key]
  if (timer) window.clearInterval(timer)
  timers[key] = null
}

function manual(key: 'car01' | 'car03', car: CarouselState, total: number, step: 1 | -1) {
  if (step === 1) next(car, total)
  else prev(car, total)
  startAuto(key, car, total)
}

function jumpTo(key: 'car01' | 'car03', car: CarouselState, total: number, index: number) {
  if (car.busy) return
  setPos(car, index + 1, true)
  startAuto(key, car, total)
}

/* ---------- 手势滑动 ---------- */
const pointerStart: Record<'car01' | 'car03', number | null> = { car01: null, car03: null }

function onPointerDown(key: 'car01' | 'car03', event: PointerEvent) {
  pointerStart[key] = event.clientX
}

function onPointerUp(
  key: 'car01' | 'car03',
  car: CarouselState,
  total: number,
  event: PointerEvent
) {
  const start = pointerStart[key]
  pointerStart[key] = null
  if (start === null) return
  const delta = event.clientX - start
  if (delta > 40) manual(key, car, total, -1)
  else if (delta < -40) manual(key, car, total, 1)
}

/* ---------- 灯箱 ---------- */
const lightboxEl = ref<HTMLDialogElement | null>(null)
const lightboxSlide = ref<Slide | null>(null)

function openZoom(slide: Slide) {
  lightboxSlide.value = slide
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

let ioReveal: IntersectionObserver | undefined
let ioEdge: IntersectionObserver | undefined
let ioSpy: IntersectionObserver | undefined

/**
 * playhead 的扫过距离必须取 hero 自己的宽度（原型口径）。
 * 之前取了整页宽度，在宽屏上会多扫出去一截，把页面撑出横向滚动条。
 */
function sizePlayhead() {
  if (playhead.value && heroSection.value) {
    // 减 1px：扫到最右端时留一线，避免亚像素取整把页面撑出 1px 横向滚动
    playhead.value.style.setProperty('--ph-travel', `${Math.max(0, heroSection.value.clientWidth - 1)}px`)
  }
}

function applyLocale(next: Locale) {
  document.documentElement.lang = next === 'en' ? 'en' : 'zh-CN'
  const meta = document.querySelector('meta[name="description"]')
  if (meta) meta.setAttribute('content', COPY[next].docDesc)
  try {
    localStorage.setItem(storageKey, next)
  } catch {
    /* 隐私模式下不可写，忽略 */
  }
}

watch(locale, applyLocale, { immediate: false })

onMounted(() => {
  // 语言：读上次选择
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved === 'en' || saved === 'zh-CN') locale.value = saved
  } catch {
    /* ignore */
  }
  applyLocale(locale.value)

  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })

  sizePlayhead()
  window.addEventListener('resize', sizePlayhead)

  // 滚入显现
  const rootEl = root.value
  if (rootEl) {
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
  }

  // Hero 主图指针微倾斜
  const fine = window.matchMedia('(hover:hover) and (pointer:fine)').matches
  const figure = heroFigure.value
  if (figure && fine && !reducedMotion) {
    figure.addEventListener('pointermove', onFigureMove)
    figure.addEventListener('pointerleave', onFigureLeave)
  }

  startAuto('car01', car01, car01Slides.value.length)
  startAuto('car03', car03, car03Slides.value.length)
})

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

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', sizePlayhead)
  stopAuto('car01')
  stopAuto('car03')
  ioReveal?.disconnect()
  ioEdge?.disconnect()
  ioSpy?.disconnect()
  const figure = heroFigure.value
  if (figure) {
    figure.removeEventListener('pointermove', onFigureMove)
    figure.removeEventListener('pointerleave', onFigureLeave)
  }
})
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
    </header>

    <main id="top">
      <!-- Hero（左文右图） -->
      <section ref="heroSection" class="hero hero-anim">
        <p class="eyebrow">CUSTOM CHART EDITOR</p>
        <div class="hero-grid">
          <div class="hero-copy">
            <h1>
              <span class="hero-lead" v-html="t.heroLead" />
              <span class="hero-main">{{ t.heroMain }}</span>
            </h1>
            <p class="lede">{{ t.heroLede }}</p>
            <div class="cta-row">
              <a
                class="btn btn-primary"
                :href="RELEASES_URL"
                target="_blank"
                rel="noreferrer noopener"
                >{{ t.ctaDownload }}</a
              >
            </div>
            <p class="cta-note">
              <b>{{ t.ctaNoteLabel }}</b><span class="plat">Windows</span><span class="plat">macOS</span
              ><span class="plat">Linux</span>
            </p>
          </div>
          <div class="hero-visual">
            <figure ref="heroFigure" class="shot hero-figure">
              <div class="win" aria-hidden="true"><i /><i /><i /></div>
              <button class="zoom" type="button" @click="openZoom({
                src: projectHub,
                alt: t.altProjectHub,
                caption: t.heroShotCap,
                width: 1920,
                height: 1001,
              })">
                <img :src="projectHub" :alt="t.altProjectHub" width="1920" height="1001" />
                <svg class="zoom-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4H4v5" /><path d="M15 4h5v5" /><path d="M15 20h5v-5" /><path d="M9 20H4v-5" /></svg>
              </button>
              <figcaption>{{ t.heroShotCap }}</figcaption>
            </figure>
          </div>
        </div>
        <div class="scroll-cue" aria-hidden="true">
          <span class="cue-track"><span class="cue-dot" /></span>
          <span class="cue-label">SCROLL</span>
        </div>
        <div ref="playhead" class="playhead" aria-hidden="true" />
      </section>

      <!-- 功能特性 -->
      <section id="features" class="section">
        <div class="section-head reveal">
          <p class="kicker">FEATURES</p>
          <h2 class="section-title">{{ t.featuresTitle }}</h2>
          <p class="section-sub">{{ t.featuresSub }}</p>
        </div>

        <!-- 01 工程管理（含社区互通） -->
        <article class="cap reveal" data-edge>
          <div class="edge-line" aria-hidden="true" />
          <div class="cap-text">
            <p class="cap-num">01 / PROJECT</p>
            <h3>{{ t.cap01Title }}</h3>
            <ul class="cap-list">
              <li v-html="t.cap01b1" />
              <li v-html="t.cap01b2" />
              <li v-html="t.cap01b3" />
            </ul>
          </div>
          <div class="cap-media">
            <div
              class="carousel"
              role="group"
              aria-roledescription="carousel"
              :aria-label="t.carAria"
              @mouseenter="stopAuto('car01')"
              @mouseleave="startAuto('car01', car01, car01Slides.length)"
              @focusin="stopAuto('car01')"
              @focusout="startAuto('car01', car01, car01Slides.length)"
              @pointerdown="onPointerDown('car01', $event)"
              @pointerup="onPointerUp('car01', car01, car01Slides.length, $event)"
            >
              <div class="car-viewport">
                <div
                  ref="card01Track"
                  class="car-track"
                  :style="trackStyle(car01)"
                  @transitionend="onTrackEnd(car01, car01Slides.length, $event)"
                >
                  <figure
                    v-for="(item, index) in car01TrackSlides"
                    :key="`01-${index}`"
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
                    v-for="(slide, index) in car01Slides"
                    :key="`01-dot-${index}`"
                    class="car-dot"
                    :class="{ active: dotIndex(car01, car01Slides.length) === index }"
                    type="button"
                    :aria-label="t[`carDot${index + 1}` as keyof typeof t]"
                    :aria-current="dotIndex(car01, car01Slides.length) === index ? 'true' : 'false'"
                    @click="jumpTo('car01', car01, car01Slides.length, index)"
                  />
                </div>
              </div>
              <button
                class="car-btn car-prev"
                type="button"
                :aria-label="t.carPrevAria"
                @click="manual('car01', car01, car01Slides.length, -1)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
              </button>
              <button
                class="car-btn car-next"
                type="button"
                :aria-label="t.carNextAria"
                @click="manual('car01', car01, car01Slides.length, 1)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
              </button>
            </div>
          </div>
        </article>

        <!-- 02 编辑 -->
        <article class="cap reveal" data-edge>
          <div class="edge-line" aria-hidden="true" />
          <div class="cap-text">
            <p class="cap-num">02 / EDIT</p>
            <h3>{{ t.cap02Title }}</h3>
            <ul class="cap-list">
              <li v-html="t.cap02b1" />
              <li v-html="t.cap02b2" />
              <li v-html="t.cap02b3" />
            </ul>
          </div>
          <div class="cap-media">
            <figure class="shot">
              <div class="win" aria-hidden="true"><i /><i /><i /></div>
              <button class="zoom" type="button" @click="openZoom({
                src: workspace,
                alt: t.altWorkspace,
                caption: t.cap02ShotCap,
                width: 1920,
                height: 1001,
              })">
                <img :src="workspace" :alt="t.altWorkspace" width="1920" height="1001" loading="lazy" />
                <svg class="zoom-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4H4v5" /><path d="M15 4h5v5" /><path d="M15 20h5v-5" /><path d="M9 20H4v-5" /></svg>
              </button>
              <figcaption>{{ t.cap02ShotCap }}</figcaption>
            </figure>
            <div class="shot-row">
              <figure class="shot">
                <div class="win win--demo" aria-hidden="true">
                  <span class="demo-dot" /><span class="demo-label">{{ t.demoLabel }}</span>
                </div>
                <button class="zoom" type="button" @click="openZoom({
                  src: placeSlide,
                  alt: t.altPlaceSlide,
                  caption: t.gif1Cap,
                  width: 1475,
                  height: 652,
                })">
                  <img :src="placeSlide" :alt="t.altPlaceSlide" width="1475" height="652" loading="lazy" />
                  <svg class="zoom-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4H4v5" /><path d="M15 4h5v5" /><path d="M15 20h5v-5" /><path d="M9 20H4v-5" /></svg>
                </button>
                <figcaption>{{ t.gif1Cap }}</figcaption>
              </figure>
              <figure class="shot">
                <div class="win win--demo" aria-hidden="true">
                  <span class="demo-dot" /><span class="demo-label">{{ t.demoLabel }}</span>
                </div>
                <button class="zoom" type="button" @click="openZoom({
                  src: curveTool,
                  alt: t.altCurveTool,
                  caption: t.gif2Cap,
                  width: 1477,
                  height: 652,
                })">
                  <img :src="curveTool" :alt="t.altCurveTool" width="1477" height="652" loading="lazy" />
                  <svg class="zoom-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4H4v5" /><path d="M15 4h5v5" /><path d="M15 20h5v-5" /><path d="M9 20H4v-5" /></svg>
                </button>
                <figcaption>{{ t.gif2Cap }}</figcaption>
              </figure>
            </div>
          </div>
        </article>

        <!-- 03 预览与导出 -->
        <article class="cap cap--soft reveal" data-edge>
          <div class="edge-line" aria-hidden="true" />
          <div class="cap-text">
            <p class="cap-num">03 / PREVIEW &amp; EXPORT</p>
            <h3>{{ t.cap03Title }}</h3>
            <ul class="cap-list">
              <li v-html="t.cap03b1" />
              <li v-html="t.cap03b2" />
              <li v-html="t.cap03b3" />
            </ul>
          </div>
          <div class="cap-media">
            <div
              class="carousel"
              role="group"
              aria-roledescription="carousel"
              :aria-label="t.carAria"
              @mouseenter="stopAuto('car03')"
              @mouseleave="startAuto('car03', car03, car03Slides.length)"
              @focusin="stopAuto('car03')"
              @focusout="startAuto('car03', car03, car03Slides.length)"
              @pointerdown="onPointerDown('car03', $event)"
              @pointerup="onPointerUp('car03', car03, car03Slides.length, $event)"
            >
              <div class="car-viewport">
                <div
                  ref="card03Track"
                  class="car-track"
                  :style="trackStyle(car03)"
                  @transitionend="onTrackEnd(car03, car03Slides.length, $event)"
                >
                  <figure
                    v-for="(item, index) in car03TrackSlides"
                    :key="`03-${index}`"
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
                    v-for="(slide, index) in car03Slides"
                    :key="`03-dot-${index}`"
                    class="car-dot"
                    :class="{ active: dotIndex(car03, car03Slides.length) === index }"
                    type="button"
                    :aria-label="t[`carDot${index + 1}` as keyof typeof t]"
                    :aria-current="dotIndex(car03, car03Slides.length) === index ? 'true' : 'false'"
                    @click="jumpTo('car03', car03, car03Slides.length, index)"
                  />
                </div>
              </div>
              <button
                class="car-btn car-prev"
                type="button"
                :aria-label="t.carPrevAria"
                @click="manual('car03', car03, car03Slides.length, -1)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
              </button>
              <button
                class="car-btn car-next"
                type="button"
                :aria-label="t.carNextAria"
                @click="manual('car03', car03, car03Slides.length, 1)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
              </button>
            </div>
          </div>
        </article>
      </section>

      <!-- 本地优先 -->
      <div class="trust" data-edge>
        <div class="edge-line" aria-hidden="true" />
        <div class="trust-inner stagger">
          <dl>
            <dt>
              <span class="ic-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="12" width="18" height="8" rx="2" /><path d="M6 12.2 7.6 6.8A2 2 0 0 1 9.5 5.5h5a2 2 0 0 1 1.9 1.3l1.6 5.4" /><circle cx="16.5" cy="16" r="1" fill="currentColor" stroke="none" /></svg></span>LOCAL-FIRST
            </dt>
            <dd>{{ t.trustLocalD }}</dd>
          </dl>
          <dl>
            <dt>
              <span class="ic-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18a4 4 0 0 1 .5-8 5.5 5.5 0 0 1 10-3 3.5 3.5 0 0 1-.5 11Z" /><path d="M4.5 4.5 19.5 19.5" /></svg></span>NO TELEMETRY
            </dt>
            <dd>{{ t.trustNoTelD }}</dd>
          </dl>
          <dl>
            <dt>
              <span class="ic-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h13" /><path d="m14 5 3 3-3 3" /><path d="M20 16H7" /><path d="m10 13-3 3 3 3" /></svg></span>PORTABLE
            </dt>
            <dd>{{ t.trustPortD }}</dd>
          </dl>
        </div>
      </div>

      <!-- 下载 -->
      <section id="download" class="section" data-edge>
        <div class="edge-line" aria-hidden="true" />
        <div class="section-head reveal">
          <p class="kicker">DOWNLOAD</p>
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
