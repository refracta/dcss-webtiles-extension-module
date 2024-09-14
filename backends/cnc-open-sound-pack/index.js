const express = require('express');
const multer = require('multer');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const authCodes = require('./authcodes.json');
const axios = require("axios");
const archiver = require('archiver');
const cors = require('cors');

const app = express();
const PORT = 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    }, filename: (req, file, cb) => {
        let filename = file.originalname;
        let counter = 1;
        while (fs.existsSync(path.join(uploadDir, filename))) {
            filename = `${path.parse(file.originalname).name}_${counter}${path.extname(file.originalname)}`;
            counter++;
        }
        cb(null, filename);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedFileTypes = /mp3|wav|ogg|m4a/;
    const allowedMimeTypes = ['audio/mpeg',   // mp3
        'audio/wav',    // wav
        'audio/ogg',    // ogg
        'audio/mp4',    // m4a
    ];
    const extname = allowedFileTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedMimeTypes.includes(file.mimetype.toLowerCase());

    console.log(file.originalname, file.mimetype); // 디버깅용 로그 출력

    if (extname && mimetype) {
        return cb(null, true);
    } else {
        cb(new Error('File upload only supports the following filetypes - mp3, wav, ogg, m4a'));
    }
};

const upload = multer({
    storage: storage, limits: {fileSize: 5 * 1024 * 1024, files: 20}, // 5MB 파일 크기 제한, 한 번에 최대 20개 파일
    fileFilter: fileFilter
}).array('files', 20); // 한 번에 최대 20개 파일 업로드

let uploadLogs = {}; // 사용자별 업로드 로그

app.post('/upload', (req, res) => {
    upload(req, res, function (err) {
        const userCode = req.body.authcode;
        const userIP = req.headers['x-forwarded-for'] || req.ip; // X-Forwarded-For 헤더 사용
        const isAuthenticated = authCodes.authcodes.includes(userCode);
        console.log(isAuthenticated, userCode, authCodes); // 디버깅용 로그 출력

        if (err instanceof multer.MulterError) {
            return res.status(500).json({error: err.message});
        } else if (err) {
            return res.status(500).json({error: err.message});
        }
        if (!req.files) {
            return res.status(400).json({error: 'No files were uploaded.'});
        }

        if (!uploadLogs[userIP]) {
            uploadLogs[userIP] = [];
        }

        // 최근 1시간 내의 업로드 로그만 유지
        const now = Date.now();
        uploadLogs[userIP] = uploadLogs[userIP].filter(timestamp => now - timestamp < 60 * 60 * 1000);

        const remainingUploads = 20 - uploadLogs[userIP].length;

        if (!isAuthenticated && remainingUploads <= 0) {
            return res.status(429).json({error: 'Upload limit exceeded. Try again later.'});
        }

        if (!isAuthenticated && req.files.length > remainingUploads) {
            return res.status(400).json({error: `You can only upload ${remainingUploads} more file(s).`});
        }

        // 업로드 로그 업데이트
        if (!isAuthenticated) {
            req.files.forEach(() => uploadLogs[userIP].push(Date.now()));
        }

        const fileUrls = req.files.map(file => ({
            filename: file.filename,
            url: `/uploads/${file.filename}`,
            size: file.size,
            uploadTime: new Date().toISOString()
        }));

        const newRemainingUploads = isAuthenticated ? remainingUploads : remainingUploads - req.files.length;

        // IP와 파일 업로드 내역 로그 출력
        console.log(`IP: ${userIP}, Uploaded Files:`, fileUrls);

        res.status(200).json({files: fileUrls, remainingUploads: newRemainingUploads});
    });
});

app.get('/remaining-uploads', (req, res) => {
    const userIP = req.headers['x-forwarded-for'] || req.ip; // X-Forwarded-For 헤더 사용
    if (!uploadLogs[userIP]) {
        uploadLogs[userIP] = [];
    }
    const now = Date.now();
    uploadLogs[userIP] = uploadLogs[userIP].filter(timestamp => now - timestamp < 60 * 60 * 1000);
    const remainingUploads = 20 - uploadLogs[userIP].length;
    res.status(200).json({remainingUploads});
});

