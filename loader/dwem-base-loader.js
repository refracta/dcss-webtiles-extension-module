// ==UserScript==
// @name         DCSS Webtiles Extension Module Loader
// @description  Load the DWEM from other Webtiles sites as well.
// @version      1.0
// @author       refracta
// @match        http://webzook.net:8080/*
// @match        https://crawl.kelbi.org/*
// @match        http://crawl.akrasiac.org:8080/*
// @match        https://underhound.eu:8080/*
// @match        https://cbro.berotato.org:8443/*
// @match        http://lazy-life.ddo.jp:8080/*
// @match        https://crawl.xtahua.com/*
// @match        https://crawl.project357.org/*
// @match        http://joy1999.codns.com:8081/*
// @grant        none
// @run-at document-start
// ==/UserScript==

(function () {
    'use strict';
    const [head] = document.getElementsByTagName('head');

    function haltRequireJS() {
        const scripts = head.getElementsByTagName('script');
        const rjsScript = Array.from(scripts).find(s => s.src?.endsWith('require.js'));
        rjsScript.remove();

        const newRJSScript = document.createElement('script');
        newRJSScript.src = rjsScript.src;
        newRJSScript.setAttribute('data-main', rjsScript.getAttribute('data-main'));

        const generateDummyAttributes = () => {
            let value;
            return {
                configurable: true, get: () => value, set: newValue => value = newValue
            };
        }

        Object.defineProperty(window, 'define', generateDummyAttributes());
        Object.defineProperty(window, 'require', generateDummyAttributes());
        Object.defineProperty(window, 'requirejs', generateDummyAttributes());

        window.reloadRequireJS = () => {
            window.require = window.define = window.requirejs = undefined;
            head.appendChild(newRJSScript);
        };
    }

    haltRequireJS();
    // github.io
    import('https://refracta.github.io/dcss-webtiles-extension-module/loader/dwem-core-loader.js');

    // CDN
    // import('https://cdn.jsdelivr.net/gh/refracta/dcss-webtiles-extension-module/loader/dwem-base-loader.js');

    // Local server
    // import('http://localhost:6060/loader/dwem-core-loader.js');
})();
