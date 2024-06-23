export default class SiteInformation {
    static name = 'SiteInformation'
    static version = '1.0'
    static dependencies = []
    static description = '(Library) This module returns site information to other modules.'

    onLoad() {
        const {SourceMapperRegistry: SMR, MatcherRegistry: MR} = DWEM;

        function clientInjectSource() {
            Object.defineProperty(DWEM.Modules.SiteInformation, 'current_user', {
                get: function () {
                    return current_user;
                },
                enumerable: true,
                configurable: true
            });
            Object.defineProperty(DWEM.Modules.SiteInformation, 'watching', {
                get: function () {
                    return watching;
                },
                enumerable: true,
                configurable: true
            });
            Object.defineProperty(DWEM.Modules.SiteInformation, 'watching_username', {
                get: function () {
                    return watching_username;
                },
                enumerable: true,
                configurable: true
            });
            Object.defineProperty(DWEM.Modules.SiteInformation, 'playing', {
                get: function () {
                    return playing;
                },
                enumerable: true,
                configurable: true
            });
            Object.defineProperty(DWEM.Modules.SiteInformation, 'current_hash', {
                get: function () {
                    return current_hash;
                },
                enumerable: true,
                configurable: true
            });
        }

        const clientMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${clientInjectSource.toString()}()`);
        SMR.add('client', clientMapper);
    }
}
