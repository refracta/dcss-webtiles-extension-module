const GOLD_STATUS_ID = 'convenience-gold';
const MAP_PREDICTOR_STATUS_ID = 'map-predictor';
const MAP_PREDICTOR_READY_EVENT = 'dwem:map-predictor-ready';

function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function count(value) {
    const number = finiteNumber(value);
    return number === null ? 0 : Math.max(0, Math.trunc(number));
}

function tooltipValue(value, fallback = 'none') {
    if (value === null || value === undefined || value === '') {
        return fallback;
    }
    return String(value)
        .replace(/[<>&]/gu, character => ({
            '<': '‹',
            '>': '›',
            '&': 'and'
        })[character])
        .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
        .trim()
        .slice(0, 160) || fallback;
}

function percentage(value, digits = 1) {
    const number = finiteNumber(value);
    if (number === null) {
        return null;
    }
    return `${(Math.max(0, Math.min(1, number)) * 100).toFixed(digits)}%`;
}

export function createMapPredictorStatus(summary) {
    if (!summary
        || summary.rcEnabled !== true
        || summary.runtimeEnabled !== true) {
        return null;
    }

    const match = summary.match || null;
    const score = percentage(match?.score);
    const forced = summary.forceRevealActive === true;
    const accepted = summary.resultReason === 'ready';
    const consensus = accepted && (match?.unique === false
        || count(summary.plausibleCandidateCount) > 1);
    const verdict = forced
        ? 'UNSAFE (forced)'
        : accepted
            ? consensus
                ? 'SAFE CONSENSUS (ambiguous identity)'
                : 'SAFE'
            : match
                ? 'UNSAFE (unaccepted)'
                : 'WAITING';
    const coverage = percentage(match?.coverage);
    const templateCount = Array.isArray(summary.templates)
        ? summary.templates.length
        : count(summary.templateCount);
    const details = [
        'MapPredictor: enabled (RC enabled; Ctrl-M on)',
        `Best candidate: ${tooltipValue(match?.name)} (${score || 'n/a'})`,
        'Match % is terrain similarity, not the probability of a correct prediction',
        `Verdict: ${verdict}; reason: ${tooltipValue(summary.resultReason, summary.status || 'not evaluated')}`,
        `Evidence: ${count(match?.evidenceCells)} cells, ${count(match?.distinctKinds)} kinds, ${coverage || 'n/a'} coverage`,
        `Candidates: ${templateCount} loaded, ${count(summary.plausibleCandidateCount)} plausible`,
        `Predictions: ${count(summary.safePredictionCount)} safe, ${count(summary.forcePredictionCount)} inferred, ${count(summary.predictionCount)} displayed`,
        `Reveal: ${summary.revealEnabled === true ? 'on' : 'off'}${forced ? ' (forced)' : ''}`
    ];

    return {
        light: `Map (${score || '--.-%'})`,
        text: 'map predictor',
        desc: details.join(' | '),
        col: !match ? 8 : (accepted && !forced ? 10 : 14),
        isCustomStatus: true,
        dwemStatusId: MAP_PREDICTOR_STATUS_ID
    };
}

export function mergeConvenienceStatuses(statuses, {gold, map} = {}) {
    const source = Array.isArray(statuses) ? statuses : [];
    const merged = source.filter(status => {
        if (status?.dwemStatusId === GOLD_STATUS_ID
            || status?.dwemStatusId === MAP_PREDICTOR_STATUS_ID) {
            return false;
        }
        // Remove entries emitted by ConvenienceModule versions predating
        // dwemStatusId, without deleting another module's custom status.
        return !(status?.isCustomStatus === true && status?.text === 'gold');
    });
    if (gold) {
        merged.push(gold);
    }
    if (map) {
        merged.push(map);
    }
    return merged;
}

function createGoldStatus(gold) {
    return {
        light: `Gold (${gold})`,
        text: 'gold',
        desc: 'The amount of gold you own.',
        col: 14,
        isCustomStatus: true,
        dwemStatusId: GOLD_STATUS_ID
    };
}

