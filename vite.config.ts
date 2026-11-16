import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // 重要：设置为相对路径，这样Electron可以正确加载资源
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
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
    // 云原生/代理环境下，若刷新后出现无限转圈（多为 HMR WebSocket 被代理拦截），
    // 可设置 DISABLE_HMR=1 关闭热更新，页面则始终通过普通 HTTP 刷新，绝不再挂起。
    hmr: process.env.DISABLE_HMR === '1' ? false : undefined,
    // 容器内保留轮询以避开 inotify 问题；Windows 本地用原生事件。
    // 素材和诊断文件很多，Windows 全树轮询即使空闲也会占满多个 CPU 核，干扰播放。
    watch: {
      usePolling: process.platform !== 'win32',
      ignored: ['**/.scratch/**']
    }
  }
})
