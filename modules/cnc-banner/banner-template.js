import {getAprilFoolsOverlayHTML} from './seasonal-theme.js';
import {escapeHtml, getLocale, getModuleBaseUrl, shouldUseAprilFools} from './utils.js';

const SOUND_SUPPORT_ARCE_URL = 'https://crawl.nemelex.cards/?arce_append=%23%20Recommended%20settings%0Asounds_on%20%3D%20true%0Asound_pack%20%2B%3D%20https%3A%2F%2Fsound-packs.nemelex.cards%2FDCSS-UST%2Fv1.0.1.zip%0Asound_pack%20%2B%3D%20https%3A%2F%2Fosp.nemelex.cards%2Fbuild%2Flatest.zip%3A%5B%22init.txt%22%5D%0Aone_SDL_sound_channel%20%3D%20true%0Asound_fade_time%20%3D%200.5%0Abgm_volume%20%3D%200.5';
const TRANSLATION_ARCE_URL = 'https://crawl.nemelex.cards/?arce_append=always_show_zot%20%3D%20true%0Atranslation_language%20=%20ko';
const PROFILES_URL = 'https://profiles.nemelex.cards';

export default class BannerTemplate {
    constructor(donations) {
        this.donations = donations;
    }

    tournaments = [
        {
            id: 'stable-tournament',
            name: '0.34 Tournament',
            startUTC: new Date(Date.UTC(2026, 1, 6, 20, 0, 0)),
            endUTC: new Date(Date.UTC(2026, 1, 22, 20, 0, 0)),
            url: 'https://crawl.develz.org/tournament/0.34/'
        },
        {
            id: 'ccsdt-tournament',
            name: 'Crawl Cosplay Sudden Death Tournament (0.34)',
            startUTC: new Date(Date.UTC(2026, 5 - 1, 15, 0, 0, 0)),
            endUTC: new Date(Date.UTC(2026, 6 - 1, 19, 0, 0, 0)),
            url: 'https://www.crawlcosplay.org/ccsdt'
        },
        {
            id: 'cctt-tournament',
            name: 'Crawl Cosplay Trunk Tournament',
            startUTC: new Date(Date.UTC(2025, 11 - 1, 28, 0, 0, 0)),
            endUTC: new Date(Date.UTC(2026, 1 - 1, 3, 0, 0, 0)),
            url: 'https://www.crawlcosplay.org/cctt'
        },
        {
            id: 'cnc-anniversary-tournament',
            name: 'CNC 2nd Anniversary Tournament',
            startUTC: new Date(Date.UTC(2026, 6 - 1, 17, 15, 0, 0)),
            endUTC: new Date(Date.UTC(2026, 7 - 1, 1, 15, 0, 0)),
            url: 'https://refracta.github.io/nemelex.cards/cnc-2nd-anniversary-tournament/details.html'
        }
    ];

    getKoreanBanner(currentUser) {
        if (shouldUseAprilFools()) {
            return this.getAprilFoolsKoreanBanner(currentUser);
        }

        return `
        ${this.getHeaderLink('ko')}
        ${this.getNethackLink('ko', currentUser)}
        🏆 <a href="https://refracta.github.io/nemelex.cards/cnc-1st-anniversary-tournament/results.html"> CNC 1st Anniversary Tournament 결과 보기</a>
        <br>
        ${this.getInfoPanel('ko', '20px 0 10px 0')}
        ${this.donations.getSummaryHTML('ko')}
        ${this.getStartupScripts(currentUser)}
        ${currentUser ? this.getUserLinks('ko', currentUser) : ''}
    `;
    }

