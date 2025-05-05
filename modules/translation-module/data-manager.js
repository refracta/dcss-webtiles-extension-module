export default class DataManager {
    /* ---------- 공통 유틸 ---------- */
    /** `<tag>`를 보존하면서 텍스트 토큰화 */
    static tokenize = (s) =>
        [...s.matchAll(/(<\/?[a-z]+>)|([^<]+)/gi)].map((m) =>
            m[1] ? {type: "tag", content: m[1]} : {type: "text", content: m[2]}
        );

    /** 깊은 복사(브라우저·노드 공통) */
    static clone = (o) => structuredClone(o);

    /** 배열을 순차 소비하는 클로저 */
    static makeNext = (arr) => () => arr.shift();

    /** 복원 시 원본‧복사 선택 */
    static target = (d, useClone = true) => (useClone ? DataManager.clone(d) : d);

    /* ---------- DSL 파서 ---------- */
    static parseSpec = (spec) => {
        const [head, tail] = spec.split("@");
        const [pathPart, option] = tail.split("#");

        const path = pathPart.split(".").map((seg) => {
            if (seg.endsWith("[]"))   // 원본 배열
                return {key: seg.slice(0, -2), isArray: true, isObjArray: false};
            if (seg.endsWith("[o]"))  // {0:…,1:…} 형태의 객체배열
                return {key: seg.slice(0, -3), isArray: true, isObjArray: true};
            return {key: seg, isArray: false, isObjArray: false};
        });

        return {msgType: head, path, option: option ?? null};
    };

    /* ---------- 값 수집 ---------- */
    static collectValues = (obj, path, res = []) => {
        if (!obj) return res;
        const [{key, isArray, isObjArray}, ...rest] = path;

        const nodes = isArray
            ? isObjArray
                ? Object.values(obj[key] ?? {})           // [o]
                : (obj[key] ?? [])                        // []
            : [obj[key]];                               // 단일

        nodes.forEach((node) =>
            rest.length
                ? DataManager.collectValues(node, rest, res)
                : node !== undefined && res.push(node)
        );
        return res;
    };

    /* ---------- 값 복원 ---------- */
    static restoreValues = (obj, path, injector) => {
        if (!obj) return;
        const [{key, isArray, isObjArray}, ...rest] = path;

        // nodes: [값], keys: 각 값의 식별자(인덱스 또는 객체키)
        let nodes, keys;
        if (isArray) {
            if (isObjArray) {
                const entries = Object.entries(obj[key] ?? {});      // {k: v}...
                nodes = entries.map((e) => e[1]);
                keys = entries.map((e) => e[0]);
            } else {
                nodes = obj[key] ?? [];
                keys = nodes.map((_, i) => i);
            }
        } else {
            nodes = [obj[key]];
            keys = [null];
        }

        nodes.forEach((node, idx) => {
            if (rest.length) {
                DataManager.restoreValues(node, rest, injector);
            } else {
                // 리프 자체가 배열(예: labels[])인 경우
                if (isArray && Array.isArray(node)) {
                    node.forEach((v, i) => {
                        node[i] = injector(v);
                    });
                } else if (node != null) {
                    const newVal = injector(node);
                    if (isArray) {
                        if (isObjArray) obj[key][keys[idx]] = newVal;
                        else obj[key][idx] = newVal;
                    } else {
                        obj[key] = newVal;
                    }
                }
            }
        });
    };


    /* ---------- 옵션 훅 ---------- */
    static optionHooks = {
        tokenize: {
            // 1개의 원본 문자열 → N개의 조각
            extract: (str) =>
                DataManager.tokenize(str)
                    .filter((t) => t.type === "text")
                    .map((t) => t.content),
            // 조각을 next()로 돌려받아 원래 포맷에 삽입
            restore: (original, next) => {
                const tokens = DataManager.tokenize(original);
                tokens.forEach((t) => {
                    if (t.type === "text") t.content = next();
                });
                return tokens.map((t) => t.content).join("");
            },
        },
        quote: {
            extract: (str) => {
                if (typeof str !== "string") return [];
                const re = /_{10,}\n\n<.+?>([\s\S]+?)\n<.+?>/;
                const m = str.match(re);
                return m ? [m[1]] : [];
            },

            restore: (original, next) => {
                if (typeof original !== "string") return original;
                const re = /_{10,}\n\n<.+?>([\s\S]+?)\n<.+?>/;
                const repl = next();                 // 배열의 첫 요소
                return original.replace(re, (full, g1) => full.replace(g1, repl));
            },
        },
        lines: {
            // 1개의 원본 문자열 → N개의 “줄” 조각
            extract: (str) =>
                typeof str === "string" ? str.split("\n") : [],

            // next() 로 돌려받은 조각들을 원래 줄 구조에 삽입
            restore: (original, next) => {
                if (typeof original !== "string") return original;

                const parts = original.split("\n");          // 줄 개수 파악
                const rebuilt = parts.map(() => next()).join("\n");

                // 원본이 마지막에 개행을 갖고 있었다면 그대로 유지
                return original.endsWith("\n") ? rebuilt + "\n" : rebuilt;
            },
        },
        // 추가 훅은 여기에...
    };

    /* ---------- 프로세서 팩토리 ---------- */
    static makeProcessor = (spec) => {
        const {msgType, path, option} = DataManager.parseSpec(spec);
        const hook = DataManager.optionHooks[option] ?? null;

        return {
            match: (d) =>
                d?.msg === msgType &&
                DataManager.collectValues(d, path).some((v) => v != null),

            extract: (d) => {
                const vals = DataManager.collectValues(d, path);
                return hook ? vals.flatMap((v) => hook.extract(v)) : vals;
            },

            restore: (d, arr, useClone = false) => {
                const out = DataManager.target(d, useClone);
                const next = DataManager.makeNext(arr);

                if (hook) {
                    const wrapperNext = () => next();
                    const inject = (node) => hook.restore(node, wrapperNext);
                    DataManager.restoreValues(out, path, inject);
                } else {
                    DataManager.restoreValues(out, path, next);
                }
                return out;
            },
        };
    };

    /* ---------- 프로세서 등록 ---------- */
    static register = (specs) =>
        Object.fromEntries(specs.map((s) => [s, DataManager.makeProcessor(s)]));

    /* ---------- 기본 스펙 목록 ---------- */
    static processors = DataManager.register([
        "game_ended@message",
        "map@cells[].mon.name",
        "map@cells[].mon.plural",
        "menu@alt_more",
        "menu@items[].text",
        "menu@more",
        "menu@title.text",
        "msgs@messages[].text",
        "msgs@messages[].text#tokenize",
        "player@god",
        "player@inv[o].inscription",
        "player@inv[o].name",
        "player@inv[o].qty_field",
        "player@inv[o].action_verb",
        "player@place",
        "player@quiver_desc",
        "player@species",
        "player@status[].desc",
        "player@status[].light",
        "player@status[].text",
        "player@title",
        "player@unarmed_attack",
        "txt@lines[o]",
        "ui-push@actions",
        "ui-push@body",
        "ui-push@body#quote",
        "ui-push@body#lines",
        "ui-push@highlight",
        "ui-push@main-items.buttons[].description",
        "ui-push@main-items.buttons[].labels[]",
        "ui-push@more",
        "ui-push@prompt",
        "ui-push@quote",
        "ui-push@spellset[].label",
        "ui-push@spellset[].spells[].effect",
        "ui-push@spellset[].spells[].letter",
        "ui-push@spellset[].spells[].range_string",
        "ui-push@spellset[].spells[].schools",
        "ui-push@spellset[].spells[].title",
        "ui-push@sub-items.buttons[].description",
        "ui-push@sub-items.buttons[].label",
        "ui-push@text",
        "ui-push@text#lines",
        "ui-push@text#tokenize",
        "ui-push@feats[].title",
        "ui-push@teats[].body",
        "ui-push@title",
        "ui-state@highlight",
        "ui-state@text",
        "update_menu@alt_more",
        "update_menu@more",
        "update_menu@title.text",
        "update_menu_items@items[].text",
    ]);

    static {
        const isHangul = cp => cp >= 0xAC00 && cp <= 0xD7A3;
        const hasBatchim = word => {
            const cp = word.charCodeAt(word.length - 1);
            return isHangul(cp) && (cp - 0xAC00) % 28 !== 0;   // 종성 0 → 받침 없음
        };
        const jongIdx = word => {
            const cp = word.charCodeAt(word.length - 1);
            return isHangul(cp) ? (cp - 0xAC00) % 28 : -1;     // -1 = 비한글
        };
        const isUnicode = cp => /[^\u0000-\u00ff]/.test(cp)

        /* ===== 헬퍼: 조사 생성 ===== */
        const josa = (withBatchim, withoutBatchim, paren = false) => w => {
            const last = w.charCodeAt(w.length - 1);
            if (!isHangul(last)) {
                return paren ? `${w}${withBatchim}(${withoutBatchim})` : w + withoutBatchim;
            }
            return w + (hasBatchim(w) ? withBatchim : withoutBatchim);
        };

        /* ===== 헬퍼: 유니코드 문자 크기 고려한 padding ===== */
        const padString = padStart => (originalStr, size, shouldEscape = false) => {
            size = parseInt(size);
            if (size <= 0) return originalStr;

            let strForCount;

            if (typeof shouldEscape === "string") {
                shouldEscape = (shouldEscape.toLowerCase() === "true");
            }

            if (shouldEscape) {
                // Considering HTML special character expression
                strForCount = originalStr.replace(/&amp;/g, '&')
                                         .replace(/&lt;/g, '<')
                                         .replace(/&gt;/g, '>')
                                         .replace(/&quot;/g, '"');
            } else {
                strForCount = originalStr;
            }

            let currentSize = 0;

            for (let i = 0; i < strForCount.length; i++) {
                currentSize += (isUnicode(strForCount[i]) ? 2 : 1);
            }

            let result = originalStr;
            for (let i = 0; i < size - currentSize; i++) {
                if (padStart) {
                    result = ' ' + result;
                } else {
                    result += ' ';
                }
            }

            return result;
        }

        /* ===== this.functions ===== */
        this.functions = {
            /* 주제·보조 */
            '은': josa('은', '는', true),
            '는': josa('은', '는', true),

            /* 주격 */
            '이': josa('이', '가', true),
            '가': josa('이', '가', true),

            /* 목적격 */
            '을': josa('을', '를', true),
            '를': josa('을', '를', true),

            /* 대등·동반 */
            '과': josa('과', '와'),
            '와': josa('과', '와'),
            '이랑': josa('이랑', '랑'),
            '랑': josa('이랑', '랑'),

            /* 선택·비교·양보 */
            '이나': josa('이나', '나'),
            '나': josa('이나', '나'),
            '이라도': josa('이라도', '라도'),
            '라도': josa('이라도', '라도'),
            '이든': josa('이든', '든'),
            '든': josa('이든', '든'),
            '이든지': josa('이든지', '든지'),
            '든지': josa('이든지', '든지'),

            /* 인용 */
            '이라고': josa('이라고', '라고'),
            '라고': josa('이라고', '라고'),

            /* 조건·원인 */
            '이라면': josa('이라면', '라면'),
            '라면': josa('이라면', '라면'),
            '이라서': josa('이라서', '라서'),
            '라서': josa('이라서', '라서'),

            /* 병렬 */
            '이며': josa('이며', '며'),
            '며': josa('이며', '며'),
            '이고': josa('이고', '고'),
            '고': josa('이고', '고'),

            /* 의문·강조 */
            '이냐': josa('이냐', '냐'),
            '냐': josa('이냐', '냐'),
            '이니': josa('이니', '니'),
            '니': josa('이니', '니'),

            /* 호격 */
            '아': josa('아', '야'),
            '야': josa('아', '야'),

            /* 방향·수단 : 특수 규칙 */
            '으로': w => {
                const j = jongIdx(w);
                return w + ((j === 0 || j === 8 || j === -1) ? '로' : '으로');
            },
            '로': w => {
                const j = jongIdx(w);
                return w + ((j === 0 || j === 8 || j === -1) ? '로' : '으로');
            },
            /* 문자열 길이 정렬 */
            'PAD_STRING': padString(false),
            'PAD_STRING_START': padString(true),
            'PAD_STRING_END': padString(false)
        };
    }
}
