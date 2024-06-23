import DWEMInjector from "./dwem-injector.js";
import DWEMMatcherRegistry from "./dwem-matcher-registry.js";
import DWEMSourceMapperRegistry from "./dwem-source-mapper-registry.js";

export default class DWEM {
    static version = '0.2';

    constructor() {
        const url = new URL(import.meta.url + '/..');
        this.Entrypoint = url.protocol + '//' + url.host + url.pathname;
        this.Injector = new DWEMInjector();
        this.Injector.installDefineHooker();
        this.SourceMapperRegistry = new DWEMSourceMapperRegistry();
        this.MatcherRegistry = new DWEMMatcherRegistry();
    }

    async init() {
        const config = this.Config;
        this.Config = config;
        const paths = config.Modules;
        this.ModuleClasses = [];
        let loadResults = await Promise.allSettled(paths.map(path => import(path)));
        for (let i = 0; i < loadResults.length; i++) {
            const loadResult = loadResults[i];
            const path = paths[i];
            if (loadResult.status === 'rejected') {
                console.error(`Failed to load module path. (${path})`, loadResult.reason);
            } else if (loadResult.status === 'fulfilled') {
                const moduleClass = loadResult.value.default;
                if (!moduleClass) {
                    console.error(`Failed to load module class. (${path})`);
                    continue;
                }
                moduleClass.path = path;
                moduleClass.identifier = `${moduleClass.name}:${moduleClass.version}`;

                if (moduleClass.name.includes(':')) {
                    console.error(`Module name="${moduleClass.name}" cannot use colon (:). (${moduleClass.path})`);
                    continue;
                }
                if (moduleClass.version.includes(':')) {
                    console.error(`Module version="${moduleClass.name}" cannot use colon (:). (${moduleClass.path})`);
                    continue;
                }

                moduleClass.dependencies = moduleClass.dependencies || [];
                const isDepError = moduleClass.dependencies.some(dep => {
                    if (dep.indexOf(':') !== dep.lastIndexOf(':')) {
                        console.error(`Module dependency="${dep}" is incorrect. (${moduleClass.path})`);
                        return true;
                    }
                    const [name, version] = [...dep.split(':'), 'latest'];
                    if (version === '') {
                        console.error(`Module dependency="${dep}" version is incorrect. (${moduleClass.path})`);
                        return true;
                    }

                    if (name === moduleClass.name) {
                        console.error(`Module cannot set itself as a dependency="${dep}". (${moduleClass.path})`);
                    }
                });

                if (isDepError) {
                    continue;
                }

                this.ModuleClasses.push(moduleClass);
            }
        }

        const counts = {};
        for (let i = 0; i < this.ModuleClasses.length; i++) {
            const moduleClass = this.ModuleClasses[i];
            const name = moduleClass.name;
            counts[name] = counts[name] || 0;
            if (counts[name] >= 1) {
                console.error(`Duplicate module name detected. (${moduleClass.name}:${moduleClass.version}, ${moduleClass.path})`);
                this.ModuleClasses.splice(i--, 1);
            }
            counts[name]++;
        }

        const graph = new Map();
        const indegree = new Map();
        this.ModuleClasses.forEach(module => {
            graph.set(module.identifier, []);
            indegree.set(module.identifier, 0);
        });
        this.ModuleClasses.forEach(module => {
            module.dependencies.forEach(dependency => {
                const dependencyModule = this.ModuleClasses.find(m => m.identifier === dependency || m.name === dependency);
                if (dependencyModule) {
                    graph.get(dependencyModule.identifier).push(module.identifier);
                    indegree.set(module.identifier, indegree.get(module.identifier) + 1);
                }
            });
        });
        const queue = [];
        indegree.forEach((count, key) => {
            if (count === 0) {
                queue.push(key);
            }
        });
        const sortedIdentifiers = [];
        while (queue.length > 0) {
            const node = queue.shift();
            sortedIdentifiers.push(node);
            graph.get(node).forEach(neighbor => {
                indegree.set(neighbor, indegree.get(neighbor) - 1);
                if (indegree.get(neighbor) === 0) {
                    queue.push(neighbor);
                }
            });
        }
        if (sortedIdentifiers.length !== this.ModuleClasses.length) {
            throw new Error('Cycle detected in dependencies');
        }
        this.ModuleClasses.sort((a, b) => {
            return sortedIdentifiers.indexOf(a.identifier) - sortedIdentifiers.indexOf(b.identifier);
        });

        const loadedDependencies = new Set();
        classesLoop: for (let i = 0; i < this.ModuleClasses.length; i++) {
            const moduleClass = this.ModuleClasses[i];
            const {dependencies} = moduleClass;
            for (let j = 0; j < dependencies.length; j++) {
                const dependency = dependencies[j];
                if (!loadedDependencies.has(dependency)) {
                    console.log(Array.from(loadedDependencies), dependency, moduleClass);
                    console.error(`Can't resolve module dependency=${dependency}. (${moduleClass.name}:${moduleClass.version}, ${moduleClass.path})`);
                    this.ModuleClasses.splice(i--, 1);
                    continue classesLoop;
                }
            }
            loadedDependencies.add(moduleClass.name);
            loadedDependencies.add(moduleClass.identifier);
        }

        this.ModuleInstances = [];
        this.Modules = {};
        for (let i = 0; i < this.ModuleClasses.length; i++) {
            const ModuleClass = this.ModuleClasses[i];
            const moduleInstance = new ModuleClass();
            this.ModuleInstances.push(moduleInstance);
            this.Modules[this.ModuleClasses[i].name] = moduleInstance;
        }

        for (const moduleInstance of this.ModuleInstances) {
            try {
                await moduleInstance?.onLoad?.();
            } catch (e) {
                console.error(e);
            }
        }

        for (const identifier in this.SourceMapperRegistry.sourceMappers) {
            const mappers = this.SourceMapperRegistry.sourceMappers[identifier];
            const matchers = Array.from(new Set(identifier.split(',').map(i => i.trim()).map(i => {
                const [name, version] = [...i.split(':'), 'all'];
                return version === 'all' ? Object.values(this.MatcherRegistry.matchers[name]) : [this.MatcherRegistry.matchers[name][version]]
            }).flat())).filter(m => m);
            const matcher = (argumentsList) => {
                return matchers.some(m => m(argumentsList));
            };
            this.Injector.replacers.push({
                matcher, mapper: (argumentsList) => {
                    const index = argumentsList.findLastIndex(arg => typeof arg === 'function');
                    let source = argumentsList[index].toString();
                    for (const mapper of mappers) {
                        source = mapper(source);
                    }
                    argumentsList[index] = window.eval(`(${source})`);
                    return argumentsList;
                }
            });
        }
    }

    get Config() {
        const defaultConfig = {
            Version: DWEM.version, Modules: []
        };
        if (!localStorage.DWEM) {
            localStorage.DWEM = JSON.stringify(defaultConfig);
        }
        const config = JSON.parse(localStorage.DWEM);
        if (DWEM.version !== config.Version) {
            if (confirm(`DWEM config version mismatch. (Config: ${config.Version}, DWEM: ${DWEM.version})\nDo you want to keep your settings?`)) {
                config.Version = DWEM.version;
                this.Config = config;
            } else {
                localStorage.DWEM = JSON.stringify(defaultConfig);
            }
        }
        const moduleSet = new Set();
        const defaultModules = JSON.parse(localStorage.DWEM_MODULES || '[]');
        const configModules = config.Modules;
        const allModules = [...defaultModules, ...configModules];
        config.Modules = [];
        for (const module of allModules) {
            if (!moduleSet.has(module)) {
                config.Modules.push(module);
            }
            moduleSet.add(module);
        }
        return config;
    }

    set Config(config) {
        localStorage.DWEM = JSON.stringify(config);
    }
}
