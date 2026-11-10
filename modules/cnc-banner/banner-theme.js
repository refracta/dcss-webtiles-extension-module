import activeTheme from './themes/active.js';
import {escapeHtml} from './utils.js';

export default class BannerTheme {
    constructor(theme = activeTheme, random = Math.random) {
        this.theme = theme;
        // Keep the same quote across login/lobby refreshes and locale changes.
        this.quote = theme.quotes[Math.floor(random() * theme.quotes.length)];
    }

    getText(locale) {
        return this.quote[locale === 'ko' ? 'ko' : 'en'];
    }

    colorize(text) {
        const {colors, colorBy} = this.theme;
        let index = 0;
        // Preserve whitespace and normal word wrapping. Array.from handles code points.
        const parts = colorBy === 'word' ? text.split(/(\s+)/) : Array.from(text);
        return parts.map(part => /^\s+$/.test(part)
            ? escapeHtml(part)
            : `<span style="color:${colors[index++ % colors.length]}">${escapeHtml(part)}</span>`
        ).join('');
    }

    getStyle() {
        const variables = Object.entries(this.theme.variables)
            .map(([name, value]) => `--cnc-${name}: ${value};`).join('\n');
        return `<style>
            #banner { ${variables} }
            #banner .cnc-info-panel {
                background-color: var(--cnc-info-background);
                color: var(--cnc-info-text);
            }
            #banner .cnc-info-panel a { color: var(--cnc-info-link); }
            #banner #coloredText { overflow-wrap: anywhere; line-height: 1.5; }
            #banner #coloredText:focus-visible { outline: 2px solid var(--cnc-donation-accent); }
        </style>`;
    }
}
