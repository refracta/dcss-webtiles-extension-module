export default class SiteInformation {
    static name = 'SiteInformation'
    static version = '1.0'
    static dependencies = []
    static description = '(Library) This module returns site information to other modules.'

    onLoad() {
        const {SourceMapperRegistry: SMR, MatcherRegistry: MR} = DWEM;

        function clientInjectSource() {
            const {SiteInformation} = DWEM.Modules;
            Object.defineProperty(SiteInformation, 'current_user', {
                get: function () {
                    return current_user;
                },
                enumerable: true,
                configurable: true
            });
            Object.defineProperty(SiteInformation, 'watching', {
                get: function () {
                    return watching;
                },
                enumerable: true,
                configurable: true
            });
            Object.defineProperty(SiteInformation, 'watching_username', {
                get: function () {
                    return watching_username;
                },
                enumerable: true,
                configurable: true
            });
            Object.defineProperty(SiteInformation, 'playing', {
                get: function () {
                    return playing;
                },
                enumerable: true,
                configurable: true
            });
            Object.defineProperty(SiteInformation, 'current_hash', {
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
