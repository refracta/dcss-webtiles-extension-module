export default class DWEMInjector {
    replacers = []

    installDefineHooker() {
        window.define = new Proxy(window.define, {
            apply: (target, thisArg, argumentsList) => {
                for (const replacer of this.replacers) {
                    const {matcher, mapper} = replacer;
                    if (matcher(argumentsList)) {
                        argumentsList = mapper(argumentsList);
                    }
                }
                return target.apply(thisArg, argumentsList);
            }
        });
    }
}
