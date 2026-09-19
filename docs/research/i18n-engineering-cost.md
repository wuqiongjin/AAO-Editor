# i18n engineering cost notes

Carrier: [issue 122](../../.scratch/basic-editor/issues/122-多语言硬编码字符串盘点.md).

Type: research (cost comparison only)  
Date: 2026-09-19  
Product conclusion (start now / never): **out of scope**. This note compares engineering cost, not whether the product should ship i18n.

Stack in this repo: Vite 7 + React 19 + TypeScript 5.8 + Electron 38 + electron-builder (`package.json`). Renderer strings are currently hardcoded; `index.html` has `<html lang="en">`; main process calls `Menu.setApplicationMenu(null)`. Data root defaults under Electron `userData` (`electron/dataRoot.cjs`). **electron-updater is not a dependency today.**

Sources are official docs / specs / npm package metadata unless marked as this repo.

---

## 1. Can we skip an i18n framework?

**Yes.** Nothing in Vite, React, TypeScript, or Electron requires i18next (or similar).

- Vite can import JSON dictionaries and statically replace constants at build time ([Vite JSON](https://vite.dev/guide/features.html#json), [Vite env/modes](https://vite.dev/guide/env-and-mode), [Vite `define`](https://vite.dev/config/shared-options.html#define)).
- Dates/numbers/plurals can go through the ECMA-402 `Intl` APIs without a translation library ([MDN `Intl`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl)).
- HTML language and base direction are document attributes (`lang`, `dir`), not a JS framework ([MDN `lang`](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/lang), [MDN `dir`](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/dir)).
- Native menus are built with `Menu.buildFromTemplate` / `Menu.setApplicationMenu`; labels are strings you supply, or inherited from a `role` ([Electron Menu](https://www.electronjs.org/docs/latest/api/menu), [Electron menus / roles](https://www.electronjs.org/docs/latest/tutorial/menus)).

Skipping a framework means **you own** interpolation, plural category keys, missing-key policy, React re-render on language change, and keeping main-process menus in sync. Those capabilities exist in i18next / react-i18next as documented APIs (sections below). They are not free in a hand-rolled `Record` unless you reimplement them.

---

## 2. Three approaches: what you pay for

### (A) Hand-rolled dictionary + `t()`

**Shape:** `Record<Locale, Record<Key, string>>` (or per-locale JSON), plus a lookup helper. TypeScript `Record<Keys, Type>` is the language feature for “keys → values” ([TypeScript `Record`](https://www.typescriptlang.org/docs/handbook/utility-types.html)).

**One-time plumbing (first foreign language):**

| Work | Cost character |
| --- | --- |
| Extract every user-visible string to keys | Dominates; independent of library |
| `t(key, vars?)` + React context/state so UI re-renders | Small if interpolation is `replace`/`{{name}}` only |
| Set `document.documentElement.lang` (and `dir` if ever RTL) | Small; required for a11y regardless of library ([WCAG via MDN `lang`](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/lang)) |
| Electron: rebuild menu template and `Menu.setApplicationMenu` on language change (if a native menu exists) | Medium; Electron does not translate custom `label`s. `role` items default label/accelerator per platform ([roles](https://www.electronjs.org/docs/latest/tutorial/menus)) |
| Font stack fallbacks | Small–medium ([CSS `font-family` per-character fallback](https://developer.mozilla.org/en-US/docs/Web/CSS/font-family)) |
| `Intl.DateTimeFormat` / `NumberFormat` with the active locale | Small; orthogonal to the dict ([MDN `Intl`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl)) |

**Hot switch vs restart:** A dict in memory + React state can switch without process restart. Native Chromium/Electron locale (`app.getLocale()`, `--lang`) is a **startup** concern: `app.getLocale()` is Chromium `l10n_util`; setting locale is a command-line switch at startup; packaged apps must ship the `locales` folder ([Electron `app.getLocale`](https://www.electronjs.org/docs/latest/api/app), [Electron `--lang`](https://www.electronjs.org/docs/latest/api/command-line-switches)). UI strings and Chromium chrome (spellcheck, default menus if you stop passing `null`) can therefore disagree unless you also pass `--lang` and restart.

**Missing keys:** You implement policy (`key` as fallback, throw in dev, test that locale objects share `keyof`). There is no `saveMissing` / `missingKey` event unless you write it.

**TypeScript keys:** `keyof typeof en` (or a shared `as const` catalog) types keys without a framework. Interpolation *variable* names are not inferred from the string unless you add extra types.

### (B) Two language-specific Electron/web builds

**Shape:** `vite build --mode ja` (or `VITE_LOCALE=ja`) so only one catalog is bundled; electron-builder emits `BangDream Editor (ja)` vs `(en)` (or two `appId`s).

Vite modes load `.env.[mode]` and expose `import.meta.env`; `define` statically replaces globals so unused locales can be tree-shaken ([Vite env and modes](https://vite.dev/guide/env-and-mode), [Vite `define`](https://vite.dev/config/shared-options.html#define)). HTML `%VITE_*%` replacement can bake `<html lang>` at build time ([same Vite env page](https://vite.dev/guide/env-and-mode)).

**Cost vs (A)/(C):**

- **No runtime language switch** without installing the other package (or shipping a second asar). Chromium `--lang` still needs a restart ([`--lang`](https://www.electronjs.org/docs/latest/api/command-line-switches)).
- **CI/release matrix doubles** (and triples with a third language): two NSIS/AppImage/dmg artifacts per version.
- **Does not remove** extraction of strings, font, `lang`/`dir`, or native-menu work. It only removes runtime catalog switching and the need to ship N JSON blobs in one asar.
- **Updater / settings / charts:** see §6. This is the expensive part of (B), not the Vite flag.

### (C) i18next + react-i18next (or i18next-icu)

**One-time plumbing:**

| Piece | Official behavior |
| --- | --- |
| Init + resources | Bundle on `init`, `addResourceBundle`, HTTP/fs backend, or Vite-style `import()` via `i18next-resources-to-backend` ([Add or load translations](https://www.i18next.com/how-to/add-or-load-translations)) |
| React | `useTranslation()` returns `t` and `i18n`; `i18n.changeLanguage('en-US')` ([useTranslation](https://react.i18next.com/latest/usetranslation-hook)). Default **Suspense** while namespaces load; `useSuspense: false` + `ready` if not wrapping a boundary (same page). |
| Interpolation | `{{value}}`; escaped by default (`escapeValue: true`) ([Interpolation](https://www.i18next.com/translation-function/interpolation)) |
| Plurals | `count` required; suffixes `_one` / `_other` / … via `Intl.PluralRules`; Arabic-style `_zero` `_two` `_few` `_many` documented ([Plurals](https://www.i18next.com/translation-function/plurals)) |
| Formatting | `{{val, number}}` / `datetime` / `relativetime` / `list` on Intl ([Formatting](https://www.i18next.com/translation-function/formatting)) |
| Missing keys | `saveMissing`, `missingKeyHandler`, `parseMissingKeyHandler`; event `missingKey` only if `saveMissing: true` ([Configuration](https://www.i18next.com/overview/configuration-options), [API events](https://www.i18next.com/overview/api)) |
| Exists | `i18next.exists(key)` ([API](https://www.i18next.com/overview/api)) |
| RTL helper | `i18next.dir('ar')` → `"rtl"` ([API `dir`](https://www.i18next.com/overview/api)) |
| Hot switch | `changeLanguage` loads resources then fires `languageChanged` ([API](https://www.i18next.com/overview/api)). Renderer can update immediately; **native `Menu` is not subscribed** — you rebuild and `setApplicationMenu` yourself ([Menu.setApplicationMenu](https://www.electronjs.org/docs/latest/api/menu)). |
| JSX-in-sentence | `Trans` interpolates nested elements; **does not** re-render on language change by itself — pair with `useTranslation` ([Trans](https://react.i18next.com/latest/trans-component)) |
| ICU | Optional plugin: MessageFormat instead of `{{ }}`; **disables** i18next interpolation/plurals/context on those keys ([i18next-icu README](https://raw.githubusercontent.com/i18next/i18next-icu/master/README.md)); ICU syntax itself ([FormatJS ICU](https://formatjs.github.io/docs/core-concepts/icu-syntax)) |
| TS keys | Module augmentation `CustomTypeOptions.resources`; selector API; large catalogs can OOM tsc unless `enableSelector: "optimize"` ([i18next TypeScript](https://www.i18next.com/overview/typescript)) |
| Main vs renderer | Two processes ⇒ two instances (or IPC). Plugins are registered with `use()` ([Plugins](https://www.i18next.com/principles/plugins)). `initAsync: false` only for sync backends such as fs ([Configuration](https://www.i18next.com/overview/configuration-options)). |

**Dependency footprint (npm published package, not min+gzip of a Vite graph):** as of 2026-09-19, `npm view` reports unpacked sizes: `i18next@26.4.2` **521 383** bytes; `react-i18next@17.0.14` **955 324** bytes; `i18next-icu@2.4.4` **761 218** bytes (npm registry metadata). Tree-shaken runtime will be smaller; ICU adds `intl-messageformat` as a peer ([i18next-icu README](https://raw.githubusercontent.com/i18next/i18next-icu/master/README.md)).

**Ongoing cost:** same key extraction as (A), plus keeping JSON/ICU in the format the library expects (plural suffixes vs ICU `{count, plural, …}`), plus TypeScript declaration maintenance.

---

## 3. First foreign language vs adding another

| | First extra locale (e.g. ja or en next to zh) | Each later locale |
| --- | --- | --- |
| String extraction, key design, call-site `t()` | **Paid once** | Incremental new strings only |
| Plumbing (`t`, React binding, `lang`, menus, fonts, `Intl`) | **Paid once** | Tweaks |
| Translation labor | Full catalog | Full catalog again |
| Plurals | zh/ja cardinals are **`other` only** in CLDR; English cardinal **`one` + `other`** ([CLDR Language Plural Rules](https://www.unicode.org/cldr/charts/47/supplemental/language_plural_rules.html)) | Arabic cardinal uses **six** categories (`zero` `one` `two` `few` `many` `other`) (same CLDR table; i18next maps them to `_zero`… [`Plurals`](https://www.i18next.com/translation-function/plurals)) |
| Layout | LTR: `dir` default is LTR if omitted ([MDN `dir`](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/dir)) | RTL: see §4 — **layout rewrite**, not “another JSON file” |
| Approach (B) artifacts | Second installer + feed | Nth installer + feed |

**Japanese vs English as first foreign language (LTR only):** Japanese does not need CLDR cardinal splits; English does for any `count`-sensitive copy. Both need `lang` (`ja` vs `en`) for screen readers ([MDN `lang`](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/lang)). Japanese needs CJK-capable fonts in the fallback list ([`font-family`](https://developer.mozilla.org/en-US/docs/Web/CSS/font-family)). English needs Latin already covered by Geist / system UI. Neither requires `dir="rtl"`.

---

## 4. LTR vs RTL (Arabic later)

`lang` does **not** set base direction; authors should set `dir` on the root for RTL scripts; default without `dir` is LTR ([MDN `dir`](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/dir)).

RTL cost that a dictionary (A or C) does **not** buy:

- Physical CSS (`margin-left`, `left`, `text-align: left`, row `flex-start` assuming LTR) vs logical properties (`margin-inline-start`, `inset-inline-start`, etc.) ([CSS logical properties](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_logical_properties_and_values)).
- Mixed content: chart IDs, BPM, file paths, Latin abbreviations inside Arabic UI need isolation (`dir` on spans / `bdi`) ([MDN `dir` mixed inline](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/dir)).
- Tables: `dir="rtl"` on a table reverses column order (same MDN page).
- Electron Win/Linux menu mnemonics use `&` in the **label** ([Menu.setApplicationMenu](https://www.electronjs.org/docs/latest/api/menu)); RTL labels still need that convention if you show a native bar.
- `i18next.dir()` only returns `"rtl"`/`"ltr"`; it does not restyle the app ([API](https://www.i18next.com/overview/api)).

Approach **(B)** with a dedicated Arabic build can bake `dir="rtl"` into `index.html` at compile time ([Vite HTML env replacement](https://vite.dev/guide/env-and-mode)) but **still** needs the CSS/logical-property work in that artifact.

---

## 5. Feature checklist (who implements what)

| Concern | (A) dict | (B) two builds | (C) i18next |
| --- | --- | --- | --- |
| Interpolation | DIY (`{{ }}` or template). XSS: you must escape if putting HTML in strings. | Same as A, compile-time locale | Built-in, escaped by default ([Interpolation](https://www.i18next.com/translation-function/interpolation)) |
| Pluralization | DIY; `Intl.PluralRules` exists in the engine ([MDN `Intl`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl)) but you map categories → keys | Same as A | JSON v4 suffixes + `count` ([Plurals](https://www.i18next.com/translation-function/plurals)) |
| ICU MessageFormat | Not present unless you add `intl-messageformat` yourself ([FormatJS ICU](https://formatjs.github.io/docs/core-concepts/icu-syntax)) | Same | Plugin; replaces i18next format ([i18next-icu](https://raw.githubusercontent.com/i18next/i18next-icu/master/README.md)). TS: set `parseInterpolation: false` so `{{` extractor does not invent phantom vars ([i18next TS](https://www.i18next.com/overview/typescript), [i18next-icu](https://raw.githubusercontent.com/i18next/i18next-icu/master/README.md)) |
| Missing-key detection | Tests / `satisfies` / exhaustive `keyof` | Same, per artifact | `saveMissing`, `exists`, `missingKey` event ([config](https://www.i18next.com/overview/configuration-options), [API](https://www.i18next.com/overview/api)) |
| Hot language switch | Yes, if catalogs shipped and state updates | **No** (other language not in the binary) | `changeLanguage` ([API](https://www.i18next.com/overview/api)) + React hook re-render ([useTranslation](https://react.i18next.com/latest/usetranslation-hook)); Electron menu extra |
| Electron `Menu.setApplicationMenu` | Rebuild template from dict; `null` currently hides the bar (this repo `electron/main.cjs`; [API](https://www.electronjs.org/docs/latest/api/menu)). Default Chromium menu appears only if you never set a menu ([same API](https://www.electronjs.org/docs/latest/api/menu)). `role` supplies default labels ([tutorial](https://www.electronjs.org/docs/latest/tutorial/menus)). Custom items: your strings. | Labels frozen in that build | Same rebuild on `languageChanged` |
| HTML `lang` / `dir` | Set on `<html>` (this repo is `lang="en"` in `index.html`) | Bake per mode | Set from `i18n.language` + `i18next.dir()` |
| Font fallback | CSS list; missing glyphs fall through families ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/font-family)). `system-ui` may pick a CJK UI face that renders Latin poorly; `lang` may not fix that (same page). | Same | Same |
| Date/number | `Intl.*` or i18next formatters | `Intl` with baked locale | i18next formatters **or** `Intl` ([Formatting](https://www.i18next.com/translation-function/formatting)) |
| Bundle size | One extra JSON (or two if both locales shipped) | One locale JSON; **two full Electron downloads** | Library unpacked sizes above + JSON; can lazy-load with `import()` ([load translations](https://www.i18next.com/how-to/add-or-load-translations), [Vite glob/`import()`](https://vite.dev/guide/features.html#json)) |
| TypeScript key typing | `keyof` catalog | Same | Official augmentation; compile-time cost / OOM risk on huge JSON ([TS docs](https://www.i18next.com/overview/typescript)) |

### What a hand-rolled dict does not do well (vs i18next)

Documented i18next behaviors you would reimplement or omit:

1. **CLDR plural (and ordinal) category resolution** tied to `count`, including languages with many forms ([Plurals](https://www.i18next.com/translation-function/plurals); CLDR [plural rules](https://www.unicode.org/cldr/charts/47/supplemental/language_plural_rules.html)).
2. **Nesting** (`$t(...)`) and interpolation escaping defaults ([Interpolation](https://www.i18next.com/translation-function/interpolation)).
3. **Context** variants (`key_male`) in the JSON format ([JSON format](https://www.i18next.com/misc/json-format)).
4. **Fallback language chains** (`fallbackLng`, `i18next.languages`) ([API](https://www.i18next.com/overview/api), [config](https://www.i18next.com/overview/configuration-options)).
5. **Missing-key pipeline** to a backend (`saveMissing`) ([config](https://www.i18next.com/overview/configuration-options)).
6. **`Trans` / mixed markup sentences** ([Trans](https://react.i18next.com/latest/trans-component)).
7. **ICU** without a parser ([i18next-icu](https://raw.githubusercontent.com/i18next/i18next-icu/master/README.md), [ICU syntax](https://formatjs.github.io/docs/core-concepts/icu-syntax)).
8. **Namespace lazy load + Suspense/`ready`** ([useTranslation](https://react.i18next.com/latest/usetranslation-hook)).
9. **Typed interpolation names** extracted from resource strings ([i18next TS](https://www.i18next.com/overview/typescript) — JSON `as const` caveats apply).
10. **`dir()`** language→rtl/ltr table ([API](https://www.i18next.com/overview/api)).

A dict **can** do simple lookup, hot switch, `Intl` formatting, and `keyof` safety. That is enough if copy is mostly labels without plurals/markup.

---

## 6. What “two packages by language” implies here

### Updater

This repo packages with electron-builder (`electron:dist` / `electron:build`) and does **not** list `electron-updater`. If auto-update is added later:

- A generic HTTP feed has a **`channel`** (default `"latest"`) and a **base `url`** ([electron-builder `GenericServerOptions` in source](https://github.com/electron-userland/electron-builder/blob/master/packages/builder-util-runtime/src/publishOptions.ts)).
- `autoUpdater.channel` / `setFeedURL` select which YAML the client fetches ([`AppUpdater` source](https://github.com/electron-userland/electron-builder/blob/v23.0.3/packages/electron-updater/src/AppUpdater.ts)).

Two language SKUs as **one app identity** will overwrite each other on update unless feeds (or channels, or `appId`) are split. Two SKUs as **two apps** need two feeds and users must install the matching one; a zh user pointed at an en `latest.yml` would download the English binary.

Release-channel docs describe `latest` / `beta` / `alpha` for **stability**, not locale ([electron-builder channels tutorial](https://www.electron.build/docs/tutorials/release-using-channels/)). Locale-specific packages are a second axis you invent (separate URLs or non-standard channel names).

### Settings persistence

Electron `userData` is `appData` + **app name** by default ([`app.getPath('userData')`](https://www.electronjs.org/docs/latest/api/app)). This app stores window/theme/data-root under that tree (`electron/dataRoot.cjs`: default data root = `userData/data`).

| Packaging choice | Effect |
| --- | --- |
| Same `appId` / `productName` (`com.mocacoffee.bangdream-editor` / `BangDream Editor` in `package.json`) | One install directory, **one `userData`**. Language switch via reinstall still keeps settings; **updater collision** as above. |
| Different `productName` / `appId` per language | Two `userData` trees. Theme, window state, **data-root pointer** do not follow the user across SKUs unless you copy files. |

### Shared chart files

Project files live under the data root (`projects/<id>/project.json`, `audio.bin` — `electron/main.cjs` comments / `dataRoot.cjs`). They are **not** bound to UI locale by the current store. Two language builds:

- **Same data root** (same `userData` or user-picked path): charts remain shared; UI language is independent.
- **Different default `userData`**: charts look “missing” until the user re-points the data root; files on disk are still the same format.
- Cost if someone later **bakes translated strings into `project.json`**: files become locale-specific and stop being interchangeable. Current design (settings vs project) already distinguishes “my habits” vs chart data (issue 114 map text); keep UI locale out of the chart schema to avoid that tax.

---

## 7. Cost snapshot (engineering, not product advice)

| | First foreign LTR locale | Extra LTR locale | First RTL locale |
| --- | --- | --- | --- |
| **(A) dict** | Extract + `t` + `lang` + `Intl` + optional menu rebuild. Weak on plurals/ICU/`Trans`/saveMissing. | Mostly translation + keys | + `dir` + logical CSS + BiDi isolation |
| **(B) two builds** | Same extract as A **plus** dual artifacts, dual installer testing, dual update feed if updater exists, `userData`/`appId` policy | Dual → N artifacts | Same RTL CSS, baked `dir` |
| **(C) i18next** | Extract + init in **renderer and main** + typed resources + `changeLanguage` wiring + menu rebuild. Plurals/interpolation/missing keys documented. Extra unpacked JS (npm sizes above). | New JSON (+ plural forms if the language needs them) | Same RTL CSS; `i18next.dir()` only sets the flag |

**Can skip a framework:** yes (§1). **(B) is not a cheaper extractor** — it is a release/updater/`userData` multiplier. **(A) vs (C)** diverge when copy needs CLDR plurals, nested markup, ICU, or a missing-key pipeline; they are close when UI is a flat label catalog and `Intl` is called at the call site.

No recommendation on whether to start i18n now.
