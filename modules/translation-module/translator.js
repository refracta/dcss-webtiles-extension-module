export default class Translator {
    constructor(matchers, functions, debug = false) {
        this.matchers = matchers;
        this.functions = functions;
        this.debug = debug;

        this.categories = {};
        for (const matcher of this.matchers) {
            try {
                if (typeof matcher.regex === 'string') {
                    matcher.regexp = new RegExp(matcher.regex);
                } else if (typeof matcher.regex === 'object') {
                    matcher.regexp = new RegExp(matcher.regex.pattern, matcher.regex.flags);
                }
            } catch (e) {
                console.error(e);
                continue;
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
            for (const category in this.categories) {
                this.categories[category].matchers.sort((m1, m2) => (m1.priority ?? 0) - (m2.priority ?? 0));
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
        const result = {
            target,
            translation: target,
            status: 'untranslated',      // 주(直) 번역 결과
            totalStatus: 'untranslated' // 집계 결과(최외곽에만 남김)
        };

        /* 0. 카테고리 존재 여부 확인 */
        const cat = this.categories[category];
        if (!cat) return result;

        /* 1. O(1) 완전 일치(raw) 매치 */
        const rawMatcher = cat.rawMap[target];
        if (rawMatcher) {
            if (this.debug) {
                result.matcher = rawMatcher;
            }
            const rawValue = typeof rawMatcher.replaceValue === 'string'
                ? rawMatcher.replaceValue
                : rawMatcher.replaceValue?.[language] ?? target;

            result.translation = this.replaceSpecialPattern(rawValue);
            result.status = 'translated';
            result.totalStatus = 'translated';
            return result;
        }
        /* 2. 정규식 매치 순회 */
        let translations = [];        // 하위 번역 모음(여기엔 totalStatus 제거본만 저장)
        for (const matcher of cat.matchers) {
            const matchResults = target.match(matcher.regexp);

            if (!matchResults) continue;
            if (this.debug) {
                result.matcher = matcher;
            }

            const baseReplace = typeof matcher.replaceValue === 'string'
                ? matcher.replaceValue
                : matcher.replaceValue?.[language] ?? target;

            let replaced = target.replace(matcher.regexp, baseReplace);

            /* ── 캡처 그룹별 재귀 번역 ───────────────────── */
            for (let i = 1; i < matchResults.length; i++) {
                const capture = matchResults[i];
                const groupCatNames = matcher.groups[i - 1];
                if (!groupCatNames || capture === undefined) {
                    let currentResult = {
                        target: capture,
                        translation: capture,
                        status: 'translated',
                        totalStatus: 'translated'
                    };
                    if (this.debug) {
                        currentResult = {category: null, ...currentResult};
                    }
                    translations.push(currentResult);
                    continue;
                }

                let done = false;
                for (const name of groupCatNames) {
                    // if (name === category) continue;
                    if (!this.categories[name]) continue;

                    let subRes = this.translate(capture, language, name);
                    if (this.debug) {
                        subRes = {category: name, ...subRes};
                    }
                    if (subRes.status === 'translated') {
                        replaced = replaced.replace(capture, subRes.translation);
                        translations.push(subRes);
                        done = true;
                        break;
                    }
                }
                if (!done) {
                    translations.push({target: capture, status: 'untranslated', totalStatus: 'untranslated'});
                }
            }

            result.translation = this.replaceSpecialPattern(replaced);
            result.status = 'translated';

            /* ── (A) totalStatus 계산 ─────────────────────── */
            const translatedCnt = translations.filter(t => t.totalStatus === 'translated').length;
            result.totalStatus = translations.length >= 0 && translatedCnt === translations.length ? 'translated' : 'part-translated';
            result.translations = translations;

            if (matcher.ignorePartTranslated && result.totalStatus !== 'translated') {
                // 이번 매처 결과를 버리고 다음 매처 계속 탐색
                translations = [];
                result.translation = target;
                result.status = 'untranslated';
                result.totalStatus = 'untranslated';
                continue;
            }

            break;
        }

        if (result.status === 'untranslated') {
            result.totalStatus = 'untranslated';
        }

        result.translations = translations;

        return result;
    }
}
