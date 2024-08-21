import express from 'express';
import multer from 'multer';
import cors from 'cors';
import {JSONFilePreset} from 'lowdb/node';
import path from 'path';
import {fileURLToPath} from 'url';
import * as fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

const db = await JSONFilePreset('db.json', {entities: [], users: {}});

// Ensure images directory exists
fs.mkdirSync('images', {recursive: true});

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'images'));
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, String(Date.now()));
    }
});

const fileFilter = (req, file, cb) => {
    const allowedMimeTypes = [
        'image/png',
    ];
    const mimetype = allowedMimeTypes.includes(file.mimetype.toLowerCase());
    if (mimetype) {
        return cb(null, true);
    } else {
        cb(new Error('File upload only supports the following filetypes - png'));
    }
};

const upload = multer({
    storage,
    limits: {fileSize: 5 * 1024 * 1024},
    fileFilter
});

app.post('/upload', upload.single('image'), async (req, res) => {
    try {
        let {data} = req.body;
        const {file} = req;

        if (!data || !file) {
            return res.status(400).json({error: 'Invalid request'});
        }

        data = JSON.parse(data);
        data.timestamp = Date.now();
        data.ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        data.filename = `${data.user}.${data.timestamp}.png`;
        const newFilePath = path.join(__dirname, 'images', data.filename);
        data.filename = `images/${data.filename}`;
        fs.renameSync(file.path, newFilePath);

        let entityNumber;
        await db.update(({entities, users}) => {
            entities.push(data);
            entityNumber = entities.length;
            if (!users[data.user]) {
                users[data.user] = [];
            }
            users[data.user].push(entityNumber);
        });

        console.log('Uploaded data:', entityNumber, data);
        const url = `${config.entrypoint}/entities/${entityNumber}`;
        res.status(200).json({url});
    } catch (error) {
        console.error(error);
        res.status(500).json({error: 'Internal server error'});
    }
});

app.get('/entities/:entityNumber', async (req, res) => {
    try {
        const entityNumber = parseInt(req.params.entityNumber, 10);
        let entity = db.data.entities[entityNumber - 1];
        entity = {...entity};
        delete entity['ip'];
        if (!entity) {
            return res.status(404).json({error: 'Entity not found'});
        }
        res.status(200).json(entity);
    } catch (error) {
        console.error(error);
        res.status(500).json({error: 'Internal server error'});
    }
});

app.use('/images', express.static(path.join(__dirname, 'images')));

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
