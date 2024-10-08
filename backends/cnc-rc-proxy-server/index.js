import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';
import fs from 'fs';

const configPath = 'config.json';
let allowed = [];

try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    allowed = config.allowed;
} catch (error) {
    console.error('Error reading config.json:', error);
    process.exit(1);
}

const app = express();
const port = 3000;

app.use(bodyParser.json());
app.use(cors());
app.get('/', (req, res) =>{
    res.write('<html></html>');
    res.end();
})
app.post('/', async (req, res) => {
    const {url} = req.body;

    if (!url) {
        return res.status(400).json({error: 'No URL provided in body.'});
    }

    const isAllowed = allowed.some((allowedLink) => url.startsWith(allowedLink));

    if (!isAllowed) {
        return res.status(403).json({error: 'URL is not allowed.'});
    }

    try {
        console.log(`PROXY: ${url}`)
        const response = await fetch(url);
        if (!response.ok) {
            return res.status(response.status).json({error: 'Error fetching the URL.'});
        }

        response.headers.forEach((value, name) => {
            res.setHeader(name, value);
        });
        res.setHeader('Access-Control-Allow-Origin', '*');

        response.body.pipe(res);
    } catch (error) {
        console.error('Error during fetch:', error);
        res.status(500).json({error: 'Error occurred while fetching the URL.'});
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);
});
