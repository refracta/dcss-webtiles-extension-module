import DWEMInjector from "./dwem-injector.js";
import DWEMMatcherRegistry from "./dwem-matcher-registry.js";
import DWEMSourceMapperRegistry from "./dwem-source-mapper-registry.js";

export default class DWEM {
    static version = '0.1';

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
        for (let i = 0; i < allModules.length; i++) {
            const module = allModules[i];
            try {
                const url = new URL(module);
            } catch (e) {
                try {
                    allModules[i] = new URL(this.Entrypoint + module).href;
                } catch (e) {
                    console.error(`The URL format of the module is invalid. (${module})`);
                }
            }
        }
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
