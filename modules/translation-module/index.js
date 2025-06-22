import DataManager from "./data-manager.js";
import Translator from "./translator.js";

export default class TranslationModule {
    static name = 'TranslationModule';
    static version = '0.1';
    static dependencies = ['IOHook', 'RCManager', 'SiteInformation'];
    static description = '(Beta) This module provides i18n feature.';

    sendMessage(text) {
        const {IOHook} = DWEM.Modules;
        IOHook.handle_message({
            msg: 'msgs', messages: [{text}]
        });
    }

    escapeHTML(str) {
        return str.replace(/[&<>"']/g, function (match) {
            const escapeMap = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            };
            return escapeMap[match];
        });
    }


    loadTranslationFont(language) {
        document.querySelector('#translation_font')?.remove();

        const HEAD = document.head || document.getElementsByTagName('head')[0];
        let fontFamily;

        switch (language) {
            case 'ko':
                window.WebFontConfig = {
                    custom: {
                        families: ['Nanum Gothic Coding'],
                        urls: ['https://fonts.googleapis.com/earlyaccess/nanumgothiccoding.css']
                    }
                };
                fontFamily = '"Nanum Gothic Coding", monospace';
                const wf = document.createElement('script');
                wf.src = (location.protocol === 'https:' ? 'https' : 'http') +
                    '://ajax.googleapis.com/ajax/libs/webfont/1.4.10/webfont.js';
                wf.type = 'text/javascript';
                wf.async = true;
                HEAD.insertBefore(wf, HEAD.firstChild);
                break;

            case 'ja':
                const preconnect = document.createElement('link');
                preconnect.rel = 'preconnect';
                preconnect.href = 'https://cdn.jsdelivr.net';
                HEAD.appendChild(preconnect);

                const fontFace = document.createElement('style');
                fontFace.setAttribute('data-noto-mono', 'true');
                fontFace.textContent = `
@font-face{
  font-family:"Noto Sans Mono CJK JP";
  font-style:normal;
  font-weight:400;
  font-display:swap;
  src:local("NotoSansMonoCJKjp-Regular"),
      local("Noto Sans Mono CJK JP Regular"),
      url("https://cdn.jsdelivr.net/gh/notofonts/noto-cjk/Sans/Mono/NotoSansMonoCJKjp-Regular.otf") format("opentype");
}
@font-face{
  font-family:"Noto Sans Mono CJK JP";
  font-style:normal;
  font-weight:700;
  font-display:swap;
  src:local("NotoSansMonoCJKjp-Bold"),
      local("Noto Sans Mono CJK JP Bold"),
      url("https://cdn.jsdelivr.net/gh/notofonts/noto-cjk/Sans/Mono/NotoSansMonoCJKjp-Bold.otf") format("opentype");
}
`;
                HEAD.appendChild(fontFace);

                fontFamily = '"Noto Sans Mono CJK JP", "MS Gothic", monospace';
                break;

            default:
                return;
        }

        const fontStyle = document.createElement('style');
        fontStyle.id = 'translation_font';
        fontStyle.appendChild(
            document.createTextNode(`* { font-family: ${fontFamily}; }`)
        );
        fontStyle.appendChild(
            document.createTextNode(`#stats .bar > *, #stats .bar { height: 1.2em !important; }`)
        );
        HEAD.appendChild(fontStyle);
    }

    unloadTranslationFont() {
        document.querySelector('#translation_font')?.remove();
    }


    #getTranslationConfig(rcfile) {
        const {RCManager} = DWEM.Modules;
        const translationLanguage = RCManager.getRCOption(rcfile, 'translation_language', 'string');
        const translationFile = RCManager.getRCOption(rcfile, 'translation_file', 'string', 'https://translation.nemelex.cards/build/latest.json');
        const useTranslationFont = RCManager.getRCOption(rcfile, 'use_translation_font', 'boolean', true);
        const translationDebug = RCManager.getRCOption(rcfile, 'translation_debug', 'boolean', false);

        return {
            translationLanguage, useTranslationFont, translationFile, translationDebug
        };
    }

    onLoad() {
        const {IOHook, RCManager} = DWEM.Modules;
        const {SourceMapperRegistry: SMR} = DWEM;
        this.DataManager = DataManager;

        function playerUIInjector() {
            const original_update_stats_pane = update_stats_pane;

            update_stats_pane = function () {
                original_update_stats_pane();
                const {TranslationModule} = DWEM.Modules;
                const language = TranslationModule.config.translationLanguage;
                if (language) {
                    const translate = (text, category) => TranslationModule.escapeHTML(TranslationModule.translator.translate(text, language, category).translation);
                    if (language === 'ja') {
                        $('#stats_titleline').text(player.title.replace(',', '').trim() + '『' + player.name + '』');
                    }

                    const wizard_TR = translate("*WIZARD*", 'interface@stats.mode');
                    const explore_TR = translate("*EXPLORE*", 'interface@stats.mode');
                    $("#stats_wizmode").text(player.wizard ? wizard_TR : player.explore ? explore_TR : "");
                    if (player.god != "") {
                        const species_god_TR = translate(player.species + " of " + player.god, 'interface@stats.species_god');
                        $("#stats_species_god").text(species_god_TR);
                    }
                    const gozag_TR = translate("Gozag", 'interface@stats.gozag');
                    if (player.god === gozag_TR) {
                        $("#stats_gozag_gold_label").text(" " + translate("Gold: ", 'interface@stats.text'));
                        $("#stats_gozag_gold_label").css("padding-left", "0.5em");
                        $("#stats_gozag_gold").text(player.gold);
                        $("#stats_piety").text("");
                    }

                    const hp_TR = translate("HP:", 'ui-panel@stats');
                    const health_TR = translate("Health:", 'ui-panel@stats');
                    $("#stats_hpline > .stats_caption").text(
                        (player.real_hp_max != player.hp_max) ? hp_TR : health_TR);

                    $("#stats_mpline > .stats_caption").text(translate("Magic:", 'interface@stats.text'))
                    $("#stats_leftcolumn span:contains('AC:')").text(translate("AC:", 'interface@stats.text'))
                    $("#stats_leftcolumn span:contains('EV:')").text(translate("EV:", 'interface@stats.text'))
                    $("#stats_leftcolumn span:contains('SH:')").text(translate("SH:", 'interface@stats.text'))
                    $("#stats_leftcolumn span:contains('XL:')").text(translate("XL:", 'interface@stats.text'))
                    $("#stats_leftcolumn span:contains('Next:')").text(translate("Next:", 'interface@stats.text'))
                    $("#stats_leftcolumn span:contains('Noise:')").text(translate("Noise:", 'interface@stats.text'))
                    $("#stats_rightcolumn span:contains('Str:')").text(translate("Str:", 'interface@stats.text'))
                    $("#stats_rightcolumn span:contains('Int:')").text(translate("Int:", 'interface@stats.text'))
                    $("#stats_rightcolumn span:contains('Dex:')").text(translate("Dex:", 'interface@stats.text'))
                    $("#stats_rightcolumn span:contains('Place:')").text(translate("Place:", 'interface@stats.text'))
                    $("#stats_rightcolumn span:contains('Time:')").text(translate("Time:", 'interface@stats.text'))
                    $("#stats_rightcolumn span:contains('Gold:')").text(translate("Gold:", 'interface@stats.text'))
                }
            }
        }

        const playerUIMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${playerUIInjector.toString()}()`);
        SMR.add('./player', playerUIMapper);

        function mouseControlInjector() {
            const {TranslationModule} = DWEM.Modules;
            const language = TranslationModule.config.translationLanguage;
            if (language) {
                const translate = (text, category) => TranslationModule.escapeHTML(TranslationModule.translator.translate(text, language, category).translation);

                handle_cell_tooltip = function handle_cell_tooltip(ev) {
                    var map_cell = map_knowledge.get(ev.cell.x, ev.cell.y);

                    var text = ""
                    // don't show a tooltip unless there's a monster in the square. It might
                    // be good to expand this (local tiles does), but there are a number
                    // of issues. First, I found the tooltips pretty disruptive in my
                    // testing, most of the time you don't care. Second, there are some
                    // challenges in filling tooltip info outside of a narrow slice of
                    // cases where the info is neatly packaged for webtiles. E.g. a tooltip
                    // that tells you whether you can move to a square is very hard to
                    // construct on the client side (see tilerg-dgn.cc:tile_dungeon_tip for
                    // the logic that would be necessary.)
                    // minimal extensions: tooltips for interesting features, like statues,
                    // doors, stairs, altars.

                    if (!map_cell.mon)
                        return;

                    // `game` force-set in game.js because of circular reference issues
                    if (game.can_target() && map_knowledge.visible(map_cell)) {
                        // XX just looking case has weird behavior
                        text += translate("Left click: select target", 'interface@mouse.text');
                    }
                    // XX a good left click tooltip for click travel is very hard to
                    // construct on the client side...
                    // see tilerg-dgn.cc:tile_dungeon_tip for the logic that would be
                    // necessary.

                    if (game.can_describe()) {
                        // only show right-click desc if there's something else in the
                        // tooltip, it's too disruptive otherwise
                        if (text)
                            text += "<br>"; // XX something better than <br>s
                        text += translate("Right click: describe", 'interface@mouse.text');
                    }

                    if (text)
                        text = "<br><br>" + text;
                    text = map_cell.mon.name + text;
                    show_tooltip(text, ev.pageX + 10, ev.pageY + 10);
                }
            }
        }

        const mouseControlMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${mouseControlInjector.toString()}()`);
        SMR.add('./mouse_control', mouseControlMapper);

        function actionPanelInjector() {
            const {TranslationModule} = DWEM.Modules;
            const language = TranslationModule.config.translationLanguage;
            if (language) {
                const translate = (text, category) => TranslationModule.escapeHTML(TranslationModule.translator.translate(text, language, category).translation);

                show_tooltip = function show_tooltip(x, y, slot) {
                    if (slot >= filtered_inv.length) {
                        hide_tooltip();
                        return;
                    }
                    $tooltip.css({
                        top: y + 10 + "px",
                        left: x + 10 + "px"
                    });
                    if (slot == -2) {
                        $tooltip.html(`<span>${translate("Left click: minimize", 'interface@action_panel.text')}</span><br />`
                            + `<span>${translate("Right click: open settings", 'interface@action_panel.text')}</span>`);
                    } else if (slot == -1 && game.get_input_mode() == enums.mouse_mode.COMMAND)
                        $tooltip.html(`<span>${translate("Left click: show main menu", 'interface@action_panel.text')}</span>`);
                    else {
                        var item = filtered_inv[slot];
                        $tooltip.empty().text(player.index_to_letter(item.slot) + " - ");
                        $tooltip.append(player.inventory_item_desc(item.slot));
                        if (game.get_input_mode() == enums.mouse_mode.COMMAND) {
                            if (item.action_verb)
                                $tooltip.append(`<br /><span>${translate("Left click: " + item.action_verb.toLowerCase(), 'interface@action_panel.text')}`
                                    + "</span>");
                            $tooltip.append(`<br /><span>${translate("Right click: describe", 'interface@action_panel.text')}</span>`);
                        }
                    }
                    $tooltip.show();
                }
            }
        }

        const actionPanelMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${actionPanelInjector.toString()}()`);
        SMR.add('./action_panel', actionPanelMapper);


        // const adder = DataManager.makeAdder(s => typeof s === 'string');
        RCManager.addHandlers('translation-handler', {
            onGameInitialize: async (rcfile) => {
                try {
                    this.config = this.#getTranslationConfig(rcfile);
                    if (this.config.translationLanguage) {
                        this.loadTranslationFont(this.config.translationLanguage);
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 5_000); // 10초 후 abort
                        const {
                            matchers,
                            time,
                            messages
                        } = await fetch(this.config.translationFile, {
                            cache: "no-store",
                            signal: controller.signal
                        }).then((r) => r.json());

                        clearTimeout(timeoutId);

                        this.matchers = matchers;
                        if (this.config.translationDebug) {
                            console.log('[TranslationModule] Config:', this.config);
                            console.log('[TranslationModule] Build time:', new Date(time));
                            console.log('[TranslationModule] Messages:', messages);
                            console.log(`[TranslationModule] Matchers file loaded (${this.matchers.length}):`, this.matchers);
                        }
                        this.translator = new Translator(this.matchers, DataManager.functions, this.config.translationDebug);
                        IOHook.handle_message.before.addHandler('translation-handler', (data) => {

                            if (this.config.translationDebug) {
                                console.log('[TranslationModule] data received:', JSON.parse(JSON.stringify(data)));
                            }
                            for (const key in DataManager.processors) {
                                const {match, extract, restore} = DataManager.processors[key];
                                if (match(data)) {
                                    const list = extract(data);
                                    const translatedList = list.map((unitText) => {
                                        try {
                                            return this.translator.translate(unitText, this.config.translationLanguage, key)
                                        } catch (e) {
                                            if (this.config.translationDebug) {
                                                console.error(`[TranslationModule] ErrorKey: ${JSON.stringify(key)}, ErrorText: ${JSON.stringify(unitText)}`);
                                            }
                                            throw e;
                                        }
                                    });
                                    if (this.config.translationDebug) {
                                        for (let i = 0; i < list.length; i++) {
                                            console.log(`%c<${key} [${i}]:ORIGINAL>%c\n${list[i]}\n%c<${key} [${i}]:TRANSLATED>%c\n${translatedList[i].translation}\n%c<${key} [${i}]:RESULT>%c\n%o\n${JSON.stringify(translatedList[i], null, 4)}\nhttps://translation.nemelex.cards/admin/core/matcher/add/?category=${encodeURIComponent(key)}&raw=${encodeURIComponent(list[i])}&priority=0`, 'font-weight: bold; color: red', '', 'font-weight: bold; color: blue', '', 'font-weight: bold; color: grey', '', translatedList[i]);
                                        }
                                    }
                                    restore(data, translatedList.map(result => result.translation));
                                }
                            }
                        });
                        this.sendMessage(`<cyan>[TranslationModule]</cyan> ${matchers.length} matcher data loaded successfully. (${new Date(time).toLocaleString()}) / Thanks to ${messages[0]}`)

                        if (this.config.translationDebug) {
                            let stamp = null;
                            const runChangeDetector = async () => {
                                const res = await fetch(this.config.translationFile, {
                                    method: "HEAD",
                                    mode: "cors",
                                    cache: "no-store",
                                });
                                const lm = res.headers.get("last-modified") ?? "";
                                const cl = res.headers.get("content-length") ?? "";
                                const newStamp = `${lm}|${cl}`;
                                if (stamp && newStamp !== stamp) {
                                    const {
                                        matchers,
                                        time,
                                        messages
                                    } = await fetch(this.config.translationFile, {
                                        cache: "no-store",
                                        signal: controller.signal
                                    }).then((r) => r.json());
                                    this.matchers = matchers;
                                    this.translator = new Translator(this.matchers, DataManager.functions, this.config.translationDebug);
                                    this.sendMessage(`<cyan>[TranslationModule]</cyan> DebugAutoReload: ${matchers.length} matcher data loaded successfully. (${new Date(time).toLocaleString()})`);
                                    if (this.debugAutoReloadCallback) {
                                        try {
                                            this.debugAutoReloadCallback();
                                        } catch (e) {

                                        }
                                    }
                                }
                                stamp = newStamp;
                            }
                            runChangeDetector();
                            setInterval(runChangeDetector, 1000);
                        }
                    }
                } catch (e) {
                    this.translator = {translate: (text) => ({translation: text})};
                    console.error(e);
                }
            }, onGameEnd: () => {
                this.unloadTranslationFont();
                IOHook.handle_message.before.removeHandler('translation-handler');
            }
        });
    }

}
