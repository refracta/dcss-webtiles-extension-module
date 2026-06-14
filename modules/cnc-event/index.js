const DEFAULT_API_BASE = 'https://goonkemon.nemelex.cards';
const EVENT_LORD_NAMES = [
    'cerebov',
    'lom lobon',
    'gloorx vloq',
    'ereshkigal',
    'mnoleg'
];

export default class CNCEvent {
    static name = 'CNCEvent';
    static version = '1.0';
    static dependencies = ['IOHook', 'SiteInformation'];
    static description = 'CNC event integrations for Goonkemon.';

    constructor() {
        this.apiBase = localStorage.CNC_EVENT_API_BASE || DEFAULT_API_BASE;
        this.gameClientVersion = null;
        this.versionText = null;
        this.gameStarted = null;
        this.latestDescribeMonster = null;
        this.watching = false;
        this.playing = false;
    }

    onLoad() {
        const {SourceMapperRegistry: SMR} = DWEM;

        const mapper = source => this.injectDescribeMonsterPane(source);
        SMR.add('./ui-layouts', mapper);
        this.injectStyle();
        this.installSpectatorPaneCycleController();

        DWEM.Modules.IOHook.handle_message.before.addHandler('cnc-event-version-tracker', data => {
            if (data?.msg === 'game_client') {
                this.gameClientVersion = data.version || this.gameClientVersion;
            } else if (data?.msg === 'version') {
                this.versionText = data.text || data.version || this.versionText;
            } else if (data?.msg === 'game_started') {
                this.gameStarted = {...data};
                this.playing = true;
                this.watching = false;
            } else if (data?.msg === 'watching_started') {
                this.watching = true;
                this.playing = false;
            } else if (data?.msg === 'go_lobby' || data?.msg === 'game_ended') {
                this.watching = false;
                this.playing = false;
            }
        }, 1000);

        DWEM.Modules.IOHook.handle_message.before.addHandler('cnc-event-describe-monster-cache', data => {
            const desc = this.findDescribeMonsterPayload(data);
            if (!desc) {
                return;
            }
            this.latestDescribeMonster = this.cloneMessage(desc);
        }, 1000);

        DWEM.Modules.IOHook.handle_message.before.addHandler('cnc-event-describe-monster-pane-state', data => {
            const pane = this.findDescribeMonsterPane(data);
            if (pane == null || data?.msg !== 'ui-state' || !this.isSpectating()) {
                return;
            }
            this.pendingDescribeMonsterPaneSync = {
                previousIndex: this.currentActiveGoonkemonPaneIndex(),
                pane
            };
        }, 1000);

        DWEM.Modules.IOHook.handle_message.after.addHandler('cnc-event-describe-monster-fallback', data => {
            const renderedDesc = this.findDescribeMonsterPayload(data);
            if (!renderedDesc) {
                return;
            }
            const desc = this.latestDescribeMonster || renderedDesc;
            setTimeout(() => this.enhanceLatestDescribeMonster(desc), 0);
        }, -1000);

        DWEM.Modules.IOHook.handle_message.after.addHandler('cnc-event-describe-monster-pane-sync', data => {
            const pane = this.findDescribeMonsterPane(data);
            if (pane == null) {
                return;
            }
            const pending = data?.msg === 'ui-state' ? this.pendingDescribeMonsterPaneSync : null;
            this.pendingDescribeMonsterPaneSync = null;
            setTimeout(() => this.syncLatestDescribeMonsterPane(pane, pending || {}), 0);
        }, -2000);
    }

