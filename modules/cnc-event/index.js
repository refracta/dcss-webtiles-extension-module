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
    }

    onLoad() {
        const {SourceMapperRegistry: SMR} = DWEM;

        function uiLayoutsInjector() {
            const originalDescribeMonster = ui_handlers["describe-monster"];
            ui_handlers["describe-monster"] = function (desc) {
                const $popup = originalDescribeMonster(desc);
                try {
                    DWEM.Modules.CNCEvent?.enhanceDescribeMonster?.($popup, desc);
                } catch (error) {
                    console.error('CNCEvent describe-monster enhancement failed:', error);
                }
                return $popup;
            };
        }

        const mapper = SMR.getSourceMapper('BeforeReturnInjection', `!${uiLayoutsInjector.toString()}()`);
        SMR.add('./ui-layouts', mapper);
        this.injectStyle();

        DWEM.Modules.IOHook.handle_message.after.addHandler('cnc-event-version-tracker', data => {
            if (data?.msg === 'game_client') {
                this.gameClientVersion = data.version || this.gameClientVersion;
            } else if (data?.msg === 'version') {
                this.versionText = data.text || data.version || this.versionText;
            } else if (data?.msg === 'game_started') {
                this.gameStarted = {...data};
            }
        });
    }

    enhanceDescribeMonster($popup, desc) {
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
        this.refreshFooter($popup, desc);
        this.installFooterSync($popup);
        this.loadScorePane($scorePane, desc);
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

    refreshFooter($popup, desc) {
        const labels = ['Description'];
        if (String(desc.status || '') !== '') {
            labels.push('Status');
        }
        if (String(desc.quote || '') !== '') {
            labels.push('Quote');
        }
        labels.push('Goonkemon score');

        const $footerPanes = $popup.find('.footer > .paneset');
        if (!$footerPanes.length) {
            return;
        }

        const currentIndex = Math.max(0, $popup.find('.body.paneset > .pane').index(
            $popup.find('.body.paneset > .pane.current')
        ));
        $footerPanes.empty();
        labels.forEach((label, index) => {
            const text = labels.map((item, itemIndex) =>
                itemIndex === index ? `<b class="fg15">${this.escapeHtml(item)}</b>` : this.escapeHtml(item)
            ).join(' | ');
            const $pane = $('<div class="pane"></div>').html(text);
            if (index === currentIndex) {
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
        const currentIndex = Math.max(0, $bodyPanes.index($bodyPanes.filter('.current')));
        const $footerPanes = $popup.find('.footer > .paneset > .pane');
        $footerPanes.removeClass('current');
        $footerPanes.eq(currentIndex).addClass('current');
    }

    renderScorePaneShell() {
        return `
<div class="goonkemon-pane" style="padding: 2px 0;">
  <div class="goonkemon-score-content fg7">Loading Goonkemon score...</div>
  <div style="margin-top: 0.75em;">
    <button type="button" data-goonkemon-submit="true" style="font: inherit; padding: 2px 8px;">Submit Goonkemon</button>
    <span data-goonkemon-submit-status="true" class="fg7" style="margin-left: 0.5em;"></span>
  </div>
</div>`;
    }

    async loadScorePane($pane, desc) {
        const $content = $pane.find('.goonkemon-score-content');
        const $button = $pane.find('[data-goonkemon-submit]');
        const $status = $pane.find('[data-goonkemon-submit-status]');

        $button.on('click', () => this.submitRequest($button, $status));

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
}
.goonkemon-pane .score-cell {
    min-width: 0;
    border: 1px solid #333;
    padding: 2px 4px;
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
}
.goonkemon-pane .score-equations {
    display: grid;
    gap: 0.15em;
}
.goonkemon-pane .score-table {
    width: 100%;
    border-collapse: collapse;
}
.goonkemon-pane .score-table th,
.goonkemon-pane .score-table td {
    border: 1px solid #333;
    padding: 2px 4px;
    text-align: left;
    vertical-align: top;
}
.goonkemon-pane .score-table th {
    color: #888;
    font-weight: normal;
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
