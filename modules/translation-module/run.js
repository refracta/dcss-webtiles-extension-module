import TranslationModule from "./index.js";

/*
[{
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
 */

const translation = new TranslationModule()
console.log(translation.translate('Welcome back, 123 the Armataur Hunter.', 'korean', 'message'))
console.log(JSON.stringify(translation.translate('Welcome back, 123 the Armataur Hunter.', 'korean', 'message')))
