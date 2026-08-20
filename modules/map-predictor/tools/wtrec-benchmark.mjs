#!/usr/bin/env node

import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {buildBenchmarkReport} from './benchmark-metrics.mjs';

const DEFAULT_ORIGIN = 'https://crawl.nemelex.cards/';
const RECORDING_ROUTE = 'https://map-predictor-benchmark.invalid/recording.wtrec';

function usage() {
    return `Usage:
  node wtrec-benchmark.mjs --recording FILE --sidecar FILE [options]
  node wtrec-benchmark.mjs --recording-url URL --sidecar FILE [options]

Options:
  --output FILE       Write JSON to FILE instead of stdout.
  --commit SHA        Pin DWEM_LATEST to this commit.
  --origin URL        WebTiles origin (default: ${DEFAULT_ORIGIN}).
  --headed            Show the browser.
  --timeout MS        Override the playback timeout.
  --help              Show this message.

Environment:
  MAP_PREDICTOR_PLAYWRIGHT  Absolute module path when playwright is not local.
  MAP_PREDICTOR_CHROME      Browser executable, such as /usr/bin/google-chrome.
`;
}

function parseArguments(argv) {
    const options = {headed: false};
    for (let index = 0; index < argv.length; index++) {
        const argument = argv[index];
        if (argument === '--headed') {
            options.headed = true;
            continue;
        }
        if (argument === '--help' || argument === '-h') {
            options.help = true;
            continue;
        }
        const key = {
            '--recording': 'recording',
            '--recording-url': 'recordingUrl',
            '--sidecar': 'sidecar',
            '--output': 'output',
            '--commit': 'commit',
            '--origin': 'origin',
            '--timeout': 'timeout'
        }[argument];
        if (!key || index + 1 >= argv.length) {
            throw new Error(`Unknown or incomplete argument: ${argument}`);
        }
        options[key] = argv[++index];
    }
    return options;
}

function validateSidecar(sidecar) {
    if (!sidecar || typeof sidecar !== 'object' || Array.isArray(sidecar)) {
        throw new Error('The sidecar must be a JSON object.');
    }
    if (sidecar.schemaVersion !== 1) {
        throw new Error('The sidecar schemaVersion must be 1.');
    }
    if (!Array.isArray(sidecar.targets) || sidecar.targets.length === 0) {
        throw new Error('The sidecar must define at least one target.');
    }
    const identifiers = new Set();
    for (const [index, target] of sidecar.targets.entries()) {
        const id = target.id || `target-${index + 1}`;
        if (identifiers.has(id)) {
            throw new Error(`Duplicate target id: ${id}`);
        }
        identifiers.add(id);
        if (!target.place && !Number.isFinite(target.fromTime)
            && !Number.isFinite(target.toTime)) {
            throw new Error(`Target ${id} needs a place or time window.`);
        }
        if (Number.isFinite(target.truthAt)
            && Number.isFinite(target.fromTime)
            && target.truthAt < target.fromTime) {
            throw new Error(`Target ${id} truthAt precedes fromTime.`);
        }
        if (Number.isFinite(target.truthAt)
            && Number.isFinite(target.toTime)
            && target.truthAt > target.toTime) {
            throw new Error(`Target ${id} truthAt follows toTime.`);
        }
    }
    return sidecar;
}

async function loadPlaywright() {
    const require = createRequire(import.meta.url);
    const candidates = [
        process.env.MAP_PREDICTOR_PLAYWRIGHT,
        'playwright'
    ].filter(Boolean);
    for (const candidate of candidates) {
        try {
            return require(candidate);
        } catch (error) {
            if (candidate === candidates.at(-1)) {
                throw new Error(
                    'Playwright is unavailable. Run `npm install --no-save playwright` '
                    + 'or set MAP_PREDICTOR_PLAYWRIGHT to its module directory.',
                    {cause: error}
                );
            }
        }
    }
    throw new Error('Playwright is unavailable.');
}

async function loadRecording(options) {
    if (Boolean(options.recording) === Boolean(options.recordingUrl)) {
        throw new Error('Choose exactly one of --recording or --recording-url.');
    }
    if (options.recording) {
        const absolute = path.resolve(options.recording);
        return {
            bytes: await readFile(absolute),
            name: path.basename(absolute),
            source: absolute
        };
    }
    const response = await fetch(options.recordingUrl);
    if (!response.ok) {
        throw new Error(`Recording download failed: HTTP ${response.status}`);
    }
    const url = new URL(options.recordingUrl);
    return {
        bytes: Buffer.from(await response.arrayBuffer()),
        name: decodeURIComponent(path.basename(url.pathname)),
        source: options.recordingUrl
    };
}

function positiveNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function installRecorder(page, targets) {
    await page.evaluate(specs => {
        const facade = globalThis.DWEM?.Modules?.MapPredictor;
        const runtime = facade?.runtime;
        const adapter = runtime?.webtilesAdapter;
        const ioHook = globalThis.DWEM?.Modules?.IOHook;
        if (!facade || !runtime || !adapter || !ioHook) {
            throw new Error('MapPredictor benchmark dependencies are not ready.');
        }

        const handlerId = `map-predictor-benchmark-${Date.now()}`;
        const state = {
            currentEventTime: null,
            currentEventIndex: -1,
            resetSequence: 0,
            samples: [],
            resets: [],
            truth: {},
            wirePlayer: {},
            bindingRecovered: false,
            lastSampleKey: null,
            stopped: false
        };
        const targetById = new Map(specs.map((target, index) => [
            target.id || `target-${index + 1}`,
            target
        ]));

        const cloneCells = cells => (Array.isArray(cells) ? cells : [])
            .filter(cell => Number.isInteger(cell?.x)
                && Number.isInteger(cell?.y)
                && typeof cell?.kind === 'string')
            .map(cell => ({x: cell.x, y: cell.y, kind: cell.kind}));
        const observations = () => cloneCells([
            ...(runtime.matcher?.observations?.values?.() || [])
        ]);
        const displayedPredictions = () => cloneCells(
            Array.isArray(adapter.displayablePredictions)
                ? adapter.displayablePredictions
                : adapter.predictions
        );
        const identity = match => match?.name
            ? [
                match.name,
                match.transform || '?',
                Number.isFinite(match.offsetX) ? match.offsetX : '?',
                Number.isFinite(match.offsetY) ? match.offsetY : '?'
            ].join('|')
            : null;
        const resetSnapshot = () => {
            const debug = facade.getDebugState();
            return {
                levelKey: debug.levelKey,
                player: debug.player,
                observations: runtime.matcher?.observations?.size || 0,
                known: adapter._observedCells?.size || 0,
                displayed: displayedPredictions().length,
                native: adapter._nativeCells?.size || 0,
                matchIdentity: identity(debug.match),
                autoRevealApplied: Boolean(debug.autoRevealApplied)
            };
        };
        const targetInWindow = target => {
            const time = state.currentEventTime;
            return (!Number.isFinite(target.fromTime)
                    || (Number.isFinite(time) && time >= target.fromTime))
                && (!Number.isFinite(target.toTime)
                    || (Number.isFinite(time) && time <= target.toTime));
        };
        const targetMatchesPlayer = (target, player) =>
            (!target.place || target.place === player?.place)
                && (!Number.isFinite(target.depth)
                    || Number(target.depth) === Number(player?.depth));
        const captureTruthInput = (id, target) => {
            if (state.truth[id]?.capturedAt != null || !targetInWindow(target)
                || !targetMatchesPlayer(target, facade.getDebugState().player)) {
                return;
            }
            const result = runtime.result || {};
            state.truth[id] = {
                capturedAt: state.currentEventTime,
                finalizedAt: null,
                predictionMode: facade.getDebugState().predictionMode,
                displayedPredictions: displayedPredictions(),
                safePredictions: cloneCells(result.predictions),
                provisionalPredictions: cloneCells(result.provisionalPredictions),
                bestDisplayPredictions: cloneCells(
                    result.bestDisplayPredictions
                ),
                observations: []
            };
        };
        const finalizeTruth = (id, finalizedAt = state.currentEventTime) => {
            const truth = state.truth[id];
            if (!truth || truth.finalizedAt != null) {
                return;
            }
            truth.finalizedAt = finalizedAt;
            truth.observations = observations();
        };
        const capture = trigger => {
            if (state.stopped) {
                return;
            }
            const debug = facade.getDebugState();
            const sample = {
                eventTime: state.currentEventTime,
                eventIndex: state.currentEventIndex,
                resetSequence: state.resetSequence,
                trigger,
                status: debug.status,
                reason: debug.resultReason,
                player: debug.player,
                levelKey: debug.levelKey,
                observations: debug.observationCount || 0,
                known: adapter._observedCells?.size || 0,
                displayed: displayedPredictions().length,
                native: adapter._nativeCells?.size || 0,
                safe: debug.safePredictionCount || 0,
                provisional: debug.provisionalPredictionCount || 0,
                bestDisplay: debug.bestDisplayPredictionCount || 0,
                force: debug.forcePredictionCount || 0,
                plausible: debug.plausibleCandidateCount || 0,
                predictionMode: debug.predictionMode,
                revealEnabled: Boolean(debug.revealEnabled),
                forceRevealActive: Boolean(debug.forceRevealActive),
                autoRevealApplied: Boolean(debug.autoRevealApplied),
                error: debug.error ? {...debug.error} : null,
                match: debug.match
            };
            const key = JSON.stringify([
                sample.resetSequence,
                sample.status,
                sample.reason,
                sample.player,
                sample.levelKey,
                sample.observations,
                sample.known,
                sample.displayed,
                sample.native,
                sample.safe,
                sample.provisional,
                sample.bestDisplay,
                sample.force,
                sample.plausible,
                sample.predictionMode,
                sample.revealEnabled,
                sample.forceRevealActive,
                sample.autoRevealApplied,
                sample.error,
                identity(sample.match),
                sample.match?.score,
                sample.match?.margin
            ]);
            if (key === state.lastSampleKey) {
                return;
            }
            state.lastSampleKey = key;
            state.samples.push(sample);
        };

        const originalReset = runtime.resetLevel;
        runtime.resetLevel = function (...args) {
            const before = resetSnapshot();
            const value = originalReset.apply(this, args);
            state.resetSequence++;
            const after = resetSnapshot();
            state.resets.push({
                eventTime: state.currentEventTime,
                eventIndex: state.currentEventIndex,
                resetSequence: state.resetSequence,
                options: args[0] || {},
                before,
                after
            });
            capture('reset');
            return value;
        };

        const beforeMessage = message => {
            if (!adapter.binding && message?.msg !== 'game_client'
                && adapter.bindCachedWebtiles?.()) {
                state.bindingRecovered = true;
            }
            const timing = Number(message?.wtrec?.timing);
            if (Number.isFinite(timing)) {
                state.currentEventTime = timing;
            }
            state.currentEventIndex++;

            for (const [id, target] of targetById) {
                if (Number.isFinite(target.truthAt)
                    && Number.isFinite(state.currentEventTime)
                    && state.currentEventTime >= target.truthAt) {
                    captureTruthInput(id, target);
                }
            }

            if (message?.msg === 'player') {
                const nextPlayer = {...state.wirePlayer};
                for (const field of ['place', 'depth', 'pos']) {
                    if (Object.prototype.hasOwnProperty.call(message, field)) {
                        nextPlayer[field] = message[field];
                    }
                }
                for (const [id, target] of targetById) {
                    if (state.truth[id]?.capturedAt != null
                        && state.truth[id]?.finalizedAt == null
                        && targetMatchesPlayer(target, state.wirePlayer)
                        && !targetMatchesPlayer(target, nextPlayer)) {
                        finalizeTruth(id);
                    }
                }
                state.wirePlayer = nextPlayer;
            }
            return false;
        };
        const afterMessage = message => {
            if (message?.msg === 'map' || message?.msg === 'player'
                || message?.msg === 'version' || message?.msg === 'msgs') {
                capture(message.msg);
            }
        };
        ioHook.handle_message.before.addHandler(handlerId, beforeMessage, 10000);
        ioHook.handle_message.after.addHandler(handlerId, afterMessage, -10000);
        const unsubscribeStatus = facade.subscribeStatus(() => capture('status'));
        const unsubscribePredictions = adapter.on(
            'predictions',
            () => capture('predictions')
        );
        const unsubscribeDisplayablePredictions = adapter.on(
            'displayable-predictions',
            () => capture('displayable-predictions')
        );

        globalThis.__mapPredictorBenchmark = {
            state,
            capture,
            stop() {
                if (!state.stopped) {
                    capture('stop');
                    for (const id of targetById.keys()) {
                        finalizeTruth(id);
                    }
                    state.stopped = true;
                    unsubscribeStatus();
                    unsubscribePredictions();
                    unsubscribeDisplayablePredictions();
                    ioHook.handle_message.before.removeHandler(handlerId);
                    ioHook.handle_message.after.removeHandler(handlerId);
                    runtime.resetLevel = originalReset;
                }
                return {
                    currentEventTime: state.currentEventTime,
                    currentEventIndex: state.currentEventIndex,
                    samples: state.samples,
                    resets: state.resets,
                    truth: state.truth,
                    adapter: {
                        bound: Boolean(adapter.binding),
                        known: adapter._observedCells?.size || 0,
                        native: adapter._nativeCells?.size || 0,
                        displayed: displayedPredictions().length,
                        playerOnLevel: adapter.playerOnLevel,
                        bindingRecovered: state.bindingRecovered
                    },
                    finalState: facade.getDebugState()
                };
            }
        };
        capture('installed');
    }, targets);
}

