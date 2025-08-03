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
                text-align: center;
            }
            .dropdown-content > div {
                color: #A2A2A2;
                border-bottom: 1px solid #626262;
                padding: 4px 8px;
                cursor: pointer;
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
        this.dropdownContent.style.display = 'block';
        const isAdmin = username.includes(' (admin)');
        const realUsername = username.replaceAll(' (admin)', '');
        const lowerUsername = realUsername.toLowerCase();
        // PROJECT_B: Get user title info
        const titleInfo = DWEM.Modules.CNCUserinfo.getUserTitleInfo(realUsername);
        const titleDiv = titleInfo
            ? `<div style="font-style: italic; font-size: 0.9em; margin-top: -4px; margin-bottom: 4px;"><a href="${titleInfo.url}" target="_blank">${titleInfo.title}</a></div>`
            : '';

        this.dropdownContent.innerHTML = `
            <div style="font-weight: bold"><a href="#watch-${realUsername}" target="_blank">${DWEM.Modules.CNCUserinfo.applyColorfulUsername(realUsername)}${isAdmin ? ' (ADMIN)' : ''}</a></div>
            ${titleDiv}
            <div><a href="https://crawl.akrasiac.org/scoring/players/${lowerUsername}.html" target="_blank">CAO Scoreboard</a></div>
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
        this.style.left = `${x - window.scrollX}px`;
        this.style.top = `${y - rect.height - window.scrollY}px`;
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

    // User title configuration
    static USER_TITLES = {
        'wizardmodephilia': {
            title: 'Wizard Account',
            url: 'https://refracta.github.io/nemelex.cards/cnc-1st-anniversary-tournament/results.html'
        },
        'sasameki': {
            title: 'CNC 1st Anniversary Tournament Champion (Skill Category)',
            url: 'https://refracta.github.io/nemelex.cards/cnc-1st-anniversary-tournament/results.html'
        },
        'opking': {
            title: 'CNC 1st Anniversary Tournament 2nd Place (Skill Category)',
            url: 'https://refracta.github.io/nemelex.cards/cnc-1st-anniversary-tournament/results.html'
        },
        'sekai': {
            title: 'CNC 1st Anniversary Tournament 3rd Place (Skill Category)',
            url: 'https://refracta.github.io/nemelex.cards/cnc-1st-anniversary-tournament/results.html'
        },
        'unreal': {
            title: 'CNC 1st Anniversary Tournament Champion (Ent Category)',
            url: 'https://refracta.github.io/nemelex.cards/cnc-1st-anniversary-tournament/results.html'
        },
        'mumonspawn': {
            title: 'CNC 1st Anniversary Tournament 2nd Place (Ent Category)',
            url: 'https://refracta.github.io/nemelex.cards/cnc-1st-anniversary-tournament/results.html'
        },
        'dogchiho': {
            title: 'CNC 1st Anniversary Tournament 3rd Place (Ent Category)',
            url: 'https://refracta.github.io/nemelex.cards/cnc-1st-anniversary-tournament/results.html'
        }
    };

    open(username, event) {
        this.userDropdown.open(username, event.pageX, event.pageY);
        event.preventDefault();
        event.stopPropagation();
    }

    /**
     * Get user title information
     * @param {string} username - The username to get title for
     * @returns {Object|null} Title object with {title, url} or null if no title
     */
    getUserTitleInfo(username) {
        if (!username) return null;
        return CNCUserinfo.USER_TITLES[username.toLowerCase()] || null;
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
                // PROJECT_A: Apply colorful username to spectator list
                anchor.innerHTML = this.applyColorfulUsername(username);
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
            return `<span style="color: ${color}">${part}</span>`;
        });

        return coloredParts.join('');
    }

    /**
     * Applies colorful username styling
     * @param {string} username - The username text
     * @returns {string} HTML string with colored spans or original username
     */
    applyColorfulUsername(username) {
        if (!username) return username;

        const lowerUsername = username.toLowerCase();
        const colorConfig = {
            'wizardmodephilia': { split: 1, time: 60 },
            'sasameki': { split: 1, time: 60 },
            'opking': { split: 2, time: 60 },
            'sekai': { split: 3, time: 60 },
            'unreal': { split: 1, time: 60 },
            'mumonspawn': { split: 2, time: 60 },
            'dogchiho': { split: 3, time: 60 }
        };

        // Apply Nemelex coloring to configured users
        if (colorConfig[lowerUsername]) {
            const config = colorConfig[lowerUsername];
            return this.createNemelexSpan(
                username,
                CNCUserinfo.NEMELEX_COLORS,
                config.split,
                config.time
            );
        }

        // Return unchanged for other users
        return username;
    }

    onLoad() {
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
                // PROJECT_A: Apply colorful username in lobby
                username_entry.html(DWEM.Modules.CNCUserinfo.applyColorfulUsername(data.username));
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
                let username;
                if (e.target.tagName === 'A') {
                    username = e.target.textContent;
                } else {
                    username = e.target.parentElement.textContent;
                }
                DWEM.Modules.CNCUserinfo.open(username, e);
            });
        }

        const lobbyEntryMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${lobbyEntryInjector.toString()}()`);
        SMR.add('client', lobbyEntryMapper);

        CNCUserinfo.open = this.open.bind(this);

        // Make instance methods available as static methods for other modules
        CNCUserinfo.createNemelexSpan = this.createNemelexSpan.bind(this);
        CNCUserinfo.applyColorfulUsername = this.applyColorfulUsername.bind(this);
        CNCUserinfo.getUserTitleInfo = this.getUserTitleInfo.bind(this);
    }
}
