export default class DWEMInjector {
    replacers = []

    installDefineHooker() {
        let originalDefine;
        Object.defineProperty(window, '_define', {
            get: () => window.define, set: (newValue) => {
                if (newValue) {
                    originalDefine = newValue;
                    window.define = new Proxy(originalDefine, {
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
        });
    }
}
