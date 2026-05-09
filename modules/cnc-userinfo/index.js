class UserDropdown extends HTMLDivElement {
    constructor() {
        super();
        this.attachShadow({mode: 'open'});

        this.style.position = 'fixed';
        this.style.zIndex = '99999';
        this.style.top = '0';
        this.style.left = '0';

        const container = document.createElement('div');
        container.classList.add('dropdown-container');

        container.addEventListener('click', (event) => {
            event.stopPropagation();
            let target = event.target;
            if (target.tagName === 'A') {
                dropdownContent.style.display = 'none';
                return;
            }
            while (target !== container) {
                if (target.firstElementChild && target.firstElementChild.tagName === 'A') {
                    event.preventDefault();
                    target.firstElementChild.click();
                    break;
                }
                target = target.parentElement;
            }
        });

        const dropdownContent = document.createElement('div');
        dropdownContent.classList.add('dropdown-content');
        container.appendChild(dropdownContent);

        this.shadowRoot.append(container);

        const style = document.createElement('style');
        style.textContent = `
            .dropdown-container {
                position: absolute;
                display: inline-block;
                z-index: 9999;
            }
            .dropdown-content {
                display: none;
                background-color: rgba(0, 0, 0, 0.85);
                color: #A2A2A2;
                border: 1px solid #626262;
                min-width: 200px;
                max-height: calc(100vh - 16px);
                overflow-y: auto;
                text-align: center;
            }
            .dropdown-content > div {
                color: #A2A2A2;
                border-bottom: 1px solid #626262;
                padding: 4px 8px;
                cursor: pointer;
                font-size: 0.88em;
                white-space: nowrap;
            }
            .dropdown-content > div > a {
                text-decoration: none;
                color: #a2a2a2;
            }
            .dropdown-content > div:last-child {
                border-bottom: none;
            }
            .dropdown-content > div:hover {
                background-color: #292829;
            }
        `;
        this.shadowRoot.append(style);

        container.addEventListener('click', (event) => {
            event.stopPropagation();
        });

        document.addEventListener('click', (event) => {
            if (!this.contains(event.target)) {
                dropdownContent.style.display = 'none';
            }
        });

        this.container = container;
        this.dropdownContent = dropdownContent;
    }

    open(username, x, y) {
        this.style.visibility = 'hidden';
        this.dropdownContent.style.display = 'block';
        const isAdmin = username.includes(' (admin)');
        const realUsername = username.replaceAll(' (admin)', '');
        const lowerUsername = realUsername.toLowerCase();
        const profileUrl = `https://profiles.nemelex.cards/${encodeURIComponent(realUsername)}`;
        const profile = DWEM.Modules.CNCUserinfo.getProfile(realUsername);
        const currentBanner = profile?.currentBanner;
        const titleDiv = currentBanner
            ? DWEM.Modules.CNCUserinfo.createBannerTitleDiv(currentBanner)
            : '';

        this.dropdownContent.innerHTML = `
            <div style="font-weight: bold"><a href="${DWEM.Modules.CNCUserinfo.escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer">${DWEM.Modules.CNCUserinfo.applyStyledUsername(realUsername)}${isAdmin ? ' (ADMIN)' : ''}</a></div>
            ${titleDiv}
            <div><a href="https://crawl.akrasiac.org/scoring/players/${lowerUsername}.html" target="_blank">CAO Scoreboard</a></div>
            <div><a href="https://crawl.akrasiac.org/scoring03/players/${realUsername}.html" target="_blank"">CAO Scoreboard (Old)</a></div>
            <div><a href="https://crawl.montres.org.uk/players/${lowerUsername}.html" target="_blank">Stoat Soup Scoreboard</a></div>
            <div><a href="https://gooncrawl.montres.org.uk/players/${lowerUsername}.html" target="_blank">GoonCrawl Scoreboard</a></div>
            <div><a href="https://bcadrencrawl.montres.org.uk/players/${lowerUsername}.html" target="_blank">BcadrenCrawl Scoreboard</a></div>
            <div><a href="https://bcrawl.montres.org.uk/players/${lowerUsername}.html" target="_blank">B-Crawl Scoreboard</a></div>
            <div><a onclick="DWEM.Modules.CNCUserinfo.openTournamentPage('${lowerUsername}');" target="_blank">Latest Tournament</a></div>
            <div><a href="https://dcss-stats.vercel.app/players/${realUsername}" target="_blank"">DCSS Stats</a></div>
            <div><a href="https://archive.nemelex.cards/morgue/${realUsername}?C=M&O=D" target="_blank"">CNC - morgues</a></div>
            <div><a href="https://archive.nemelex.cards/ttyrec/${realUsername}?C=M&O=D" target="_blank"">CNC - ttyrecs</a></div>
            <div><a href="https://archive.nemelex.cards/rcfiles/?user=${realUsername}" target="_blank"">CNC - rcfiles</a></div>
        `;
        const rect = this.dropdownContent.getBoundingClientRect();
        this.position(x, y, rect);
        this.style.visibility = '';
        this.username = realUsername;
        this.x = x;
        this.y = y;
    }

    refresh(username) {
        if (this.dropdownContent.style.display !== 'block' || !this.username || this.username.toLowerCase() !== username.toLowerCase()) {
            return;
        }
        this.open(this.username, this.x, this.y);
    }

    position(x, y, rect = this.dropdownContent.getBoundingClientRect()) {
        const margin = 8;
        const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
        const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
        const width = rect.width || 200;
        const height = rect.height || 0;
        const maxLeft = Math.max(margin, viewportWidth - width - margin);
        const maxTop = Math.max(margin, viewportHeight - height - margin);
        let left = Number.isFinite(x) ? x : margin;
        let top = Number.isFinite(y) ? y - height : margin;

        if (left + width + margin > viewportWidth) {
            left -= width;
        }
        if (top < margin) {
            top = Number.isFinite(y) ? y : margin;
        }

        this.style.left = `${Math.round(Math.max(margin, Math.min(left, maxLeft)))}px`;
        this.style.top = `${Math.round(Math.max(margin, Math.min(top, maxTop)))}px`;
    }
}

