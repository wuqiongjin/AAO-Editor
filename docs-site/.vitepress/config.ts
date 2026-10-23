import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitepress'
import type { Connect } from 'vite'
import { REPO_URL } from './links'

/**
 * 站点部署路径。
 *
 * GitHub Pages 项目站挂在 `https://<user>.github.io/AAO-Editor/`，故默认 `/AAO-Editor/`；
 * 迁自定义域名或 Cloudflare Pages（根域）时用 `DOCS_BASE=/` 覆盖，构建脚本无需改动。
 */
const base = (() => {
  const raw = process.env.DOCS_BASE?.trim()
  if (!raw) return '/AAO-Editor/'
  return raw.endsWith('/') ? raw : `${raw}/`
})()

/**
 * `/AAO-Editor` → 302 → `/AAO-Editor/`（保留 query / hash）。
 * base 为 `/`（自定义域名、根域托管）时没有可补的东西，直接放行。
 */
const bareBase = base.endsWith('/') ? base.slice(0, -1) : base

const baseRedirect: Connect.NextHandleFunction = (req, res, next) => {
  const url = req.url ?? ''
  // base 是 `/` 时没有可补的斜杠，直接放行
  if (!bareBase) {
    next()
    return
  }
  const isBare =
    url === bareBase || url.startsWith(`${bareBase}?`) || url.startsWith(`${bareBase}#`)
  if (!isBare) {
    next()
    return
  }
  res.statusCode = 302
  res.setHeader('Location', `${base}${url.slice(bareBase.length)}`)
  res.end()
}

const DOCS_ROOT = fileURLToPath(new URL('..', import.meta.url))
const APP_FAVICON = fileURLToPath(new URL('../../public/favicon.ico', import.meta.url))
const PUBLIC_FAVICON = resolve(DOCS_ROOT, 'public/favicon.ico')

/**
 * 站点图标复用 app 的 `/public/favicon.ico`。
 * favicon 在 `<head>` 里必须是一个稳定 URL，走不了 Vite 的资源 import（config 也不在 Vite 管线里），
 * 所以这里在 dev 启动 / 构建收尾时把它复制进 `public/`（该文件不进仓库，已在 .gitignore 里）。
 */
let faviconOutDir = ''

function syncFavicon(outDir?: string) {
  if (!existsSync(APP_FAVICON)) return
  mkdirSync(resolve(DOCS_ROOT, 'public'), { recursive: true })
  copyFileSync(APP_FAVICON, PUBLIC_FAVICON)
  if (outDir) copyFileSync(APP_FAVICON, resolve(outDir, 'favicon.ico'))
}

