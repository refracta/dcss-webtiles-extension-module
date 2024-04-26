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
        let disableRJSInjection = true;
        for (const funcName of ['appendChild', 'insertBefore']) {
            head['_' + funcName] = head[funcName];
            head[funcName] = function (tag) {
                if (disableRJSInjection && (tag.dataset.requirecontext !== undefined || tag.dataset.requiremodule !== undefined)) {
                    return tag;
                }
                return this['_' + funcName].apply(this, arguments);
            }
        }

        const scripts = head.getElementsByTagName('script');
        const rjsScript = Array.from(scripts).find(s => s.src?.endsWith('require.js'));
        rjsScript?.remove();

        window.reloadRequireJS = async () => {
            window.require = window.define = window.requirejs = undefined;
            disableRJSInjection = false;
            const newRJSScript = document.createElement('script');
            newRJSScript.setAttribute('data-main', rjsScript.getAttribute('data-main'));
            let rjsScriptRaw = await fetch(rjsScript.src).then(r => r.text());
            rjsScriptRaw = rjsScriptRaw.replace('define=', '_define=').replace('define.', '_define.');
            newRJSScript.src = URL.createObjectURL(new Blob([rjsScriptRaw], {type: 'application/javascript'}))
            head.appendChild(newRJSScript);
        };
    }

    haltRequireJS();
    (async () => {
        if (localStorage.DWEM_DEBUG === 'true') {
            await import(localStorage.DWEM_DEBUG_LOADER_PATH);
        } else {
            try {
                await import('https://refracta.github.io/dcss-webtiles-extension-module/loader/dwem-core-loader.js');
            } catch (e) {
                await import('https://cdn.jsdelivr.net/gh/refracta/dcss-webtiles-extension-module/loader/dwem-base-loader.js');
            }
        }
    })();
})();
