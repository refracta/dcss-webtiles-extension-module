export default class RCManager {
    static name = 'RCManager'
    static version = '1.0'
    static dependencies = ['IOHook', 'SiteInformation', 'WebSocketFactory']
    static description = '(Library) This module provides features for creating custom RC trigger logic.'

    handlersList = []
    useURLBasedLoading = false;

    addHandlers(identifier, handlers, priority = 0) {
        // TODO: REMOVE LEGACY SUPPORT
        if (typeof handlers === 'function') {
            const handler = handlers;
            handlers = {
                onGameInitialize: (rcfile) => {
                    handler('play', {contents: rcfile});
                }, onGameEnd: () => {
                    handler('go_lobby');
                }
            }
        }
        this.handlersList.push({identifier, handlers, priority});
        this.handlersList.sort((h1, h2) => h2.priority - h1.priority);
    }

    removeHandlers(identifier) {
        for (let i = this.handlersList.length - 1; i >= 0; i--) {
            if (this.handlersList[i].identifier === identifier) {
                this.handlersList.splice(i, 1);
            }
        }
    }

    versions = {
        'Dungeon Crawl Stone Soup 5.7-23-g595bc06eb0': 'hellcrawl',
        'Dungeon Crawl Stone Soup v2.0': 'gooncrawl',
        'Dungeon Crawl Stone Soup v1.3-10-gd965a25124': 'xcrawl',
        'Dungeon Crawl Stone Soup 0.24.1-1828-gcd7e8225a3': 'kimchicrawl',
        'Dungeon Crawl Stone Soup 0.23-a0-520-gc80c17c0f1': 'addedcrawl'
    };

    getIdentifier(version) {
        let identifier;
        if (this.versions[version]) {
            identifier = this.versions[version];
        } else if (version.startsWith('Dungeon Crawl Stone Soup: Circus Animals')) {
            identifier = 'dcssca';
        } else if (version.startsWith('Dungeon Crawl Stone Soup (GnollCrawl)')) {
            identifier = 'gnollcrawl'
        } else if (version.startsWith('Dungeon Crawl Stone Soup bcrawl')) {
            identifier = 'bcrawl'
        } else if (version.startsWith('Bloatcrawl 2')) {
            identifier = 'bloatcrawl2';
        } else if (version.startsWith('Crawl Stoat Soup')) {
            identifier = 'stoatsoup';
        } else if (version.startsWith('BcadrenCrawl: Boulder Brew')) {
            identifier = 'bcadrencrawl';
        } else if (version.startsWith('Dungeon Crawl Stone Soup')) {
            const match = version.match(/Dungeon Crawl Stone Soup (\d+\.\d+)[.-]([a-z\d]+)/);
            const gameVersion = match[1];
            const release = match[2];
            if (release.startsWith('a') || release.startsWith('b')) {
                identifier = 'git';
            } else {
                identifier = gameVersion;
            }
        }
        return identifier;
    }

    locations = {
        'crawl.nemelex.cards': 'https://archive.nemelex.cards/rcfiles',
        'crawl.project357.org': 'https://crawl.project357.org/rc-files'
    };
    cncGenerator = (version, username) => {
        const baseURL = this.locations[location.host];
        const identifier = this.getIdentifier(version);
        if (baseURL && identifier) {
            return `${baseURL}/crawl-${identifier}/${username}.rc`;
        }
    };
    cpoGenerator = (version, username) => {
        const baseURL = this.locations[location.host];
        const identifier = this.getIdentifier(version);
        if (baseURL && identifier) {
            return `${baseURL}/${identifier}/${username}.rc`;
        }
    };
    generators = {
        'crawl.nemelex.cards': this.cncGenerator,
        'crawl.project357.org': this.cpoGenerator
    }

    getRCURL(version, username) {
        const generator = this.generators[location.host];
        if (generator) {
            return generator(version, username);
        }
    }

    async triggerHandlers(rcfile) {
        const {IOHook} = DWEM.Modules;
        for (const {handlers} of this.handlersList) {
            try {
                await handlers?.onGameInitialize?.(rcfile);
            } catch (e) {
                console.error(e);
            }
        }
        while (this.queue.length > 0) {
            const data = this.queue.shift();
            IOHook.handle_message({...data, initiator: 'rc-manager'});
            if (data.msg === 'game_client') {
                const initPromise = new Promise(resolve => {
                    this.initResolver = resolve;
                });
                const scriptPromise = new Promise(resolve => {
                    require([`game-${data.version}/game`], (game) => {
                        const images = Array.from(document.querySelectorAll('#game img'));
                        const imagePromises = images.map(image => image.complete ? Promise.resolve() : new Promise(r => image.onload = r));
                        Promise.all(imagePromises).then(resolve);
                    });
                });
                await Promise.all([initPromise, scriptPromise]);
            }
        }
        delete this.queue;
        for (const {handlers} of this.handlersList) {
            try {
                handlers?.onGameStart?.(data.contents);
            } catch (e) {
                console.error(e);
            }
        }
    }

    getRCOption(rcfile, name, type = 'string', defaultValue) {
        const regex = new RegExp(`^(?!\\s*#).*${name}\\s*=\\s*(\\S+)\\s*`, 'gm');
        const value = Array.from(rcfile.matchAll(regex)).pop()?.[1];

        if (type === 'boolean') {
            return value === 'true';
        } else if (type === 'number') {
            const numValue = Number(value);
            return isNaN(numValue) ? defaultValue : numValue;
        } else if (type === 'float') {
            const floatValue = parseFloat(value);
            return isNaN(floatValue) ? defaultValue : floatValue;
        } else if (type === 'integer') {
            const intValue = parseInt(value, 10);
            return isNaN(intValue) ? defaultValue : intValue;
        } else if (type === 'string') {
            return value;
        }
    }

    onLoad() {
        const {SourceMapperRegistry: SMR} = DWEM;

        function gameInjector() {
            const {RCManager} = DWEM.Modules;
            let originalInit = init;
            init = function () {
                originalInit();
                RCManager?.initResolver();
            }

            $(document).off("game_preinit game_cleanup").on("game_preinit game_cleanup", init);
        }

        const clientMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${gameInjector.toString()}()`);
        SMR.add('./game', clientMapper);

        const {IOHook, SiteInformation} = DWEM.Modules;
        IOHook.send_message.before.addHandler('rc-manager', (msg, data) => {
            if (msg === 'play' || msg === 'watch') {
                this.session = data;
            }
        });
        IOHook.handle_message.before.addHandler('rc-manager', (data) => {
            if (data.initiator === 'rc-manager' || !this.session) {
                return;
            }
            if (data.msg === 'game_client') {
                if (this.session.game_id && !this.useURLBasedLoading) {
                    socket.send(JSON.stringify({msg: 'get_rc', game_id: this.session.game_id}));
                }
                this.queue = [data];
                return true;
            } else if (data.msg === 'version') {
                if (this.session.username || this.useURLBasedLoading) {
                    (async () => {
                        const username = this.session.username || SiteInformation.current_user;
                        const version = data.text;
                        const rawURL = this.getRCURL(version, username);
                        console.log(`RC URL: ${rawURL}`);
                        const url = `https://corsproxy.io/?${rawURL}?${Date.now()}`;
                        // TODO: backend needed
                        let rcfile = '';
                        if (rawURL && url) {
                            try {
                                rcfile = await fetch(url).then(r => r.text());
                            } catch (e) {
                                console.error(`Failed to fetch RCURL. ${url}`);
                            }
                        }
                        await this.triggerHandlers(rcfile);
                    })();
                }
                this.queue.push(data);
                return true;
            } else if (data.msg === 'rcfile_contents') {
                if (this.session.game_id && !this.useURLBasedLoading) {
                    this.triggerHandlers(data.contents);
                    return true;
                }
            } else if (this.queue) {
                this.queue.push(data);
                return true;
            } else if (data.msg === 'go_lobby') {
                delete this.session;
                for (const {handlers} of this.handlersList) {
                    try {
                        handlers?.onGameEnd?.();
                    } catch (e) {
                        console.error(e);
                    }
                }
            }
        });
    }
}