customElements.define('user-dropdown', UserDropdown, {extends: 'div'});
export default class CNCUserinfo {
    static name = 'CNCUserinfo';
    static version = '0.1';
    static dependencies = ['IOHook'];
    static description = '(Beta) This module provides advanced CNC user information.';

    // PROJECT_A: Nemelex colors from CNCBanner, sorted
    static NEMELEX_COLORS = ['#008cc0', '#009800', '#8000ff', '#cad700', '#ff4000'];
    static PROFILE_API_BASE = 'https://profiles.nemelex.cards';

    open(username, event) {
        const x = Number.isFinite(event?.clientX) ? event.clientX : (Number.isFinite(event?.pageX) ? event.pageX - window.scrollX : 0);
        const y = Number.isFinite(event?.clientY) ? event.clientY : (Number.isFinite(event?.pageY) ? event.pageY - window.scrollY : 0);
        this.userDropdown.open(username, x, y);
        event?.preventDefault?.();
        event?.stopPropagation?.();
    }

    async openTournamentPage(username) {
        try {
            localStorage.LATE_TOURNAMENT_VERSION = (await fetch('https://api.github.com/repos/crawl/dcss_tourney/branches?per_page=100').then(r => r.json())).filter(e => e.name.includes('-tourney')).pop().name.replace('-tourney', '');
        } catch (e) {
        }
        window.open(`https://crawl.develz.org/tournament/${localStorage.LATE_TOURNAMENT_VERSION}/players/${username}.html`, '_blank');
    }

    patchUpdateSpectators(data) {
        if (data.msg === 'update_spectators') {
            const container = document.createElement('div');
            container.innerHTML = data.names;
            const anchors = container.querySelectorAll('a');
            for (const anchor of anchors) {
                const username = anchor.textContent.replaceAll(' (admin)', '');
                anchor.href = 'javascript:void(0);'
                anchor.setAttribute('onclick', `DWEM.Modules.CNCUserinfo.open('${username}', event);`);
                anchor.textContent = username;
                anchor.removeAttribute('target');
                anchor.innerHTML = this.applyStyledUsername(username);
            }
            data.names = container.innerHTML;
        }
    }

