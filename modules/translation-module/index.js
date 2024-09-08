class TranslationModule {
    static name = 'TranslationModule';
    static version = '0.1';
    static dependencies = ['IOHook'];
    static description = '(Beta) This module provides i18n feature.';

    list = [
        'a - a +0 hand axe (weapon)',
        'c - a +0 short sword',
        'b - a +0 animal skin',
        'j - 4 scrolls of blinking',
        'z - a wand of quicksilver (7)',
        'B - the +7 great mace "Firestarter" {flame, immolate, rFlCloud, rF++}'
    ];

    matchers = [];

    constructor() {
        this.matchers = {
            'INVENTORY_ITEM': {regex: /([a-zA-Z]) - (.+)/},
            'A_ITEM': {},
            'THE_ITEM': {},
            'N_ITEM': {},
            'ARTIFACT': {},
        }
    }

    // translation_language  = ko

    onLoad() {

    }
}

const translation = new TranslationModule();
console.log(TranslationModule.list)
