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
                let topLevelFunction = null;
                estraverse.traverse(ast, {
                    enter: function (node) {
                        if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') {
                            if (!topLevelFunction) {
                                topLevelFunction = node;
                            }
                        }
                    }
                });

                if (topLevelFunction) {
                    const newExpression = esprima.parseScript(injectSource).body[0].expression;
                    const lastIndex = topLevelFunction.body.body.length - 1;
                    const lastStatement = topLevelFunction.body.body[lastIndex];
                    if (lastStatement.type === 'ReturnStatement') {
                        topLevelFunction.body.body.splice(lastIndex, 0, {
                            type: 'ExpressionStatement', expression: newExpression
                        });
                    }
                }

                return escodegen.generate(ast).slice(1, -2);
            };
        }
    }

    getSourceMapper(type, ...parameters) {
        return this.predefinedSourceMappers[type](...parameters);
    }
}
