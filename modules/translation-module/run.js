import Translator from "./translator.js";

const matchers = [{
    'category': 'root',
    "regex": '(.+)',
    "replaceValue": '$1 :틀1',
    groups: [
        ['one', 'two']
    ],
    ignorePartTranslated: true
}, {
    'category': 'root',
    "regex": '(.+) (.+)',
    "replaceValue": '$1 :틀2',
    groups: ['one', 'two']
}, {
    'category': 'one',
    "raw": 'one',
    "replaceValue": '1'
}, {
    'category': 'two',
    "raw": 'two',
    "replaceValue": '2'
}, {
    'category': 'two',
    "raw": 'two',
    "replaceValue": '2'
}];
const translator = new Translator(matchers, {}, true);
console.log(translator.translate('one two', 'ko', 'two'));
console.log(translator.translate('one two', 'ko', 'root'));
