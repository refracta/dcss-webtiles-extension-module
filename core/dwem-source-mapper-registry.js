import * as acorn from 'https://cdn.skypack.dev/acorn';
import * as astring from 'https://cdn.skypack.dev/astring';

export default class DWEMSourceMapperRegistry {
    sourceMappers = {};

    add(matcherIdentifier, sourceMapper, priority = 0) {
        if (!Array.isArray(matcherIdentifier)) {
            matcherIdentifier = [matcherIdentifier];
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
                let topLevelFunction = null;
                const ast = acorn.parse(`(${source})`, {ecmaVersion: 'latest'});

                const stack = [...ast.body];
                while (stack.length > 0) {
                    const currentNode = stack.pop();

                    if (currentNode.type === 'FunctionDeclaration' || currentNode.type === 'FunctionExpression' || currentNode.type === 'ArrowFunctionExpression') {
                        topLevelFunction = currentNode;
                        break;
                    }

                    if (currentNode.type === 'ExpressionStatement' && currentNode.expression) {
                        stack.push(currentNode.expression);
                    }

                    if (currentNode.type === 'VariableDeclaration') {
                        for (const declaration of currentNode.declarations) {
                            if (declaration.init) {
                                stack.push(declaration.init);
                            }
                        }
                    }

                    if (currentNode.body && Array.isArray(currentNode.body)) {
                        for (let i = currentNode.body.length - 1; i >= 0; i--) {
                            stack.push(currentNode.body[i]);
                        }
                    }
                }

                if (!topLevelFunction) {
                    throw new Error('No top-level function found.');
                }
                const expression = acorn.parseExpressionAt(injectSource, 0, {ecmaVersion: 'latest'});
                const body = topLevelFunction.body.body;
                const lastIndex = body.length - 1;
                const lastStatement = body[lastIndex];
                if (lastStatement.type === 'ReturnStatement') {
                    body.splice(lastIndex, 0, {
                        type: 'ExpressionStatement', expression
                    });
                } else {
                    body.push({
                        type: 'ExpressionStatement', expression
                    });
                }
                return astring.generate(ast).slice(1, -3);
            };
        }
    }

    getSourceMapper(type, ...parameters) {
        return this.predefinedSourceMappers[type](...parameters);
    }
}
