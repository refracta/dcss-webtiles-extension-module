export default class TestModule1 {
    static name = 'TestModule1'
    static version = '1.0'
    static dependencies = []

    onLoad() {
        const {SourceMapperRegistry: SMR, MatcherRegistry: MR} = DWEM;

        function injectSource1() {
            DWEM.Modules.TestModule1.toggle = toggle;
        }

        const myMapper1 = SMR.getSourceMapper('BeforeReturnInjection', `!${injectSource1.toString()}()`);
        MR.matchers['my-matcher'] = {'test': MR.getModuleMatcher('chat')};
        SMR.add('my-matcher:test', myMapper1);

        function injectSource2() {
            DWEM.Modules.TestModule1.clear = clear;
        }

        const myMapper2 = SMR.getSourceMapper('BeforeReturnInjection', `!${injectSource2.toString()}()`);
        SMR.add('chat', myMapper2);

        function injectSource3() {
            let original_get_option = get_option;
            get_option = function (name) {
                switch (name) {
                    case 'tile_unseen_col':
                        return {r: 255, g: 0, b: 0};
                    case 'tile_floor_col':
                        return {r: 0, g: 255, b: 0};
                    case 'tile_wall_col':
                        return {r: 0, g: 0, b: 255};
                }
                return original_get_option(name)
            }
        }

        const myMapper3 = SMR.getSourceMapper('BeforeReturnInjection', `!${injectSource3.toString()}()`);
        // SMR.add('./options', myMapper3);
    }
}