    getAprilFoolsKoreanBanner(currentUser) {
        const aprilImage = `${getModuleBaseUrl()}/images/xobeh.gif`;
        return `
        ${getAprilFoolsOverlayHTML(aprilImage, 'ko')}
        ${this.getAprilFoolsStyle()}
        조베죽 [ New - 갓 - 서버 ]에 온 것을 환영한다.<br>
        <details>
            <summary style="cursor: pointer;">당연히 신은 <span style="color: lawngreen">조베</span>겠지?</summary>
            <div style="margin-left: 15px">
                ${this.getHeaderLink('ko')}
                ${this.getNethackLink('ko', currentUser)}
                🏆 <a href="https://refracta.github.io/nemelex.cards/cnc-1st-anniversary-tournament/results.html"> CNC 1st Anniversary Tournament 결과 보기</a>
                <br>
                ${this.getInfoPanel('ko', '0 0 10px 0', true)}
                ${this.donations.getSummaryHTML('ko')}
            </div>
        </details>
        <br>
        ${currentUser ? `더 열심히 하지 못하겠나. ${currentUser}!<br><a href="https://archive.nemelex.cards/morgue/${currentUser}/">morgues</a> <a href="https://archive.nemelex.cards/ttyrec/${currentUser}/">ttyrecs</a> <a href="https://archive.nemelex.cards/rcfiles/?user=${currentUser}">rcfiles</a><br>` : ''}
        ${this.getStartupScripts(currentUser)}
    `;
    }

    getEnglishBanner(currentUser) {
        if (shouldUseAprilFools()) {
            return this.getAprilFoolsEnglishBanner(currentUser);
        }

        return `${this.getHeaderLink('en')}
                    ${this.getNethackLink('en', currentUser)}
                    🏆 <a href="https://refracta.github.io/nemelex.cards/cnc-1st-anniversary-tournament/results.html"> CNC 1st Anniversary Tournament Results</a>
                    <br>
                    ${this.getInfoPanel('en', '20px 0 10px 0')}
                    ${this.donations.getSummaryHTML('en')}
                    ${this.getStartupScripts(currentUser)}
                    ${currentUser ? this.getUserLinks('en', currentUser) : ''}
                `;
    }

    getAprilFoolsEnglishBanner(currentUser) {
        const aprilImage = `${getModuleBaseUrl()}/images/xobeh.gif`;
        return `
        ${getAprilFoolsOverlayHTML(aprilImage, 'en')}
        ${this.getAprilFoolsStyle()}
        Welcome to Xobeh Soup [New - God - Server].<br>
        <details>
            <summary style="cursor: pointer;">Surely your god is <span style="color: lawngreen">Xobeh</span>, right?</summary>
            <div style="margin-left: 15px">
        ${this.getHeaderLink('en')}
        ${this.getNethackLink('en', currentUser)}
        🏆 <a href="https://refracta.github.io/nemelex.cards/cnc-1st-anniversary-tournament/results.html"> CNC 1st Anniversary Tournament Results</a>
        <br>
        ${this.getInfoPanel('en', '0 0 10px 0', true)}
        ${this.donations.getSummaryHTML('en')}
            </div>
        </details>
        <br>
        ${currentUser ? this.getAprilFoolsEnglishUserLinks(currentUser) : ''}
        ${this.getStartupScripts(currentUser)}
    `;
    }

    getAprilFoolsStyle() {
        return `
        <style>
            #play_now a, #player_list a, .extra_links a {
                color: #f4d700 !important;
            }
            #play_now a:hover, #player_list a:hover, .extra_links a:hover {
                color: #fa0000 !important;
            }
        </style>`;
    }

    getHeaderLink(locale) {
        const text = locale === 'ko' ? '카드 안에 모든 것이 있나니!' : "It's all in the cards!";
        const latencyTitle = locale === 'ko'
            ? '서버 지연 시간입니다. 다시 측정하려면 클릭, 지연 시간 측정기를 확인하려면 우클릭하세요'
            : 'This is your server latency. Click to remeasure, Right click to show latency indicator';
        return `<a href="https://refracta.github.io/nemelx-altar-3d" id="coloredText">${text}</a>
        <a title="${latencyTitle}" style="text-decoration: none" href="javascript:DWEM.Modules.CNCBanner.updateLatencyText(true)" oncontextmenu="DWEM.Modules.CNCBanner.toggleLatencyIndicator(event)">(<span id="latency">?</span> MS)</a>
        <div id="latency-indicator" style="display: none; max-width: 500px"></div>
        <br>`;
    }

