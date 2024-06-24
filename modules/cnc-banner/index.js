export default class CNCBanner {
    static name = 'CNCBanner';
    static version = '1.0';
    static dependencies = ['IOHook', 'SiteInformation', 'ModuleManager', 'WebSocketFactory'];
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

    #getRandomColor() {
        const colors = ['#ff4000', '#008cc0', '#cad700', '#009800', '#8000ff'];
        return colors[Math.floor(Math.random() * colors.length)];
    }

    colorizeText() {
        const text = $('#coloredText').text();
        const words = text.split(" ");
        const coloredWords = words.map(word => `<span style="color:${this.#getRandomColor()};">${word}</span>`);
        document.getElementById('coloredText').innerHTML = coloredWords.join(" ");
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

    async updateLatencyText() {
        if (this.isWaiting) {
            return;
        }
        this.isWaiting = true;
        const latency = await this.getLatency();
        this.isWaiting = false;
        $('#latency').text(latency);

        function interpolateColor(color1, color2, factor) {
            const result = color1.slice(1).match(/.{2}/g)
                .map((hex, i) => Math.round(parseInt(hex, 16) * (1 - factor) + parseInt(color2.slice(1).match(/.{2}/g)[i], 16) * factor)
                    .toString(16).padStart(2, '0')).join('');
            return `#${result}`;
        }

        let color;
        if (latency <= 50) {
            color = interpolateColor('#00FF00', '#0000FF', latency / 50); // Green to Blue
        } else if (latency <= 150) {
            color = interpolateColor('#0000FF', '#FFFF00', (latency - 50) / 100); // Blue to Yellow
        } else if (latency <= 300) {
            color = interpolateColor('#FFFF00', '#FF0000', (latency - 150) / 150); // Yellow to Red
        } else if (latency <= 1000) {
            color = interpolateColor('#FF0000', '#808080', (latency - 300) / 700); // Red to Grey
        } else {
            color = '#808080'; // Grey
        }

        $('#latency').css('color', color);
    }

    getKoreanBanner(current_user) {
        return `
        <a href="https://refracta.github.io/nemelx-alter-3d" id="coloredText">카드 안에 모든 것이 있나니!</a> <a title="서버 지연 시간입니다. 다시 측정하려면 클릭하세요." style="text-decoration: none" href="javascript:DWEM.Modules.CNCBanner.updateLatencyText()">(<span id="latency">?</span> MS)</a>
        <br>
        ${current_user ? `
        <a href="https://webtiles.nethack.live" style="font-size: small; margin: 0; padding:0; text-decoration: none"> 넷핵도 웹타일로 플레이 할 수 있다는 것을 아시나요?</a>
        <br>` : ''}
        <details>
            <summary style="cursor: pointer;">KST 2024.06.19 14:12:00 시점의 <a href="https://crawl.project357.org">CPO (호주 서버)</a> 사용자 데이터베이스를 사용하여 서버를 시작했습니다.</summary>
            <div>
                <p>이것은 단순히 계정 선점 남용(기존 사용자들의 스코어를 망치는 등의 트롤링 행위)을 방지하기 위한 조치입니다. 여러 서버에 걸쳐 서로 다른 소유자를 가진 있는 계정이 있는 경우, 이러한 계정 소유자를 CPO 계정의 소유자로 간주하지 않습니다. 소명 기간은 1년입니다. 다른 서버의 자격 증명을 <strong>2025년 6월</strong>까지 수동으로 제출하면 계정이 최초 요청자에게 이전됩니다.</p>
                <p><strong>[자격 증명 제출 방법]</strong><br>
                    다른 서버에 로그인하여 Trunk RC 파일 상단에 "# CRAWL.NEMELEX.CARDS" 줄을 추가한 후 <a href="javascript:DWEM.Modules.CNCBanner.openRCLinks()">RC 링크</a>를 제출하세요 (<a href="https://discord.com/invite/mNcPSDendT">서버 디스코드 - cnc-account-migration 채널</a>). 계정을 받은 후에는 소명 기간이 끝날 때까지 CNC 계정의 RC 파일 상단에 "# CRAWL.NEMELEX.CARDS" 줄을 추가하고 유지하세요. 또한, 이러한 상황에 있는 CPO 사용자는 이 서버의 RC 파일 상단에 "# CRAWL.NEMELEX.CARDS" 줄을 추가해야 합니다. 이 줄이 있으면 CPO 계정 사용자를 최초 요청자로 간주합니다.</p>
                <p>KST 2024.06.19 19:00:00 갱신: 본 서버에 처음 로그인할 때 "# CRAWL.NEMELEX.CARDS" 줄이 자동으로 Trunk RC 파일에 삽입됩니다.</p>
                <p>KST 2024.06.18 00:00:00에서 2024.06.18 07:03:00 사이에 등록한 사용자에 대해서는 계정 데이터가(비밀번호 등) CPO의 것으로 변경되었습니다 (게임 데이터는 유지됩니다). 로그인하는 데 문제가 있는 경우 관리자에게 연락하세요.</p>
            </div>
        </details>
        <p style="padding:5px; border-radius:10px; background-color:#2c6f17; display:inline-block; margin:20px 0 10px 0; line-height:1.3;">
            <a href="https://archive.nemelex.cards">플레이어 데이터</a> -
            <a href="https://github.com/refracta/dcss-server/issues">버그 신고</a> -
            <a href="javascript:DWEM.Modules.ModuleManager.toggle()">DWEM 모듈 관리자 (Ctrl + F12)</a>
            <br>
            'nemelex' 사용자로 포트 1326에서 SSH 접속이 가능합니다. 비밀번호 'xobeh' 또는 <a href="https://archive.nemelex.cards/cao_key" style="text-decoration:none;">CAO 키</a>를 사용하여 인증할 수 있습니다.
            <br>
            <a href="https://archive.nemelex.cards/code_of_conduct.txt">서버 규칙</a>을 준수해주세요.
            <br>
            계정 또는 서버 문제의 경우, <a href="https://discord.com/invite/mNcPSDendT">서버 디스코드</a>에서 ASCIIPhilia에게 문의할 수 있습니다.
        </p>
        ${current_user ? `
        <p>
            안녕하세요, ${current_user}! <br>여기서 기록을 확인할 수 있습니다: <a href="https://archive.nemelex.cards/morgue/${current_user}/">morgues</a> <a href="https://archive.nemelex.cards/ttyrec/${current_user}/">ttyrecs</a>
        </p>
        <script>
            DWEM.Modules.CNCBanner.colorizeText();
        </script>
        ` : ''}
    `;
    }

    getEnglishBanner(current_user) {
        return `<a href="https://refracta.github.io/nemelx-alter-3d" id="coloredText">It's all in the cards!</a> <a title="This is your server latency. Click to remeasure." style="text-decoration: none" href="javascript:DWEM.Modules.CNCBanner.updateLatencyText()">(<span id="latency">?</span> MS)</a>
                    <br>
                    ${current_user ? `
                    <a href="https://webtiles.nethack.live" style="font-size: small; margin: 0; padding:0; text-decoration: none"> Did you know that NetHack can be played on WebTiles? </a>
                    <br>` : ''}
                    <details>
                        <summary style="cursor: pointer;">We have started the server using the user database from <a href="https://crawl.project357.org">CPO</a> as of KST 2024.06.19 14:12:00.</summary>
                        <div>
                            <p>This is simply a method to prevent account griefing. If you have accounts with different owners across multiple servers, we will not consider those account owners as the owners of the CPO account. The appeal period is one year. If you manually submit credentials from other servers to me by <strong>June 2025</strong>, the account will be transferred to the earliest requester.</p>
                            <p><strong>[How to Submit Credentials]</strong><br>
                                Log into the other server, add the line "# CRAWL.NEMELEX.CARDS" at the top of the trunk RC file, and then submit the <a href="javascript:DWEM.Modules.CNCBanner.openRCLinks()">RC link</a> to me (<a href="https://discord.com/invite/mNcPSDendT">Server Discord - cnc-account-migration Channel</a>). After receiving the account, add and maintain the line "# CRAWL.NEMELEX.CARDS" at the top of the CNC account's trunk RC file until the appeal period ends. Additionally, CPO users in this situation should add the line "# CRAWL.NEMELEX.CARDS" at the top of the trunk RC file on this server. If this line is present, I will consider the CPO account user as the earliest requester.</p>
                            <p>KST 2024.06.19 19:00:00 Updated: When you log into the this server for the first time, the line "# CRAWL.NEMELEX.CARDS" is automatically inserted into the trunk RC.</p>
                            <p>For users who registered between KST 2024.06.18 00:00:00 and 2024.06.18 07:03:00, the account credentials have been switched to CPO's (game data will be retained). If you encounter any issues logging in, please contact me.</p>
                        </div>
                    </details>
                    <p style="padding:5px; border-radius:10px; background-color:#2c6f17; display:inline-block; margin:20px 0 10px 0; line-height:1.3;">
                        <a href="https://archive.nemelex.cards">Player Data</a> -
                        <a href="https://github.com/refracta/dcss-server/issues">Report a Bug</a> -
                        <a href="javascript:DWEM.Modules.ModuleManager.toggle()">DWEM Module Manager (Ctrl + F12)</a>
                        <br>
                        SSH is available on port 1326 with the user 'nemelex'. You can use the password 'xobeh' or authenticate using the <a href="https://archive.nemelex.cards/cao_key" style="text-decoration:none;">CAO key</a>.
                        <br>
                        Please read and follow the <a href="https://archive.nemelex.cards/code_of_conduct.txt">Code of Conduct</a> for this server.
                        <br>
                        For account or server issues, contact ASCIIPhilia on <a href="https://discord.com/invite/mNcPSDendT">Server Discord</a>.
                    </p>
                    ${current_user ? `
                    <p>
                        Hello, ${current_user}! View your <a href="https://archive.nemelex.cards/morgue/${current_user}/">morgues</a> <a href="https://archive.nemelex.cards/ttyrec/${current_user}/">ttyrecs</a>.
                    </p>
                    <script>
                        DWEM.Modules.CNCBanner.colorizeText();
                    </script>
                    ` : ''}
                `;
    }

    onLoad() {
        const {IOHook, SiteInformation} = DWEM.Modules;
        const userLang = navigator.language || navigator.userLanguage;
        IOHook.handle_message.before.push((data) => {
            if (data.msg === 'html' && data.id === 'banner') {
                const {current_user} = SiteInformation;
                this.updateLatencyText();
                if (userLang.startsWith('ko')) {
                    data.content = this.getKoreanBanner(current_user);
                } else {
                    data.content = this.getEnglishBanner(current_user);
                }
            }
        });
    }
}
