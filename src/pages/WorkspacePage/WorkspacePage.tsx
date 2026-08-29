// WorkspacePage 路由壳（issue 48 整改）：
// 工作台页 = 路由壳 + lazy 装入 src/chart/Editor。
// 工作台实现的所有逻辑（含工具栏、面板、播放协调、快捷键）都封在 Editor 内，
// 路由壳只负责「lazy + Suspense」两件事。
import { lazy, Suspense } from 'react';

const Editor = lazy(() => import('../../chart/Editor'));

export function WorkspacePage() {
  return (
    <Suspense fallback={null}>
      <Editor />
    </Suspense>
  );
}
