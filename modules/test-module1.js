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
    }
}
