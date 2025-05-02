export default class Translator {
    constructor(matchers, functions) {
        this.matchers = matchers;
        this.functions = functions;

        this.categories = {};
        for (const matcher of this.matchers) {
            if (typeof matcher.regex === 'string') {
                matcher.regexp = new RegExp(matcher.regex);
            } else if (typeof matcher.regex === 'object') {
                try {
                    matcher.regexp = new RegExp(matcher.regex.pattern, matcher.regex.flags);
                } catch (e) {
                    console.error(e);
                    continue;
                }
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
        const result = {
            target,
            translation: target,
            status: 'untranslated',      // 주(直) 번역 결과
            total_status: 'untranslated' // 집계 결과(최외곽에만 남김)
        };

        /* 0. 카테고리 존재 여부 확인 */
        const cat = this.categories[category];
        if (!cat) return result;

        /* 1. O(1) 완전 일치(raw) 매치 */
        const rawMatcher = cat.rawMap[target];
        if (rawMatcher) {
            const rawValue = typeof rawMatcher.replaceValue === 'string'
                ? rawMatcher.replaceValue
                : rawMatcher.replaceValue?.[language] ?? target;

            result.translation = this.replaceSpecialPattern(rawValue);
            result.status = 'translated';
            result.total_status = 'translated';     // 하위 번역 없음
            return result;
        }

        /* 2. 정규식 매치 순회 */
        const translations = [];        // 하위 번역 모음(여기엔 total_status 제거본만 저장)
        for (const matcher of cat.matchers) {
            const matchResults = target.match(matcher.regexp);
            if (!matchResults) continue;

            const baseReplace = typeof matcher.replaceValue === 'string'
                ? matcher.replaceValue
                : matcher.replaceValue?.[language] ?? target;

            let replaced = target.replace(matcher.regexp, baseReplace);

            /* ── 캡처 그룹별 재귀 번역 ───────────────────── */
            for (let i = 1; i < matchResults.length; i++) {
                const capture = matchResults[i];
                const groupCatNames = matcher.groups[i - 1] || [];

                let done = false;
                for (const name of groupCatNames) {
                    if (name === category) continue;          // 무한루프 방지
                    if (!this.categories[name]) continue;

                    const subRes = this.translate(capture, language, name);

                    // ── total_status 제거 후 translations 에 push ──
                    const {total_status: _omit, ...clean} = subRes;
                    translations.push(clean);

                    if (subRes.status === 'translated') {
                        replaced = replaced.replace(capture, subRes.translation);
                        done = true;
                    }
                    break;   // 첫 번째 매치된 카테고리만 사용
                }
                if (!done && groupCatNames.length === 0) {
                    translations.push({target: capture, status: 'untranslated'});
                }
            }

            result.translation = this.replaceSpecialPattern(replaced);
            result.status = 'translated';
            break;
        }

        /* 3. total_status 집계(최상위에만 존재) */
        if (translations.length) {
            const translatedCnt = translations.filter(t => t.status === 'translated').length;

            result.total_status =
                translatedCnt === translations.length ? 'translated'
                    : translatedCnt > 0 ? 'part-translated'
                        : 'untranslated';

            result.translations = translations;  // 하위 객체엔 total_status 없음
        } /* else 하위 번역이 없으므로 total_status는 기본값 유지 */

        return result;
    }
}
