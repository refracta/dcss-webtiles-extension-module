export default class Translator {
    constructor(matchers, functions) {
        this.matchers = matchers;
        this.functions = functions;

        this.categories = {};
        for (const matcher of this.matchers) {
            if (typeof matcher.regex === 'string') {
                matcher.regexp = new RegExp(matcher.regex);
            } else if (typeof matcher.regex === 'object') {
                matcher.regexp = new RegExp(matcher.regex.pattern, matcher.regex.flags);
            }
            matcher.groups = matcher?.groups?.map?.(g => typeof g === 'string' ? [g] : g) || [];
            if (!this.categories[matcher.category]) {
                this.categories[matcher.category] = {matchers: [], rawMap: {}};
            }
            if (typeof matcher.raw === 'string') {
                this.categories[matcher.category].rawMap[matcher.raw] = matcher;
            } else if (matcher.regexp) {
                this.categories[matcher.category].matchers.push(matcher);
            }
        }
    }

    replaceSpecialPattern(text) {
        return text.replace(/\{((?:\\.|[^{}])+?):([\p{L}\p{N}_]+)\}/gsu, (match, paramsStr, funcName) => {
            if (this.functions[funcName]) {
                const params = [];
                let currParam = '';
                let escaping = false;
                for (let i = 0; i < paramsStr.length; i++) {
                    const char = paramsStr[i];

                    if (escaping) {
                        currParam += char;
                        escaping = false;
                    } else if (char === '\\') {
                        escaping = true;
                    } else if (char === ',') {
                        params.push(currParam);
                        currParam = '';
                    } else {
                        currParam += char;
                    }
                }
                params.push(currParam);
                const unescapeParam = (str) => str.replace(/\\(.)/gs, '$1');
                const args = params.map(unescapeParam);
                return this.functions[funcName](...args);
            } else {
                return match;
            }
        });
    }

    translate(target, language, category) {
        const result = {target, translation: target, status: 'untranslated'};

        /* ────────────────────────────────────────────────────────────────
           0. 카테고리 존재 여부 확인
        ──────────────────────────────────────────────────────────────── */
        const cat = this.categories[category];
        if (!cat) return result;            // 없는 카테고리면 그대로 반환

        /* ────────────────────────────────────────────────────────────────
           1. O(1) 완전 일치(raw) 매치
        ──────────────────────────────────────────────────────────────── */
        const rawMatcher = cat.rawMap[target];
        if (rawMatcher) {
            const rawValue = typeof rawMatcher.replaceValue === 'string' ? rawMatcher.replaceValue : rawMatcher.replaceValue?.[language] ?? target;

            result.translation = this.replaceSpecialPattern(rawValue);
            result.status = 'translated';
            return result;                  // 바로 반환하므로 재귀 없음
        }

        /* ────────────────────────────────────────────────────────────────
           2. 정규식 매치 순회
        ──────────────────────────────────────────────────────────────── */
        const translations = [];
        for (const matcher of cat.matchers) {
            const matchResults = target.match(matcher.regexp);
            if (!matchResults) continue;    // 매치 실패 → 다음으로

            const baseReplace = typeof matcher.replaceValue === 'string' ? matcher.replaceValue : matcher.replaceValue?.[language] ?? target;

            let replaced = target.replace(matcher.regexp, baseReplace);

            /* ── 캡처 그룹별 재귀 번역 ──────────────────────────────── */
            for (let i = 1; i < matchResults.length; i++) {
                const capture = matchResults[i];
                const groupCatNames = matcher.groups[i - 1] || [];   // ex) ['user','class']

                let done = false;
                for (const name of groupCatNames) {
                    if (name === category) continue;                 // 같은 카테고리 → 무한루프 방지
                    if (!this.categories[name]) continue;            // 존재하지 않는 카테고리 무시

                    const subRes = this.translate(capture, language, name);
                    if (subRes.status === 'translated') {
                        replaced = replaced.replace(capture, subRes.translation);
                        translations.push(subRes);
                        done = true;
                        break;
                    }
                }
                if (!done) {
                    translations.push({target: capture, status: 'untranslated'});
                }
            }

            result.translation = this.replaceSpecialPattern(replaced);
            result.status = 'translated';
            if (translations.length) result.translations = translations;
            break;
        }

        return result;
    }
}