async function waitForPlayback(page, sidecar, timeout) {
    const startedAt = Date.now();
    const endTime = Number(sidecar.endTime);
    while (Date.now() - startedAt < timeout) {
        const status = await page.evaluate(() => {
            const benchmark = globalThis.__mapPredictorBenchmark?.state;
            const title = [...document.querySelectorAll('div')]
                .find(element => element.textContent?.trim() === 'WTREC Player');
            const container = title?.parentElement;
            const progressText = [...(container?.querySelectorAll('div') || [])]
                .map(element => element.textContent || '')
                .find(text => /^Progress:\s/u.test(text)) || '';
            const progress = Number(progressText.match(/([0-9.]+)%/u)?.[1]);
            const button = container?.querySelector('button[title="Play/Pause (Space)"]');
            return {
                eventTime: benchmark?.currentEventTime ?? null,
                progress: Number.isFinite(progress) ? progress : null,
                playing: Boolean(button?.textContent?.includes('Pause'))
            };
        });
        if (Number.isFinite(endTime) && Number(status.eventTime) >= endTime) {
            break;
        }
        if (Number(status.progress) >= 99.99 && !status.playing) {
            break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (Date.now() - startedAt >= timeout) {
        throw new Error(`Playback timed out after ${timeout}ms.`);
    }
    await page.evaluate(() => {
        const title = [...document.querySelectorAll('div')]
            .find(element => element.textContent?.trim() === 'WTREC Player');
        const button = title?.parentElement
            ?.querySelector('button[title="Play/Pause (Space)"]');
        if (button?.textContent?.includes('Pause')) {
            button.click();
        }
    });
}

async function waitForSettledState(page, settleMs, timeoutMs) {
    const startedAt = Date.now();
    let unchangedSince = Date.now();
    let previous = null;
    while (Date.now() - startedAt < timeoutMs) {
        const signature = await page.evaluate(() => {
            const facade = globalThis.DWEM?.Modules?.MapPredictor;
            const state = facade?.getDebugState?.();
            const benchmark = globalThis.__mapPredictorBenchmark?.state;
            return JSON.stringify([
                benchmark?.samples?.length,
                state?.status,
                state?.observationCount,
                state?.predictionCount,
                state?.resultReason,
                state?.workerStatus,
                state?.match?.name,
                state?.match?.score,
                state?.match?.offsetX,
                state?.match?.offsetY
            ]);
        });
        if (signature !== previous) {
            previous = signature;
            unchangedSince = Date.now();
        } else if (Date.now() - unchangedSince >= settleMs) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Matcher did not settle within ${timeoutMs}ms.`);
}

async function main() {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
        process.stdout.write(usage());
        return;
    }
    if (!options.sidecar) {
        throw new Error('--sidecar is required.');
    }
    const sidecar = validateSidecar(JSON.parse(
        await readFile(path.resolve(options.sidecar), 'utf8')
    ));
    const recording = await loadRecording(options);
    const recordingSha256 = createHash('sha256')
        .update(recording.bytes)
        .digest('hex');
    const {chromium} = await loadPlaywright();
    const launchOptions = {
        headless: !options.headed,
        args: ['--no-sandbox']
    };
    if (process.env.MAP_PREDICTOR_CHROME) {
        launchOptions.executablePath = process.env.MAP_PREDICTOR_CHROME;
    }
    const browser = await chromium.launch(launchOptions);
    const errors = [];
    const errorsByKey = new Map();
    const recordError = (type, value) => {
        const message = String(value || '').slice(0, 2000);
        const firstLine = message.split('\n', 1)[0].slice(0, 500);
        const key = `${type}:${firstLine}`;
        const existing = errorsByKey.get(key);
        if (existing) {
            existing.count++;
            return;
        }
        if (errors.length >= 50) {
            return;
        }
        const entry = {type, message, count: 1};
        errorsByKey.set(key, entry);
        errors.push(entry);
    };
    try {
        const context = await browser.newContext({ignoreHTTPSErrors: true});
        const dwemCommit = options.commit || sidecar.dwemCommit || null;
        if (dwemCommit) {
            await context.addInitScript(commit => {
                localStorage.DWEM_LATEST = commit;
                localStorage.DWEM_LATEST_TIME = String(Date.now());
                localStorage.DWEM_LATEST_DURATION = '86400';
            }, dwemCommit);
        }
        const page = await context.newPage();
        page.on('pageerror', error => recordError('pageerror', error.message));
        page.on('console', message => {
            if (message.type() === 'error') {
                recordError('console', message.text());
            }
        });
        await page.route(RECORDING_ROUTE, route => route.fulfill({
            status: 200,
            contentType: 'application/zip',
            headers: {'Access-Control-Allow-Origin': '*'},
            body: recording.bytes
        }));
        await page.goto(options.origin || sidecar.origin || DEFAULT_ORIGIN, {
            waitUntil: 'domcontentloaded',
            timeout: positiveNumber(options.timeout, 60000)
        });
        await page.waitForFunction(() => globalThis.DWEM?.Modules?.WTRec
            && globalThis.DWEM?.Modules?.MapPredictor, null, {timeout: 120000});
        await page.evaluate(async () => {
            const facade = globalThis.DWEM.Modules.MapPredictor;
            await facade.applyRcEnabled(true);
        });
        await page.waitForFunction(() => globalThis.DWEM?.Modules
            ?.MapPredictor?.runtime?.webtilesAdapter, null, {timeout: 120000});
        await installRecorder(page, sidecar.targets);
        await page.evaluate(async ({
            recordingUrl,
            startTime,
            speed,
            preludeMs,
            firstTargetTime
        }) => {
            const response = await fetch(recordingUrl);
            if (!response.ok) {
                throw new Error(`Benchmark recording fetch failed: ${response.status}`);
            }
            let blob = await response.blob();
            if (startTime > 0 && preludeMs >= 0) {
                const {default: JSZip} = await import(
                    'https://cdn.skypack.dev/jszip@3.10.1'
                );
                const zip = await JSZip.loadAsync(blob);
                const entry = zip.file('wtrec.json');
                if (!entry) {
                    throw new Error('The recording has no wtrec.json entry.');
                }
                const recording = JSON.parse(await entry.async('string'));
                const originalMessageCount = recording.data.length;
                const requestedCutoff = Math.max(0, startTime - preludeMs);
                const clearTimes = recording.data
                    .filter(message => message?.msg === 'map'
                        && message.clear === true
                        && Number.isFinite(Number(message?.wtrec?.timing)))
                    .map(message => Number(message.wtrec.timing));
                const upperBound = Number.isFinite(firstTargetTime)
                    ? Math.max(startTime, firstTargetTime)
                    : startTime;
                const latestClear = clearTimes.findLast(time =>
                    time >= requestedCutoff && time <= upperBound);
                const previousClear = clearTimes.findLast(time =>
                    time <= requestedCutoff);
                const cutoff = latestClear ?? previousClear ?? requestedCutoff;
                const bootstrapTypes = new Set([
                    'game_client',
                    'version',
                    'options',
                    'game_state',
                    'ui_state',
                    'layout'
                ]);
                const menuTypes = new Set([
                    'menu',
                    'close_menu',
                    'close_all_menus',
                    'update_menu',
                    'update_menu_items',
                    'menu_scroll'
                ]);
                const bootstrap = new Map();
                const playerState = {};
                const playerInventory = {};
                for (let index = 0; index < recording.data.length; index++) {
                    const message = recording.data[index];
                    if (Number(message?.wtrec?.timing) >= cutoff) {
                        break;
                    }
                    if (bootstrapTypes.has(message?.msg)) {
                        bootstrap.set(message.msg, index);
                    }
                    if (message?.msg === 'player') {
                        for (const [key, value] of Object.entries(message)) {
                            if (key === 'inv' && value
                                && typeof value === 'object') {
                                for (const [slot, item] of Object.entries(value)) {
                                    playerInventory[slot] = {
                                        ...(playerInventory[slot] || {}),
                                        ...(item || {})
                                    };
                                }
                            } else if (key !== 'msg' && key !== 'wtrec') {
                                playerState[key] = value;
                            }
                        }
                    }
                }
                const keep = new Set(bootstrap.values());
                const prefix = recording.data.filter((message, index) =>
                    keep.has(index));
                if (Object.keys(playerState).length > 0) {
                    prefix.push({
                        msg: 'player',
                        ...playerState,
                        ...(Object.keys(playerInventory).length > 0
                            ? {inv: playerInventory}
                            : {}),
                        wtrec: {
                            type: 'receive',
                            timing: Math.max(0, cutoff - 1)
                        }
                    });
                }
                let droppedMenuMessageCount = 0;
                const tail = recording.data.filter(message => {
                    if (Number(message?.wtrec?.timing) < cutoff) {
                        return false;
                    }
                    if (menuTypes.has(message?.msg)) {
                        droppedMenuMessageCount++;
                        return false;
                    }
                    return true;
                });
                recording.data = [...prefix, ...tail];
                globalThis.__mapPredictorCrop = {
                    requestedCutoff,
                    cutoff,
                    firstTargetTime,
                    originalMessageCount,
                    retainedMessageCount: prefix.length + tail.length,
                    droppedMenuMessageCount
                };
                zip.file('wtrec.json', JSON.stringify(recording));
                blob = await zip.generateAsync({
                    type: 'blob',
                    compression: 'DEFLATE',
                    compressionOptions: {level: 6}
                });
            }
            globalThis.__mapPredictorPlayback = globalThis.DWEM.Modules.WTRec
                .playWTRec(blob, {startTime, autoplay: false, speed})
                .catch(error => {
                    globalThis.__mapPredictorPlaybackError = error?.message
                        || String(error);
                    throw error;
                });
        }, {
            recordingUrl: RECORDING_ROUTE,
            startTime: Number(sidecar.startTime) || 0,
            speed: positiveNumber(sidecar.speed, 10),
            preludeMs: Number.isFinite(sidecar.preludeMs)
                ? Math.max(0, sidecar.preludeMs)
                : 30000,
            firstTargetTime: (() => {
                const times = sidecar.targets
                    .map(target => Number(target.fromTime))
                    .filter(Number.isFinite);
                return times.length > 0 ? Math.min(...times) : null;
            })()
        });
        await page.waitForFunction(() => [...document.querySelectorAll('div')]
            .some(element => element.textContent?.trim() === 'WTREC Player'), null, {
            timeout: 120000
        });
        await page.evaluate(() => {
            const title = [...document.querySelectorAll('div')]
                .find(element => element.textContent?.trim() === 'WTREC Player');
            const button = title?.parentElement
                ?.querySelector('button[title="Play/Pause (Space)"]');
            if (!button) {
                throw new Error('WTRec play button was not found.');
            }
            button.click();
        });
        const playbackTimeout = positiveNumber(
            options.timeout,
            positiveNumber(sidecar.timeoutMs, 300000)
        );
        await waitForPlayback(page, sidecar, playbackTimeout);
        await waitForSettledState(
            page,
            positiveNumber(sidecar.settleMs, 1500),
            positiveNumber(sidecar.settleTimeoutMs, 60000)
        );
        const playbackError = await page.evaluate(() =>
            globalThis.__mapPredictorPlaybackError || null);
        if (playbackError) {
            throw new Error(`WTRec playback failed: ${playbackError}`);
        }
        const raw = await page.evaluate(() => ({
            ...globalThis.__mapPredictorBenchmark.stop(),
            crop: globalThis.__mapPredictorCrop || null
        }));
        const runtimeError = raw.samples.find(sample => sample.error)?.error
            || raw.finalState?.error;
        if (runtimeError) {
            throw new Error(
                `MapPredictor runtime failed: ${runtimeError.code || 'error'}: `
                + (runtimeError.message || 'unknown failure')
            );
        }
        const report = buildBenchmarkReport(raw, sidecar, {
            recordingName: recording.name,
            recordingSha256,
            recordingSource: recording.source,
            dwemCommit,
            errors
        });
        const json = `${JSON.stringify(report, null, 2)}\n`;
        if (options.output) {
            await writeFile(path.resolve(options.output), json);
        } else {
            process.stdout.write(json);
        }
        await context.close();
    } finally {
        await browser.close();
    }
}

main().catch(error => {
    process.stderr.write(`${error.stack || error.message || String(error)}\n`);
    process.exitCode = 1;
});