// /list 경로 추가
app.get('/list', (req, res) => {
    fs.readdir(uploadDir, (err, files) => {
        if (err) {
            return res.status(500).send('Unable to scan directory: ' + err);
        }

        const fileList = files.map(file => {
            const filePath = path.join(uploadDir, file);
            const stats = fs.statSync(filePath);
            return {
                filename: file, size: stats.size, uploadTime: stats.birthtime
            };
        });

        // 업로드 시간 기준으로 정렬 (내림차순)
        fileList.sort((a, b) => new Date(b.uploadTime) - new Date(a.uploadTime));

        res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>Uploaded Files</title>
      </head>
      <body>
        <h1>Uploaded Files</h1>
        <ul>
          ${fileList.map(file => `
            <li>
              <a href="/uploads/${file.filename}">${file.filename}</a>
              <br>Size: ${(file.size / 1024).toFixed(2)} KB
              <br>Upload Time: ${file.uploadTime}
            </li>
          `).join('')}
        </ul>
        <a href="/">Go back to Upload Page</a>
      </body>
      </html>
    `);
    });
});
const ENTRYPOINT = 'https://osp.nemelex.cards/';
const UPLOADS = ENTRYPOINT + 'uploads';
app.get('/request-build', async (req, res) => {
    try {
        let response = await axios.get('https://script.google.com/macros/s/AKfycbwRlkmG1lrsM0u466175yulAobpUufbF830QtlWlxiMFS5sVqBo2TBr02_6rvHJwHtFHg/exec');
        let list = response.data.data;
        list = list.filter(e => e.REGEX !== '' && e.PATH !== '' && e.SOUND !== '' && e.SOUND.startsWith(UPLOADS) && e.RCFILE !== '');
        list = list.map(e => ({...e, PRIORITY: (isNaN(e.PRIORITY) || e.PRIORITY === '') ? Number.MAX_SAFE_INTEGER : parseInt(e.PRIORITY)}));
        list.sort((a, b) => a.PRIORITY - b.PRIORITY);
        const rcFiles = Array.from(new Set(list.map(e => e.RCFILE)));
        const rcContents = {};
        for (const rcFile of rcFiles) {
            rcContents[rcFile] = '';
        }
        for (const element of list) {
            const {RCFILE, REGEX, PATH} = element;
            rcContents[RCFILE] += `sound ^= ${REGEX}:${PATH}\n`;
        }
        const output = fs.createWriteStream('build/latest.zip');
        const archive = archiver('zip', {
            zlib: {level: 9}
        });
        archive.pipe(output);
        for (let key of Object.keys(rcContents)) {
            archive.append(rcContents[key], {name: key});
        }
        const soundSet = new Set();
        for (const element of list) {
            let {SOUND, PATH} = element;
            if (soundSet.has(PATH)) {
                continue
            }
            soundSet.add(PATH);
            SOUND = SOUND.replace(ENTRYPOINT, '');
            SOUND = SOUND.split(/[\\/]/g).filter(part => part !== '.' && part !== '..').join('/');
            SOUND = decodeURIComponent(SOUND);
            archive.file('./' + SOUND, {name: PATH});
            console.log(SOUND, PATH);
        }
        const registerCounts = list
            .filter(e => e.REGISTER)
            .map(e => e.REGISTER)
            .reduce((acc, register) => {
                acc[register] = (acc[register] || 0) + 1;
                return acc;
            }, {});
        const sortedRegisters = Object.entries(registerCounts)
            .sort((a, b) => b[1] - a[1]);
        const thanksMessage = sortedRegisters
            .map(([register, count]) => `${register} (x${count})`)
            .join(', ');
        const now = new Date();
        const offset = now.getTimezoneOffset() * 60000;
        const kstDate = new Date(now.getTime() + offset + 9 * 60 * 60000);
        const year = kstDate.getFullYear().toString().slice(2);
        const month = String(kstDate.getMonth() + 1).padStart(2, '0');
        const day = String(kstDate.getDate()).padStart(2, '0');
        const hours = String(kstDate.getHours()).padStart(2, '0');
        const minutes = String(kstDate.getMinutes()).padStart(2, '0');
        const seconds = String(kstDate.getSeconds()).padStart(2, '0');
        const version = `${year}${month}${day}${hours}${minutes}${seconds}`;
        const soundPackInfo = `CNC Open Sound Pack v${version} (https://l.abstr.net/cnc-osp) / Thanks to ${thanksMessage}`;
        archive.append(soundPackInfo, {name: 'sound-pack-info'});
        await archive.finalize();
    } catch (e) {
        res.send({result: 'fail', error: e.message});
    } finally {
        res.send({result: 'success'})
    }
});

// 루트 경로를 추가합니다.
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const setSecurityHeaders = (req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    next();
};

app.use('/build', setSecurityHeaders, cors({origin: '*'}), express.static(path.join(__dirname, 'build')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(setSecurityHeaders, express.static('public'));

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
