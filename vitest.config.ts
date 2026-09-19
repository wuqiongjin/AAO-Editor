import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `@` = 仓库根。测试一律用 `@/src/...` / `@/electron/...` 引用被测代码，
// 这样 tests 内部再怎么按领域分层、加目录，都不用改相对路径。
const repoRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': repoRoot },
  },
  test: {
    globals: true,
    environment: 'node',
    // support/ 只放测试基建（无 .test.ts），不参与收集；
    // 新增大类目录（如 tests/e2e）需在此显式登记才会进入默认全量跑。
    include: ['tests/{unit,platform,static,perf}/**/*.test.ts'],
  },
});
