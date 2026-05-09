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
        cb(new Error('File upload only supports the following filetypes - png or gif'));
    }
};

const upload = multer({
    storage,
    limits: {fileSize: 5 * 1024 * 1024},
    fileFilter
});

app.get('/entities', async (req, res) => {
    try {
        const result = getEntityList({
            user: req.query.user,
            type: req.query.type,
            q: req.query.q,
            limit: req.query.limit,
            offset: req.query.offset,
            order: req.query.order
        });
        res.status(200).json(result);
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({error: error.message});
        }

        console.error(error);
        res.status(500).json({error: 'Internal server error'});
    }
});

app.get('/users/:username/entities', async (req, res) => {
    try {
        const result = getEntityList({
            user: req.params.username,
            type: req.query.type,
            q: req.query.q,
            limit: req.query.limit,
            offset: req.query.offset,
            order: req.query.order
        });
        res.status(200).json(result);
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({error: error.message});
        }

        console.error(error);
        res.status(500).json({error: 'Internal server error'});
    }
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
        const ext = file.mimetype.split('/').pop();
        entity.file = `${entity.user}.${entity.timestamp}.${ext}`;
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
        const entity = db.data.entities[entityNumber - 1];
        if (!entity) {
            return res.status(404).json({error: 'Entity not found'});
        }
        res.status(200).json(publicEntity(entity, entityNumber));
    } catch (error) {
        console.error(error);
        res.status(500).json({error: 'Internal server error'});
    }
});

app.use('/files', express.static(path.join(__dirname, 'files')));

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

function getEntityList({user, type, q, limit, offset, order}) {
    const normalizedType = normalizeEntityType(type);
    const normalizedQuery = String(q || '').trim().toLowerCase();
    const pageLimit = parsePageLimit(limit);
    const pageOffset = parsePageOffset(offset);
    const sortOrder = order === 'asc' ? 'asc' : 'desc';
    const numbers = getEntityNumbers(user)
        .map((number) => ({
            number,
            entity: db.data.entities[number - 1]
        }))
        .filter(({entity}) => entity)
        .filter(({entity}) => !normalizedType || entity.type === normalizedType)
        .filter(({entity}) => !normalizedQuery || getEntitySearchText(entity).includes(normalizedQuery))
        .sort((a, b) => compareEntityEntries(a, b, sortOrder));
    const total = numbers.length;
    const entities = numbers
        .slice(pageOffset, pageOffset + pageLimit)
        .map(({number, entity}) => publicEntity(entity, number));

    return {
        total,
        limit: pageLimit,
        offset: pageOffset,
        order: sortOrder,
        type: normalizedType || null,
        q: q || '',
        user: user || null,
        entities
    };
}

function getEntityNumbers(user) {
    if (!user) {
        return db.data.entities.map((_, index) => index + 1);
    }

    const userKey = findUserKey(user);
    return userKey ? [...(db.data.users[userKey] || [])] : [];
}

function findUserKey(username) {
    const value = String(username || '').trim();
    if (!value) return null;
    if (db.data.users[value]) return value;

    const lowered = value.toLowerCase();
    return Object.keys(db.data.users).find((key) => key.toLowerCase() === lowered) || null;
}

function normalizeEntityType(type) {
    const value = String(type || '').trim();
    if (!value) return '';
    if (['game', 'item', 'menu'].includes(value)) return value;

    const error = new Error('Invalid entity type');
    error.statusCode = 400;
    throw error;
}

function parsePageLimit(value) {
    const limit = Number.parseInt(value, 10);
    if (!Number.isFinite(limit)) return 24;
    return Math.max(1, Math.min(100, limit));
}

function parsePageOffset(value) {
    const offset = Number.parseInt(value, 10);
    if (!Number.isFinite(offset)) return 0;
    return Math.max(0, offset);
}

function compareEntityEntries(a, b, order) {
    const direction = order === 'asc' ? 1 : -1;
    return direction * (
        Number(a.entity.timestamp || 0) - Number(b.entity.timestamp || 0) ||
        a.number - b.number
    );
}

function getEntitySearchText(entity) {
    return [
        entity.item,
        entity.type,
        entity.user
    ].filter(Boolean).join(' ').toLowerCase();
}

function publicEntity(entity, number) {
    const publicData = {
        ...entity,
        number,
        url: `${config.entrypoint}/entities/${number}`
    };
    delete publicData.ip;

    if (publicData.file && !/^https?:\/\//i.test(publicData.file)) {
        publicData.file = `${config.entrypoint}/${String(publicData.file).replace(/^\/+/, '')}`;
    }

    return publicData;
}
