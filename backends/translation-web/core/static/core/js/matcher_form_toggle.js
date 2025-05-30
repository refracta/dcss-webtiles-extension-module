// core/static/core/js/matcher_form_toggle.js
document.addEventListener("DOMContentLoaded", () => {
    const typeSelect = document.getElementById("id_type");
    if (!typeSelect) return;            // 필드 없으면 중단

    // Jazzmin & 기본 Admin 양쪽 호환: 행(div) 클래스는 field-<name>
    const rawRow = document.querySelector(".field-raw");
    const srcRow = document.querySelector(".field-regexp_source");
    const groupsRow = document.querySelector(".field-groups");
    const flagRow = document.querySelector(".field-regexp_flag");
    const ignorePT = document.querySelector(".field-ignore_part_translated");

    function showRow(row) {
        if (!row) return;
        row.classList.remove("d-none");
        row.style.display = "";           // 이전 inline display 제거
    }

    function hideRow(row) {
        if (!row) return;
        row.classList.add("d-none");
        // 인라인 display는 굳이 건드리지 않음 → 충돌 최소화
    }

    function toggle() {
        const mode = typeSelect.value === "regex" ? "regex" : "raw";

        if (mode === "raw") {
            document.querySelector("textarea[name=raw]").value ||= document.querySelector("textarea[name=regexp_source]").value;
            showRow(rawRow);
            hideRow(srcRow);
            hideRow(flagRow);
            hideRow(groupsRow);
            hideRow(ignorePT);
        } else {
            document.querySelector("textarea[name=regexp_source]").value ||= document.querySelector("textarea[name=raw]").value;
            hideRow(rawRow);
            showRow(srcRow);
            showRow(flagRow);
            showRow(groupsRow);
            Array.from(groupsRow.querySelectorAll('input')).forEach((input) => {
                if (input.value === '""') {
                    input.value = '[]'
                }
            })
            showRow(ignorePT);
        }
    }

    $(typeSelect).on("change", toggle)

    toggle();       // 첫 로드 시 한 번 실행
});
