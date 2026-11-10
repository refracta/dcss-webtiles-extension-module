import {yiufQuotes} from './yiuf-quotes.js';

export default {
    id: 'xom',
    viewerUrl: 'https://refracta.github.io/nemelx-altar-3d/xom/',
    quotes: yiufQuotes,
    // Guardian in status.cc; corresponding WebTiles foreground colours in style.css.
    colors: ['#a40000', '#ef2929', '#fce94f', '#4e9a06', '#8ae234', '#204a87', '#729fcf', '#ad7fa8'],
    colorBy: 'character',
    variables: {
        'info-background': '#845fbf',
        'info-text': '#ffffff',
        'info-link': '#ffffff',
        'donation-border': '#9874d0',
        'donation-accent': '#845fbf',
        'donation-background': 'rgba(23, 17, 33, 0.94)',
        'donation-text': '#eee4fa',
        'donation-label': '#c4a4ef',
        'donation-muted': '#c3b3d3'
    }
};
