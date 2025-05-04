const commitHash = '51587771';
const translatorPromise = import((`https://cdn.jsdelivr.net/gh/refracta/dcss-webtiles-extension-module@${commitHash}/modules/translation-module/translator.js`));
const dataManagerPromise = import((`https://cdn.jsdelivr.net/gh/refracta/dcss-webtiles-extension-module@${commitHash}/modules/translation-module/data-manager.js`));
const fetchPromise = fetch('/build/latest.json', {cache: "no-store"}).then((r) => r.json());
const STATUS_BADGE = {
    "untranslated": {cls: "bg-danger", label: "Untranslated"},
    "part-translated": {cls: "bg-warning", label: "Part-Translated"},
    "translated": {cls: "bg-primary", label: "Translated"},
};
document.addEventListener("DOMContentLoaded", async () => {
    const results = Array.from(document.querySelectorAll(".translation-result"));
    const statuses = Array.from(document.querySelectorAll(".translation-status"));
    const infos = Array.from(document.querySelectorAll(".translation-info"));
    const [{default: Translator}, {default: DataManager}, {matchers}] = await Promise.all([translatorPromise, dataManagerPromise, fetchPromise]);
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
        } catch (e){}
    }
});
