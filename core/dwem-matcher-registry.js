export default class DWEMMatcherRegistry {
    matchers = {}

    getSourceMatcher(regexp) {
        return ({args}) => {
            const func = args.find(arg => typeof arg === 'function');
            return func ? func.toString().match(regexp) : false;
        };
    }

    getModuleMatcher(regexp) {
        return ({module}) => module.match(regexp);
    }

    getURLMatcher(regexp) {
        return ({url}) => url.match(regexp);
    }

    constructor() {
        const mainModules = ['chat', 'client', 'comm'];
        for (const module of mainModules) {
            this.matchers[module] = {'latest': this.getModuleMatcher(new RegExp(`^${module}$`))};
        }
        const gameModules = ['./action_panel', './cell_renderer', './display', './dungeon_renderer', './enums', './game', './map_knowledge', './menu', './messages', './minimap', './monster_list', './mouse_control', './options', './player', './scroller', './text', './textinput', './tileinfo-dngn', './tileinfo-feat', './tileinfo-floor', './tileinfo-gui', './tileinfo-icons', './tileinfo-main', './tileinfo-player', './tileinfo-wall', './tileinfos', './ui-layouts', './ui', './util', './view_data'];
        for (const module of gameModules) {
            this.matchers[module] = {'latest': this.getModuleMatcher(new RegExp(`${module.substring(1)}$`))};
        }
    }
}
