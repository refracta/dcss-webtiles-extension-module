export default class DEMMatcherRegistry {
    matchers = {}

    getDepsMatcher(deps) {
        return ([dependencies]) => JSON.stringify(deps) === JSON.stringify(dependencies);
    }

    getSourceMatcher(regexp) {
        return ([argumentsList]) => {
            const func = argumentsList.find(arg => typeof arg === 'function')
            return func ? func.toString().match(regexp) : false
        };
    }

    constructor() {
        this.matchers['chat'] = {};
        this.matchers['chat']['latest'] = this.getDepsMatcher(['jquery', 'comm', 'linkify']);
        this.matchers['client'] = {};
        this.matchers['client']['latest'] = this.getDepsMatcher(["exports", "jquery", "key_conversion", "chat", "comm", "contrib/jquery.cookie", "contrib/jquery.tablesorter", "contrib/jquery.waitforimages", "contrib/inflate"]);
        this.matchers['comm'] = {};
        this.matchers['comm']['latest'] = this.getDepsMatcher(["jquery", "contrib/jquery.json"]);
        this.matchers['./action_panel'] = {};
        this.matchers['./action_panel']['latest'] = this.getDepsMatcher(["jquery", "comm", "client", "./cell_renderer", "./enums", "./options", "./player", "./tileinfo-icons", "./tileinfo-gui", "./tileinfo-main", "./util", "./focus-trap", "./ui"]);
        this.matchers['./cell_renderer'] = {};
        this.matchers['./cell_renderer']['latest'] = this.getDepsMatcher(["jquery", "./view_data", "./tileinfo-gui", "./tileinfo-main", "./tileinfo-player", "./tileinfo-icons", "./tileinfo-dngn", "./enums", "./map_knowledge", "./tileinfos", "./player", "./options", "contrib/jquery.json"]);
        this.matchers['./display'] = {};
        this.matchers['./display']['latest'] = this.getDepsMatcher(["jquery", "comm", "./map_knowledge", "./view_data", "./monster_list", "./minimap", "./dungeon_renderer"]);
        this.matchers['./dungeon_renderer'] = {};
        this.matchers['./dungeon_renderer']['latest'] = this.getDepsMatcher(["jquery", "comm", "./cell_renderer", "./map_knowledge", "./options", "./tileinfo-dngn", "./util", "./view_data", "./enums", "./mouse_control"]);
        this.matchers['./enums'] = {};
        this.matchers['./enums']['latest'] = this.getSourceMatcher(`TODO: Generate this automatically from enum.h?`);
        this.matchers['./game'] = {};
        this.matchers['./game']['latest'] = this.getDepsMatcher(["jquery", "exports", "comm", "client", "key_conversion", "./dungeon_renderer", "./display", "./minimap", "./enums", "./messages", "./options", "./mouse_control", "./text", "./menu", "./action_panel", "./player", "./ui", "./ui-layouts"]);
        this.matchers['./map_knowledge'] = {};
        this.matchers['./map_knowledge']['latest'] = this.getDepsMatcher(["jquery", "./enums", "./util"]);
        this.matchers['./menu'] = {};
        this.matchers['./menu']['latest'] = this.getDepsMatcher(["jquery", "comm", "client", "./ui", "./enums", "./cell_renderer", "./util", "./options", "./scroller"]);
        this.matchers['./messages'] = {};
        this.matchers['./messages']['latest'] = this.getDepsMatcher(["jquery", "comm", "client", "./textinput", "./util", "./options"]);
        this.matchers['./minimap'] = {};
        this.matchers['./minimap']['latest'] = this.getDepsMatcher(["jquery", "./map_knowledge", "./dungeon_renderer", "./view_data", "./tileinfo-player", "./tileinfo-main", "./tileinfo-dngn", "./enums", "./player", "./options", "./util"]);
        this.matchers['./monster_list'] = {};
        this.matchers['./monster_list']['latest'] = this.getDepsMatcher(["jquery", "./map_knowledge", "./cell_renderer", "./dungeon_renderer", "./options", "./util"]);
        this.matchers['./mouse_control'] = {};
        this.matchers['./mouse_control']['latest'] = this.getDepsMatcher(["jquery", "comm", "./dungeon_renderer", "./tileinfo-gui", "./map_knowledge", "./enums"]);
        this.matchers['./options'] = {};
        this.matchers['./options']['latest'] = this.getSourceMatcher(`function get_option(name)`);
        this.matchers['./player'] = {};
        this.matchers['./player']['latest'] = this.getDepsMatcher(["jquery", "comm", "client", "./enums", "./map_knowledge", "./messages", "./options", "./util"]);
        this.matchers['./scroller'] = {};
        this.matchers['./scroller']['latest'] = this.getDepsMatcher(["jquery", "./simplebar"]);
        this.matchers['./text'] = {};
        this.matchers['./text']['latest'] = this.getSourceMatcher(`function get_container(id)`);
        this.matchers['./textinput'] = {};
        this.matchers['./textinput']['latest'] = this.getDepsMatcher(["jquery", "comm", "client", "./enums", "./util", "./options", "./ui"]);
        this.matchers['./tileinfo-dngn'] = {};
        this.matchers['./tileinfo-dngn']['latest'] = this.getDepsMatcher(["jquery", "./tileinfo-floor", "./tileinfo-wall", "./tileinfo-feat",]);
        this.matchers['./tileinfo-feat'] = {};
        this.matchers['./tileinfo-feat']['latest'] = this.getDepsMatcher(["./tileinfo-wall"]);
        this.matchers['./tileinfo-floor'] = {};
        this.matchers['./tileinfo-floor']['latest'] = this.getSourceMatcher('exports.DNGN_UNSEEN');
        this.matchers['./tileinfo-gui'] = {};
        this.matchers['./tileinfo-gui']['latest'] = this.getDepsMatcher(["./tileinfo-player"]);
        this.matchers['./tileinfo-icons'] = {};
        this.matchers['./tileinfo-icons']['latest'] = this.getDepsMatcher(["./tileinfo-gui"]);
        this.matchers['./tileinfo-main'] = {};
        this.matchers['./tileinfo-main']['latest'] = this.getDepsMatcher(["./tileinfo-feat"]);
        this.matchers['./tileinfo-player'] = {};
        this.matchers['./tileinfo-player']['latest'] = this.getDepsMatcher(["./tileinfo-main"]);
        this.matchers['./tileinfo-wall'] = {};
        this.matchers['./tileinfo-wall']['latest'] = this.getDepsMatcher(["./tileinfo-floor"]);
        this.matchers['./tileinfos'] = {};
        this.matchers['./tileinfos']['latest'] = this.getDepsMatcher(["./tileinfo-floor", "./tileinfo-wall", "./tileinfo-feat", "./tileinfo-player", "./tileinfo-main", "./tileinfo-gui", "./tileinfo-icons"]);
        this.matchers['./ui-layouts'] = {};
        this.matchers['./ui-layouts']['latest'] = this.getDepsMatcher(["jquery", "comm", "client", "./ui", "./enums", "./cell_renderer", "./util", "./scroller", "./tileinfo-main", "./tileinfo-gui", "./tileinfo-player", "./options"]);
        this.matchers['./ui'] = {};
        this.matchers['./ui']['latest'] = this.getDepsMatcher(["jquery", "comm", "client", "./options", "./focus-trap"]);
        this.matchers['./util'] = {};
        this.matchers['./util']['latest'] = this.getSourceMatcher(`// this is a bit weird because the crawl binary never closes color`);
        this.matchers['./view_data'] = {};
        this.matchers['./view_data']['latest'] = this.getSourceMatcher(`// Compare tilereg-dgn.cc`);
    }
}
