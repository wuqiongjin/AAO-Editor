// 开场的**信息项**（chart-preview 30）：声明式列表 —— 未来加项 = 加一个 id + 默认值 + 文案 + 一处绘制。
//
// 与长图头带那 7 个「信息区字段」**互不跟随**（那是谱面统计信息，这是歌曲信息）。
// id 与默认值表的唯一定义处是 `AppSettings`（`OPENING_ITEM_IDS` / `DEFAULT_OPENING_ITEMS`）——
// 口径同长图那边的 `EXPORT_FIELD_KEYS`：设置形状归设置，域这一层只消费 + 提供"有序 / 归一化"两个助手。
import {
  DEFAULT_OPENING_ITEMS,
  OPENING_ITEM_IDS,
  type OpeningItemId,
} from '../../../chart/config/AppSettings';

export { OPENING_ITEM_IDS, DEFAULT_OPENING_ITEMS };
export type { OpeningItemId };

/** 有序的"实际画哪些项"：空项不占位（整块按画出的项重新垂直居中） */
export function openingItemOrder(items: Record<OpeningItemId, boolean>): OpeningItemId[] {
  return OPENING_ITEM_IDS.filter((id) => items[id] !== false);
}

// 归一化**只有 `AppSettings.normalizeOpening` 一份**：段内浅合并 + 缺字段回落 true 都是设置的
// 事，域这一层再写一份就会两处各漂（`updateSettings` 的浅合并已经在 `mergeOpening` 里处理）。
