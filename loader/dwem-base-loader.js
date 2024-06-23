// ==UserScript==
// @name         DCSS Webtiles Extension Module Loader
// @description  Load the DWEM from other Webtiles sites as well.
// @version      1.1
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

    async function haltRequireJS() {
        let disableRJSInjection = true;
        for (const funcName of ['appendChild', 'insertBefore']) {
            head['_' + funcName] = head[funcName];
            head[funcName] = function (tag) {
                if (disableRJSInjection && (tag.getAttribute('data-requirecontext') !== null || tag.getAttribute('data-requiremodule') !== null)) {
                    return tag;
                }
                return this['_' + funcName].apply(this, arguments);
            }
        }

        const scripts = head.getElementsByTagName('script');
        let rjsScript = Array.from(scripts).find(s => s.src?.endsWith('require.js'));
        if (!rjsScript) {
            rjsScript = {src: "/static/scripts/contrib/require.js", getAttribute: () => "/static/scripts/app"};
        }
        rjsScript?.remove?.();

        const config = (() => {
            const dataMain = rjsScript.getAttribute('data-main');
            let mainScript = dataMain;
            const src = mainScript.split('/');
            mainScript = src.pop();
            const baseUrl = src.length ? src.join('/') + '/' : './';
            mainScript = mainScript.replace(/\.js$/, '');
            if (/^\/|:|\?|\.js$/.test(mainScript)) {
                mainScript = dataMain;
            }
            return {deps: [mainScript], baseUrl};
        })();

        window.require = window.define = window.requirejs = undefined;
        const newRJSScript = document.createElement('script');
        newRJSScript.src = rjsScript.src;
        await new Promise(resolve => {
            newRJSScript.onload = newRJSScript.onreadystatechange = () => {
                if (!newRJSScript.readyState || /loaded|complete/.test(newRJSScript.readyState)) {
                    newRJSScript.onload = newRJSScript.onreadystatechange = null;
                    resolve();
                }
            };
            head.appendChild(newRJSScript);
        });

        window.startMainScript = async () => {
            disableRJSInjection = false;
            require.config(config);
        };
    }

    (async () => {
        await haltRequireJS();
        // localStorage.DWEM_MODULES = JSON.stringify(['https://example.org/module.js', ...]);
        // localStorage.DWEM_CACHE_PARAMETER = `?t=${Math.floor(Date.now() / 1000 * 60 * 5)}`;
        localStorage.DWEM_CACHE_PARAMETER = localStorage.DWEM_CACHE_PARAMETER || '';
        if (localStorage.DWEM_DEBUG === 'true') {
            await import(localStorage.DWEM_DEBUG_LOADER + localStorage.DWEM_CACHE_PARAMETER);
        } else {
            try {
                await import('https://refracta.github.io/dcss-webtiles-extension-module/loader/dwem-core-loader.js' + localStorage.DWEM_CACHE_PARAMETER);
            } catch (e) {
                await import('https://cdn.jsdelivr.net/gh/refracta/dcss-webtiles-extension-module/loader/dwem-core-loader.js' + localStorage.DWEM_CACHE_PARAMETER);
            }
        }
    })();
})();
