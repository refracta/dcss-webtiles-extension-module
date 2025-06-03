/**
 * proxy-server.ts
 *
 * ‣ gzip/deflate/br 응답을 node-fetch가 **자동으로 해제**한다는 점을 활용해
 *   ‘이중(gunzip) 해제’ 오류를 없앤 버전입니다.
 * ‣ 해제된 뒤에는 Content-Encoding / Content-Length 헤더를 제거하고
 *   `Content-Encoding: identity`로 바꿔 클라이언트에 전달합니다.
 */

import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';          // v3.x  (공식 ESM)
import fs from 'fs';
import { pipeline } from 'stream/promises';

const CONFIG_PATH = 'config.json';
let allowed = [];

try {
    const { allowed: allowList = [] } = JSON.parse(
        fs.readFileSync(CONFIG_PATH, 'utf-8'),
    );
    allowed = allowList;
} catch (err) {
    console.error('Error reading config.json:', err);
    process.exit(1);
}

const app = express();
const PORT = 3000;

app.use(bodyParser.json());
app.use(cors());

app.get('/', (_req, res) => {
    res.type('html').send('<html></html>');
});

/**
 * POST /  { url: "https://example.com/foo.json" }
 */
app.post('/', async (req, res) => {
    const { url } = req.body;

    /* 1. 입력 검증 ---------------------------------------------------------- */
    if (!url) {
        return res.status(400).json({ error: 'No URL provided.' });
    }
    if (!allowed.some((base) => url.startsWith(base))) {
        return res.status(403).json({ error: 'URL is not allowed.' });
    }

    /* 2. 원본 서버에 요청 ---------------------------------------------------- */
    try {
        console.log(`PROXY → ${url}`);

        /** node-fetch v3: 기본값 { decompress:true } → gzip/br/deflate 자동 해제 */
        const upstream = await fetch(url, {
            // 원한다면 accept-encoding 헤더를 명시적으로 지정할 수도 있음
            // headers: { 'accept-encoding': 'gzip, deflate, br' },
        });

        if (!upstream.ok) {
            return res
                .status(upstream.status)
                .json({ error: `Upstream returned ${upstream.status}` });
        }

        /* 3. 헤더 복사/정리 --------------------------------------------------- */
        upstream.headers.forEach((value, name) => {
            const n = name.toLowerCase();
            // 압축을 이미 풀었으므로, 인코딩/길이 헤더는 제거
            if (n === 'content-encoding' || n === 'content-length') return;
            res.setHeader(name, value);
        });
        // “이 데이터는 압축돼 있지 않다”는 의미
        res.setHeader('Content-Encoding', 'identity');
        // CORS 허용 (필요에 따라 조정)
        res.setHeader('Access-Control-Allow-Origin', '*');

        /* 4. 본문 스트림 전달 -------------------------------------------------- */
        // upstream.body 는 이미 평문 스트림 (gunzip 완료 상태)
        await pipeline(upstream.body, res);
    } catch (err) {
        console.error('Proxy error:', err);
        res.status(500).json({ error: 'Internal proxy error.' });
    }
});

app.listen(PORT, () => {
    console.log(`Proxy server running at http://localhost:${PORT}/`);
});
