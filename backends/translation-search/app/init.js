import fs from 'fs';
import path from 'path';
import { globSync } from 'glob';
import request from 'request';
import { fileURLToPath } from 'url';
import StreamArray from 'stream-json/streamers/StreamArray.js'

const ES_URL = process.env.ES_URL || 'http://elasticsearch:9200';
const INDEX  = 'documents';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* ─── 1. 인덱스(있으면 패스) ─── */
function createIndex() {
    return new Promise((resolve) =>
        request.put(
            `${ES_URL}/${INDEX}`,
            { json: { mappings: { properties: {
                            source:  { type: 'keyword' },
                            content: { type: 'text' }
                        }}}},
            () => resolve()
        ));
}

/* ─── 2. ND-JSON 10 MB 버퍼로 묶어 전송 ─── */
function bulkSend(lines) {
    return new Promise((resolve, reject) => {
        request.post(
            `${ES_URL}/_bulk`,
            {
                headers: { 'Content-Type': 'application/x-ndjson' },
                body: lines
            },
            (err, _res, body) => {
                if (err) return reject(err);
                const r = JSON.parse(body);
                if (r.errors) return reject(new Error('Bulk insert error'));
                resolve();
            }
        );
    });
}

/* ─── 3. 단일 파일 스트리밍 색인 ─── */
async function indexFile(file) {
    return new Promise((resolve, reject) => {
        const src = path.basename(file, '.json');
        const stream = fs.createReadStream(file).pipe(StreamArray.withParser());

        let buf = [];
        let size = 0;
        const FLUSH_LIMIT = 10 * 1024 * 1024;   // 10 MB

        const flush = async () => {
            if (!buf.length) return;
            stream.pause();                   // 잠시 멈춤
            await bulkSend(buf.join('\n') + '\n').catch(reject);
            buf.length = 0;
            size = 0;
            stream.resume();
        };

        stream.on('data', async ({ value: str }) => {
            const meta = JSON.stringify({ index: { _index: INDEX } });
            const doc  = JSON.stringify({ source: src, content: str });
            const add  = meta.length + doc.length + 2;

            if (size + add > FLUSH_LIMIT) await flush();
            buf.push(meta, doc);
            size += add;
        });

        stream.on('end', async () => {
            try { await flush(); resolve(); } catch (e) { reject(e); }
        });
        stream.on('error', reject);
    });
}

/* ─── 4. 실행 ─── */
(async () => {
    console.log('🛠  index check/create…');
    await createIndex();

    const files = globSync(path.join(__dirname, 'packs', '*.json'));
    console.log(`📦  ${files.length} file(s) detected`);

    for (const f of files) {
        console.log(`→ ${path.basename(f)}`);
        await indexFile(f);
    }
    console.log('✅  all indexed');
})();
