import {Chart, registerables} from 'https://cdn.skypack.dev/chart.js@v4.4.7';

Chart.register(...registerables);

export default class CNCBanner {
    static name = 'CNCBanner';
    static version = '1.0';
    static dependencies = ['IOHook', 'SiteInformation', 'ModuleManager', 'WebSocketFactory', 'WTRec'];
    static description = 'This module sets the banner for the CNC server.';

    openRCLinks() {
        const textContent = `[CDI]
https://crawl.dcss.io/crawl/rcfiles/crawl-git/%n.rc

[CDO]
https://crawl.develz.org/configs/trunk/%n.rc

[CAO]
https://crawl.akrasiac.org/rcfiles/crawl-git/%n.rc

[CUE]
https://underhound.eu/crawl/rcfiles/crawl-git/%n.rc

[CBRO2]
https://cbro.berotato.org/rcfiles/crawl-git/%n

[LLD]
http://lazy-life.ddo.jp/mirror/meta/0.31/rcfiles/%n.rc
(You can use 0.31 version RC)

[CWZ]
https://webzook.net/soup/rcfiles/trunk/%n.rc

[CXC]
https://crawl.xtahua.com/crawl/rcfiles/crawl-git/%n.rc
`;
        const newWindow = window.open("", "_blank", "width=600,height=400");
        newWindow.document.open();
        newWindow.document.write("<!DOCTYPE html><html><head><title>RC Links</title></head><body><pre>" + textContent + "</pre></body></html>");
    }

    getRandomColor() {
        const colors = ['#ff4000', '#008cc0', '#cad700', '#009800', '#8000ff'];
        return colors[Math.floor(Math.random() * colors.length)];
    }

    colorizeText() {
        const text = document.getElementById('coloredText').textContent
        const words = text.split(" ");
        this.colors = this.colors || words.map(_ => this.getRandomColor());
        const coloredWords = words.map((word, index) => `<span style="color:${this.colors[index]};">${word}</span>`);
        document.getElementById('coloredText').innerHTML = coloredWords.join(" ");
    }

    getLatencySocket() {
        const {WebSocketFactory} = DWEM.Modules;
        let startTime, endTime;
        const socket = WebSocketFactory.create((data) => {
            if (data.msg === 'register_fail') {
                endTime = Date.now();
                socket.latencyResolver(endTime - startTime);
            } else if (data.msg === 'ping') {
                socket.send(JSON.stringify({msg: 'pong'}));
            }
        });
        socket.getLatency = function () {
            startTime = Date.now();
            return new Promise(resolve => {
                socket.latencyResolver = resolve;
                this.send(JSON.stringify({
                    msg: 'register', username: '', password: 'LATENCY_CHECK', email: ''
                }));
            })
        }
        return socket;
    }

