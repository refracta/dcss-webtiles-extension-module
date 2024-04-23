export default class DEMMatcherRegistry {
    matchers = {}

    getDepsMatcher(deps) {
        return ([dependencies]) => JSON.stringify(deps) === JSON.stringify(dependencies);
    }

    constructor() {
        this.matchers['chat'] = {};
        this.matchers['chat']['latest'] = this.getDepsMatcher(['jquery', 'comm', 'linkify']);
    }
}
