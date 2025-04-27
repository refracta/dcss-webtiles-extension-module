export default class DataManager {
    /* ---------- 공통 유틸 ---------- */
    static tokenize = (s) =>
        [...s.matchAll(/(<\/?[a-z]+>)|([^<]+)/gi)].map((m) =>
            m[1] ? {type: "tag", content: m[1]} : {type: "text", content: m[2]}
        );

    /** 깊은 복사(브라우저·노드 공통) */
    static clone = (o) => structuredClone(o);

    /** extracted 배열을 순차적으로 소비 */
    static makeNext = (arr) => () => arr.shift();

    /** 복원 타깃 선택: true → 복사본, false → 원본 */
    static target = (d, useClone) =>
        useClone === false ? d : DataManager.clone(d);

    /* ---------- processors ---------- */
    static processors = {
        /* ===== msgs:messages[] ===== */
        "msgs@messages[]": {
            match: (d) => d?.msg === "msgs" && d.messages?.length,
            extract: (d) => d.messages.flatMap((m) => (m.text ? [m.text] : [])),
            restore: (d, arr, useClone = false) => {
                const out = DataManager.target(d, useClone);
                const next = DataManager.makeNext(arr);
                out.messages?.forEach((m) => {
                    if (m.text != null) m.text = next();
                });
                return out;
            },
        },

        /* ===== msgs:messages[]|tokenize ===== */
        "msgs@messages[]#tokenize": {
            match: (d) => DataManager.processors["msgs:messages[]"].match(d),
            extract: (d) =>
                d.messages.flatMap((m) =>
                    m.text
                        ? DataManager.tokenize(m.text)
                            .filter((t) => t.type === "text")
                            .map((t) => t.content)
                        : []
                ),
            restore: (d, arr, useClone = false) => {
                const out = DataManager.target(d, useClone);
                const next = DataManager.makeNext(arr);
                out.messages?.forEach((m) => {
                    if (!m.text) return;
                    const tokens = DataManager.tokenize(m.text);
                    tokens.forEach((t) => {
                        if (t.type === "text") t.content = next();
                    });
                    m.text = tokens.map((t) => t.content).join("");
                });
                return out;
            },
        },

        /* ===== menu:items[] ===== */
        "menu@items[]": {
            match: (d) => d?.msg === "menu" && d.items?.length,
            extract: (d) => d.items.flatMap((it) => (it.text ? [it.text] : [])),
            restore: (d, arr, useClone = false) => {
                const out = DataManager.target(d, useClone);
                const next = DataManager.makeNext(arr);
                out.items?.forEach((it) => {
                    if (it.text != null) it.text = next();
                });
                return out;
            },
        },

        /* ===== ui-push 관련 ===== */
        "ui-push@main-items.buttons[].description": {
            match: (d) =>
                d?.msg === "ui-push" &&
                d["main-items"]?.buttons?.some((b) => b.description),
            extract: (d) =>
                d["main-items"].buttons.flatMap((b) =>
                    b.description ? [b.description] : []
                ),
            restore: (d, arr, useClone = false) => {
                const out = DataManager.target(d, useClone);
                const next = DataManager.makeNext(arr);
                out["main-items"]?.buttons?.forEach((b) => {
                    if (b.description != null) b.description = next();
                });
                return out;
            },
        },

        "ui-push@sub-items.buttons[].description": {
            match: (d) =>
                d?.msg === "ui-push" &&
                d["sub-items"]?.buttons?.some((b) => b.description),
            extract: (d) =>
                d["sub-items"].buttons.flatMap((b) =>
                    b.description ? [b.description] : []
                ),
            restore: (d, arr, useClone = false) => {
                const out = DataManager.target(d, useClone);
                const next = DataManager.makeNext(arr);
                out["sub-items"]?.buttons?.forEach((b) => {
                    if (b.description != null) b.description = next();
                });
                return out;
            },
        },

        "ui-push@sub-items.buttons[].label": {
            match: (d) =>
                d?.msg === "ui-push" &&
                d["sub-items"]?.buttons?.some((b) => b.label),
            extract: (d) =>
                d["sub-items"].buttons.flatMap((b) => (b.label ? [b.label] : [])),
            restore: (d, arr, useClone = false) => {
                const out = DataManager.target(d, useClone);
                const next = DataManager.makeNext(arr);
                out["sub-items"]?.buttons?.forEach((b) => {
                    if (b.label != null) b.label = next();
                });
                return out;
            },
        },

        "ui-push@main-items.buttons[].labels[]": {
            match: (d) =>
                d?.msg === "ui-push" &&
                d["main-items"]?.buttons?.some((b) => Array.isArray(b.labels)),
            extract: (d) =>
                d["main-items"].buttons.flatMap((b) => b.labels ?? []),
            restore: (d, arr, useClone = false) => {
                const out = DataManager.target(d, useClone);
                const next = DataManager.makeNext(arr);
                out["main-items"]?.buttons?.forEach((b) => {
                    if (Array.isArray(b.labels)) {
                        b.labels = b.labels.map(() => next());
                    }
                });
                return out;
            },
        },

        /* ===== ui-push 단일 필드 ===== */
        ...["title", "text", "body", "actions", "prompt"].reduce((o, f) => {
            o[`ui-push:${f}`] = {
                match: (d) => d?.msg === "ui-push" && d[f] != null,
                extract: (d) => [d[f]],
                restore: (d, arr, useClone = false) => {
                    const out = DataManager.target(d, useClone);
                    out[f] = arr[0];
                    return out;
                },
            };
            return o;
        }, {}),

        /* ===== ui-state:text ===== */
        "ui-state@text": {
            match: (d) => d?.msg === "ui-state" && d.text,
            extract: (d) => [d.text],
            restore: (d, arr, useClone = false) => {
                const out = DataManager.target(d, useClone);
                out.text = arr[0];
                return out;
            },
        },

        /* ===== game_ended:message ===== */
        "game_ended@message": {
            match: (d) => d?.msg === "game_ended" && d.message,
            extract: (d) => [d.message],
            restore: (d, arr, useClone = false) => {
                const out = DataManager.target(d, useClone);
                out.message = arr[0];
                return out;
            },
        },
    };
}
