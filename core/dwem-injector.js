export default class DWEMInjector {
    replacers = []

    installDefineHooker() {
        window.define = new Proxy(window.define, {
            apply: (target, thisArg, argumentsList) => {
                const script = document.currentScript;
                const module = script?.getAttribute('data-requiremodule');
                const url = script?.getAttribute('src');
                if (module && url) {
                    for (const replacer of this.replacers) {
                        const {matcher, mapper} = replacer;
                        if (matcher({module, url, args: argumentsList})) {
                            argumentsList = mapper(argumentsList);
                        }
                    }
                }
                return target.apply(thisArg, argumentsList);
            }
        });
    }
}
