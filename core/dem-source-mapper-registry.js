import esprima from 'https://cdn.skypack.dev/esprima';
import estraverse from 'https://cdn.skypack.dev/estraverse';
import escodegen from 'https://cdn.skypack.dev/escodegen';

export default class DEMSourceMapperRegistry {
    sourceMappers = {};

    add(matcherIdentifier, sourceMapper) {
        const [name, version] = [...matcherIdentifier.split(':'), 'latest'];
        matcherIdentifier = `${name}:${version}`;
        this.sourceMappers[matcherIdentifier] = this.sourceMappers[matcherIdentifier] || [];
        this.sourceMappers[matcherIdentifier].push(sourceMapper);
    }

    predefinedSourceMappers = {
        'BeforeReturnInjection': (injectSource) => {
            return (source) => {
                const ast = esprima.parseScript(`(${source})`);
                estraverse.traverse(ast, {
                    enter: function (node, parent) {
                        if (node.type === 'ReturnStatement' && parent.type === 'BlockStatement') {
                            const newExpression = esprima.parseScript(injectSource).body[0].expression;
                            const returnIndex = parent.body.indexOf(node);
                            parent.body.splice(returnIndex, 0, {
                                type: 'ExpressionStatement', expression: newExpression
                            });
                        }
                    }
                });
                return escodegen.generate(ast).slice(1, -2);
            };
        }
    }

    getSourceMapper(type, ...parameters) {
        return this.predefinedSourceMappers[type](...parameters);
    }
}
