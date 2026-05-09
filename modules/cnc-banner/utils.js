export function getLocale() {
    const forcedLocale = getForcedLocale();
    if (forcedLocale) {
        return forcedLocale;
    }

    return (navigator.language || navigator.userLanguage || '').startsWith('ko') ? 'ko' : 'en';
}

export function isKorean() {
    return getLocale() === 'ko';
}

export function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
}

export function getForcedLocale() {
    const forceLang = (getQueryParam('forceLang') || '').toLowerCase();
    if (forceLang.startsWith('ko')) {
        return 'ko';
    }
    if (forceLang.startsWith('en')) {
        return 'en';
    }
    return null;
}

export function isQueryFlagTrue(name) {
    return getQueryParam(name) === 'true';
}

export function shouldUseAprilFools() {
    const today = new Date();
    return isQueryFlagTrue('aprilFools') || (today.getMonth() === 4 - 1 && today.getDate() === 1);
}

export function shouldUseXMasTheme() {
    return isQueryFlagTrue('xmas') || new Date().getMonth() === 11;
}

export function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function randomChoice(items) {
    return items[Math.floor(Math.random() * items.length)];
}

export function getModuleBaseUrl() {
    return import.meta.url.substring(0, import.meta.url.lastIndexOf('/'));
}

export function ensureStyle(id, css) {
    const existingStyle = document.getElementById(id);
    if (existingStyle) {
        existingStyle.remove();
    }

    const style = document.createElement('style');
    style.id = id;
    style.type = 'text/css';
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);
    return style;
}

export function interpolateColor(color1, color2, factor) {
    const target = color2.slice(1).match(/.{2}/g);
    const result = color1.slice(1).match(/.{2}/g)
        .map((hex, i) => Math.round(parseInt(hex, 16) * (1 - factor) + parseInt(target[i], 16) * factor)
            .toString(16).padStart(2, '0')).join('');
    return `#${result}`;
}

export function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
