import {interpolateColor, isKorean, randomChoice, wait} from './utils.js';

const LATENCY_CHECK_PAYLOAD = {
    msg: 'register',
    username: '',
    password: 'LATENCY_CHECK',
    email: ''
};
const SARANGBANG_BLACKLIST = ['CNCPublicChat'];
const WTREC_MIN_SIZE = 10 * 1024 * 1024;
const WTREC_INDEX_URL = 'https://wtrec-json.nemelex.cards/wtrec';
const WTREC_FILE_BASE_URL = 'https://wtrec.nemelex.cards/wtrec';

export default class LobbyActions {
    latency = null;
    latencySocket = null;
    chartModule = null;
    chart = null;
    chartData = null;
    count = 1;
    showLatencyIndicator = false;
    sarangbang = false;

    getLatencySocket() {
        const {WebSocketFactory} = DWEM.Modules;
        let startTime;
        const socket = WebSocketFactory.create((data) => {
            if (data.msg === 'register_fail') {
                socket.latencyResolver(Date.now() - startTime);
            } else if (data.msg === 'ping') {
                socket.send(JSON.stringify({msg: 'pong'}));
            }
        });
        socket.getLatency = function () {
            startTime = Date.now();
            return new Promise(resolve => {
                socket.latencyResolver = resolve;
                this.send(JSON.stringify(LATENCY_CHECK_PAYLOAD));
            });
        };
        return socket;
    }

    getLatency() {
        const {WebSocketFactory} = DWEM.Modules;
        return new Promise(resolve => {
            let startTime;
            const socket = WebSocketFactory.create((data) => {
                if (data.msg === 'register_fail') {
                    socket.close();
                    resolve(Date.now() - startTime);
                }
            });

            socket.onopen = () => {
                startTime = Date.now();
                socket.send(JSON.stringify(LATENCY_CHECK_PAYLOAD));
            };
        });
    }

    getLobbyList() {
        const {WebSocketFactory} = DWEM.Modules;
        return new Promise(resolve => {
            const lobbyList = [];
            const socket = WebSocketFactory.create((data) => {
                if (data.msg === 'lobby_entry') {
                    lobbyList.push(data);
                } else if (data.msg === 'lobby_complete') {
                    socket.close();
                    resolve(lobbyList);
                }
            });
        });
    }

    async goSarangbang() {
        let list = await this.getLobbyList();
        list = list.filter(e => !SARANGBANG_BLACKLIST.includes(e.username));
        if (list.length > 0) {
            list.sort((a, b) => a.spectator_count - b.spectator_count);
            const count = list[list.length - 1].spectator_count;
            list = list.filter(msg => msg.spectator_count === count);
            const {username} = randomChoice(list);
            location.hash = `#watch-${username}`;
        } else {
            setTimeout(this.goSarangbang.bind(this), 1000);
        }
    }

    async enterSarangbang() {
        for (let i = 10; i > 0; i--) {
            document.getElementById('sarangbang-second').style.color = 'blue';
            document.getElementById('sarangbang-second').textContent = ` (${i}s)`;
            await wait(1000);
            if (!this.sarangbang) {
                return;
            }
        }
        await this.goSarangbang();
    }

    async toggleSarangbang() {
        const {IOHook} = DWEM.Modules;
        const {before, after} = IOHook.handle_message;
        this.sarangbang = !this.sarangbang;
        if (this.sarangbang) {
            before.addHandler('cnc-banner-sarangbang', (data) => {
                if (data.msg === 'game_ended') {
                    return true;
                }
            });
            after.addHandler('cnc-banner-sarangbang', (data) => {
                if (data.msg === 'go_lobby') {
                    this.enterSarangbang();
                }
            });
            await this.goSarangbang();
        } else {
            document.getElementById('sarangbang-second').style.color = '';
            document.getElementById('sarangbang-second').textContent = '';
            before.removeHandler('cnc-banner-sarangbang');
            after.removeHandler('cnc-banner-sarangbang');
        }
    }

    async updateLatencyText(force = false) {
        if (!this.latency || force) {
            this.latency = await this.getLatency();
        }

        const latency = document.getElementById('latency');
        if (!latency) {
            return;
        }

        latency.textContent = this.latency;
        latency.style.color = this.getLatencyColor(this.latency);
    }

    getLatencyColor(latency) {
        if (latency <= 50) {
            return interpolateColor('#00FF00', '#0000FF', latency / 50);
        } else if (latency <= 150) {
            return interpolateColor('#0000FF', '#FFFF00', (latency - 50) / 100);
        } else if (latency <= 300) {
            return interpolateColor('#FFFF00', '#FF0000', (latency - 150) / 150);
        } else if (latency <= 1000) {
            return interpolateColor('#FF0000', '#808080', (latency - 300) / 700);
        }
        return '#808080';
    }

    async loadChart() {
        if (!this.chartModule) {
            this.chartModule = await import('https://cdn.skypack.dev/chart.js@v4.4.7');
            this.chartModule.Chart.register(...this.chartModule.registerables);
        }
        return this.chartModule.Chart;
    }

