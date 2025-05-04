import Translator from "./translator.js";

const matchers = [{
    'category': 'root',
    "regex": '(.+)',
    "replaceValue": '$1 :틀1',
    groups: [
        ['one', 'two']
    ],
    ignorePartTranslated: false
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
},
    {
      "category": "player@species",
      "raw": 'Deep Elf',
      "replaceValue": '딥 엘프',
    },    {
        "category": "backgrounds",
        "raw": 'Fire Elementalist',
        "replaceValue": '화염 술사',
    },
    {
        "category": "msgs@messages[].text#tokenize",
        "replaceValue": {
            "ko": "돌아온 것을 환영합니다. $2 $3 $1."
        },
        "regex": "^Welcome back, (.+?) the (.+?) (.+ .+)\\.",
        "groups": [
            null,
            "player@species",
            "backgrounds"
        ],
        "ignorePartTranslated": true,
        "priority": 0
    },
    {
        "category": "msgs@messages[].text#tokenize",
        "replaceValue": {
            "ko": "돌아온 것을 환영합니다. $2 $3 $1."
        },
        "regex": "^Welcome back, (.+?) the (.+ .+) (.+?)\\.",
        "groups": [
            null,
            "player@species",
            "backgrounds"
        ],
        "ignorePartTranslated": true,
        "priority": 0
    },
    {
        "category": "msgs@messages[].text#tokenize",
        "replaceValue": {
            "ko": "돌아온 것을 환영합니다. $2 $3 $1."
        },
        "regex": "^Welcome back, (.+?) the (.+ .+) (.+ .+)\\.",
        "groups": [
            null,
            "player@species",
            "backgrounds"
        ],
        "ignorePartTranslated": true,
        "priority": 0
    }
    ,
    {
        "category": "update_menu_items@items[].text",
        "replaceValue": {
            "ko": "~ 혹은 Ctrl-D"
        },
        "raw": "~ or Ctrl-D\n",
        "priority": 0,
        "groups": []
    }
];
const translator = new Translator(matchers, {}, true);
console.log(translator.translate("Welcome back, labter the Deep Elf Fire Elementalist.", 'ko', "msgs@messages[].text#tokenize"));
// console.log(translator.translate('one three', 'ko', 'root'));
// console.log(translator.translate('one two', 'ko', 'root'));
// console.log(translator.translate("~ or Ctrl-D\n", 'ko', 'update_menu_items@items[].text'));