    injectDescribeMonsterPane(source) {
        const scrollerLoopPattern = /(\s*)for \(var i = 0; i < \$panes\.length; i\+\+\)\r?\n\s*scroller\(\$panes\.eq\(i\)\[0\]\);/;
        const match = source.match(scrollerLoopPattern);
        if (!match) {
            console.warn('CNCEvent could not find describe_monster scroller hook point.');
            return source;
        }

        const indent = match[1] || '';
        const injection = `${indent}try {
            var goonkemon_desc = DWEM.Modules.CNCEvent?.latestDescribeMonster || desc;
            DWEM.Modules.CNCEvent?.enhanceDescribeMonster?.($popup, goonkemon_desc, {preScroller: true});
            $panes = $body.find(".pane");
            $footer = $popup.find(".footer > .paneset");
            have_quote = $footer.length > 0;
        } catch (error) {
            console.error("CNCEvent describe-monster enhancement failed:", error);
        }`;

        return source.replace(scrollerLoopPattern, `${injection}\n\n${match[0]}`);
    }

    enhanceDescribeMonster($popup, desc, options = {}) {
        if (!$popup?.hasClass?.('describe-monster')) {
            return;
        }
        if (!this.isEligibleGoonkemonMonster(desc)) {
            return;
        }

        const $body = $popup.find('.body.paneset');
        if (!$body.length || $body.find('[data-goonkemon-score-pane]').length) {
            return;
        }

        const $scorePane = $('<div class="pane" data-goonkemon-score-pane="true"></div>');
        $scorePane.html(this.renderScorePaneShell());
        $body.append($scorePane);

        this.ensureFooter($popup);
        this.refreshFooter($popup, desc, options);
        this.installFooterSync($popup);
        this.loadScorePane($scorePane, desc);
    }

    enhanceLatestDescribeMonster(desc) {
        const $popup = $('.describe-monster').last();
        if (!$popup.length) {
            return;
        }
        this.enhanceDescribeMonster($popup, desc);
    }

    cloneMessage(data) {
        try {
            return JSON.parse(JSON.stringify(data));
        } catch (error) {
            return {...data};
        }
    }

    findDescribeMonsterPayload(data) {
        if (this.hasDescribeMonsterPayload(data)) {
            return data;
        }

        if (data?.msg === 'ui-stack' && Array.isArray(data.items)) {
            for (let i = data.items.length - 1; i >= 0; i--) {
                const item = data.items[i];
                if (this.hasDescribeMonsterPayload(item)) {
                    return {...item, msg: 'ui-push'};
                }
            }
        }

        return null;
    }

    findDescribeMonsterPane(data) {
        if (data?.msg === 'ui-state' && data.type === 'describe-monster' && data.pane != null) {
            const pane = Number(data.pane);
            return Number.isFinite(pane) ? pane : null;
        }

        if (data?.msg === 'ui-stack' && Array.isArray(data.items)) {
            for (let i = data.items.length - 1; i >= 0; i--) {
                const item = data.items[i];
                if (item?.type !== 'describe-monster' || item.pane == null) {
                    continue;
                }
                const pane = Number(item.pane);
                return Number.isFinite(pane) ? pane : null;
            }
        }

        return null;
    }

    hasDescribeMonsterPayload(item) {
        return item?.type === 'describe-monster' &&
            (item.title != null || item.body != null || Array.isArray(item.spellset));
    }

    ensureFooter($popup) {
        if ($popup.children('.footer').length) {
            return;
        }

        $popup.append($(
            '<div class="footer">' +
            '<div>[<b class="fg3">!</b>]:&nbsp;</div>' +
            '<div class="paneset"></div>' +
            '</div>'
        ));
    }

    refreshFooter($popup, desc, options = {}) {
        const labels = ['Description'];
        if (String(desc.status || '') !== '') {
            labels.push('Status');
        }
        if (String(desc.quote || '') !== '') {
            labels.push('Quote');
        }
        labels.push('Goonkemon');

        const $footerPanes = $popup.find('.footer > .paneset');
        if (!$footerPanes.length) {
            return;
        }

        const currentIndex = options.preScroller
            ? -1
            : $popup.find('.body.paneset > .pane').index($popup.find('.body.paneset > .pane.current'));
        if (currentIndex >= 0) {
            $popup.data('goonkemon-pane-index', currentIndex);
        }
        $footerPanes.empty();
        labels.forEach((label, index) => {
            const text = labels.map((item, itemIndex) =>
                itemIndex === index ? `<b class="fg15">${this.escapeHtml(item)}</b>` : this.escapeHtml(item)
            ).join(' | ');
            const $pane = $('<div class="pane"></div>').html(text);
            if (currentIndex >= 0 && index === currentIndex) {
                $pane.addClass('current');
            }
            $footerPanes.append($pane);
        });
    }

