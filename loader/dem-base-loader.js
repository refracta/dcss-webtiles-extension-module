// ==UserScript==
// @name         Webtiles Extension Module Loader
// @description  Load the WEM from other Webtiles sites as well.
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
    import('http://localhost:8080/loader/dem-core-loader.js');
})();
