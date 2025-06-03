import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';
import fs from 'fs';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';

const configPath = 'config.json';
const { allowed = [] } = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const app = express();
app.use(bodyParser.json());
app.use(cors());

app.post('/', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'No URL provided.' });
    if (!allowed.some((base) => url.startsWith(base)))
        return res.status(403).json({ error: 'URL is not allowed.' });

    try {
        console.log(`PROXY: ${url}`);

        // 1) node-fetch는 기본적으로 알아서 gunzip 합니다.
        //    필요하다면 { decompress: false }로 끄고 직접 해제해도 됩니다.
        const upstream = await fetch(url, {
            // 헤더를 명시해 두면 서버가 gzip 을 줄 확률이 높아집니다.
            headers: { 'accept-encoding': 'gzip, deflate, br' },
            // decompress: false  // 직접 해제하려면 주석을 풀어 주세요
        });

        if (!upstream.ok)
            return res.status(upstream.status).json({ error: 'Fetch failed.' });

        /** ---------- 공통 헤더 처리 ---------- */
        upstream.headers.forEach((value, name) => {
            const n = name.toLowerCase();
            // gzip 을 풀어서 보내므로 content-encoding/length 는 제거
            if (n === 'content-encoding' || n === 'content-length') return;
            res.setHeader(name, value);
        });
        // 브라우저에서 다시 압축하지 말라는 의미로 identity 지정
        res.setHeader('Content-Encoding', 'identity');
        res.setHeader('Access-Control-Allow-Origin', '*');

        /** ---------- 본문 스트림 처리 ---------- */
        const enc = upstream.headers.get('content-encoding');
        if (enc === 'gzip' /* && decompress:false 일 때만 필요 */) {
            await pipeline(upstream.body, zlib.createGunzip(), res);
        } else {
            // 이미 풀린 스트림이면 그대로 전달
            await pipeline(upstream.body, res);
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Proxy error.' });
    }
});

app.listen(3000, () => console.log('Server running on :3000'));
