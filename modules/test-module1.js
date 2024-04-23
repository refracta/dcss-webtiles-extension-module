export default class TestModule1 {
    static name = 'TestModule1'
    static version = '1.0'
    static dependencies = []

    onLoad() {
        const {SourceMapperRegistry} = DEM;

        function injectSource1() {
            DEM.Modules.TestModule1.toggle = toggle;
        }

        function injectSource2() {
            DEM.Modules.TestModule1.clear = clear;
        }

        const myMapper1 = SourceMapperRegistry.getSourceMapper('BeforeReturnInjection', `!${injectSource1.toString()}()`);
        SourceMapperRegistry.add('chat:latest', myMapper1);

        const myMapper2 = SourceMapperRegistry.getSourceMapper('BeforeReturnInjection', `!${injectSource2.toString()}()`);
        SourceMapperRegistry.add('chat:latest', myMapper2);
    }
}
