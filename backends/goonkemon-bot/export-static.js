import {createHash} from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {renderMonsterHtml} from './goonkemon.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.join(MODULE_DIR, 'static');

export function exportStaticSite({
    storageDir,
    outputDir,
    generatedAt = new Date().toISOString(),
    expectedCaptureCount = 0
}) {
    const sourceRoot = path.resolve(String(storageDir || ''));
    const destinationRoot = path.resolve(String(outputDir || ''));
    assertExportPaths(sourceRoot, destinationRoot);

    const captureFiles = findCaptureFiles(sourceRoot);
    const captures = captureFiles.map(jsonPath => ({
        jsonPath,
        imagesPath: jsonPath.replace(/\.json$/i, '.images.json'),
        capture: readJson(jsonPath)
    })).sort((a, b) => String(a.capture.id).localeCompare(String(b.capture.id)));
    validateCaptures(captures);
    if (Number(expectedCaptureCount) > 0 && captures.length !== Number(expectedCaptureCount)) {
        throw new Error(`Expected ${expectedCaptureCount} captures, found ${captures.length}.`);
    }
    const sourceSha256 = calculateSourceDigest(sourceRoot, captures);

    fs.rmSync(destinationRoot, {recursive: true, force: true});
    fs.mkdirSync(path.join(destinationRoot, 'data'), {recursive: true});
    fs.mkdirSync(path.join(destinationRoot, 'assets', 'images'), {recursive: true});
    fs.mkdirSync(path.join(destinationRoot, 'ranking'), {recursive: true});
    fs.mkdirSync(path.join(destinationRoot, 'list'), {recursive: true});

    copyStaticFile('app.js', destinationRoot);
    copyStaticFile('style.css', destinationRoot);
    fs.copyFileSync(path.join(MODULE_DIR, 'score-rules.js'), path.join(destinationRoot, 'score-rules.js'));
    fs.writeFileSync(path.join(destinationRoot, 'index.html'), renderAppPage('ranking', './'));
    fs.writeFileSync(path.join(destinationRoot, 'ranking', 'index.html'), renderAppPage('ranking', '../'));
    fs.writeFileSync(path.join(destinationRoot, 'list', 'index.html'), renderAppPage('list', '../'));

    const assetSizes = new Map();
    let sourceImageBytes = 0;
    const captureIndex = [];

    for (const item of captures) {
        const {capture, jsonPath, imagesPath} = item;
        const id = String(capture.id);
        const encodedId = encodeURIComponent(id);
        const detailDir = path.join(destinationRoot, id);
        fs.mkdirSync(detailDir, {recursive: true});
        fs.copyFileSync(jsonPath, path.join(destinationRoot, 'data', `${id}.json`));

        if (!fs.existsSync(imagesPath)) {
            throw new Error(`Missing image bundle for ${id}: ${imagesPath}`);
        }
        const imageBundle = readJson(imagesPath);
        const staticImageBundle = {
            ...imageBundle,
            images: {}
        };
        for (const [name, image] of Object.entries(imageBundle.images || {}).sort()) {
            const decoded = decodeImage(image, `${id}:${name}`);
            const hash = createHash('sha256').update(decoded.bytes).digest('hex');
            const extension = extensionForMime(decoded.mime);
            const assetName = `${hash}.${extension}`;
            const assetPath = path.join(destinationRoot, 'assets', 'images', assetName);
            sourceImageBytes += decoded.bytes.length;
            if (!assetSizes.has(assetName)) {
                fs.writeFileSync(assetPath, decoded.bytes);
                assetSizes.set(assetName, decoded.bytes.length);
            }
            staticImageBundle.images[name] = {
                mime: decoded.mime,
                byteLength: decoded.bytes.length,
                url: `../assets/images/${assetName}`
            };
        }
        writeJson(path.join(destinationRoot, 'data', `${id}.images.json`), staticImageBundle);

        const detailHtml = renderMonsterHtml(
            capture,
            `../data/${encodedId}.json`,
            `../data/${encodedId}.images.json`,
            {
                scoreRulesPath: '../score-rules.js',
                rankingPath: '../ranking/'
            }
        );
        fs.writeFileSync(path.join(detailDir, 'index.html'), detailHtml);
        captureIndex.push({
            id,
            username: capture.username || '',
            capturedAt: capture.capturedAt || '',
            analysis: capture.analysis || capture.score || {}
        });
    }

    writeJson(path.join(destinationRoot, 'data', 'captures.json'), {
        generatedAt,
        captures: captureIndex
    });

    const assetBytes = [...assetSizes.values()].reduce((sum, size) => sum + size, 0);
    const build = {
        schemaVersion: 1,
        generatedAt,
        sourceSha256,
        captureCount: captures.length,
        imageManifestCount: captures.length,
        imageAssetCount: assetSizes.size,
        sourceImageBytes,
        imageAssetBytes: assetBytes
    };
    writeJson(path.join(destinationRoot, 'build.json'), build);
    return build;
}

