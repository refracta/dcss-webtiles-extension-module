import esprima from 'https://cdn.skypack.dev/esprima';
import estraverse from 'https://cdn.skypack.dev/estraverse';
import escodegen from 'https://cdn.skypack.dev/escodegen';

export default class DWEMSourceMapperRegistry {
    sourceMappers = {};

    add(matcherIdentifier, sourceMapper, priority = 0) {
        if (!Array.isArray(matcherIdentifier)) {
            matcherIdentifier = [matcherIdentifier]
        }
        matcherIdentifier = Array.from(new Set(matcherIdentifier.map(i => i.trim()).map(i => {
            const [name, version] = [...i.split(':'), 'all'];
            return `${name}:${version}`
        }))).sort().join(',');
        this.sourceMappers[matcherIdentifier] = this.sourceMappers[matcherIdentifier] || [];
        this.sourceMappers[matcherIdentifier].push({sourceMapper, priority});
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
                    } else {
                        topLevelFunction.body.body.push({
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
