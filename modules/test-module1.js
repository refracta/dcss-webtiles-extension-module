export default class TestModule1 {
    static name = 'TestModule1'
    static version = '1.0'
    static dependencies = []

    onLoad() {
        const {SourceMapperRegistry: SMR} = DEM;

        function injectSource1() {
            DEM.Modules.TestModule1.toggle = toggle;
        }

        const myMapper1 = SMR.getSourceMapper('BeforeReturnInjection', `!${injectSource1.toString()}()`);
        SMR.add('chat', myMapper1);


        function injectSource2() {
            DEM.Modules.TestModule1.clear = clear;
        }

        const myMapper2 = SMR.getSourceMapper('BeforeReturnInjection', `!${injectSource2.toString()}()`);
        SMR.add('chat', myMapper2);
    }
}