    installFooterSync($popup) {
        if ($popup.data('goonkemon-footer-sync')) {
            return;
        }
        $popup.data('goonkemon-footer-sync', true);
        $popup.on('keydown.cnc-event', event => {
            if (event.key !== '!') {
                return;
            }
            setTimeout(() => this.syncFooterCurrent($popup), 0);
        });
    }

    syncFooterCurrent($popup) {
        const $bodyPanes = $popup.find('.body.paneset > .pane');
        const currentIndex = this.currentPaneIndex($popup, $bodyPanes);
        this.setPaneIndex($popup, currentIndex);
    }

    syncLatestDescribeMonsterPane(pane, options = {}) {
        if (!this.isSpectating()) {
            return;
        }

        const $popup = $('.describe-monster').last();
        if (!$popup.length) {
            return;
        }

        if (this.latestDescribeMonster) {
            this.enhanceDescribeMonster($popup, this.latestDescribeMonster);
        }
        if (!$popup.find('[data-goonkemon-score-pane]').length) {
            return;
        }

        const previousIndex = Number(options.previousIndex);
        const targetPane = Number.isFinite(previousIndex) && previousIndex >= 0
            ? previousIndex + 1
            : pane;
        this.setPaneIndex($popup, targetPane);
    }

    installSpectatorPaneCycleController() {
        if (this.spectatorPaneCycleControllerInstalled) {
            return;
        }

        this.spectatorPaneCycleControllerInstalled = true;
        document.addEventListener('keydown', event => this.handleSpectatorPaneCycleKey(event), true);
    }

    handleSpectatorPaneCycleKey(event) {
        if (!this.isSpectating() || !this.isPaneCycleKey(event)) {
            return;
        }

        const popup = this.findActiveGoonkemonPopupElement();
        if (!popup) {
            return;
        }

        const currentIndex = this.currentPaneIndexElement(popup);
        this.setPaneIndexElement(popup, currentIndex + 1);
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
    }

    isPaneCycleKey(event) {
        const key = event.key || '';
        const code = event.which || event.keyCode || event.charCode || 0;
        return key === '!' || (key === '1' && event.shiftKey) || code === 33 || (code === 49 && event.shiftKey);
    }

    findActiveGoonkemonPopupElement() {
        const popups = Array.from(document.querySelectorAll('.describe-monster')).filter(element => {
            const connected = element.isConnected !== false;
            const hasPane = element.querySelector('[data-goonkemon-score-pane]');
            const visible = element.offsetParent !== null || element.getClientRects().length > 0;
            return connected && hasPane && visible;
        });
        return popups.at(-1) || null;
    }

    currentActiveGoonkemonPaneIndex() {
        const popup = this.findActiveGoonkemonPopupElement();
        return popup ? this.currentPaneIndexElement(popup) : null;
    }

    currentPaneIndexElement(popup) {
        const bodyPanes = Array.from(popup.querySelectorAll('.body.paneset > .pane'));
        const bodyIndex = bodyPanes.findIndex(pane => pane.classList.contains('current'));
        if (bodyIndex >= 0) {
            return bodyIndex;
        }

        const footerPanes = Array.from(popup.querySelectorAll('.footer > .paneset > .pane'));
        const footerIndex = footerPanes.findIndex(pane => pane.classList.contains('current'));
        return footerIndex >= 0 ? footerIndex : 0;
    }

