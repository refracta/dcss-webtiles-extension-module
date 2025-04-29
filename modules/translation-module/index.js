import DataManager from "./data-manager.js";
import Translator from "./translator.js";

export default class TranslationModule {
    static name = 'TranslationModule';
    static version = '0.1';
    static dependencies = ['IOHook', 'RCManager', 'SiteInformation'];
    static description = '(Beta) This module provides i18n feature.';


    matchers = [];
    // regex 대신 raw matcher도
    // 엔진 다듬기 후에 wtrec utils 손보고
    // tools 페이지에 페이지 하나씩 만들
    // translation pack을 단위로 번역
    constructor() {
        this.matchers = [{
            category: 'message', regex: {pattern: '(.+)', flags: ''}, replaceValue: '$1', groups: ['system']
        }, {
            category: 'system',
            regex: '\\<lightgrey\\>Press \\<white\\>\\?\\<lightgrey\\> for a list of commands and other information\\.',
            replaceValue: '<lightgrey>명령어 목록 또는 기타 정보를 보려면 <white>?<lightgrey>를 누르세요.',
            groups: ['user', 'class']
        }, {
            category: 'system',
            regex: '^Welcome back, (.+) (the .+).',
            replaceValue: '돌아오신 것을 환영합니다. {$2:이} $1',
            groups: ['user', 'class']
        }, {
            category: 'class', raw: 'the Armataur Hunter', replaceValue: '아머타우르스 사냥꾼',
        }, {
            category: 'user', raw: 'dummy', replaceValue: '아머타우르스 사냥꾼',
        }, {
            category: 'hit_messages',
            regex: 'The rebounding (.+?) hits (.+?)\\.',
            replaceValue: '반동하는 {$1:이} {$2:를} 때렸다.',
            groups: ['magic', 'target']
        }, {
            category: 'magic', regex: 'Welcome back, (.+) (the .+).', replaceValue: '돌아오신 것을 환영합니다',
        }, {
            category: 'target', regex: 'Welcome back, (.+) (the .+).', replaceValue: '돌아오신 것을 환영합니다',
        }, {
            category: 'target', raw: 'hello', replaceValue: '돌아오신 것을 환영합니다',
        }]

        this.functions = {
            '이': (a) => {
                return a + 'E'
            }
        };
    }
    /*
    function apply_font_patch() {
	if (typeof fontStyle === 'undefined') {
		window.WebFontConfig = {
			custom : {
				families : ['Nanum Gothic Coding'],
				urls : ['https://fonts.googleapis.com/earlyaccess/nanumgothiccoding.css']
			}
		};
		(function () {
			var wf = document.createElement('script');
			wf.src = ('https:' == document.location.protocol ? 'https' : 'http') +
			'://ajax.googleapis.com/ajax/libs/webfont/1.4.10/webfont.js';
			wf.type = 'text/javascript';
			wf.async = 'true';
			var s = document.getElementsByTagName('script')[0];
			s.parentNode.insertBefore(wf, s);
		})();
		var fontStyle = document.createElement("style");
		fontStyle.setAttribute("id", "font_style_apply");
		fontStyle.appendChild(document.createTextNode(
				'* {font-family: "Nanum Gothic Coding", monospace;}'));
		document.getElementsByTagName("head")[0].appendChild(fontStyle);
	}
}
function disapply_font_patch() {
	var font_tag = $('#font_style_apply');
	if (font_tag) {
		font_tag.remove();
	}
}
     */

    #getTranslationConfig(rcfile) {
        const {RCManager} = DWEM.Modules;
        const translation = RCManager.getRCOption(rcfile, 'translation', 'string');
        const translationFile = RCManager.getRCOption(rcfile, 'translation_file', 'string', 'http://localhost:8000/build/matchers/latest.json');
        const translationDebug = RCManager.getRCOption(rcfile, 'translation_debug', 'boolean');

        return {
            translation, translationFile, translationDebug
        };
    }

    onLoad() {
        const {IOHook, RCManager, SiteInformation} = DWEM.Modules;

        RCManager.addHandlers('translation-handler', {
            onGameInitialize: async (rcfile) => {
                this.translationConfig = this.#getTranslationConfig(rcfile);
                console.log(this.translationConfig.translationFile);
                this.translationFile = await fetch(this.translationConfig.translationFile, {cache: "no-store"}).then((r) => r.json());
                this.translator = new Translator(this.translationFile, this.functions);
                console.log(this.translationFile)
                IOHook.handle_message.before.addHandler('translation-handler', (data) => {
                    console.log(data);

                    for (const key in DataManager.processors) {
                        const {match, extract, restore} = DataManager.processors[key];
                        if (match(data)) {
                            const list = extract(data);
                            // console.log(list.map((unitText) => this.translate(unitText, 'ko', 'message')))
                            const language = this.translationConfig.translation;
                            const translatedList = list.map((unitText) => this.translator.translate(unitText, language, key).translation);
                            console.log(list.map((unitText) => this.translator.translate(unitText, language, key)), language, key)
                            // console.log(list, translatedList);
                            restore(data, translatedList);
                        }
                    }
                });
            },
            onGameEnd: () => {
                IOHook.handle_message.after.removeHandler('translation-handler');
            }
        });
    }

}
