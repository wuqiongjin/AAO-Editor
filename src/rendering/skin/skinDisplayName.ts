// 皮肤显示名解析（issue 49 · ADR-0018 §6 分层命名：官方命名 API > 社区 fallback > 包 ID）。
// 前两级由取件侧随 gen 注册表产进快照（entry 的 skinName 五服原样 [jp,en,tw,cn,kr]；
// 无官方名的主题包由取件侧按社区清洗规则填同值 fallback），这里只按界面语言选服。
//
// 显示名不进 i18n 消息表——官方名是名称不是文案。例外见 pickBackgroundSkinName：
// 官方背景名不出本地化条目，那 6 个包只能手写。
import { DICTS, getActiveUiLanguage, type UiLanguage } from '../../i18n';

/**
 * 选服顺序 = 五服槽位 [jp,en,tw,cn,kr] 的下标。新增界面语言在此加一项——
 * Record<UiLanguage, …> 漏加编译红（照 i18n PLURAL_TAGS 的数据驱动口径）。
 */
const SERVER_ORDER: Record<UiLanguage, readonly number[]> = {
  'zh-CN': [3, 1, 0],
  en: [1, 0],
};

/**
 * 不可用的条目：非字符串（API 实给过 null）/ 空串 / 纯空白 / 含 NBSP 的变体。
 * NBSP 肉眼与普通空格无异但会带进不可见空格、影响检索排版（skin09 的 cn 条目实测如此）。
 */
function isUsableName(name: unknown): name is string {
  return typeof name === 'string' && name.trim() !== '' && !name.includes('\u00A0');
}

/** 五服命名里按界面语言挑一个；全不可用 / 无映射 → fallback（null = 明说"没有名"，回落什么由调用方定） */
export function pickSkinName(
  skinName: readonly (string | null)[] | undefined,
  locale: UiLanguage,
  fallback: string | null,
): string | null {
  if (skinName) {
    for (const server of SERVER_ORDER[locale]) {
      const name = skinName[server];
      if (isUsableName(name)) return name;
    }
  }
  return fallback;
}

/**
 * gen 注册表 entry 的可选 skinName（issue 49 契约）。gen 文件由取件侧产出、类型随快照
 * 版本走（升级前没有该字段），故按未知形状防御性读取：缺字段 / 脏值 → undefined。
 */
export function readPackSkinName(entry: unknown): readonly (string | null)[] | undefined {
  const raw = (entry as { skinName?: unknown } | null | undefined)?.skinName;
  return Array.isArray(raw) ? (raw as (string | null)[]) : undefined;
}

/** pack 类 entry 的显示名；快照未带 skinName → fallback（现 label / 包 ID） */
export function packDisplayName(entry: unknown, fallback: string): string {
  return pickSkinName(readPackSkinName(entry), getActiveUiLanguage(), fallback) ?? fallback;
}

/**
 * 背景包的显示名：官方背景名五服同值日文、不出本地化条目，不能拿日文给用户看 →
 * 6 个官方背景包的 zh/en 名进 i18n 消息表 preview.display.bgName.*（照键音先例：
 * 无 API 本地化只能手写）。官方将来真本地化（当前语言槽异于 jp 槽）时以官方为准；
 * 无官方名的主题包仍社区 fallback。
 */
export function pickBackgroundSkinName(
  id: string,
  skinName: readonly (string | null)[] | undefined,
  fallback: string,
): string {
  const locale = getActiveUiLanguage();
  const picked = pickSkinName(skinName, locale, null);
  if (picked !== null && picked !== (skinName?.[0] ?? null)) return picked;
  // 直接查 DICTS：缺 key 是正常路径（多数背景包没有消息），不走会告警的 lookupMessage
  const localized = DICTS[locale][`preview.display.bgName.${id}`];
  return localized ?? picked ?? fallback;
}