    async toggleLatencyIndicator(event) {
        event?.preventDefault?.();
        this.showLatencyIndicator = !this.showLatencyIndicator;
        const indicator = document.getElementById('latency-indicator');
        if (!indicator) {
            return;
        }

        if (this.showLatencyIndicator) {
            const Chart = await this.loadChart();
            this.chartData = {
                labels: [],
                datasets: [{
                    label: 'Latency',
                    backgroundColor: 'rgba(255, 99, 132, 0.2)',
                    borderColor: 'rgba(255, 99, 132, 1)',
                    data: [],
                    fill: false,
                }]
            };
            indicator.innerHTML = '';
            const canvas = document.createElement('canvas');
            indicator.appendChild(canvas);
            const span = document.createElement('span');
            indicator.appendChild(span);
            const ctx = canvas.getContext('2d');
            this.chart = new Chart(ctx, {
                type: 'line',
                data: this.chartData,
                options: {
                    scales: {
                        x: {type: 'category', position: 'bottom'},
                        y: {beginAtZero: true}
                    },
                    animation: {duration: 0},
                    maintainAspectRatio: true
                }
            });
            this.count = 1;
            this.latencySocket = this.getLatencySocket();
            setTimeout(async () => {
                while (this.latencySocket) {
                    const latency = await this.latencySocket.getLatency();
                    this.chartData.labels.push(`${this.count++}t`);
                    const data = this.chartData.datasets[0].data;
                    data.push(latency);
                    this.chart.update();
                    const sum = data.reduce((a, v) => a + v, 0);
                    const min = data.reduce((a, v) => Math.min(a, v), Number.MAX_SAFE_INTEGER);
                    const max = data.reduce((a, v) => Math.max(a, v), Number.MIN_SAFE_INTEGER);
                    const avg = Math.floor(sum / data.length * 100) / 100;
                    span.textContent = `${data.length}t=${latency}MS, AVG=${avg}MS, MAX=${max}MS, MIN=${min}MS`;
                    await wait(500);
                }
            }, 1000);
        } else {
            this.latencySocket?.close();
            this.latencySocket = null;
        }
        indicator.style.display = this.showLatencyIndicator ? '' : 'none';
    }

    async playWTRec() {
        let url = prompt(
            "Please enter a URL in the form of\n\"https://wtrec.nemelex.cards/wtrec/*/*.wtrec\".\n\nOK with empty input ('') = play random.\nCancel = do nothing."
        );
        if (url === null) {
            return;
        }
        if (url !== '') {
            const blob = await fetch(url).then(r => r.blob());
            if (blob.size >= WTREC_MIN_SIZE) {
                DWEM.Modules.WTRec.playWTRec(blob);
            } else {
                alert(`File is too small (${(blob.size / 1024 / 1024).toFixed(2)}MB). Please select a file that is 10MB or larger.`);
            }
            return;
        }

        const list = await fetch(WTREC_INDEX_URL).then(r => r.json());
        const maxAttempts = 30;
        let attempts = 0;
        let largestFileUrl = null;
        let largestFileSize = 0;

        while (attempts < maxAttempts) {
            const user = randomChoice(list).name;
            attempts++;

            const files = await fetch(`${WTREC_INDEX_URL}/${user}`).then(r => r.json());
            for (const file of files) {
                if (file.size > largestFileSize) {
                    largestFileUrl = `${WTREC_FILE_BASE_URL}/${user}/${file.name}`;
                    largestFileSize = file.size;
                }
            }

            const largeFiles = files.filter(file => file.size >= WTREC_MIN_SIZE);
            if (largeFiles.length > 0) {
                const file = randomChoice(largeFiles);
                const blob = await fetch(`${WTREC_FILE_BASE_URL}/${user}/${file.name}`).then(r => r.blob());
                DWEM.Modules.WTRec.playWTRec(blob);
                return;
            }
        }

        if (largestFileUrl) {
            console.log(`No file >= 10MB found. Playing largest file found: ${(largestFileSize / 1024 / 1024).toFixed(2)}MB`);
            const blob = await fetch(largestFileUrl).then(r => r.blob());
            DWEM.Modules.WTRec.playWTRec(blob);
        } else {
            alert('Could not find any wtrec files.');
        }
    }

    async uploadWTRec(event) {
        try {
            event?.preventDefault?.();
        } catch (_) {}

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.wtrec,.zip,application/zip';
        input.style.display = 'none';
        document.body.appendChild(input);
        input.onchange = async () => {
            const file = input.files && input.files[0];
            document.body.removeChild(input);
            if (!file) {
                return;
            }
            try {
                await DWEM.Modules.WTRec.playWTRec(file);
            } catch (e) {
                console.error(e);
                alert('Failed to play WTRec file. Please ensure it is a valid .wtrec/.zip.');
            }
        };
        input.click();
    }

    enhanceWTRecLinks() {
        const links = document.querySelectorAll('a[href="javascript:DWEM.Modules.CNCBanner.playWTRec()"]');
        const titleText = isKorean()
            ? '좌클릭: URL 입력 또는 랜덤 재생 | 우클릭: 내 wtrec 파일 업로드 후 재생'
            : 'Left click: Enter URL or play random | Right click: Upload your wtrec and play';

        links.forEach(a => {
            if (a.dataset.wtrecEnhanced) {
                return;
            }
            try {
                a.oncontextmenu = null;
                a.removeAttribute('oncontextmenu');
            } catch (_) {}
            a.title = a.title || titleText;
            a.addEventListener('contextmenu', (e) => {
                try {
                    e.preventDefault();
                } catch (_) {}
                try {
                    e.stopPropagation();
                } catch (_) {}
                try {
                    DWEM.Modules.CNCBanner.uploadWTRec(e);
                } catch (_) {}
                return false;
            }, {passive: false});
            a.dataset.wtrecEnhanced = 'true';
        });
    }
}
