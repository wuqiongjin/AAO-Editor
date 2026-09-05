import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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