    setPaneIndexElement(popup, index) {
        const bodyPanes = Array.from(popup.querySelectorAll('.body.paneset > .pane'));
        if (!bodyPanes.length) {
            return;
        }

        const normalizedIndex = ((Number(index) || 0) % bodyPanes.length + bodyPanes.length) % bodyPanes.length;
        bodyPanes.forEach((pane, paneIndex) => pane.classList.toggle('current', paneIndex === normalizedIndex));

        const footerPanes = Array.from(popup.querySelectorAll('.footer > .paneset > .pane'));
        footerPanes.forEach((pane, paneIndex) => pane.classList.toggle('current', paneIndex === normalizedIndex));
        popup.dataset.goonkemonPaneIndex = String(normalizedIndex);
    }

    currentPaneIndex($popup, $bodyPanes = null) {
        const $panes = $bodyPanes || $popup.find('.body.paneset > .pane');
        const bodyIndex = $panes.index($panes.filter('.current'));
        if (bodyIndex >= 0) {
            return bodyIndex;
        }

        const $footerPanes = $popup.find('.footer > .paneset > .pane');
        const footerIndex = $footerPanes.index($footerPanes.filter('.current'));
        if (footerIndex >= 0) {
            return footerIndex;
        }

        const storedIndex = Number($popup.data('goonkemon-pane-index'));
        return Number.isFinite(storedIndex) ? storedIndex : 0;
    }

    setPaneIndex($popup, index) {
        const $bodyPanes = $popup.find('.body.paneset > .pane');
        if (!$bodyPanes.length) {
            return;
        }

        const normalizedIndex = ((Number(index) || 0) % $bodyPanes.length + $bodyPanes.length) % $bodyPanes.length;
        $bodyPanes.removeClass('current').eq(normalizedIndex).addClass('current');

        const $footerPanes = $popup.find('.footer > .paneset > .pane');
        $footerPanes.removeClass('current').eq(normalizedIndex).addClass('current');
        $popup.data('goonkemon-pane-index', normalizedIndex);
    }

    renderScorePaneShell() {
        return `
<div class="goonkemon-pane" style="padding: 2px 0;">
  <div class="goonkemon-score-content fg7">Loading Goonkemon score...</div>
  <div data-goonkemon-submit-row="true" style="margin-top: 0.75em;">
    <button type="button" data-goonkemon-submit="true" style="font: inherit; padding: 2px 8px;">Submit Goonkemon</button>
    <span data-goonkemon-submit-status="true" class="fg7" style="margin-left: 0.5em;"></span>
  </div>
</div>`;
    }

    async loadScorePane($pane, desc) {
        const $content = $pane.find('.goonkemon-score-content');
        const $button = $pane.find('[data-goonkemon-submit]');
        const $status = $pane.find('[data-goonkemon-submit-status]');
        const $submitRow = $pane.find('[data-goonkemon-submit-row]');

        if (this.isSpectating()) {
            $submitRow.hide();
        } else {
            $button.on('click', () => this.submitRequest($button, $status));
        }

        try {
            const result = await this.postJson('/score', {
                monster: desc,
                webtiles: this.webtilesContext()
            });
            if (!result.ok) {
                throw new Error(result.error || 'score failed');
            }
            $content.html(result.html || this.escapeHtml(`${result.score?.total ?? '?'} pts`));
        } catch (error) {
            $content.html(`<span class="fg12">${this.escapeHtml(error.message || error)}</span>`);
        }
    }

    async submitRequest($button, $status) {
        const username = DWEM.Modules.SiteInformation?.current_user || '';
        if (!username) {
            $status.removeClass().addClass('fg12').text('Login required.');
            return;
        }

        $button.prop('disabled', true);
        $status.removeClass().addClass('fg7').text('Submitting...');
        try {
            const result = await this.postJson('/request', {username});
            if (!result.ok) {
                throw new Error(result.error || 'request failed');
            }
            $status.removeClass().addClass('fg10').text(result.message || 'Queued.');
        } catch (error) {
            $status.removeClass().addClass('fg12').text(error.message || String(error));
            $button.prop('disabled', false);
        }
    }