export default class ConvenienceModule {
    static name = 'ConvenienceModule';
    static version = '0.2';
    static dependencies = ['IOHook', 'RCManager', 'CommandManager'];
    static description = '(Beta) This module provides convenience features.';

    getRCConfig(rcfile) {
        const {RCManager} = DWEM.Modules;
        const showGoldStatus = RCManager.getRCOption(rcfile, 'show_gold_status', 'boolean', false);
        const disableClearChat = RCManager.getRCOption(rcfile, 'disable_clear_chat', 'boolean', false);
        const redirectChat = RCManager.getRCOption(rcfile, 'redirect_chat', 'boolean', false);
        const inputTimeoutMS = RCManager.getRCOption(rcfile, 'input_timeout_ms', 'float', 0);
        return {
            showGoldStatus, disableClearChat, redirectChat, inputTimeoutMS
        };
    }

    onLoad() {
        const {IOHook, RCManager, CommandManager} = DWEM.Modules;
        this.mapPredictorSummary = null;
        this.mapPredictorStatusFingerprint = null;
        this.statusHooksInstalled = false;
        this.statusLifecycleReady = true;
        this.removeStatusHooksAfterRefresh = false;

        this.installMapPredictorStatusBridge();
       /*
                    const {SourceMapperRegistry: SMR} = DWEM;

                    const {IOHook, RCManager} = DWEM.Modules;
                    IOHook.send_message.before.addHandler('convenience-module', (msg, data) => {
                        console.log(msg, data)
                        this.lastSendTime = Date.now();
                    });

                    function injectSendKey() {
                        send_keycode = function (code) {

                    if(DWEM.Modules.ConvenienceModule.lastReceiveTime - DWEM.Modules.ConvenienceModule.lastSendTime > 15){
                        return;
                    }
                    DWEM.Modules.ConvenienceModule.lastSendTime = Date.now();

                    socket.send('{"msg":"key","keycode":' + code + '}');
                }
            }

            const injectSendKeyMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${injectSendKey.toString()}()`);
            SMR.add('client', injectSendKeyMapper);

            IOHook.handle_message.before.addHandler('convenience-module', (data) => {
                this.lastReceiveTime = Date.now();
                console.log(this.lastReceiveTime - this.lastSendTime);
            });
        */

        RCManager.addHandlers('convenience-module', async (msg, data) => {
            if (msg === 'play') {
                let {
                    showGoldStatus, disableClearChat, redirectChat
                } = this.getRCConfig(data.contents);
                this.disableClearChat = disableClearChat;
                const goldStatusChanged = this.showGoldStatus !== showGoldStatus;
                this.showGoldStatus = showGoldStatus;
                this.redirectChat = redirectChat;
                if (this.showGoldStatus) {
                    this.syncStatusHooks();
                }
                if (goldStatusChanged) {
                    this.schedulePlayerStatusRefresh({syncHooksAfter: true});
                }
                if (this.redirectChat) {
                    IOHook.handle_message.after.addHandler('convenience-module-chat-redirect', (data) => {
                        if (data.msg === 'chat' && data.content) {
                            const container = document.createElement('div');
                            container.innerHTML = data.content;
                            const sender = container.querySelector('.chat_sender').textContent;
                            const message = container.querySelector('.chat_msg').textContent;
                            IOHook.handle_message({
                                msg: 'msgs', messages: [{
                                    'text': ('<cyan>' + sender + ': ' + '<white>' + message + '')
                                }]
                            });
                        }
                    });
                }
            } else if (msg === 'go_lobby') {
                // TODO
                this.disableClearChat = this.showGoldStatus = this.redirectChat = false;
                this.schedulePlayerStatusRefresh({syncHooksAfter: true});
                IOHook.handle_message.after.removeHandler('convenience-module-chat-redirect');
            }
        });

        const {SourceMapperRegistry: SMR} = DWEM;

        function injectDisableChatClear() {
            originalClear = clear
            const {ConvenienceModule} = DWEM.Modules;
            clear = function () {
                if (!ConvenienceModule.disableClearChat) {
                    originalClear();
                }
            }
        }

        const disableClearChatMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${injectDisableChatClear.toString()}()`);
        SMR.add('chat', disableClearChatMapper, -1);

        function injectShowGoldStatus() {
            DWEM.Modules.ConvenienceModule.player = player;
        }

        const showGoldStatusMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${injectShowGoldStatus.toString()}()`);
        SMR.add('./player', showGoldStatusMapper);

