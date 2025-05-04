!async function () {
    localStorage.SCRIPT_LATEST_DURATION ||= 300;
    localStorage.SCRIPT_LATEST_TIME ||= 0;

    const currentTime = Date.now();
    if (localStorage.SCRIPT_LATEST_TIME && localStorage.SCRIPT_LATEST_DURATION) {
        const latestTime = parseInt(localStorage.SCRIPT_LATEST_TIME);
        const duration = parseInt(localStorage.SCRIPT_LATEST_DURATION);
        const cacheAge = (currentTime - latestTime) / 1000;
        console.log(`SCRIPT_LATEST Cache Age: ${cacheAge}s`);
        console.log(`SCRIPT_LATEST Cache Duration: ${duration}s`);
        if (cacheAge > duration) {
            try {
                localStorage.SCRIPT_LATEST = (await fetch(`https://api.github.com/repos/refracta/dcss-webtiles-extension-module/commits/main`).then(r => r.json())).sha;
                localStorage.SCRIPT_LATEST_TIME = Date.now();
            } catch (e) {
            }
        }
    }
    localStorage.SCRIPT_LATEST = localStorage.SCRIPT_LATEST || 'latest';
    window.translatorPromise = import((`https://cdn.jsdelivr.net/gh/refracta/dcss-webtiles-extension-module@${localStorage.SCRIPT_LATEST}/modules/translation-module/translator.js`));
    window.dataManagerPromise = import((`https://cdn.jsdelivr.net/gh/refracta/dcss-webtiles-extension-module@${localStorage.SCRIPT_LATEST}/modules/translation-module/data-manager.js`));
    window.fetchPromise = fetch('/build/latest.json', {cache: "no-store"}).then((r) => r.json());
}()


const STATUS_BADGE = {
    "untranslated": {cls: "bg-danger", label: "Untranslated"},
    "part-translated": {cls: "bg-warning", label: "Part-Translated"},
    "translated": {cls: "bg-primary", label: "Translated"},
};
document.addEventListener("DOMContentLoaded", async () => {
    const params = new URLSearchParams(location.search);
    if (params.get("mode") !== "fast") return;      // fast 모드 아닐 때는 패스

    // ➋ 검색 폼(상단 우측) 찾아서 hidden input 주입
    const form = document.getElementById("changelist-search");   // Django-admin 기본 id
    if (!form) return;

    // 이미 있으면 중복 추가하지 않음
    if (!form.querySelector('input[name="mode"]')) {
        const hidden = document.createElement("input");
        hidden.type = "hidden";
        hidden.name = "mode";
        hidden.value = "fast";
        form.appendChild(hidden);
    }

    const results = Array.from(document.querySelectorAll(".translation-result"));
    const statuses = Array.from(document.querySelectorAll(".translation-status"));
    const infos = Array.from(document.querySelectorAll(".translation-info"));
    const [{default: Translator}, {default: DataManager}, {matchers}] = await Promise.all([window.translatorPromise, window.dataManagerPromise, window.fetchPromise]);
    const translator = new Translator(matchers, DataManager.functions, true);
    for (let i = 0; i < results.length; i++) {
        const resultTag = results[i];
        const statusTag = statuses[i];
        const infoTag = infos[i];
        const source = resultTag.dataset.source;
        const content = resultTag.dataset.content;
        const translationResult = translator.translate(content, navigator.language, source);
        const badge = STATUS_BADGE[translationResult.totalStatus] || {
            cls: "bg-secondary",
            label: translationResult.totalStatus
        };
        statusTag.innerHTML = `<span class="badge ${badge.cls}">${badge.label}</span>`;
        resultTag.textContent = translationResult.translation;
        try {
            infoTag.textContent = JSON.stringify(translationResult, null, 4);
        } catch (e) {
        }
    }
});