    async postJson(path, body) {
        const response = await fetch(`${this.apiBase.replace(/\/$/, '')}${path}`, {
            method: 'POST',
            mode: 'cors',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body)
        });
        const text = await response.text();
        const data = text ? JSON.parse(text) : {};
        if (!response.ok) {
            return {ok: false, error: data.error || `${response.status} ${response.statusText}`};
        }
        return data;
    }

    webtilesContext() {
        return {
            entrypoint: window.location.origin,
            gameClientVersion: this.gameClientVersion,
            versionText: this.versionText,
            gameStarted: this.gameStarted || null
        };
    }

    isSpectating() {
        const site = DWEM.Modules.SiteInformation || {};
        return Boolean((site.watching || this.watching) && !(site.playing || this.playing));
    }

    isEligibleGoonkemonMonster(monster) {
        if (!monster || monster.type !== 'describe-monster') {
            return false;
        }

        if (this.isEligibleGoonkemonTitle(this.cleanText(monster.title || ''))) {
            return true;
        }

        const body = this.cleanText(monster.body || '');
        return /\bpandemonium\b/i.test(body) &&
            /\bdemon lord\b|\blord of pandemonium\b|\blords of pandemonium\b/i.test(body);
    }

    isEligibleGoonkemonTitle(title) {
        const normalized = String(title || '')
            .toLowerCase()
            .replace(/^the\s+/, '')
            .replace(/\.$/, '')
            .trim();

        if (/\bpan(?:demonium)? lord\b/i.test(normalized)) {
            return true;
        }

        return EVENT_LORD_NAMES.some(lordName =>
            normalized === lordName ||
            normalized.startsWith(`${lordName},`) ||
            normalized.startsWith(`${lordName} the `)
        );
    }

    cleanText(value) {
        return this.decodeEntities(String(value || '').replace(/<[^>]*>/g, ''))
            .replace(/[ \t]+\n/g, '\n')
            .trim();
    }

    decodeEntities(value) {
        const element = document.createElement('textarea');
        element.innerHTML = value;
        return element.value;
    }

    injectStyle() {
        if (document.getElementById('cnc-event-goonkemon-style')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'cnc-event-goonkemon-style';
        style.textContent = `
.goonkemon-pane .score-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1px;
    margin: 0.5em 0;
    min-width: 0;
}
.goonkemon-pane .score-cell {
    min-width: 0;
    border: 1px solid #333;
    padding: 2px 4px;
    overflow-wrap: anywhere;
}
.goonkemon-pane .score-label {
    color: #888;
}
.goonkemon-pane .score-value,
.goonkemon-pane .score-subtitle,
.goonkemon-pane .score-equation strong {
    color: #fff;
}
.goonkemon-pane .score-detail {
    display: grid;
    gap: 0.75em;
    min-width: 0;
}
.goonkemon-pane .score-detail > div,
.goonkemon-pane .goonkemon-score-content {
    min-width: 0;
    max-width: 100%;
}
.goonkemon-pane .score-equations {
    display: grid;
    gap: 0.15em;
    min-width: 0;
}
.goonkemon-pane .score-equation {
    overflow-wrap: anywhere;
}
.goonkemon-pane .score-section {
    min-width: 0;
    max-width: 100%;
    overflow-x: auto;
}
.goonkemon-pane .score-table {
    width: 100%;
    max-width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
}
.goonkemon-pane .score-table th,
.goonkemon-pane .score-table td {
    border: 1px solid #333;
    padding: 2px 4px;
    text-align: left;
    vertical-align: top;
    overflow-wrap: anywhere;
}
.goonkemon-pane .score-table th {
    color: #888;
    font-weight: normal;
}
.describe-monster .body.paneset,
.describe-monster .body.paneset > .pane,
.describe-monster .body.paneset .simplebar-content,
.describe-monster .goonkemon-pane {
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
}
.goonkemon-pane .score-points {
    text-align: right;
    white-space: nowrap;
}
`;
        document.head.appendChild(style);
    }

    escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[char]);
    }
}
