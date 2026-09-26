import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // 本仓约定：Provider 文件同时导出组件、Context 与 useXxx hook（ADR-0003 §7 上下文分域）。
      // 这条规则要求"只导出组件"才能保住 Fast Refresh，与本约定冲突，故降级为警告：
      // 热更新时可能丢 Context 状态，属开发体验损失，不该阻断构建。
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // 测试专用豁免：node 环境下没有 DOM / Canvas / Storage，测试替身大量依赖
    // `as unknown as X` 与结构性 any（假 2d context、假位图、强穿透的类型断言）。
    // 收窄类型只会让替身更难写，这里放开 any；其余规则照常生效。
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
])
