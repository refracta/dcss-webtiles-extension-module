import express from 'express';
import request from 'request';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';

const ES_URL = process.env.ES_URL || 'http://elasticsearch:9200';
const INDEX  = 'documents';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// UI Form 제출 → ES 검색
app.post('/search', (req, res) => {
    const { q, source, from = 0, size = 50 } = req.body;

    const query = source && source !== 'all'
        ? { bool: { must:[{ match:{ content:q }}], filter:[{ term:{ source } }] } }
        : { match:{ content:q } };

    request.post(
        `${ES_URL}/${INDEX}/_search`,
        { json: { from: +from, size: +size, query } },
        (_e, _r, body) => {
            const hits   = body.hits?.hits.map(h => h._source) || [];
            const total  = body.hits?.total?.value || 0;
            res.json({ hits, total });          // ← total 포함해 응답
        }
    );
});

// Distinct source 목록 제공
app.get('/sources', (_req, res) => {
    request.post(
        `${ES_URL}/${INDEX}/_search`,
        { json: {
                size: 0,
                aggs: { srcs: { terms: { field: 'source', size: 10000 } } }
            }},
        (_e, _r, body) => {
            const list = body.aggregations?.srcs?.buckets.map(b => b.key) || [];
            res.json(list);
        }
    );
});

app.listen(3000, () => console.log('🌐  http://localhost:3000'));
