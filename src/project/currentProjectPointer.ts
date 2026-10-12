// 当前工程指针（chart-projects 20 定案 / ADR-0015 §3 修订）：
// 「当前工程」跨刷新存活——`{ projectId, chartId }` 落在本机独立存储，启动即恢复。
//
// 为什么不进设置对象：设置对象会随「配置导入 / 导出」搬家，而指针指向的是**这台机器上的**工程 id；
// 也不属于 `curve` 那种"我的习惯"型可迁移配置。故单开一个键。
//
// 一切读失败（无存储 / 无值 / JSON 坏 / 字段缺）都静默回 null：指针只是"上次去过哪"，
// 读不到就回落既有规则（最近未完成 → 新建未命名），不把启动卡住。

export interface CurrentProjectPointer {
  projectId: string;
  chartId: string | null;
}

export const CURRENT_PROJECT_POINTER_KEY = 'aao.currentProject.v1';

export type PointerStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): PointerStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadCurrentProjectPointer(
  storage: PointerStorage | null = defaultStorage(),
): CurrentProjectPointer | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(CURRENT_PROJECT_POINTER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { projectId?: unknown; chartId?: unknown } | null;
    if (!parsed || typeof parsed.projectId !== 'string' || parsed.projectId === '') return null;
    return {
      projectId: parsed.projectId,
      chartId: typeof parsed.chartId === 'string' && parsed.chartId !== '' ? parsed.chartId : null,
    };
  } catch {
    return null;
  }
}

export function saveCurrentProjectPointer(
  pointer: CurrentProjectPointer,
  storage: PointerStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(CURRENT_PROJECT_POINTER_KEY, JSON.stringify({
      projectId: pointer.projectId,
      chartId: pointer.chartId ?? null,
    }));
  } catch {
    // 写失败不影响会话：下次启动只是回落"最近未完成"
  }
}

export function clearCurrentProjectPointer(storage: PointerStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(CURRENT_PROJECT_POINTER_KEY);
  } catch {
    // 同上
  }
}
