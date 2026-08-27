// 背景皮肤订阅 hook（issue 29 Q4）：useSyncExternalStore 桥接 backgroundSkinStore 快照。
// 独立成文件以保持 utils/backgroundSkin.ts 的纯逻辑可在 node 测试环境无 React 依赖复用（react 本体可导入，
// 但保持数据层零 UI 关系更干净）。
import { useSyncExternalStore, useEffect } from 'react';
import { backgroundSkinStore, type BackgroundSkinSnapshot } from './backgroundSkin';

export function useBackgroundSkin(): BackgroundSkinSnapshot {
  useEffect(() => {
    // 首个消费者挂载即懒装载 IndexedDB 里的图；幂等
    void backgroundSkinStore.ensureLoaded();
  }, []);
  return useSyncExternalStore(backgroundSkinStore.subscribe, backgroundSkinStore.getSnapshot);
}
