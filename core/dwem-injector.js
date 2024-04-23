export default class DWEMInjector {
    replacers = []

    installDefineHooker() {
        let originalDefine;
        let proxiedDefine;
        Object.defineProperty(window, 'define', {
            get: () => proxiedDefine, set: (newValue) => {
                if (newValue) {
                    originalDefine = newValue;
                    proxiedDefine = new Proxy(originalDefine, {
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
