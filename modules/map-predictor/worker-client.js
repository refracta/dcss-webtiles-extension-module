export const MATCHER_WORKER_MODULE_URL = new URL(
    './matcher-worker.js',
    import.meta.url
);

function canUseBlobBootstrap(BlobClass, urlApi) {
    return typeof BlobClass === 'function'
        && typeof urlApi?.createObjectURL === 'function'
        && typeof urlApi?.revokeObjectURL === 'function';
}

function isCrossOrigin(moduleUrl, locationObject) {
    if (!locationObject?.origin) {
        return false;
    }
    try {
        return moduleUrl.origin !== locationObject.origin;
    } catch (error) {
        return false;
    }
}

/**
 * Small lifecycle wrapper around the matcher module worker.
 *
 * DWEM modules are commonly served by jsDelivr while the game runs on a
 * different origin. A direct module Worker is then rejected by Chrome, so a
 * same-origin blob module imports the exact immutable module URL instead.
 */
export default class MatcherWorkerClient {
    constructor(options = {}) {
        this.WorkerClass = options.WorkerClass || globalThis.Worker;
        this.BlobClass = options.BlobClass || globalThis.Blob;
        this.urlApi = options.urlApi || globalThis.URL;
        this.location = options.location || globalThis.location;
        this.moduleUrl = options.moduleUrl || MATCHER_WORKER_MODULE_URL;
        this.onMessage = options.onMessage || (() => {});
        this.onError = options.onError || (() => {});
        this.worker = null;
        this.objectUrl = null;
        this.mode = null;
        this.terminated = false;

        this.start();
    }

    start() {
        if (typeof this.WorkerClass !== 'function') {
            throw new Error('Web Worker is unavailable.');
        }

        const blobAvailable = canUseBlobBootstrap(this.BlobClass, this.urlApi);
        const preferBlob = blobAvailable
            && isCrossOrigin(this.moduleUrl, this.location);
        const attempts = preferBlob
            ? ['blob-module', 'module']
            : ['module', 'blob-module'];
        let lastError = null;

        for (const mode of attempts) {
            if (mode === 'blob-module' && !blobAvailable) {
                continue;
            }
            try {
                this.worker = mode === 'blob-module'
                    ? this.createBlobWorker()
                    : new this.WorkerClass(this.moduleUrl, {
                        type: 'module',
                        name: 'dwem-map-predictor'
                    });
                this.mode = mode;
                this.attachHandlers();
                return;
            } catch (error) {
                lastError = error;
                this.revokeObjectUrl();
            }
        }

        throw lastError || new Error('Unable to create matcher worker.');
    }

    createBlobWorker() {
        const source = `import ${JSON.stringify(this.moduleUrl.href)};`;
        const blob = new this.BlobClass([source], {type: 'text/javascript'});
        this.objectUrl = this.urlApi.createObjectURL(blob);
        return new this.WorkerClass(this.objectUrl, {
            type: 'module',
            name: 'dwem-map-predictor'
        });
    }

    attachHandlers() {
        this.worker.onmessage = event => {
            if (!this.terminated) {
                this.onMessage(event?.data);
            }
        };
        this.worker.onerror = error => {
            if (!this.terminated) {
                this.onError(error);
            }
        };
        this.worker.onmessageerror = error => {
            if (!this.terminated) {
                this.onError(error);
            }
        };
    }

    postMessage(message) {
        if (!this.worker || this.terminated) {
            throw new Error('Matcher worker is not active.');
        }
        this.worker.postMessage(message);
    }

    revokeObjectUrl() {
        if (this.objectUrl) {
            this.urlApi.revokeObjectURL(this.objectUrl);
            this.objectUrl = null;
        }
    }

    terminate() {
        if (this.terminated) {
            return;
        }
        this.terminated = true;
        this.worker?.terminate?.();
        this.worker = null;
        this.revokeObjectUrl();
    }
}