        IOHook.handle_message.after.addHandler('convenience-module', (data) => {
            if (!(this.autoReconnect && this.lastSessionData)) {
                return;
            }
            if (data.msg === 'go_lobby') {
                if (this.lastSessionData.msg === 'play') {
                    location.hash = `play-${this.lastSessionData.game_id}`;
                }
            } else if (data.msg === 'lobby_entry' && data.username === this.lastSessionData.username) {
                location.hash = `watch-${this.lastSessionData.username}`;
            }
        });

        IOHook.handle_message.before.addHandler('convenience-module', (data) => {
            if (data.msg === 'game_ended' && this.autoReconnect && this.lastSessionData) {
                return true;
            }
        });

        IOHook.send_message.after.addHandler('convenience-module', (msg, data) => {
            if (msg === 'play') {
                this.lastSessionData = data;
            } else if (msg === 'watch') {
                this.lastSessionData = data;
            }
        });

        CommandManager.addCommand('/arc', [], () => {
            this.autoReconnect = !this.autoReconnect;
            IOHook.handle_message({
                msg: 'chat',
                content: `Auto reconnect mode is ${this.autoReconnect ? 'enabled' : 'disabled'}.`
            });
        }, {
            module: ConvenienceModule.name,
            description: 'Toggle auto reconnect mode'
        });

    }

    refreshPlayerStatus() {
        const {IOHook} = DWEM.Modules;
        if (!Array.isArray(this?.player?.status)) {
            return;
        }
        IOHook.handle_message({
            msg: 'player',
            status: [...this.player.status]
        });
    }

    installMapPredictorStatusBridge() {
        const eventTarget = globalThis.document;
        if (typeof eventTarget?.addEventListener === 'function') {
            this.mapPredictorReadyTarget = eventTarget;
            this.mapPredictorReadyHandler ||= event => {
                const connected = this.bindMapPredictorStatus(
                    DWEM.Modules.MapPredictor || event?.detail?.module
                );
                if (connected) {
                    this.removeMapPredictorReadyListener();
                }
            };
            eventTarget.addEventListener(
                MAP_PREDICTOR_READY_EVENT,
                this.mapPredictorReadyHandler
            );
        }
        // DWEM constructs and registers every module instance before calling
        // any onLoad method, so this is the normal/default-load-order path.
        // The ready event above also makes the optional integration robust to
        // module hosts that register MapPredictor later.
        if (this.bindMapPredictorStatus(DWEM.Modules.MapPredictor)) {
            this.removeMapPredictorReadyListener();
        }
    }

    bindMapPredictorStatus(mapPredictor) {
        if (typeof mapPredictor?.subscribeStatus !== 'function') {
            return false;
        }
        if (this.mapPredictorStatusSource === mapPredictor
            && typeof this.mapPredictorUnsubscribe === 'function') {
            return true;
        }
        this.mapPredictorUnsubscribe?.();
        this.mapPredictorStatusSource = mapPredictor;
        this.mapPredictorUnsubscribe = mapPredictor.subscribeStatus(summary => {
            this.handleMapPredictorStatus(summary);
        });
        return true;
    }

    removeMapPredictorReadyListener() {
        this.mapPredictorReadyTarget?.removeEventListener?.(
            MAP_PREDICTOR_READY_EVENT,
            this.mapPredictorReadyHandler
        );
        this.mapPredictorReadyTarget = null;
    }

    currentGoldStatus(data = {}) {
        const god = data.god ?? this?.player?.god;
        const gold = data.gold ?? this?.player?.gold;
        return this.showGoldStatus === true
            && god !== 'Gozag'
            && gold !== undefined
            ? createGoldStatus(gold)
            : null;
    }

    needsStatusHooks() {
        return this.showGoldStatus === true || this.mapPredictorSummary !== null;
    }

    installStatusHooks() {
        if (!this.statusLifecycleReady || this.statusHooksInstalled) {
            return;
        }
        const {IOHook} = DWEM.Modules;
        this.statusBeforeHandler ||= data => {
            if (data.msg !== 'player' || !Array.isArray(data.status)) {
                return;
            }
            data.status = mergeConvenienceStatuses(data.status, {
                gold: this.currentGoldStatus(data),
                map: createMapPredictorStatus(this.mapPredictorSummary)
            });
        };
        this.statusAfterHandler ||= data => {
            if (this.showGoldStatus && data.gold !== undefined) {
                this.schedulePlayerStatusRefresh();
            }
        };
        IOHook.handle_message.before.addHandler(
            'convenience-module-status',
            this.statusBeforeHandler
        );
        IOHook.handle_message.after.addHandler(
            'convenience-module-status',
            this.statusAfterHandler
        );
        this.statusHooksInstalled = true;
    }

    removeStatusHooks() {
        if (!this.statusHooksInstalled) {
            return;
        }
        const {IOHook} = DWEM.Modules;
        IOHook.handle_message.before.removeHandler('convenience-module-status');
        IOHook.handle_message.after.removeHandler('convenience-module-status');
        this.statusHooksInstalled = false;
    }

    syncStatusHooks() {
        if (!this.statusLifecycleReady) {
            return;
        }
        if (this.needsStatusHooks()) {
            this.installStatusHooks();
        } else {
            this.removeStatusHooks();
        }
    }

    schedulePlayerStatusRefresh({syncHooksAfter = false} = {}) {
        this.removeStatusHooksAfterRefresh ||= syncHooksAfter;
        if (this.playerStatusRefreshPending) {
            return;
        }
        this.playerStatusRefreshPending = true;
        const schedule = globalThis.queueMicrotask
            || (callback => Promise.resolve().then(callback));
        schedule(() => {
            this.playerStatusRefreshPending = false;
            if (!this.destroyed) {
                this.refreshPlayerStatus();
                if (this.removeStatusHooksAfterRefresh) {
                    this.removeStatusHooksAfterRefresh = false;
                    this.syncStatusHooks();
                }
            }
        });
    }

    handleMapPredictorStatus(summary) {
        const visibleSummary = summary?.rcEnabled === true
            && summary?.runtimeEnabled === true
            ? summary
            : null;
        const status = createMapPredictorStatus(visibleSummary);
        const fingerprint = status
            ? JSON.stringify([status.light, status.desc, status.col])
            : null;
        this.mapPredictorSummary = visibleSummary;
        if (fingerprint === this.mapPredictorStatusFingerprint) {
            return;
        }
        this.mapPredictorStatusFingerprint = fingerprint;
        if (visibleSummary) {
            this.syncStatusHooks();
        }
        // Defer until the current WebTiles player packet finishes. A matcher
        // status can change from another before-message hook; refreshing
        // synchronously there would let the outer native player handler
        // overwrite this newer status entry.
        this.schedulePlayerStatusRefresh({syncHooksAfter: true});
    }

    destroy() {
        this.destroyed = true;
        this.mapPredictorUnsubscribe?.();
        this.mapPredictorUnsubscribe = null;
        this.mapPredictorStatusSource = null;
        this.removeMapPredictorReadyListener();
        const {IOHook, RCManager} = DWEM.Modules;
        RCManager?.removeHandlers?.('convenience-module');
        this.removeStatusHooks();
        IOHook?.handle_message?.after?.removeHandler?.('convenience-module-chat-redirect');
        IOHook?.handle_message?.before?.removeHandler?.('convenience-module');
        IOHook?.handle_message?.after?.removeHandler?.('convenience-module');
        IOHook?.send_message?.after?.removeHandler?.('convenience-module');
    }
}
