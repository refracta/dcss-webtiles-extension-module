import DataManager from "./data-manager.js";
import Translator from "./translator.js";

export default class TranslationModule {
    static name = 'TranslationModule';
    static version = '0.1';
    static dependencies = ['IOHook', 'RCManager', 'SiteInformation'];
    static description = '(Beta) This module provides i18n feature.';

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
        const translationFile = RCManager.getRCOption(rcfile, 'translation_file', 'string', 'https://translation.nemelex.cards/build/latest.json');
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
                    const {
                        matchers,
                        time,
                        messages
                    } = await fetch(this.config.translationFile, {cache: "no-store"}).then((r) => r.json());
                    this.matchers = matchers;
                    if (this.config.translationDebug) {
                        console.log('[TranslationModule] Config:', this.config);
                        console.log('[TranslationModule] Build time:', new Date(time));
                        console.log('[TranslationModule] Messages:', messages);
                        console.log(`[TranslationModule] Matchers file loaded (${this.matchers.length}):`, this.matchers);
                    }
                    this.translator = new Translator(this.matchers, DataManager.functions);
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
                                        console.log(`%c<${key} [${i}]:RAW>%c\n${list[i]}\n%c<${key} [${i}]:TRANSLATED>%c\n${translatedList[i].translation}\n%c<${key} [${i}]:RESULT>%c\n${JSON.stringify(translatedList[i], null, 4)}`, 'font-weight: bold; color: red', '', 'font-weight: bold; color: blue', '', 'font-weight: bold; color: grey', '');
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
