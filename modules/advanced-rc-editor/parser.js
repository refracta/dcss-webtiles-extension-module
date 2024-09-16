const fs = require('fs');
let guide = fs.readFileSync('options_guide.txt', 'utf8');
guide = guide.replaceAll('\r\n', '\n');
const snippets = guide.split(/\n\n(?=[a-z])/gim);

const list = [];
for (let snippet of snippets) {
    snippet = snippet.trim();
    const lines = snippet.split('\n');
    const docText = snippet.replaceAll('(DWEM)', '').replaceAll('(LUA)', '');
    let meta = snippet.includes('(DWEM)') ? "dwem option" : "dcss option";
    if (snippet.includes('(LUA)')) {
        meta = 'dcss lua';
    } else if (snippet.includes('(SOUND PACK)')) {
        meta = 'sound pack';
    }

    for (let line of lines) {
        const lineSplit = line.split(' ');
        let name = lineSplit.shift();
        if (line.includes('= ') || meta === 'dcss lua' || meta === 'sound pack') {
            if (name === "") {
                break;
            }
            const data = {
                caption: name,
                value: name,
                docText,
                meta
            }
            list.push(data);
        } else {
            break;
        }
    }

}


fs.writeFileSync('completions.json', JSON.stringify(list, null, 4), 'utf8');