    getLatency() {
        const {WebSocketFactory} = DWEM.Modules;
        return new Promise(resolve => {
            let startTime, endTime;
            const socket = WebSocketFactory.create((data) => {
                if (data.msg === 'register_fail') {
                    socket.close();
                    endTime = Date.now();
                    resolve(endTime - startTime);
                }
            });

            socket.onopen = () => {
                startTime = Date.now();
                socket.send(JSON.stringify({
                    msg: 'register', username: '', password: 'LATENCY_CHECK', email: ''
                }));
            }
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

    blackList = ['CNCPublicChat'];

    async goSarangbang() {
        let list = await this.getLobbyList();
        list = list.filter(e => !this.blackList.includes(e.username));
        if (list.length > 0) {
            list.sort((a, b) => a.spectator_count - b.spectator_count);
            const count = list[list.length - 1].spectator_count
            list = list.filter(msg => msg.spectator_count === count);
            const {username} = list[Math.floor(Math.random() * list.length)];
            location.hash = `#watch-${username}`;
        } else {
            setTimeout(this.goSarangbang.bind(this), 1000);
        }
    }

    async enterSarangbang() {
        for (let i = 10; i > 0; i--) {
            document.getElementById('sarangbang-second').style.color = 'blue';
            document.getElementById('sarangbang-second').textContent = ` (${i}s)`;
            await new Promise(resolve => setTimeout(resolve, 1000));
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
        document.getElementById('latency').textContent = this.latency;

        function interpolateColor(color1, color2, factor) {
            const result = color1.slice(1).match(/.{2}/g)
                .map((hex, i) => Math.round(parseInt(hex, 16) * (1 - factor) + parseInt(color2.slice(1).match(/.{2}/g)[i], 16) * factor)
                    .toString(16).padStart(2, '0')).join('');
            return `#${result}`;
        }

        let color;
        if (this.latency <= 50) {
            color = interpolateColor('#00FF00', '#0000FF', this.latency / 50); // Green to Blue
        } else if (this.latency <= 150) {
            color = interpolateColor('#0000FF', '#FFFF00', (this.latency - 50) / 100); // Blue to Yellow
        } else if (this.latency <= 300) {
            color = interpolateColor('#FFFF00', '#FF0000', (this.latency - 150) / 150); // Yellow to Red
        } else if (this.latency <= 1000) {
            color = interpolateColor('#FF0000', '#808080', (this.latency - 300) / 700); // Red to Grey
        } else {
            color = '#808080'; // Grey
        }
        document.getElementById('latency').style.color = color;
    }

    #getTimeRemaining(endTime, currentTime) {
        const total = Date.parse(endTime) - Date.parse(currentTime);
        const seconds = Math.floor((total / 1000) % 60);
        const minutes = Math.floor((total / 1000 / 60) % 60);
        const hours = Math.floor((total / (1000 * 60 * 60)) % 24);
        const days = Math.floor(total / (1000 * 60 * 60 * 24));
        return {
            total, days, hours, minutes, seconds
        };
    }
    //  url: navigator.language.startsWith('ko') ? 'https://tournament.nemelex.cards/0.32.html' : 'https://crawl.develz.org/tournament/0.32/'
    tournaments = [
        {
            id: 'stable-tournament',
            name: '0.33 Tournament',
            startUTC: new Date(Date.UTC(2025, 4, 2, 20, 0, 0)),
            endUTC: new Date(Date.UTC(2025, 4, 18, 20, 0, 0)),
            url:  'https://crawl.develz.org/tournament/0.33/'
        },
        {
            id: 'cssdt-tournament',
            name: 'Crawl Cosplay Sudden Death Tournament (0.32)',
            startUTC: new Date(Date.UTC(2024, 10, 1, 0, 0, 0)),
            endUTC: new Date(Date.UTC(2024, 11, 6, 0, 0, 0)),
            url: 'https://cosplay.kelbi.org/ccsdt/ccsdt.html'
        },
        {
            id: 'cctt-tournament',
            name: 'Crawl Cosplay Trunk Tournament',
            startUTC: new Date(Date.UTC(2025, 2 - 1, 21, 0, 0, 0)),
            endUTC: new Date(Date.UTC(2025, 2 - 1, 21 + 7 * 5, 0, 0, 0)),
            url: 'https://crawlcosplay.dcss.io/cctt/about_cctt'
        }
    ];

    getTournaments() {
        return this.tournaments.map(tournament => (
            {message: this.getTournamentMessage(tournament.name, tournament.startUTC, tournament.endUTC, tournament.url), ...tournament}
        ))
            .filter(info => info.message !== '')
            .map(info => `<span id="${info.id}">${info.message}</span>`)
            .join('<br>');
    }

    startUpdateTournamentInfo() {
        clearInterval(this.updateTournamentKey);
        this.updateTournamentKey = setInterval(() => {
            for (const tournament of this.tournaments) {
                const tag = document.getElementById(tournament.id);
                if (tag) {
                    tag.innerHTML = this.getTournamentMessage(tournament.name, tournament.startUTC, tournament.endUTC, tournament.url);
                }
            }
        }, 1000);
    }

    getTournamentMessage(name, startUTC, endUTC, url) {
        const now = new Date();
        const sevenDays = 7 * 24 * 60 * 60 * 1000;
        const options = {month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric'};

        const userLang = navigator.language || navigator.userLanguage;
        const isKorean = userLang.startsWith('ko');
        const locales = isKorean ? 'ko' : 'en';
        const startLocal = startUTC.toLocaleString(locales, options);
        const endLocal = endUTC.toLocaleString(locales, options);

        let message = '';
        const startTimeRemaining = this.#getTimeRemaining(startUTC, now).total;
        const endTimeRemaining = this.#getTimeRemaining(endUTC, now).total;

        if (isKorean) {
            message += `🏆 <a href="${url}">${name}</a>가 ${startLocal}부터 ${endLocal}까지 진행됩니다! `;
            if (startTimeRemaining > 0 && startTimeRemaining <= sevenDays) {
                const timeToStart = this.#getTimeRemaining(startUTC, now);
                message += `(시작까지 ${timeToStart.days}일 ${timeToStart.hours}시간 ${timeToStart.minutes}분 남음)`;
            } else if (now >= startUTC && now < endUTC) {
                const timeToEnd = this.#getTimeRemaining(endUTC, now);
                message += `(종료까지 ${timeToEnd.days}일 ${timeToEnd.hours}시간 ${timeToEnd.minutes}분 남음)`;
            } else if (Math.abs(endTimeRemaining) <= sevenDays && endTimeRemaining < 0) {
                message = `🏆 <a href="${url}">${name}</a>가 종료되었습니다. 모두 고생하셨습니다!`;
            } else {
                message = '';
            }
        } else {
            message += `🏆 <a href="${url}">${name}</a> runs from ${startLocal} to ${endLocal}. `;
            if (startTimeRemaining > 0 && startTimeRemaining <= sevenDays) {
                const timeToStart = this.#getTimeRemaining(startUTC, now);
                message += `(Starts in ${timeToStart.days} days ${timeToStart.hours} hours ${timeToStart.minutes} minutes)`;
            } else if (now >= startUTC && now < endUTC) {
                const timeToEnd = this.#getTimeRemaining(endUTC, now);
                message += `(Ends in ${timeToEnd.days} days ${timeToEnd.hours} hours ${timeToEnd.minutes} minutes)`;
            } else if (Math.abs(endTimeRemaining) <= sevenDays && endTimeRemaining < 0) {
                message = `🏆 <a href="${url}">${name}</a> has ended. Thank you for participating.`;
            } else {
                message = '';
            }
        }
        return message;
    }

    toggleLatencyIndicator(event) {
        this.showLatencyIndicator = !this.showLatencyIndicator;
        const indicator = document.getElementById('latency-indicator');
        if (this.showLatencyIndicator) {
            this.chartData = {
                labels: [], datasets: [{
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
                type: 'line', data: this.chartData, options: {
                    scales: {
                        x: {
                            type: 'category', position: 'bottom'
                        }, y: {
                            beginAtZero: true
                        }
                    }, animation: {
                        duration: 0
                    }, maintainAspectRatio: true
                }
            });
            this.count = 1;
            this.latencySocket = this.getLatencySocket();
            // TODO onopen promise
            setTimeout(async _ => {
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
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }, 1000);
        } else {
            this.latencySocket?.close();
            this.latencySocket = null;
        }
        indicator.style.display = this.showLatencyIndicator ? '' : 'none';
        event.preventDefault();
    }

    getOverlayHTML(aprilImage) {
        return `
    <style>
        .af-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
        }

        .af-container {
            background-color: #000;
            border: 1px solid #626262;
            padding: 10px;
            box-sizing: border-box;
        }

        .af-container img {
            width: 500px;
            height: 500px;
            display: block;
            z-index: 99999;
        }

        .af-footer {
            display: flex;
            justify-content: space-between;
            color: #fff;
            font-size: 14px;
            margin-top: 5px;
        }

        .close-btn {
            cursor: pointer;
            text-decoration: underline;
        }
    </style>

    <div class="af-overlay">
        <div class="af-container">
            <img src="${aprilImage}" alt="af">
            <div class="af-footer">
                <span>인생은 <span style="color: lawngreen">Deal Four </span>아니면 <span style="color: darkorchid">Stack Five</span>다!</span>
                <span class="close-btn" onclick="document.querySelector('.af-overlay').style.display = 'none';">오늘 하루 보지 않기</span>
            </div>
        </div>
    </div>
    `;
    }

    getKoreanBanner(current_user) {
        const today = new Date();
        const isAprilFools = today.getMonth() === 4 - 1 && today.getDate() === 1;
        const aprilImage = import.meta.url.substring(0, import.meta.url.lastIndexOf('/')) + '/images/xobeh.gif';
        if (isAprilFools) {
            return `
        ${this.getOverlayHTML(aprilImage)}
        <style>
            #play_now a, #player_list a, .extra_links a {
                color: #f4d700 !important;
            }
            #play_now a:hover, #player_list a:hover, .extra_links a:hover {
                color: #fa0000 !important;
            }
        </style>
        조베죽 [ New - 갓 - 서버 ]에 온 것을 환영한다.<br>
        <details>
            <summary style="cursor: pointer;">당연히 신은 <span style="color: lawngreen">조베</span>겠지?</summary>
            <div style="margin-left: 15px">
                <a href="https://refracta.github.io/nemelx-alter-3d" id="coloredText">카드 안에 모든 것이 있나니!</a>
                <a title="서버 지연 시간입니다. 다시 측정하려면 클릭, 지연 시간 측정기를 확인하려면 우클릭하세요" style="text-decoration: none" href="javascript:DWEM.Modules.CNCBanner.updateLatencyText(true)" oncontextmenu="DWEM.Modules.CNCBanner.toggleLatencyIndicator(event)">(<span id="latency">?</span> MS)</a>
                <div id="latency-indicator" style="display: none; max-width: 500px"></div>
                <br>
                ${current_user ? `
                <a href="https://webtiles.nethack.live" style="font-size: small; margin: 0; padding:0; text-decoration: none"> 넷핵도 웹타일로 플레이 할 수 있다는 것을 아시나요?</a>
                <br>` : ''}
                <details>
                    <summary style="cursor: pointer;">KST 2024.06.19 14:12:00 시점의 <a href="https://crawl.project357.org">CPO (호주 서버)</a> 사용자 데이터베이스를 사용하여 서버를 시작했습니다.</summary>
                    <div>
                        <p>이것은 단순히 계정 선점 남용(기존 사용자들의 스코어를 망치는 등의 트롤링 행위)을 방지하기 위한 조치입니다. 여러 서버에 걸쳐 서로 다른 소유자를 가진 있는 계정이 있는 경우, 이러한 계정 소유자를 CPO 계정의 소유자로 간주하지 않습니다. 소명 기간은 1년입니다. 다른 서버의 자격 증명을 <strong>2025년 6월</strong>까지 수동으로 제출하면 계정이 최초 요청자에게 이전됩니다.</p>
                        <p><strong>[자격 증명 제출 방법]</strong><br>
                            다른 서버에 로그인하여 Trunk RC 파일 상단에 "# CRAWL.NEMELEX.CARDS" 줄을 추가한 후 <a href="javascript:DWEM.Modules.CNCBanner.openRCLinks()">RC 링크</a>를 제출하세요 (<a href="https://discord.gg/cFUynNtAVA">서버 디스코드 - cnc-account-migration 채널</a>). 계정을 받은 후에는 소명 기간이 끝날 때까지 CNC 계정의 Trunk RC 파일 상단에 "# CRAWL.NEMELEX.CARDS" 줄을 추가하고 유지하세요. 또한, 이러한 상황에 있는 CPO 사용자는 이 서버의 Trunk RC 파일 상단에 "# CRAWL.NEMELEX.CARDS" 줄을 추가해야 합니다. 이 줄이 있으면 CPO 계정 사용자를 최초 요청자로 간주합니다.</p>
                        <p>KST 2024.06.19 19:00:00 갱신: 본 서버에 처음 로그인할 때 "# CRAWL.NEMELEX.CARDS" 줄이 자동으로 Trunk RC 파일에 삽입됩니다.</p>
                        <p>KST 2024.06.18 00:00:00에서 2024.06.18 07:03:00 사이에 등록한 사용자에 대해서는 계정 데이터가(비밀번호 등) CPO의 것으로 변경되었습니다 (게임 데이터는 유지됩니다). 로그인하는 데 문제가 있는 경우 관리자에게 연락하세요.</p>
                    </div>
                </details>
                <br>
                <p style="padding:5px; border-radius:10px; background-color:#2c6f17; display:inline-block; margin:0 0 10px 0; line-height:1.3;">
                            <a href="https://archive.nemelex.cards">플레이어 데이터</a> -
                            <a href="https://github.com/refracta/dcss-server/issues">버그 신고</a> -
                            <a href="https://grafana.abstr.net/d/d256ff3c-64f5-42f1-ac0c-cf6637664308/cnc-server-status">서버 상태</a> - 
                            <a id="sarangbang" href="javascript:DWEM.Modules.CNCBanner.toggleSarangbang()" title="사랑방은 한옥에서 손님을 맞이하는 방을 말합니다. 이 기능이 켜져있으면 자동으로 관전자 수가 제일 많은 플레이어를 관전합니다.">사랑방<span id="sarangbang-second"></span></a> - 
                            <a href="https://terminal.nemelex.cards">웹 터미널</a> - 
                            <a href="javascript:DWEM.Modules.CNCBanner.playWTRec()">WTRec 재생 (베타)</a> - 
                            <a href="javascript:DWEM.Modules.ModuleManager.toggle()">DWEM 모듈 관리자 (Ctrl + F12)</a>
                            <br>
                            'nemelex' 사용자로 포트 1326에서 SSH 접속이 가능합니다. 비밀번호 'xobeh' 또는 <a href="https://archive.nemelex.cards/cao_key" style="text-decoration:none;">CAO 키</a>를 사용하여 인증할 수 있습니다.
                            <br>
                            <a href="https://archive.nemelex.cards/code_of_conduct.txt">서버 규칙</a>을 준수해주세요.
                            <br>
                            계정 또는 서버 문제의 경우, <a href="https://discord.gg/cFUynNtAVA">서버 디스코드</a>에서 ASCIIPhilia에게 문의할 수 있습니다.
                            <br>
                            7/2 업데이트: <a href="https://github.com/refracta/dcss-webtiles-extension-module">DWEM</a>에 추가된 <a href="https://github.com/refracta/dcss-webtiles-extension-module/blob/main/modules/sound-support/README.md">SoundSupport</a> 모듈을 사용해보세요!
                            <br>
                            DWEM에 <a href="https://docs.google.com/document/d/1AFNN3L139L3U9cMPNpFOViutlpaJ2rCdiJtkJ0g2ykY/edit?usp=sharing">번역 모듈</a>이 추가되었습니다. 한국어로 게임을 즐겨보세요. 관심이 있다면 번역 작업에도 도움을 주세요!
                            <br>
                            ${this.getTournaments()}
                </p>
            </div>
        </details>
        <br>
        ${current_user ? `더 열심히 하지 못하겠나. ${current_user}!<br><a href="https://archive.nemelex.cards/morgue/${current_user}/">morgues</a> <a href="https://archive.nemelex.cards/ttyrec/${current_user}/">ttyrecs</a> <a href="https://archive.nemelex.cards/rcfiles/?user=${current_user}">rcfiles</a><br>` : ''}
        <script>
            DWEM.Modules.CNCBanner.updateLatencyText();
            DWEM.Modules.CNCBanner.startUpdateTournamentInfo();
        </script>
        ${current_user ? `
        <script>
            DWEM.Modules.CNCBanner.colorizeText();
        </script>
        ` : ''}
    `;

        }
        return `
        <a href="https://refracta.github.io/nemelx-alter-3d" id="coloredText">카드 안에 모든 것이 있나니!</a>
        <a title="서버 지연 시간입니다. 다시 측정하려면 클릭, 지연 시간 측정기를 확인하려면 우클릭하세요" style="text-decoration: none" href="javascript:DWEM.Modules.CNCBanner.updateLatencyText(true)" oncontextmenu="DWEM.Modules.CNCBanner.toggleLatencyIndicator(event)">(<span id="latency">?</span> MS)</a>
        <div id="latency-indicator" style="display: none; max-width: 500px"></div>
        <br>
        ${current_user ? `
        <a href="https://webtiles.nethack.live" style="font-size: small; margin: 0; padding:0; text-decoration: none"> 넷핵도 웹타일로 플레이 할 수 있다는 것을 아시나요?</a>
        <br>` : ''}
        <details>
            <summary style="cursor: pointer;">KST 2024.06.19 14:12:00 시점의 <a href="https://crawl.project357.org">CPO (호주 서버)</a> 사용자 데이터베이스를 사용하여 서버를 시작했습니다.</summary>
            <div>
                <p>이것은 단순히 계정 선점 남용(기존 사용자들의 스코어를 망치는 등의 트롤링 행위)을 방지하기 위한 조치입니다. 여러 서버에 걸쳐 서로 다른 소유자를 가진 있는 계정이 있는 경우, 이러한 계정 소유자를 CPO 계정의 소유자로 간주하지 않습니다. 소명 기간은 1년입니다. 다른 서버의 자격 증명을 <strong>2025년 6월</strong>까지 수동으로 제출하면 계정이 최초 요청자에게 이전됩니다.</p>
                <p><strong>[자격 증명 제출 방법]</strong><br>
                    다른 서버에 로그인하여 Trunk RC 파일 상단에 "# CRAWL.NEMELEX.CARDS" 줄을 추가한 후 <a href="javascript:DWEM.Modules.CNCBanner.openRCLinks()">RC 링크</a>를 제출하세요 (<a href="https://discord.gg/cFUynNtAVA">서버 디스코드 - cnc-account-migration 채널</a>). 계정을 받은 후에는 소명 기간이 끝날 때까지 CNC 계정의 Trunk RC 파일 상단에 "# CRAWL.NEMELEX.CARDS" 줄을 추가하고 유지하세요. 또한, 이러한 상황에 있는 CPO 사용자는 이 서버의 Trunk RC 파일 상단에 "# CRAWL.NEMELEX.CARDS" 줄을 추가해야 합니다. 이 줄이 있으면 CPO 계정 사용자를 최초 요청자로 간주합니다.</p>
                <p>KST 2024.06.19 19:00:00 갱신: 본 서버에 처음 로그인할 때 "# CRAWL.NEMELEX.CARDS" 줄이 자동으로 Trunk RC 파일에 삽입됩니다.</p>
                <p>KST 2024.06.18 00:00:00에서 2024.06.18 07:03:00 사이에 등록한 사용자에 대해서는 계정 데이터가(비밀번호 등) CPO의 것으로 변경되었습니다 (게임 데이터는 유지됩니다). 로그인하는 데 문제가 있는 경우 관리자에게 연락하세요.</p>
            </div>
        </details>
        <p style="padding:5px; border-radius:10px; background-color:#2c6f17; display:inline-block; margin:20px 0 10px 0; line-height:1.3;">
            <a href="https://archive.nemelex.cards">플레이어 데이터</a> -
            <a href="https://github.com/refracta/dcss-server/issues">버그 신고</a> -
            <a href="https://grafana.abstr.net/d/d256ff3c-64f5-42f1-ac0c-cf6637664308/cnc-server-status">서버 상태</a> -
            <a id="sarangbang" href="javascript:DWEM.Modules.CNCBanner.toggleSarangbang()" title="사랑방은 한옥에서 손님을 맞이하는 방을 말합니다. 이 기능이 켜져있으면 자동으로 관전자 수가 제일 많은 플레이어를 관전합니다.">사랑방<span id="sarangbang-second"></span></a> -
            <a href="https://terminal.nemelex.cards">웹 터미널</a> -
            <a href="javascript:DWEM.Modules.CNCBanner.playWTRec()">WTRec 재생 (베타)</a> -
            <a href="javascript:DWEM.Modules.ModuleManager.toggle()">DWEM 모듈 관리자 (Ctrl + F12)</a>
            <br>
            'nemelex' 사용자로 포트 1326에서 SSH 접속이 가능합니다. 비밀번호 'xobeh' 또는 <a href="https://archive.nemelex.cards/cao_key" style="text-decoration:none;">CAO 키</a>를 사용하여 인증할 수 있습니다.
            <br>
            <a href="https://archive.nemelex.cards/code_of_conduct.txt">서버 규칙</a>을 준수해주세요.
            <br>
            계정 또는 서버 문제의 경우, <a href="https://discord.gg/cFUynNtAVA">서버 디스코드</a>에서 ASCIIPhilia에게 문의할 수 있습니다.
            <br>
            7/2 업데이트: <a href="https://github.com/refracta/dcss-webtiles-extension-module">DWEM</a>에 추가된 <a href="https://github.com/refracta/dcss-webtiles-extension-module/blob/main/modules/sound-support/README.md">SoundSupport</a> 모듈을 <a href="https://crawl.nemelex.cards/?arce_append=%23%20Recommended%20settings%0Asound_on%20%3D%20true%0Asound_pack%20%2B%3D%20https%3A%2F%2Fosp.nemelex.cards%2Fbuild%2Flatest.zip%3A%5B%22init.txt%22%5D%0Aone_SDL_sound_channel%20%3D%20true%0Asound_fade_time%20%3D%200.5">사용해보세요!</a>
            <br>
            DWEM에 <a href="https://docs.google.com/document/d/1AFNN3L139L3U9cMPNpFOViutlpaJ2rCdiJtkJ0g2ykY/edit?usp=sharing">번역 모듈</a>이 추가되었습니다. 한국어로 게임을 <a href="https://crawl.nemelex.cards/?arce_append=translation_language%20=%20ko">즐겨보세요</a>. 관심이 있다면 번역 작업에도 도움을 주세요!
            <br>
            ${this.getTournaments()}
        </p>
        <script>
            DWEM.Modules.CNCBanner.updateLatencyText();
            DWEM.Modules.CNCBanner.startUpdateTournamentInfo();
        </script>
        ${current_user ? `
        <p>
            안녕하세요, ${current_user}! <br>여기서 기록을 확인할 수 있습니다: <a href="https://archive.nemelex.cards/morgue/${current_user}/">morgues</a> <a href="https://archive.nemelex.cards/ttyrec/${current_user}/">ttyrecs</a> <a href="https://archive.nemelex.cards/rcfiles/?user=${current_user}">rcfiles</a>
        </p>
        <script>
            DWEM.Modules.CNCBanner.colorizeText();
        </script>
        ` : ''}
    `;
    }

    getEnglishBanner(current_user) {
        return `<a href="https://refracta.github.io/nemelx-alter-3d" id="coloredText">It's all in the cards!</a> <a title="This is your server latency. Click to remeasure, Right click to show latency indicator" style="text-decoration: none" href="javascript:DWEM.Modules.CNCBanner.updateLatencyText(true)" oncontextmenu="DWEM.Modules.CNCBanner.toggleLatencyIndicator(event)">(<span id="latency">?</span> MS)</a>
                    <div id="latency-indicator" style="display: none; max-width: 500px"></div>
                    <br>
                    ${current_user ? `
                    <a href="https://webtiles.nethack.live" style="font-size: small; margin: 0; padding:0; text-decoration: none"> Did you know that NetHack can be played on WebTiles? </a>
                    <br>` : ''}
                    <details>
                        <summary style="cursor: pointer;">We have started the server using the user database from <a href="https://crawl.project357.org">CPO</a> as of KST 2024.06.19 14:12:00.</summary>
                        <div>
                            <p>This is simply a method to prevent account griefing. If you have accounts with different owners across multiple servers, we will not consider those account owners as the owners of the CPO account. The appeal period is one year. If you manually submit credentials from other servers to me by <strong>June 2025</strong>, the account will be transferred to the earliest requester.</p>
                            <p><strong>[How to Submit Credentials]</strong><br>
                                Log into the other server, add the line "# CRAWL.NEMELEX.CARDS" at the top of the trunk RC file, and then submit the <a href="javascript:DWEM.Modules.CNCBanner.openRCLinks()">RC link</a> to me (<a href="https://discord.gg/cFUynNtAVA">Server Discord - cnc-account-migration Channel</a>). After receiving the account, add and maintain the line "# CRAWL.NEMELEX.CARDS" at the top of the CNC account's trunk RC file until the appeal period ends. Additionally, CPO users in this situation should add the line "# CRAWL.NEMELEX.CARDS" at the top of the trunk RC file on this server. If this line is present, I will consider the CPO account user as the earliest requester.</p>
                            <p>KST 2024.06.19 19:00:00 Updated: When you log into the this server for the first time, the line "# CRAWL.NEMELEX.CARDS" is automatically inserted into the trunk RC.</p>
                            <p>For users who registered between KST 2024.06.18 00:00:00 and 2024.06.18 07:03:00, the account credentials have been switched to CPO's (game data will be retained). If you encounter any issues logging in, please contact me.</p>
                        </div>
                    </details>
                    <p style="padding:5px; border-radius:10px; background-color:#2c6f17; display:inline-block; margin:20px 0 10px 0; line-height:1.3;">
                        <a href="https://archive.nemelex.cards">Player Data</a> -
                        <a href="https://github.com/refracta/dcss-server/issues">Report a Bug</a> -
                        <a href="https://grafana.abstr.net/d/d256ff3c-64f5-42f1-ac0c-cf6637664308/cnc-server-status">Server Status</a> -
                        <a id="sarangbang" href="javascript:DWEM.Modules.CNCBanner.toggleSarangbang()" title="The 'Sarangbang' refers to the room in traditional korean houses used to receive guests. When this feature is enabled, it will automatically find and watch the player with the highest number of spectators.">Sarangbang<span id="sarangbang-second"></span></a> -
                        <a href="https://terminal.nemelex.cards">Web Terminal</a> -
                        <a href="javascript:DWEM.Modules.CNCBanner.playWTRec()">Play WTRec (Beta)</a> -
                        <a href="javascript:DWEM.Modules.ModuleManager.toggle()">DWEM Module Manager (Ctrl + F12)</a>
                        <br>
                        SSH is available on port 1326 with the user 'nemelex'. You can use the password 'xobeh' or authenticate using the <a href="https://archive.nemelex.cards/cao_key" style="text-decoration:none;">CAO key</a>.
                        <br>
                        Please read and follow the <a href="https://archive.nemelex.cards/code_of_conduct.txt">Code of Conduct</a> for this server.
                        <br>
                        For account or server issues, contact ASCIIPhilia on <a href="https://discord.gg/cFUynNtAVA">Server Discord</a>.
                        <br>
                        7/2 Update: <a href="https://crawl.nemelex.cards/?arce_append=%23%20Recommended%20settings%0Asound_on%20%3D%20true%0Asound_pack%20%2B%3D%20https%3A%2F%2Fosp.nemelex.cards%2Fbuild%2Flatest.zip%3A%5B%22init.txt%22%5D%0Aone_SDL_sound_channel%20%3D%20true%0Asound_fade_time%20%3D%200.5">Try</a> the new <a href="https://github.com/refracta/dcss-webtiles-extension-module">DWEM</a> module <a href="https://github.com/refracta/dcss-webtiles-extension-module/blob/main/modules/sound-support/README.md">SoundSupport</a>!
                        <br>
                        <a href="https://docs.google.com/document/d/1AFNN3L139L3U9cMPNpFOViutlpaJ2rCdiJtkJ0g2ykY/edit?usp=sharing">Translation Module</a> has been added to DWEM. If you are interested, please help with the translation work.
                        <br>
                        ${this.getTournaments()}
                    </p>
                    <script>
                        DWEM.Modules.CNCBanner.updateLatencyText();
                        DWEM.Modules.CNCBanner.startUpdateTournamentInfo();
                    </script>
                    ${current_user ? `
                    <p>
                        Hello, ${current_user}! View your <a href="https://archive.nemelex.cards/morgue/${current_user}/">morgues</a> <a href="https://archive.nemelex.cards/ttyrec/${current_user}/">ttyrecs</a> <a href="https://archive.nemelex.cards/rcfiles/?user=${current_user}">rcfiles</a>.
                    </p>
                    <script>
                        DWEM.Modules.CNCBanner.colorizeText();
                        DWEM.Modules.CNCBanner.updateLatencyText();
                    </script>
                    ` : ''}
                `;
    }

    async playWTRec() {
        let url = prompt("Please enter a URL in the form of \n\"https://wtrec.nemelex.cards/wtrec/*/*.wtrec\".\n\nIf left blank, a random wtrec will be played.");
        if (url) {
            DWEM.Modules.WTRec.playWTRec(await fetch(url).then(r => r.blob()));
        } else {
            const list = await fetch('https://wtrec-json.nemelex.cards/wtrec').then(r => r.json());
            const user = list[Math.floor(Math.random() * list.length)].name;
            const files = await fetch(`https://wtrec-json.nemelex.cards/wtrec/${user}`).then(r => r.json());
            const url = `https://wtrec.nemelex.cards/wtrec/${user}/${files[Math.floor(Math.random() * files.length)].name}`;
            DWEM.Modules.WTRec.playWTRec(await fetch(url).then(r => r.blob()));
        }
    }

    onLoad() {
        const {IOHook, SiteInformation} = DWEM.Modules;
        const userLang = navigator.language || navigator.userLanguage;
        IOHook.handle_message.before.addHandler('cnc-banner', (data) => {
            if (data.msg === 'html' && data.id === 'banner') {
                const {current_user} = SiteInformation;
                if (userLang.startsWith('ko')) {
                    data.content = this.getKoreanBanner(current_user);
                } else {
                    data.content = this.getEnglishBanner(current_user);
                }
            }
        });
        const lobby = {};
        const lobbySpan = document.querySelector('#lobby_body span');
        IOHook.handle_message.after.addHandler('cnc-banner', (data) => {
            if (!(data.msg === 'lobby_entry' || data.msg === 'lobby_remove')) {
                return;
            }
            if (data.msg === 'lobby_entry') {
                lobby[data.id] = data;
            } else if (data.msg === 'lobby_remove') {
                delete lobby[data.id];
            }
            const numberOfPlayers = Object.keys(lobby).length;
            lobbySpan.textContent = `Games currently running (${numberOfPlayers} players):`
        });
    }
}