    getNethackLink(locale, currentUser) {
        if (!currentUser) {
            return '';
        }

        const text = locale === 'ko'
            ? ' 넷핵도 웹타일로 플레이 할 수 있다는 것을 아시나요?'
            : ' Did you know that NetHack can be played on WebTiles? ';
        return `
        <a href="https://webtiles.nethack.live" style="font-size: small; margin: 0; padding:0; text-decoration: none">${text}</a>
        <br>`;
    }

    getInfoPanel(locale, margin, aprilFools = false) {
        return `
        <p style="padding:5px; border-radius:10px; background-color:#2c6f17; display:inline-block; margin:${margin}; line-height:1.3;">
            ${this.getInfoLinks(locale)}
            <br>
            ${this.getSshText(locale)}
            <br>
            ${this.getRulesText(locale)}
            <br>
            ${this.getContactText(locale)}
            <br>
            ${this.getSoundSupportText(locale, aprilFools)}
            <br>
            ${this.getTranslationText(locale)}
            <br>
            ${this.getTournaments()}
        </p>`;
    }

    getInfoLinks(locale) {
        if (locale === 'ko') {
            return `<a href="https://archive.nemelex.cards">플레이어 데이터</a> -
            <a href="https://github.com/refracta/dcss-server/issues">버그 신고</a> -
            <a href="https://grafana.abstr.net/d/d256ff3c-64f5-42f1-ac0c-cf6637664308/cnc-server-status">서버 상태</a> -
            <a id="sarangbang" href="javascript:DWEM.Modules.CNCBanner.toggleSarangbang()" title="사랑방은 한옥에서 손님을 맞이하는 방을 말합니다. 이 기능이 켜져있으면 자동으로 관전자 수가 제일 많은 플레이어를 관전합니다.">사랑방<span id="sarangbang-second"></span></a> -
            <a href="https://terminal.nemelex.cards">웹 터미널</a> -
            <a href="https://refracta.github.io/pocketzot-dwem/">모바일 <span style="color: yellow;">(New)</span></a> -
            <a href="javascript:DWEM.Modules.CNCBanner.playWTRec()" title="좌클릭: URL 입력 또는 랜덤 재생 | 우클릭: 내 wtrec 파일 업로드 후 재생">WTRec 재생 (베타)</a> -
            <a href="javascript:DWEM.Modules.ModuleManager.toggle()">DWEM 모듈 관리자 (Ctrl + F12)</a>`;
        }

        return `<a href="https://archive.nemelex.cards">Player Data</a> -
                        <a href="https://github.com/refracta/dcss-server/issues">Report a Bug</a> -
                        <a href="https://grafana.abstr.net/d/d256ff3c-64f5-42f1-ac0c-cf6637664308/cnc-server-status">Server Status</a> -
                        <a id="sarangbang" href="javascript:DWEM.Modules.CNCBanner.toggleSarangbang()" title="The 'Sarangbang' refers to the room in traditional korean houses used to receive guests. When this feature is enabled, it will automatically find and watch the player with the highest number of spectators.">Sarangbang<span id="sarangbang-second"></span></a> -
                        <a href="https://terminal.nemelex.cards">Web Terminal</a> -
                        <a href="https://refracta.github.io/pocketzot-dwem/">Mobile <span style="color: yellow;">(New)</span></a> -
                        <a href="javascript:DWEM.Modules.CNCBanner.playWTRec()" title="Left click: Enter URL or play random | Right click: Upload your wtrec and play">Play WTRec (Beta)</a> -
                        <a href="javascript:DWEM.Modules.ModuleManager.toggle()">DWEM Module Manager (Ctrl + F12)</a>`;
    }