export default defineConfig({
  base,
  lang: 'zh-CN',
  /**
   * 图片直接复用仓库里的 `docs/media/readme/`（README 同源），不在站点目录再存一份：
   * `@shots/xxx.png` 由 Vite 构建时读取并按 base 输出。
   */
  vite: {
    resolve: {
      alias: {
        '@shots': fileURLToPath(new URL('../../docs/media/readme', import.meta.url)),
      },
    },
    plugins: [
      {
        name: 'aao:shared-favicon',
        configResolved(config) {
          faviconOutDir = resolve(config.root, config.build.outDir)
        },
        configureServer() {
          syncFavicon()
        },
        buildStart() {
          syncFavicon()
        },
        closeBundle() {
          syncFavicon(faviconOutDir)
        },
      },
      /**
       * 把「不带尾斜杠的 base」补成规范地址。
       *
       * VitePress 会把 `/` 重定向到 base（`/AAO-Editor/`），却对 `/AAO-Editor` 直接 404——
       * 同一个目标两种态度。静态托管（GitHub Pages / Cloudflare Pages）都会自动补斜杠，
       * 所以这只是开发 / 预览服务器的短板，但预览链接走的就是它。
       * 这里 302 到带斜杠的地址，而不是就地返回 index.html：就地返回会让页面里的
       * 相对资源按 `/AAO-Editor/xxx` 之外的基准去找，资源全 404。
       */
      {
        name: 'aao:base-trailing-slash',
        configureServer(server) {
          server.middlewares.use(baseRedirect)
        },
        configurePreviewServer(server) {
          server.middlewares.use(baseRedirect)
        },
      },
    ],
    server: {
      // CNB 容器里必须监听 0.0.0.0 且放行代理 Host，否则外部访问是 connection refused。
      host: true,
      allowedHosts: true,
      fs: {
        allow: ['..', '../..'],
      },
      hmr: process.env.DISABLE_HMR === '1' ? false : undefined,
    },
  },
  title: 'AAO Editor',
  titleTemplate: ':title · AAO Editor',
  description:
    'AAO Editor 是一款为 BanG Dream! 自制谱作者打造的桌面级谱面编辑器：工程管理、谱面编辑、预览导出与 Bestdori 社区互通都在一个应用里完成。',
  head: [
    ['link', { rel: 'icon', href: `${base}favicon.ico` }],
    // 浏览器 UI 底色跟着系统走；页面外观由 dark 类决定（见 theme/style.css）
    ['meta', { name: 'theme-color', media: '(prefers-color-scheme: dark)', content: '#0c0e11' }],
    ['meta', { name: 'theme-color', media: '(prefers-color-scheme: light)', content: '#f7f8fa' }],
  ],
  /**
   * 默认深色（品牌调性），但允许用户切到亮色：落地页顶栏与文档导航右侧都带开关，
   * 两边共用 `vitepress-theme-appearance` 这个存储键，切换后全站一致。
   */
  appearance: 'dark',
  locales: {
    root: { label: '简体中文', lang: 'zh-CN' },
    // i18n 结构预留（本票只留结构，不填英文正文）：
    // 1) 建 `docs-site/en/`（index.md + guide/*.md 镜像）；落地页的中 / EN 两套文案都在
    //    `theme/landingCopy.ts`，由顶栏的语言开关真切换，不靠 VitePress 的 locale 路由；
    // 2) 取消下面注释，英文导航 / 侧边栏 / 页脚与 root 各自成树。
    // en: {
    //   label: 'English',
    //   lang: 'en',
    //   link: '/en/',
    //   themeConfig: {
    //     nav: [
    //       { text: 'Guide', link: '/en/guide/', activeMatch: '^/en/guide/' },
    //       { text: 'Features', link: '/en/#features' },
    //       { text: 'Download', link: '/en/#download' },
    //       { text: 'GitHub', link: REPO_URL },
    //     ],
    //     sidebar: {
    //       '/en/guide/': [
    //         {
    //           text: 'Getting started',
    //           items: [
    //             { text: 'Install', link: '/en/guide/install' },
    //             { text: 'Quick start', link: '/en/guide/getting-started' },
    //           ],
    //         },
    //       ],
    //     },
    //   },
    // },
  },
  themeConfig: {
    nav: [
      { text: '指南', link: '/guide/', activeMatch: '^/guide/' },
      { text: '功能特性', link: '/#features' },
      { text: '下载', link: '/#download' },
      { text: 'GitHub', link: REPO_URL },
    ],
    sidebar: {
      '/guide/': [
        {
          text: '开始使用',
          items: [
            { text: '安装', link: '/guide/install' },
            { text: '快速上手', link: '/guide/getting-started' },
          ],
        },
        {
          text: '使用指南',
          items: [
            { text: '功能指南', link: '/guide/features' },
            { text: '浏览器版与桌面版的差异', link: '/guide/browser-demo' },
          ],
        },
        {
          text: '帮助',
          items: [
            { text: '常见问题', link: '/guide/faq' },
            { text: '排障', link: '/guide/troubleshooting' },
          ],
        },
        {
          text: '关于',
          items: [{ text: '免责与版权', link: '/guide/legal' }],
        },
      ],
    },
    search: { provider: 'local' },
    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一页', next: '下一页' },
    sidebarMenuLabel: '目录',
    returnToTopLabel: '回到顶部',
    socialLinks: [{ icon: 'github', link: REPO_URL }],
    footer: {
      message: '非营利粉丝自制工具，与 Bushiroad、Craft Egg 及 BanG Dream! 项目官方无任何关联。',
      copyright: '代码以 MIT 许可发布 · © 2026 AAO Editor',
    },
  },
})