    /**
     * Creates a span element with Nemelex color animation
     * @param {string} text - Text to colorize
     * @param {string[]} colorArray - Array of colors to use
     * @param {number} split - Length of each color segment (1 = each character gets different color)
     * @param {number} time - Animation interval in seconds (negative for left roll, positive for right roll)
     * @returns {string} HTML string with colored spans
     */
    createNemelexSpan(text, colorArray, split, time) {
        if (!text || !colorArray || colorArray.length === 0 || split <= 0) {
            return text;
        }

        const N = colorArray.length;
        const currentTime = Date.now();
        const intervalMs = Math.abs(time) * 1000;
        const offset = intervalMs > 0 ? Math.floor(currentTime / intervalMs) % N : 0;

        // Determine roll direction
        const rollOffset = time < 0 ? offset : (N - offset) % N;

        // Create rotated color array
        const rotatedColors = [];
        for (let i = 0; i < N; i++) {
            rotatedColors.push(colorArray[(i + rollOffset) % N]);
        }

        // Split text into segments of 'split' length
        const parts = [];
        for (let i = 0; i < text.length; i += split) {
            parts.push(text.substring(i, Math.min(i + split, text.length)));
        }

        // Apply colors to parts
        const coloredParts = parts.map((part, index) => {
            const color = rotatedColors[index % rotatedColors.length];
            return `<span style="color: ${color}">${this.escapeHtml(part)}</span>`;
        });

        return coloredParts.join('');
    }

    applyStyledUsername(username) {
        if (!username) return '';

        const cleanUsername = username.replaceAll(' (admin)', '');
        const profile = this.getProfile(cleanUsername);
        const key = this.getProfileKey(cleanUsername);
        this.trackProfileUsername(cleanUsername);

        const styledUsername = this.renderUsernameStyle(cleanUsername, profile?.currentBanner?.usernameStyle);
        return `<span data-cnc-profile-username="${this.escapeHtml(cleanUsername)}" data-cnc-profile-key="${this.escapeHtml(key)}">${styledUsername}</span>`;
    }

    renderUsernameStyle(username, usernameStyle) {
        if (!usernameStyle) {
            return this.escapeHtml(username);
        }

        if (usernameStyle.id === 'nemelex') {
            const data = usernameStyle.data || {};
            return this.createNemelexSpan(
                username,
                this.getNemelexColors(data.colors),
                data.split || 1,
                data.time || 60
            );
        }

        if (usernameStyle.id === 'donator') {
            return `<span style="${this.styleObjectToString(this.getDonatorStyle(usernameStyle.data?.donation))}">${this.escapeHtml(username)}</span>`;
        }

        if (usernameStyle.id === 'translator') {
            return `<span style="${this.styleObjectToString(this.getTranslatorStyle(usernameStyle.data?.intensity))}">${this.escapeHtml(username)}</span>`;
        }

        if (usernameStyle.id === 'bot') {
            return `${this.escapeHtml(usernameStyle.data?.prefix || '🤖')}${this.escapeHtml(username)}`;
        }

        if (usernameStyle.id === 'ranking') {
            return `${this.escapeHtml(usernameStyle.data?.badge || this.getRankingBadge(usernameStyle.data?.rank))}${this.escapeHtml(username)}`;
        }

        if (usernameStyle.id === 'fastest-win') {
            return `${this.escapeHtml(usernameStyle.data?.badge || this.getFastestWinBadge(usernameStyle.data?.rank))}${this.escapeHtml(username)}`;
        }

        if (usernameStyle.id === 'dcss-contributor') {
            return `${this.escapeHtml(usernameStyle.data?.badge || '🛠️')}${this.escapeHtml(username)}`;
        }

        return this.escapeHtml(username);
    }

    createBannerTitleDiv(banner) {
        const title = this.escapeHtml(banner.title);
        const url = this.escapeHtml(banner.url);
        const isCompactStatBanner = banner.id === 'ranking' || banner.id === 'fastest-win';
        const fontSize = isCompactStatBanner ? '0.82em' : '0.9em';
        const lineHeight = isCompactStatBanner ? '1.15' : 'normal';
        const titleStyle = isCompactStatBanner ? ' style="white-space: nowrap;"' : ' style="white-space: pre-line;"';
        const detail = this.getBannerDetailLines(banner.detail)
            .map((line, index) => {
                const color = isCompactStatBanner && index === 0 ? 'inherit' : '#d6c895';
                return `<span style="display: block; color: ${color}; white-space: nowrap;">${this.escapeHtml(line)}</span>`;
            })
            .join('');

        return `<div style="font-style: italic; font-size: ${fontSize}; line-height: ${lineHeight}; margin-top: -4px; margin-bottom: 4px;"><a href="${url}" target="_blank"${titleStyle}>${title}</a>${detail}</div>`;
    }