    getSshText(locale) {
        return locale === 'ko'
            ? `'nemelex' 사용자로 포트 1326에서 SSH 접속이 가능합니다. 비밀번호 'xobeh' 또는 <a href="https://archive.nemelex.cards/cao_key" style="text-decoration:none;">CAO 키</a>를 사용하여 인증할 수 있습니다.`
            : `SSH is available on port 1326 with the user 'nemelex'. You can use the password 'xobeh' or authenticate using the <a href="https://archive.nemelex.cards/cao_key" style="text-decoration:none;">CAO key</a>.`;
    }

    getRulesText(locale) {
        return locale === 'ko'
            ? `<a href="https://archive.nemelex.cards/code_of_conduct.txt">서버 규칙</a>을 준수해주세요.`
            : `Please read and follow the <a href="https://archive.nemelex.cards/code_of_conduct.txt">Code of Conduct</a> for this server.`;
    }

    getContactText(locale) {
        return locale === 'ko'
            ? `계정 또는 서버 문제의 경우, <a href="https://discord.gg/cFUynNtAVA">서버 디스코드</a>에서 ASCIIPhilia에게 문의할 수 있습니다.`
            : `For account or server issues, contact ASCIIPhilia on <a href="https://discord.gg/cFUynNtAVA">Server Discord</a>.`;
    }

    getSoundSupportText(locale, aprilFools = false) {
        if (locale === 'ko') {
            const action = aprilFools
                ? '모듈을 사용해보세요!'
                : `모듈을 <a href="${SOUND_SUPPORT_ARCE_URL}">사용해보세요!</a>`;
            return `7/2 업데이트: <a href="https://github.com/refracta/dcss-webtiles-extension-module">DWEM</a>에 추가된 <a href="https://github.com/refracta/dcss-webtiles-extension-module/blob/main/modules/sound-support/README.md">SoundSupport</a> ${action}`;
        }

        return `7/2 Update: <a href="${SOUND_SUPPORT_ARCE_URL}">Try</a> the new <a href="https://github.com/refracta/dcss-webtiles-extension-module">DWEM</a> module <a href="https://github.com/refracta/dcss-webtiles-extension-module/blob/main/modules/sound-support/README.md">SoundSupport</a>!`;
    }

    getTranslationText(locale) {
        return locale === 'ko'
            ? `DWEM에 <a href="https://docs.google.com/document/d/1AFNN3L139L3U9cMPNpFOViutlpaJ2rCdiJtkJ0g2ykY/edit?usp=sharing">번역 모듈</a>이 추가되었습니다. 한국어로 게임을 <a href="${TRANSLATION_ARCE_URL}">즐겨보세요</a>. 관심이 있다면 번역 작업에도 도움을 주세요!`
            : `<a href="https://docs.google.com/document/d/1AFNN3L139L3U9cMPNpFOViutlpaJ2rCdiJtkJ0g2ykY/edit?usp=sharing">Translation Module</a> has been added to DWEM. If you are interested, please help with the translation work.`;
    }

    getUserLinks(locale, currentUser) {
        const encodedUser = encodeURIComponent(currentUser);
        const profilePath = '/';
        const profileLink = `<a href="${PROFILES_URL}${profilePath}" onclick="return DWEM.Modules.CNCBanner.openProfilesWithToken(event, ${escapeHtml(JSON.stringify(profilePath))})" oncontextmenu="return DWEM.Modules.CNCBanner.openUserInfo(event, ${escapeHtml(JSON.stringify(currentUser))})" title="CNC Profiles">${this.getStyledUsername(currentUser)}</a>`;
        const links = `<a href="https://archive.nemelex.cards/morgue/${encodedUser}/">morgues</a> <a href="https://archive.nemelex.cards/ttyrec/${encodedUser}/">ttyrecs</a> <a href="https://archive.nemelex.cards/rcfiles/?user=${encodedUser}">rcfiles</a>`;
        const message = locale === 'ko'
            ? `안녕하세요, ${profileLink}! <br>여기서 기록을 확인할 수 있습니다: ${links}`
            : `Hello, ${profileLink}! View your ${links}.`;
        return `
        <p>
            ${message}
        </p>
        <script>
            DWEM.Modules.CNCBanner.colorizeText();
        </script>
        `;
    }