function assertExportPaths(storageDir, outputDir) {
    if (!storageDir || storageDir === path.parse(storageDir).root || !fs.existsSync(storageDir)) {
        throw new Error(`Invalid storage directory: ${storageDir}`);
    }
    if (!outputDir || outputDir === path.parse(outputDir).root || outputDir === storageDir) {
        throw new Error(`Invalid output directory: ${outputDir}`);
    }
}

function findCaptureFiles(storageDir) {
    const files = [];
    walk(storageDir, filePath => {
        if (filePath.endsWith('.json') && !filePath.endsWith('.images.json')) {
            files.push(filePath);
        }
    });
    return files.sort();
}

function walk(dir, visit) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(fullPath, visit);
        } else if (entry.isFile()) {
            visit(fullPath);
        }
    }
}

function validateCaptures(captures) {
    const ids = new Set();
    for (const {capture, jsonPath} of captures) {
        const id = String(capture?.id || '');
        if (!capture?.monster || !/^[A-Za-z0-9_-]+$/.test(id)) {
            throw new Error(`Invalid capture in ${jsonPath}`);
        }
        if (ids.has(id)) {
            throw new Error(`Duplicate capture id: ${id}`);
        }
        ids.add(id);
    }
}

function calculateSourceDigest(storageDir, captures) {
    const hash = createHash('sha256');
    hash.update('goonkemon-static-source-v1\0');
    for (const item of captures) {
        for (const filePath of [item.jsonPath, item.imagesPath]) {
            if (!fs.existsSync(filePath)) {
                throw new Error(`Missing source file: ${filePath}`);
            }
            const relativePath = path.relative(storageDir, filePath).split(path.sep).join('/');
            const contents = fs.readFileSync(filePath);
            hash.update(relativePath);
            hash.update('\0');
            hash.update(String(contents.length));
            hash.update('\0');
            hash.update(contents);
        }
    }
    return hash.digest('hex');
}

function decodeImage(image, label) {
    let mime = String(image?.mime || 'image/png');
    let encoded = String(image?.data || '');
    if (!encoded && image?.dataUrl) {
        const dataUrl = String(image.dataUrl);
        const comma = dataUrl.indexOf(',');
        const metadata = comma >= 0 ? dataUrl.slice(5, comma) : '';
        if (comma < 0 || !metadata.includes(';base64')) {
            throw new Error(`Unsupported image data URL for ${label}`);
        }
        mime = metadata.split(';')[0] || mime;
        encoded = dataUrl.slice(comma + 1);
    }
    if (!encoded) {
        throw new Error(`Missing image data for ${label}`);
    }
    return {
        mime,
        bytes: Buffer.from(encoded, 'base64')
    };
}

function extensionForMime(mime) {
    switch (String(mime).toLowerCase()) {
    case 'image/jpeg':
        return 'jpg';
    case 'image/webp':
        return 'webp';
    case 'image/gif':
        return 'gif';
    case 'image/png':
        return 'png';
    default:
        throw new Error(`Unsupported image MIME type: ${mime}`);
    }
}

function copyStaticFile(filename, outputDir) {
    fs.copyFileSync(path.join(STATIC_DIR, filename), path.join(outputDir, filename));
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function renderAppPage(view, prefix) {
    const ranking = view !== 'list';
    const heading = ranking ? 'Goonkemon ranking' : 'Goonkemon list';
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${heading}</title>
<link rel="stylesheet" href="${prefix}style.css">
<script type="module" src="${prefix}app.js"></script>
</head>
<body data-view="${view}">
<main>
<header class="page-header">
    <h1>${heading}</h1>
    <nav aria-label="Goonkemon pages">
        <a href="${prefix}ranking/" data-route="ranking">Ranking</a>
        <a href="${prefix}list/" data-route="list">Search captures</a>
    </nav>
</header>
<section id="goonkemon-app" aria-live="polite">
    <p class="loading">Loading captures...</p>
</section>
<noscript><p class="error">JavaScript is required to calculate scores and search captures.</p></noscript>
</main>
</body>
</html>
`;
}

function readArgument(name) {
    const exact = process.argv.indexOf(`--${name}`);
    if (exact >= 0) {
        return process.argv[exact + 1] || '';
    }
    const prefix = `--${name}=`;
    const match = process.argv.find(argument => argument.startsWith(prefix));
    return match ? match.slice(prefix.length) : '';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const build = exportStaticSite({
            storageDir: readArgument('storage') || process.env.GOONKEMON_STORAGE_DIR,
            outputDir: readArgument('output') || process.env.GOONKEMON_STATIC_OUTPUT,
            generatedAt: readArgument('generated-at') || new Date().toISOString(),
            expectedCaptureCount: Number(readArgument('expected-count') || 0)
        });
        console.log(JSON.stringify(build, null, 2));
    } catch (error) {
        console.error(error.message || error);
        process.exitCode = 1;
    }
}
