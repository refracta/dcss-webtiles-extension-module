import BannerTemplate from './banner-template.js';
import DonationSummary from './donation-summary.js';
import LobbyActions from './lobby-actions.js';
import {applyXMasTheme} from './seasonal-theme.js';
import {escapeHtml, getLocale, randomChoice, shouldUseXMasTheme} from './utils.js';

const RC_LINKS = `[CDI]
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
const PROFILES_URL = 'https://profiles.nemelex.cards';
const PROFILES_TOKEN_LOGIN_URL = `${PROFILES_URL}/session/cnc-token`;

export default class CNCBanner {
    static name = 'CNCBanner';
    static version = '1.0';
    static dependencies = ['IOHook', 'SiteInformation', 'ModuleManager', 'WebSocketFactory', 'WTRec', 'CNCUserinfo'];
    static description = 'This module sets the banner for the CNC server.';

    constructor() {
        this.donations = new DonationSummary();
        this.actions = new LobbyActions();
        this.banner = new BannerTemplate(this.donations);
    }

    get donationApiUrl() {
        return this.donations.apiUrl;
    }

    set donationApiUrl(value) {
        this.donations.apiUrl = value;
    }

    get donationGuideUrl() {
        return this.donations.guideUrl;
    }

    set donationGuideUrl(value) {
        this.donations.guideUrl = value;
    }

    get donationListUrl() {
        return this.donations.listUrl;
    }

    set donationListUrl(value) {
        this.donations.listUrl = value;
    }

    get donationGoalKrw() {
        return this.donations.goalKrw;
    }

    set donationGoalKrw(value) {
        this.donations.goalKrw = value;
    }

    get donationSummaryCache() {
        return this.donations.summaryCache;
    }

    set donationSummaryCache(value) {
        this.donations.summaryCache = value;
    }

    get donationSummaryUpdateKey() {
        return this.donations.updateKey;
    }

    set donationSummaryUpdateKey(value) {
        this.donations.updateKey = value;
    }

    get donationLedgerRequest() {
        return this.donations.ledgerRequest;
    }

    set donationLedgerRequest(value) {
        this.donations.ledgerRequest = value;
    }

    openRCLinks() {
        const newWindow = window.open('', '_blank', 'width=600,height=400');
        newWindow.document.open();
        newWindow.document.write(`<!DOCTYPE html><html><head><title>RC Links</title></head><body><pre>${RC_LINKS}</pre></body></html>`);
    }

    openProfilesWithToken(event, next = '/') {
        event?.preventDefault?.();
        this.installProfilesTokenListener();
        const nextPath = this.getSafeProfilesPath(next);

        const loginCookie = DWEM.Modules.WebSocketFactory?.get_login_cookie?.();
        if (!loginCookie) {
            window.open(`${PROFILES_URL}${nextPath}`, '_blank');
            return false;
        }

        const windowName = `cnc_profiles_${Date.now()}`;
        const popup = window.open('', windowName);
        if (!popup) {
            window.open(`${PROFILES_URL}${nextPath}`, '_blank');
            return false;
        }

        const form = document.createElement('form');
        form.method = 'POST';
        form.action = PROFILES_TOKEN_LOGIN_URL;
        form.target = windowName;
        form.style.display = 'none';

        this.appendHiddenField(form, 'token', loginCookie);
        this.appendHiddenField(form, 'openerOrigin', window.location.origin);
        this.appendHiddenField(form, 'next', nextPath);

        document.body.append(form);
        form.submit();
        form.remove();
        return false;
    }

    openUserInfo(event, username) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        const cleanUsername = String(username || '').trim();
        if (cleanUsername) {
            DWEM.Modules.CNCUserinfo?.open?.(cleanUsername, event);
        }
        return false;
    }

    getSafeProfilesPath(value) {
        const path = String(value || '/');
        if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
            return '/';
        }
        return path;
    }

    appendHiddenField(form, name, value) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value;
        form.append(input);
    }

    installProfilesTokenListener() {
        if (this.profilesTokenListenerInstalled) {
            return;
        }

        window.addEventListener('message', (event) => {
            if (event.origin !== PROFILES_URL) {
                return;
            }

            const data = event.data || {};
            if (data.type !== 'cnc-profiles-login-cookie' || !data.cookie) {
                return;
            }

            DWEM.Modules.WebSocketFactory?.set_login_cookie?.({
                cookie: data.cookie,
                expires: data.expires
            });
        });
        this.profilesTokenListenerInstalled = true;
    }

    getRandomColor() {
        return randomChoice(['#ff4000', '#008cc0', '#cad700', '#009800', '#8000ff']);
    }

    colorizeText() {
        const coloredText = document.getElementById('coloredText');
        if (!coloredText) {
            return;
        }

        const words = coloredText.textContent.split(' ');
        this.colors = this.colors || words.map(() => this.getRandomColor());
        const coloredWords = words.map((word, index) => `<span style="color:${this.colors[index]};">${word}</span>`);
        coloredText.innerHTML = coloredWords.join(' ');
    }

    getDonationSummaryHTML(locale = 'ko') {
        return this.donations.getSummaryHTML(locale);
    }

    scheduleDonationSummaryUpdate() {
        return this.donations.scheduleUpdate();
    }

    updateDonationSummary() {
        return this.donations.update();
    }

    getDonationLocale() {
        return getLocale();
    }

    getDonationTexts(locale) {
        return this.donations.getTexts(locale);
    }

    renderDonationSummary(ledger, locale = getLocale()) {
        return this.donations.renderSummary(ledger, locale);
    }

    filterCncDonations(donations) {
        return this.donations.filterCncDonations(donations);
    }

    getTopDonors(donations, locale = getLocale()) {
        return this.donations.getTopDonors(donations, locale);
    }

    getLatestDonation(donations, locale = getLocale()) {
        return this.donations.getLatestDonation(donations, locale);
    }

    renderLatestDonation(donation, locale = getLocale()) {
        return this.donations.renderLatestDonation(donation, locale);
    }

    renderTopDonors(donors, locale = getLocale()) {
        return this.donations.renderTopDonors(donors, locale);
    }

    formatDonationMessagePreview(message) {
        return this.donations.formatMessagePreview(message);
    }

    formatLatestDonationMessage(message) {
        return this.donations.formatLatestMessage(message);
    }

    normalizeDonationMessage(message) {
        return this.donations.normalizeMessage(message);
    }

    getDonationTime(donation) {
        return this.donations.getTime(donation);
    }

    getDonationAmount(donation) {
        return this.donations.getAmount(donation);
    }

    formatKrw(value, locale = getLocale()) {
        return this.donations.formatKrw(value, locale);
    }

    formatDonationGoalPercent(monthlyTotal) {
        return this.donations.formatGoalPercent(monthlyTotal);
    }

    escapeHtml(value) {
        return escapeHtml(value);
    }

    getLatencySocket() {
        return this.actions.getLatencySocket();
    }

    getLatency() {
        return this.actions.getLatency();
    }

    getLobbyList() {
        return this.actions.getLobbyList();
    }

    goSarangbang() {
        return this.actions.goSarangbang();
    }

    enterSarangbang() {
        return this.actions.enterSarangbang();
    }

    toggleSarangbang() {
        return this.actions.toggleSarangbang();
    }

    updateLatencyText(force = false) {
        return this.actions.updateLatencyText(force);
    }

    getTournaments() {
        return this.banner.getTournaments();
    }

    startUpdateTournamentInfo() {
        return this.banner.startUpdateTournamentInfo();
    }

    getTournamentMessage(name, startUTC, endUTC, url) {
        return this.banner.getTournamentMessage(name, startUTC, endUTC, url);
    }

    toggleLatencyIndicator(event) {
        return this.actions.toggleLatencyIndicator(event);
    }

    getKoreanBanner(currentUser) {
        return this.banner.getKoreanBanner(currentUser);
    }

    getEnglishBanner(currentUser) {
        return this.banner.getEnglishBanner(currentUser);
    }

    playWTRec() {
        return this.actions.playWTRec();
    }

    uploadWTRec(event) {
        return this.actions.uploadWTRec(event);
    }

    applyXMasTheme() {
        return applyXMasTheme();
    }

    enhanceWTRecLinks() {
        return this.actions.enhanceWTRecLinks();
    }

    onLoad() {
        const {IOHook, SiteInformation} = DWEM.Modules;
        const refreshDonationSummary = () => this.scheduleDonationSummaryUpdate();

        IOHook.handle_message.before.addHandler('cnc-banner', (data) => {
            if (data.msg === 'html' && data.id === 'banner') {
                const {current_user} = SiteInformation;
                data.content = getLocale() === 'ko'
                    ? this.getKoreanBanner(current_user)
                    : this.getEnglishBanner(current_user);
            }
        });

        IOHook.handle_message.after.addHandler('cnc-banner-wtrec-enhancer', (data) => {
            if (data.msg === 'html' && data.id === 'banner') {
                setTimeout(() => {
                    this.enhanceWTRecLinks();
                    refreshDonationSummary();
                }, 0);
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
            if (lobbySpan) {
                const numberOfPlayers = Object.keys(lobby).length;
                lobbySpan.textContent = `Games currently running (${numberOfPlayers} players):`;
            }
        });

        if (shouldUseXMasTheme()) {
            this.applyXMasTheme();
        }
    }
}
