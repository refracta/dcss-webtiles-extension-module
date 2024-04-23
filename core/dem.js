import DEMInjector from "./dem-injector.js";
import DEMMatcherRegistry from "./dem-matcher-registry.js";
import DEMSourceMapperRegistry from "./dem-source-mapper-registry.js";

export default class DEM {
    constructor() {
        this.Injector = new DEMInjector();
        this.Injector.installDefineHooker();
        this.SourceMapperRegistry = new DEMSourceMapperRegistry();
        this.MatcherRegistry = new DEMMatcherRegistry();
    }

    async init() {
        const config = this.Config;
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

        this.ModuleClasses.sort((a, b) => {
            const aDependsOnB = a.dependencies.includes(b.identifier) || a.dependencies.includes(b.name);
            const bDependsOnA = b.dependencies.includes(a.identifier) || b.dependencies.includes(a.name);
            if (aDependsOnB && !bDependsOnA) {
                return 1;
            } else if (bDependsOnA && !aDependsOnB) {
                return -1;
            } else {
                return 0;
            }
        });

        const loadedDependencies = new Set();
        classesLoop: for (let i = 0; i < this.ModuleClasses.length; i++) {
            const moduleClass = this.ModuleClasses[i];
            const {dependencies} = moduleClass;
            for (let j = 0; j < dependencies.length; j++) {
                const dependency = dependencies[j];
                if (!loadedDependencies.has(dependency)) {
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
                await moduleInstance?.onLoad();
            } catch (e) {
                console.error(e);
            }
        }

        for (const identifier in this.SourceMapperRegistry.sourceMappers) {
            const [name, version] = [...identifier.split(':'), 'latest'];
            const mappers = this.SourceMapperRegistry.sourceMappers[identifier];
            const matcher = this.MatcherRegistry.matchers[name][version]
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
        localStorage.clear();
        if (!localStorage.DEM) {
            localStorage.DEM = JSON.stringify({Modules: []});
            localStorage.DEM = JSON.stringify({Modules: ['../modules/basic-module.js', '../modules/test-module1.js', '../modules/test-module2.js']});
            // TODO: For Test
        }
        return JSON.parse(localStorage.DEM);
    }

    set Config(config) {
        localStorage.DEM = JSON.stringify(config);
    }
}
