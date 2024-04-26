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
        const mainModules = ['chat', 'client', 'comm'];
        for (const module of mainModules) {
            this.matchers[module] = {'latest': this.getModuleMatcher(module)};
        }
        const gameModules = ['./action_panel', './cell_renderer', './display', './dungeon_renderer', './enums', './game', './map_knowledge', './menu', './messages', './minimap', './monster_list', './mouse_control', './options', './player', './scroller', './text', './textinput', './tileinfo-dngn', './tileinfo-feat', './tileinfo-floor', './tileinfo-gui', './tileinfo-icons', './tileinfo-main', './tileinfo-player', './tileinfo-wall', './tileinfos', './ui-layouts', './ui', './util', './view_data'];
        for (const module of gameModules) {
            this.matchers[module] = {'latest': this.getModuleMatcher(module.substring(1))};
        }
    }
}
