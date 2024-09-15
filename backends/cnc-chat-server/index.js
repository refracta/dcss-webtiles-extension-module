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

fs.mkdirSync('files', {recursive: true});

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'files'));
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, String(Date.now()));
    }
});

const fileFilter = (req, file, cb) => {
    const allowedMimeTypes = [
        'image/png',
        'image/gif'
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

app.post('/upload', upload.single('file'), async (req, res) => {
    try {
        let {data: entity} = req.body;
        const {file} = req;

        if (!entity || !file) {
            return res.status(400).json({error: 'Invalid request'});
        }

        entity = JSON.parse(entity);
        entity.timestamp = Date.now();
        entity.ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const ext = path.extname(file.originalname).toLowerCase();
        entity.file = `${entity.user}.${entity.timestamp}${ext}`;
        const newFilePath = path.join(__dirname, 'files', entity.file);
        entity.file = `files/${entity.file}`;
        fs.renameSync(file.path, newFilePath);

        let entityNumber;
        await db.update(({entities, users}) => {
            entities.push(entity);
            entityNumber = entities.length;
            if (!users[entity.user]) {
                users[entity.user] = [];
            }
            users[entity.user].push(entityNumber);
        });

        console.log('Uploaded data:', entityNumber, entity);
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
        if (!entity) {
            return res.status(404).json({error: 'Entity not found'});
        }
        entity = {...entity};
        delete entity['ip'];
        entity.file = `${config.entrypoint}/${entity.file}`;
        res.status(200).json(entity);
    } catch (error) {
        console.error(error);
        res.status(500).json({error: 'Internal server error'});
    }
});

app.use('/files', express.static(path.join(__dirname, 'files')));

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