    getBannerDetailLines(detail) {
        if (!detail?.value) return [];

        const lines = [
            `${detail.label ? `${detail.label}: ` : ''}${detail.value}`
        ];
        if (detail.subvalue) {
            lines.push(String(detail.subvalue));
        }
        if (Array.isArray(detail.lines)) {
            lines.push(...detail.lines.map((line) => String(line)));
        }
        return lines;
    }

    getRankingBadge(rank) {
        const safeRank = Math.max(1, Math.floor(Number(rank) || 1));
        if (safeRank === 1) return '👑';
        if (safeRank <= 3) return '🏆';
        if (safeRank <= 10) return '🥇';
        if (safeRank <= 25) return '💎';
        if (safeRank <= 50) return '🌟';
        if (safeRank <= 100) return '⭐';
        return '';
    }

    getFastestWinBadge(rank) {
        const safeRank = Math.max(1, Math.floor(Number(rank) || 1));
        if (safeRank === 1) return '⚡';
        if (safeRank <= 3) return '🚀';
        if (safeRank <= 5) return '🏎️';
        if (safeRank <= 10) return '💨';
        return '';
    }

    getNemelexColors(colors) {
        const safeColors = Array.isArray(colors)
            ? colors
                .map((color) => String(color || '').trim())
                .filter((color) => /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(color))
            : [];
        return safeColors.length > 0 ? safeColors : CNCUserinfo.NEMELEX_COLORS;
    }

    getDonatorStyle(amount) {
        const maxAmount = 500000;
        const clamped = Math.max(0, Math.min(maxAmount, Number(amount) || 0));
        const progress = clamped / maxAmount;
        const color = this.mixGoldColor(Math.pow(progress, 0.72));
        const glowSize = 5 + progress * 18;
        const style = {
            color,
            'font-weight': '800',
            'text-shadow': `0 0 ${glowSize}px rgba(255, 216, 94, ${0.18 + progress * 0.5}), 0 1px 0 rgba(70, 42, 0, ${progress * 0.25})`,
            filter: `drop-shadow(0 0 ${glowSize}px rgba(255, 211, 72, ${0.08 + progress * 0.25}))`
        };

        if (progress >= 0.18) {
            style['background-image'] = `linear-gradient(115deg, ${color} 0%, #fff8d8 ${28 + progress * 18}%, ${color} ${60 + progress * 12}%, #8f6400 100%)`;
            style['-webkit-background-clip'] = 'text';
            style['background-clip'] = 'text';
            style['-webkit-text-fill-color'] = 'transparent';
        }

        return style;
    }

    getTranslatorStyle(intensity) {
        const t = Math.max(0, Math.min(1, Number(intensity) || 0));
        const chroma = Math.pow(t, 1.6);
        const red = this.mixColor('#607088', '#d61f3c', chroma);
        const paper = this.mixColor('#dce5ee', '#f8fbff', t);
        const blue = this.mixColor('#4d6681', '#1457b8', Math.pow(t, 1.1));
        const navy = this.mixColor('#3b526d', '#0b2f73', t);
        const redStop = 2 + t * 22;
        const whiteStop = 56 - t * 28;
        const blueStop = 76 - t * 18;
        return {
            color: '#4d6681',
            'font-weight': '800',
            'background-image': `linear-gradient(${108 + t * 24}deg, ${red} 0%, ${red} ${redStop}%, ${paper} ${whiteStop}%, ${blue} ${blueStop}%, ${navy} 100%)`,
            '-webkit-background-clip': 'text',
            'background-clip': 'text',
            '-webkit-text-fill-color': 'transparent',
            'text-shadow': `0 0 ${2 + t * 10}px rgba(214, 31, 60, ${t * 0.32}), 0 0 ${3 + t * 12}px rgba(20, 87, 184, ${0.08 + t * 0.34})`
        };
    }

