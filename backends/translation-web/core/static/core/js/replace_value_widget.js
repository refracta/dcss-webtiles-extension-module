// replace_value_widget.js
(function () {
    /* ─── 유틸 ─────────────────────────────────────────────────── */
    function closest(el, selector) {
        while (el && !el.matches(selector)) el = el.parentElement;
        return el;
    }

    function serialize(container) {
        const obj = {};
        container.querySelectorAll(".kv-row").forEach(row => {
            const lang = row.querySelector(".kv-lang").value.trim();
            const text = row.querySelector(".kv-text").value;
            if (lang) obj[lang] = text;
        });
        return obj;
    }

    /* ─── localStorage helpers ────────────────────────────────── */
    const LS_KEY = "lastLangCode";
    const loadLastLang  = () => localStorage.getItem(LS_KEY) || "";
    const saveLastLang  = (code) => localStorage.setItem(LS_KEY, code);

    /* ─── DOMContentLoaded ────────────────────────────────────── */
    document.addEventListener("DOMContentLoaded", () => {
        document.querySelectorAll(".kv-container").forEach(container => {
            const hiddenTextarea = container.parentElement.querySelector(
                `textarea[name="${container.dataset.name}"]`
            );
            const addBtn = container.parentElement.querySelector(".add-kv");

            /* +Add 버튼 ------------------------------------------------- */
            addBtn.addEventListener("click", () => {
                // prototype 행 추가
                container.insertAdjacentHTML("beforeend", container.dataset.prototype);
                const newRow    = container.lastElementChild;
                const langInput = newRow.querySelector(".kv-lang");

                // 마지막 lang 코드가 이미 사용됐는지 검사
                const candidate = loadLastLang().trim();
                if (candidate) {
                    const usedCodes = new Set(
                        Array.from(container.querySelectorAll(".kv-lang")).map(
                            i => i.value.trim()
                        )
                    );
                    if (!usedCodes.has(candidate)) {
                        langInput.value = candidate;      // 아직 미사용 → 기본값으로
                    }
                }
            });

            /* ✕ Delete -------------------------------------------------- */
            container.addEventListener("click", (e) => {
                if (e.target.classList.contains("del-kv")) {
                    closest(e.target, ".kv-row").remove();
                }
            });

            /* lang 입력 시 localStorage 업데이트 ------------------------- */
            container.addEventListener("input", (e) => {
                if (e.target.classList.contains("kv-lang")) {
                    saveLastLang(e.target.value.trim());
                }
            });

            /* form submit → JSON 직렬화 -------------------------------- */
            hiddenTextarea.form.addEventListener("submit", () => {
                hiddenTextarea.value = JSON.stringify(serialize(container));
            });

            /* 처음 로드 시, 첫 행 lang 이 비어 있으면 최근 코드 채우기 */
            const firstLang = container.querySelector(".kv-lang");
            if (firstLang && !firstLang.value) {
                firstLang.value = loadLastLang();
            }
        });
    });
})();
