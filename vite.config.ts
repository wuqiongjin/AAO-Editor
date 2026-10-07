import { createReadStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, extname, resolve, sep } from 'node:path';
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 云原生/代理环境下，若刷新后出现无限转圈（多为 HMR WebSocket 被代理拦截），
  // 可设置 DISABLE_HMR=1 关闭热更新，页面则始终通过普通 HTTP 刷新，绝不再挂起。
  const disableHmr = process.env.DISABLE_HMR === '1';
  // 发布主应用：`npm run build:release` / `electron:build` 走 --mode release，
  // 只打 index.html，不把 sprite-locator 独立工具打进发行包。
  const isRelease = mode === 'release';
  const input = isRelease
    ? ({ main: 'index.html' } as Record<string, string>)
    : ({ main: 'index.html', 'sprite-locator': 'tools/sprite-locator.html' } as Record<string, string>);

  return {
    plugins: [
      react(),
      {
        // 把 `tools/sprite-locator.html` 在两个阶段都暴露成公开的 `/sprite-locator.html`：
        //   - dev  ：`configureServer` 把 URL 重写到源文件位置。
        //   - build：`closeBundle` 把 Vite 产出的 `dist/tools/sprite-locator.html` 移到 `dist/sprite-locator.html`，
        //            原因：Vite/Rollup 按 input 源路径保留目录结构，导致产物落到 `dist/tools/`，但
        //            `dev.sh` / 团队 / 旧 `dist/sprite-locator.html` 链接 / electron 发行包都按 `dist/` 平铺引用。
        // 构建产物的 key 仍是 `sprite-locator`（与原 `rollupOptions.input` 一致），不破坏其他消费方。
        name: 'sprite-locator-relocate',
        configureServer(server) {
          server.middlewares.use((req, _res, next) => {
            if (req.url === '/sprite-locator.html') {
              req.url = '/tools/sprite-locator.html';
            }
            next();
          });
        },
        closeBundle() {
          // release 模式不打 sprite-locator，跳过
          if (isRelease) return;
          const src = resolve(process.cwd(), 'dist/tools/sprite-locator.html');
          const dest = resolve(process.cwd(), 'dist/sprite-locator.html');
          if (!existsSync(src)) return;
          mkdirSync(dirname(dest), { recursive: true });
          if (existsSync(dest)) rmSync(dest);
          renameSync(src, dest);
          // 顺便把空了的 dist/tools/ 目录清掉（保留 src/tools/）；并发场景下读目录可能撞到 ENOENT，吞掉
          const toolsDir = resolve(process.cwd(), 'dist/tools');
          try {
            if (existsSync(toolsDir) && readdirSync(toolsDir).length === 0) {
              rmSync(toolsDir, { recursive: true, force: true });
            }
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
          }
        },
      },
      {
        // chart-preview 04 · 仿真场素材的**开发期直读通道**（ADR-0016 §6）：
        // 归档产物（`docs/resource/bestdori/`，不入 git、不进安装包）由归档脚本生成，
        // 本插件只在 dev（apply: 'serve'）把它挂在 `/__bestdori-assets/` 前缀下；
        // 生产构建没有这条通道 —— 没跑过归档脚本的机器上，仿真场给空态 + 获取命令。
        name: 'bestdori-preview-assets',
        apply: 'serve',
        configureServer(server) {
          const root = resolve(process.cwd(), 'docs/resource/bestdori');
          const prefix = '/__bestdori-assets/';
          const prefixBase = prefix.slice(0, -1);
          const mime: Record<string, string> = {
            '.png': 'image/png',
            '.mp3': 'audio/mpeg',
            '.json': 'application/json',
          };
          server.middlewares.use((req, res, next) => {
            const pathname = (req.url ?? '').split('?')[0];
            // 裸前缀（无尾斜杠）也归本通道：走下面的目录判定给 404，不落 SPA 回退页冒充 200
            if (pathname !== prefixBase && !pathname.startsWith(prefix)) return next();
            if (req.method !== 'GET' && req.method !== 'HEAD') {
              res.statusCode = 405;
              res.end('Method Not Allowed');
              return;
            }
            let rel: string;
            try {
              rel = decodeURIComponent(pathname === prefixBase ? '' : pathname.slice(prefix.length));
            } catch {
              res.statusCode = 400;
              res.end('Bad Request');
              return;
            }
            // 只允许落在归档目录内（挡 `..` / 绝对路径越界）
            const abs = resolve(root, rel);
            if (abs !== root && !abs.startsWith(root + sep)) {
              res.statusCode = 403;
              res.end('Forbidden');
              return;
            }
            let stat;
            try {
              stat = statSync(abs);
            } catch {
              stat = null;
            }
            if (stat === null || !stat.isFile()) {
              res.statusCode = 404;
              res.end(`missing: ${rel}`);
              return;
            }
            // `.sprites` = Unity SpriteAtlas 序列化 JSON（同 build-note-skins.mjs 的解析口径）；
            // 它是不带扩展名的点文件（extname 返回空），得按名字单独认
            const contentType =
              basename(abs) === '.sprites'
                ? 'application/json'
                : mime[extname(abs).toLowerCase()] ?? 'application/octet-stream';
            res.setHeader('content-type', contentType);
            res.setHeader('content-length', stat.size);
            // 重新归档后同一 URL 内容会变，dev 下不要缓存
            res.setHeader('cache-control', 'no-store');
            if (req.method === 'HEAD') {
              res.end();
              return;
            }
            // 文件在 stat 之后被移走 / 权限变化：接住流错误，别让未处理的 'error' 掀掉 dev server
            const stream = createReadStream(abs);
            stream.on('error', () => {
              if (!res.headersSent) {
                res.statusCode = 500;
                res.end('Internal Server Error');
              } else {
                res.destroy();
              }
            });
            stream.pipe(res);
          });
        },
      },
    ],
    base: './', // 重要：设置为相对路径，这样Electron可以正确加载资源
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      rollupOptions: {
        input,
      },
    },
    server: {
      // 绑定 0.0.0.0，让云环境的端口转发 / 代理能访问到
      host: true,
      // 端口可通过 DEV_PORT 环境变量覆盖（默认 5173）；scripts/dev.sh 会处理
      // 占用的进程并打印对外访问地址。
      port: Number(process.env.DEV_PORT) || 5173,
      strictPort: true,
      // 允许代理域名作为 Host 头，避免 Vite 默认拦截导致刷新被拒/挂起
      allowedHosts: true as const,
      hmr: disableHmr ? false : undefined,
      // 容器内 inotify 文件监听常出问题（触发请求挂起/无限转圈），改用轮询
      watch: {
        usePolling: true
      }
    }
  }
})