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
        this.dropdownContent.innerHTML = `
            <div style="font-weight: bold"><a href="#watch-${realUsername}" target="_blank">${realUsername}${isAdmin ? ' (ADMIN)' : ''}</a></div>
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
        this.style.left = `${x - rect.width - window.scrollX}px`;
        this.style.top = `${y - rect.height - window.scrollY}px`;
    }
}

customElements.define('user-dropdown', UserDropdown, {extends: 'div'});
export default class CNCUserinfo {
    static name = 'CNCUserinfo';
    static version = '0.1';
    static dependencies = ['IOHook'];
    static description = '(Beta) This module provides advanced CNC user information.';

    open(username, event) {
        this.userDropdown.open(username, event.pageX, event.pageY);
        event.preventDefault();
        event.stopPropagation();
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
                anchor.href = 'javascript:void(0);'
                anchor.setAttribute('onclick', `DWEM.Modules.CNCUserinfo.open('${anchor.textContent}', event);`);
                anchor.textContent = anchor.textContent.replaceAll(' (admin)', '');
                anchor.removeAttribute('target');
            }
            data.names = container.innerHTML;
        }
    }

    onLoad() {
        this.userDropdown = new UserDropdown();
        document.body.appendChild(this.userDropdown);

        const {IOHook} = DWEM.Modules;
        IOHook.handle_message.before.addHandler('cnc-userinfo', (data) => {
            this.patchUpdateSpectators(data);
        });

        CNCUserinfo.open = this.open.bind(this);
    }
}
