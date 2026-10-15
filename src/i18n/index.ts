export {
  UI_LANGUAGES, isUiLanguage, detectOsLanguageTag, mapOsLanguageTag, resolveUiLanguage,
  type UiLanguage,
} from './resolveUiLanguage';
export {
  t, tFor, tPlural, tPluralFor, lookupMessage, interpolate,
  getActiveUiLanguage, setActiveUiLanguage,
  DICTS, PLURAL_TAGS,
  type MessageKey, type MessageVars,
} from './t';