    mixGoldColor(t) {
        const stops = [
            { at: 0, color: '#ffffff' },
            { at: 0.08, color: '#fff9e8' },
            { at: 0.18, color: '#ffefbd' },
            { at: 0.38, color: '#ffd95f' },
            { at: 0.68, color: '#efb72e' },
            { at: 1, color: '#b8860b' }
        ];
        let left = stops[0];
        let right = stops[stops.length - 1];

        for (let i = 0; i < stops.length - 1; i++) {
            if (t >= stops[i].at && t <= stops[i + 1].at) {
                left = stops[i];
                right = stops[i + 1];
                break;
            }
        }

        const localT = right.at === left.at ? 0 : (t - left.at) / (right.at - left.at);
        return this.mixColor(left.color, right.color, localT);
    }

    mixColor(from, to, t) {
        const a = this.hexToRgb(from);
        const b = this.hexToRgb(to);
        return this.rgbToHex({
            r: a.r + (b.r - a.r) * t,
            g: a.g + (b.g - a.g) * t,
            b: a.b + (b.b - a.b) * t
        });
    }

    hexToRgb(hex) {
        const value = Number.parseInt(hex.replace('#', ''), 16);
        return {
            r: (value >> 16) & 255,
            g: (value >> 8) & 255,
            b: value & 255
        };
    }

    rgbToHex({r, g, b}) {
        const toHex = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }

    styleObjectToString(style) {
        return Object.entries(style).map(([key, value]) => `${key}: ${value}`).join('; ');
    }

    escapeHtml(value) {
        return String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    getProfileKey(username) {
        return String(username || '').trim().toLowerCase();
    }

    getProfile(username) {
        const entry = this.profileCache?.get(this.getProfileKey(username));
        return entry?.profile || null;
    }

    trackProfileUsername(username) {
        const key = this.getProfileKey(username);
        if (!key) return;
        this.trackedProfileUsernames.set(key, username);
    }

    async fetchTrackedProfiles() {
        if (this.profileFetchPromise || !this.trackedProfileUsernames.size) {
            return;
        }

        const profiles = Array.from(this.trackedProfileUsernames.entries()).map(([key, username]) => ({
            username,
            lastUpdatedAt: this.profileCache.get(key)?.profile?.lastUpdatedAt
        }));

        await this.fetchProfileBatch(profiles);
    }

    async preloadProfiles(usernames) {
        const profiles = [];
        const seen = new Set();

        for (const username of usernames || []) {
            const cleanUsername = String(username || '').replaceAll(' (admin)', '').trim();
            const key = this.getProfileKey(cleanUsername);
            if (!key || seen.has(key)) continue;

            seen.add(key);
            this.trackProfileUsername(cleanUsername);
            profiles.push({
                username: cleanUsername,
                lastUpdatedAt: this.profileCache.get(key)?.profile?.lastUpdatedAt
            });
        }

        if (!profiles.length) {
            return;
        }

        if (this.profileFetchPromise) {
            await this.profileFetchPromise;
        }

        await this.fetchProfileBatch(profiles);
    }

    async fetchProfileBatch(profiles) {
        if (!profiles.length) {
            return;
        }

        const fetchPromise = this.requestProfileBatch(profiles);
        this.profileFetchPromise = fetchPromise;
        this.profileFetchInFlight = true;

        try {
            await fetchPromise;
        } finally {
            if (this.profileFetchPromise === fetchPromise) {
                this.profileFetchPromise = null;
                this.profileFetchInFlight = false;
            }
        }
    }

    async requestProfileBatch(profiles) {
        try {
            const response = await fetch(`${this.getProfilesApiBase()}/api/profiles/batch`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({profiles})
            });

            if (!response.ok) {
                return;
            }

            const data = await response.json();
            for (const profile of data.profiles || []) {
                const key = this.getProfileKey(profile.username);
                this.profileCache.set(key, {profile});
                this.refreshStyledUsername(profile.username);
                this.userDropdown.refresh(profile.username);
            }

            for (const username of data.missing || []) {
                const key = this.getProfileKey(username);
                if (!this.profileCache.has(key)) {
                    this.profileCache.set(key, {profile: null});
                }
            }
        } catch (e) {
            if (localStorage.DWEM_DEBUG) {
                console.warn('Failed to fetch CNC profiles', e);
            }
        }
    }

