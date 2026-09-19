const fs = require('fs');
const path = require('path');

function messagesDir() {
    const fromSrc = path.join(__dirname, '../src/i18n/messages');
    if (fs.existsSync(fromSrc)) return fromSrc;
    return path.join(__dirname, 'messages');
}

function loadDict(file) {
    return JSON.parse(fs.readFileSync(path.join(messagesDir(), file), 'utf8'));
}

const DICTS = {
    'zh-CN': loadDict('zh-CN.json'),
    en: loadDict('en.json'),
};

const FALLBACK = 'zh-CN';
let activeUiLanguage = 'zh-CN';

function interpolate(template, vars) {
    if (!vars) return template;
    return template.replace(/\{\{(\w+)\}\}/g, (_, name) => {
        const v = vars[name];
        return v === undefined ? `{{${name}}}` : String(v);
    });
}

function isUiLanguage(raw) {
    return raw === 'zh-CN' || raw === 'en';
}

function setActiveUiLanguage(locale) {
    if (isUiLanguage(locale)) activeUiLanguage = locale;
}

function getActiveUiLanguage() {
    return activeUiLanguage;
}

function t(key, vars) {
    const primary = DICTS[activeUiLanguage] && DICTS[activeUiLanguage][key];
    if (primary !== undefined) return interpolate(primary, vars);
    const fallback = DICTS[FALLBACK][key];
    if (fallback !== undefined) {
        if (activeUiLanguage !== FALLBACK) {
            console.warn(`[i18n] missing key "${key}" in ${activeUiLanguage}, falling back to ${FALLBACK}`);
        }
        return interpolate(fallback, vars);
    }
    return key;
}

module.exports = {
    t,
    setActiveUiLanguage,
    getActiveUiLanguage,
    isUiLanguage,
};
