/**
 * 产品对外的地址（票 18）：关于页四行入口与导航作者块共用这一份。
 *
 * 为什么集中：地址是**会变的事实**（站点迁 Cloudflare、仓库换组织），散在页面里就是一次改五处。
 * 与 `community/bestdori/endpoints.ts` 同一条纪律 —— 域名只住一处。
 *
 * 主进程还有一份"镜像"（`electron/externalLink.cjs` 的 `PRODUCT_HOSTS`）：那边只认主机名，
 * 因为它要做的是**放行判定**，不关心路径。改域名要两边一起改，`tests/static/ProductLinksWiring`
 * 会拦。
 */
export const PRODUCT_LINKS = {
  /** 产品落地页（文档站首页，`docs-site/index.md` 带 `landing: true`） */
  home: 'https://wuqiongjin.github.io/AAO-Editor/',
  /** 使用文档（安装 / 常见问题 / 故障排查那一区） */
  guide: 'https://wuqiongjin.github.io/AAO-Editor/guide/',
  /** 源码与 Release 所在仓库 */
  repository: 'https://github.com/wuqiongjin/AAO-Editor',
  /** 问题反馈（Issue 列表） */
  issues: 'https://github.com/wuqiongjin/AAO-Editor/issues',
  /** 作者个人主页（导航作者块的落点） */
  author: 'https://github.com/wuqiongjin',
} as const;

/** 作者署名（与仓库 owner、Release 署名一致；只这一处） */
export const AUTHOR_NAME = 'wuqiongjin';

/**
 * 去掉协议与末尾斜杠：tooltip 里给人看的短形。
 * 正文永远不出现 `https://`（票 18 Q2）—— 长地址在行内会把版面撑散。
 */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}