    refreshStyledUsername(username) {
        const key = this.getProfileKey(username);
        for (const element of document.querySelectorAll('[data-cnc-profile-key]')) {
            if (element.dataset.cncProfileKey !== key) continue;
            const elementUsername = element.dataset.cncProfileUsername || username;
            element.innerHTML = this.renderUsernameStyle(elementUsername, this.getProfile(elementUsername)?.currentBanner?.usernameStyle);
        }
    }

    getProfilesApiBase() {
        return localStorage.CNC_PROFILES_API || CNCUserinfo.PROFILE_API_BASE;
    }

    onLoad() {
        this.profileCache = new Map();
        this.trackedProfileUsernames = new Map();
        this.profileFetchInFlight = false;
        this.profileFetchPromise = null;
        this.profileFetchTimer = setInterval(() => {
            this.fetchTrackedProfiles();
        }, 1000);

        this.userDropdown = new UserDropdown();
        document.body.appendChild(this.userDropdown);
        const {SourceMapperRegistry: SMR} = DWEM;
        const {IOHook} = DWEM.Modules;

        IOHook.handle_message.before.addHandler('cnc-userinfo', (data) => {
            this.patchUpdateSpectators(data);
        });

        function lobbyEntryInjector() {
            function lobby_entry(data) {
                var single = false;
                if (new_list == null) {
                    single = true;
                    new_list = $("#player_list").clone();
                }

                var id = "game-" + data.id;
                var entry = new_list.find("#" + id);
                if (entry.length == 0) {
                    entry = $("#game_entry_template").clone();
                    entry.attr("id", id);
                    new_list.append(entry);
                }

                function set(key, value) {
                    const cell = entry.find("." + key).empty(); // 내용 비우기
                    cell.append(value);
                }

                var username_entry = $(make_watch_link(data));
                username_entry.text(data.username);
                username_entry.attr("data-cnc-username", data.username);
                username_entry.html(DWEM.Modules.CNCUserinfo.applyStyledUsername(data.username));
                set("username", username_entry);
                set("game_id", data.game_id);
                set("xl", data.xl);
                set("char", data.char);
                set("place", data.place);
                if (data.turn && data.dur) {
                    set("turn", data.turn);
                    set("dur", format_duration(parseInt(data.dur)));

                    new_list.removeClass("no_game_times");
                }
                set("god", data.god || "");
                set("title", data.title);
                set("idle_time", format_idle_time(data.idle_time));
                entry.find(".idle_time")
                    .data("time", data.idle_time)
                    .attr("data-time", "" + data.idle_time);
                entry.find(".idle_time")
                    .data("sort", "" + data.idle_time)
                    .attr("data-sort", "" + data.idle_time);
                set("spectator_count", data.spectator_count > 0 ? data.spectator_count : "");
                if (entry.find(".milestone").text() !== data.milestone) {
                    if (single)
                        roll_in_new_milestone(entry, data.milestone);
                    else
                        set("milestone", data.milestone);
                }

                if (single)
                    lobby_complete();
            }

            comm.register_handlers({lobby_entry: lobby_entry});
            $(document).on('contextmenu', '#player_list .username a', function (e) {
                e.preventDefault();
                const profileElement = this.querySelector('[data-cnc-profile-username]');
                const username = this.getAttribute('data-cnc-username') ||
                    (profileElement ? profileElement.getAttribute('data-cnc-profile-username') : '') ||
                    this.textContent;
                DWEM.Modules.CNCUserinfo.open(username, e);
            });
        }

        const lobbyEntryMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${lobbyEntryInjector.toString()}()`);
        SMR.add('client', lobbyEntryMapper);

        CNCUserinfo.open = this.open.bind(this);

        // Make instance methods available as static methods for other modules
        CNCUserinfo.createNemelexSpan = this.createNemelexSpan.bind(this);
        CNCUserinfo.applyStyledUsername = this.applyStyledUsername.bind(this);
        CNCUserinfo.preloadProfiles = this.preloadProfiles.bind(this);
        CNCUserinfo.getProfile = this.getProfile.bind(this);
        CNCUserinfo.escapeHtml = this.escapeHtml.bind(this);
        CNCUserinfo.createBannerTitleDiv = this.createBannerTitleDiv.bind(this);
    }
}
