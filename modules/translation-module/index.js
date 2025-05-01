import DataManager from "./data-manager.js";
import Translator from "./translator.js";

export default class TranslationModule {
    static name = 'TranslationModule';
    static version = '0.1';
    static dependencies = ['IOHook', 'RCManager', 'SiteInformation'];
    static description = '(Beta) This module provides i18n feature.';

    constructor() {
        /* ===== 한글·받침 판별 유틸 ===== */
        const isHangul = cp => cp >= 0xAC00 && cp <= 0xD7A3;
        const hasBatchim = word => {
            const cp = word.charCodeAt(word.length - 1);
            return isHangul(cp) && (cp - 0xAC00) % 28 !== 0;   // 종성 0 → 받침 없음
        };
        const jongIdx = word => {
            const cp = word.charCodeAt(word.length - 1);
            return isHangul(cp) ? (cp - 0xAC00) % 28 : -1;     // -1 = 비한글
        };

        /* ===== 헬퍼: 조사 생성 ===== */
        const josa = (withBatchim, withoutBatchim, paren = false) => w => {
            const last = w.charCodeAt(w.length - 1);
            if (!isHangul(last)) {
                return paren ? `${w}${withBatchim}(${withoutBatchim})` : w + withoutBatchim;
            }
            return w + (hasBatchim(w) ? withBatchim : withoutBatchim);
        };

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
            }
        };
    }

    loadTranslationFont(language) {
        if (language === 'ko') {
            window.WebFontConfig = {
                custom: {
                    families: ['Nanum Gothic Coding'],
                    urls: ['https://fonts.googleapis.com/earlyaccess/nanumgothiccoding.css']
                }
            };
            (function () {
                const wf = document.createElement('script');
                wf.src = ('https:' == document.location.protocol ? 'https' : 'http') + '://ajax.googleapis.com/ajax/libs/webfont/1.4.10/webfont.js';
                wf.type = 'text/javascript';
                wf.async = 'true';
                const s = document.getElementsByTagName('script')[0];
                s.parentNode.insertBefore(wf, s);
            })();
            const fontStyle = document.createElement("style");
            fontStyle.setAttribute("id", "translation_font");
            fontStyle.appendChild(document.createTextNode('* {font-family: "Nanum Gothic Coding", monospace;}'));
            document.getElementsByTagName("head")[0].appendChild(fontStyle);
        }
    }

    unloadTranslationFont() {
        document.querySelector('#translation_font')?.remove();
    }


    #getTranslationConfig(rcfile) {
        const {RCManager} = DWEM.Modules;
        const translationLanguage = RCManager.getRCOption(rcfile, 'translation_language', 'string');
        const translationFile = RCManager.getRCOption(rcfile, 'translation_file', 'string', 'http://localhost:8000/build/matchers/latest.json');
        const useTranslationFont = RCManager.getRCOption(rcfile, 'use_translation_font', 'boolean');
        const translationDebug = RCManager.getRCOption(rcfile, 'translation_debug', 'boolean');

        return {
            translationLanguage, useTranslationFont, translationFile, translationDebug
        };
    }

    onLoad() {
        const {IOHook, RCManager} = DWEM.Modules;

        // const adder = DataManager.makeAdder(s => typeof s === 'string');
        RCManager.addHandlers('translation-handler', {
            onGameInitialize: async (rcfile) => {
                this.config = this.#getTranslationConfig(rcfile);
                if (this.config.translationLanguage) {
                    this.loadTranslationFont(this.config.translationLanguage);
                    this.matchers = await fetch(this.config.translationFile, {cache: "no-store"}).then((r) => r.json());
                    if (this.config.translationDebug) {
                        console.log('[TranslationModule] Config:', this.config);
                        console.log(`[TranslationModule] Matchers file loaded (${this.matchers.length}):`, this.matchers);
                    }
                    this.translator = new Translator(this.matchers, this.functions);
                    IOHook.handle_message.before.addHandler('translation-handler', (data) => {

                        if (this.config.translationDebug) {
                            console.log('[TranslationModule] data received:', JSON.parse(JSON.stringify(data)));
                        }
                        for (const key in DataManager.processors) {
                            const {match, extract, restore} = DataManager.processors[key];
                            if (match(data)) {
                                const list = extract(data);
                                const translatedList = list.map((unitText) => this.translator.translate(unitText, this.config.translationLanguage, key));
                                if (this.config.translationDebug) {
                                    for (let i = 0; i < list.length; i++) {
                                        console.log(`%c<${key} [${i}]:RAW>%c\n${list[i]}\n%c<${key} [${i}]:TRANSLATED>%c\n${translatedList[i].translation}`, 'font-weight: bold; color: red', '', 'font-weight: bold; color: blue', '');
                                        console.log(`Translation result:`, translatedList[i]);
                                    }
                                }
                                restore(data, translatedList.map(result => result.translation));
                            }
                        }
                    });
                }
            }, onGameEnd: () => {
                this.unloadTranslationFont();
                IOHook.handle_message.after.removeHandler('translation-handler');
            }
        });
    }

}