    getStyledUsername(username) {
        const userinfo = globalThis.DWEM?.Modules?.CNCUserinfo;
        return userinfo?.applyStyledUsername
            ? userinfo.applyStyledUsername(username)
            : escapeHtml(username);
    }

    getAprilFoolsEnglishUserLinks(currentUser) {
        return `Can you not try harder, ${currentUser}?!<br><a href="https://archive.nemelex.cards/morgue/${currentUser}/">morgues</a> <a href="https://archive.nemelex.cards/ttyrec/${currentUser}/">ttyrecs</a> <a href="https://archive.nemelex.cards/rcfiles/?user=${currentUser}">rcfiles</a><br>`;
    }

    getStartupScripts(currentUser) {
        return `
        <script>
            DWEM.Modules.CNCBanner.updateLatencyText();
            DWEM.Modules.CNCBanner.startUpdateTournamentInfo();
        </script>
        ${currentUser ? `
        <script>
            DWEM.Modules.CNCBanner.colorizeText();
        </script>
        ` : ''}
        `;
    }

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

        const locales = getLocale();
        const isKorean = locales === 'ko';
        const startLocal = startUTC.toLocaleString(locales, options);
        const endLocal = endUTC.toLocaleString(locales, options);

        let message = '';
        const startTimeRemaining = this.getTimeRemaining(startUTC, now).total;
        const endTimeRemaining = this.getTimeRemaining(endUTC, now).total;

        if (isKorean) {
            message += `🏆 <a href="${url}">${name}</a>가 ${startLocal}부터 ${endLocal}까지 진행됩니다! `;
            if (startTimeRemaining > 0 && startTimeRemaining <= sevenDays) {
                const timeToStart = this.getTimeRemaining(startUTC, now);
                message += `(시작까지 ${timeToStart.days}일 ${timeToStart.hours}시간 ${timeToStart.minutes}분 남음)`;
            } else if (now >= startUTC && now < endUTC) {
                const timeToEnd = this.getTimeRemaining(endUTC, now);
                message += `(종료까지 ${timeToEnd.days}일 ${timeToEnd.hours}시간 ${timeToEnd.minutes}분 남음)`;
            } else if (Math.abs(endTimeRemaining) <= sevenDays && endTimeRemaining < 0) {
                message = `🏆 <a href="${url}">${name}</a>가 종료되었습니다. 모두 고생하셨습니다!`;
            } else {
                message = '';
            }
        } else {
            message += `🏆 <a href="${url}">${name}</a> runs from ${startLocal} to ${endLocal}. `;
            if (startTimeRemaining > 0 && startTimeRemaining <= sevenDays) {
                const timeToStart = this.getTimeRemaining(startUTC, now);
                message += `(Starts in ${timeToStart.days} days ${timeToStart.hours} hours ${timeToStart.minutes} minutes)`;
            } else if (now >= startUTC && now < endUTC) {
                const timeToEnd = this.getTimeRemaining(endUTC, now);
                message += `(Ends in ${timeToEnd.days} days ${timeToEnd.hours} hours ${timeToEnd.minutes} minutes)`;
            } else if (Math.abs(endTimeRemaining) <= sevenDays && endTimeRemaining < 0) {
                message = `🏆 <a href="${url}">${name}</a> has ended. Thank you for participating.`;
            } else {
                message = '';
            }
        }
        return message;
    }

    getTimeRemaining(endTime, currentTime) {
        const total = Date.parse(endTime) - Date.parse(currentTime);
        const seconds = Math.floor((total / 1000) % 60);
        const minutes = Math.floor((total / 1000 / 60) % 60);
        const hours = Math.floor((total / (1000 * 60 * 60)) % 24);
        const days = Math.floor(total / (1000 * 60 * 60 * 24));
        return {total, days, hours, minutes, seconds};
    }
}
