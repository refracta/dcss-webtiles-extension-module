export default class DWEMMatcherRegistry {
    matchers = {}

    getDepsMatcher(deps) {
        return ({args}) => JSON.stringify(deps) === JSON.stringify(args[0]);
    }

    getSourceMatcher(regexp) {
        return ({args}) => {
            const func = args.find(arg => typeof arg === 'function');
            return func ? func.toString().match(regexp) : false;
        };
    }

    getModuleMatcher(targetModule) {
        return ({module}) => module.endsWith(targetModule);
    }

    getURLMatcher(targetURL) {
        return ({url}) => url.endsWith(targetURL);
    }

    constructor() {
        this.matchers['chat'] = {};
        this.matchers['chat']['latest'] = this.getModuleMatcher('chat');
        this.matchers['client'] = {};
        this.matchers['client']['latest'] = this.getModuleMatcher('client');
        this.matchers['comm'] = {};
        this.matchers['comm']['latest'] = this.getModuleMatcher('comm');
        this.matchers['./action_panel'] = {};
        this.matchers['./action_panel']['latest'] = this.getModuleMatcher('/action_panel');
        this.matchers['./cell_renderer'] = {};
        this.matchers['./cell_renderer']['latest'] = this.getModuleMatcher('/cell_renderer');
        this.matchers['./display'] = {};
        this.matchers['./display']['latest'] = this.getModuleMatcher('/display');
        this.matchers['./dungeon_renderer'] = {};
        this.matchers['./dungeon_renderer']['latest'] = this.getModuleMatcher('/dungeon_renderer');
        this.matchers['./enums'] = {};
        this.matchers['./enums']['latest'] = this.getModuleMatcher('/enums');
        this.matchers['./game'] = {};
        this.matchers['./game']['latest'] = this.getModuleMatcher('/game');
        this.matchers['./map_knowledge'] = {};
        this.matchers['./map_knowledge']['latest'] = this.getModuleMatcher('/map_knowledge');
        this.matchers['./menu'] = {};
        this.matchers['./menu']['latest'] = this.getModuleMatcher('/menu');
        this.matchers['./messages'] = {};
        this.matchers['./messages']['latest'] = this.getModuleMatcher('/messages');
        this.matchers['./minimap'] = {};
        this.matchers['./minimap']['latest'] = this.getModuleMatcher('/minimap');
        this.matchers['./monster_list'] = {};
        this.matchers['./monster_list']['latest'] = this.getModuleMatcher('/monster_list');
        this.matchers['./mouse_control'] = {};
        this.matchers['./mouse_control']['latest'] = this.getModuleMatcher('/mouse_control');
        this.matchers['./options'] = {};
        this.matchers['./options']['latest'] = this.getSourceMatcher(`function get_option(name)`);
        this.matchers['./player'] = {};
        this.matchers['./player']['latest'] = this.getModuleMatcher('/player');
        this.matchers['./scroller'] = {};
        this.matchers['./scroller']['latest'] = this.getModuleMatcher('/scroller');
        this.matchers['./text'] = {};
        this.matchers['./text']['latest'] = this.getModuleMatcher('/text');
        this.matchers['./textinput'] = {};
        this.matchers['./textinput']['latest'] = this.getModuleMatcher('/textinput');
        this.matchers['./tileinfo-dngn'] = {};
        this.matchers['./tileinfo-dngn']['latest'] = this.getModuleMatcher('/tileinfo-dngn');
        this.matchers['./tileinfo-feat'] = {};
        this.matchers['./tileinfo-feat']['latest'] = this.getModuleMatcher('/tileinfo-feat');
        this.matchers['./tileinfo-floor'] = {};
        this.matchers['./tileinfo-floor']['latest'] = this.getModuleMatcher('/tileinfo-floor');
        this.matchers['./tileinfo-gui'] = {};
        this.matchers['./tileinfo-gui']['latest'] = this.getModuleMatcher('/tileinfo-gui');
        this.matchers['./tileinfo-icons'] = {};
        this.matchers['./tileinfo-icons']['latest'] = this.getModuleMatcher('/tileinfo-icons');
        this.matchers['./tileinfo-main'] = {};
        this.matchers['./tileinfo-main']['latest'] = this.getModuleMatcher('/tileinfo-main');
        this.matchers['./tileinfo-player'] = {};
        this.matchers['./tileinfo-player']['latest'] = this.getModuleMatcher('/tileinfo-player');
        this.matchers['./tileinfo-wall'] = {};
        this.matchers['./tileinfo-wall']['latest'] = this.getModuleMatcher('/tileinfo-wall');
        this.matchers['./tileinfos'] = {};
        this.matchers['./tileinfos']['latest'] = this.getModuleMatcher('/tileinfos');
        this.matchers['./ui-layouts'] = {};
        this.matchers['./ui-layouts']['latest'] = this.getModuleMatcher('/ui-layouts');
        this.matchers['./ui'] = {};
        this.matchers['./ui']['latest'] = this.getModuleMatcher('/ui');
        this.matchers['./util'] = {};
        this.matchers['./util']['latest'] = this.getModuleMatcher('/util');
        this.matchers['./view_data'] = {};
        this.matchers['./view_data']['latest'] = this.getModuleMatcher('/view_data');
        console.log(Object.keys(this.matchers));
    }
}
