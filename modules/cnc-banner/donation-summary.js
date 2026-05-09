import {escapeHtml, getLocale} from './utils.js';

const DEFAULT_DONATION_API_URL = 'https://donation.abstr.net/api/donation';
const DEFAULT_DONATION_GUIDE_URL = 'https://donation.abstr.net?type=CNC';
const DEFAULT_DONATION_LIST_URL = 'https://donation.abstr.net/list';
const DEFAULT_DONATION_GOAL_KRW = 120000;

const DONATION_SUMMARY_STYLE = `
    #banner .cnc-donation-summary {
        width: min(980px, calc(100% - 10px));
        box-sizing: border-box;
        margin: 0 0 12px 0;
        padding: 9px 11px;
        border: 1px solid rgba(117, 183, 106, 0.55);
        border-left: 3px solid #75b76a;
        border-radius: 6px;
        background: rgba(9, 16, 12, 0.88);
        color: #dcebd7;
        font-size: 13px;
        line-height: 1.45;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
    }
    #banner .cnc-donation-summary a {
        color: #f4d700 !important;
        text-decoration: none;
    }
    #banner .cnc-donation-summary a:hover {
        color: #ffffff !important;
        text-shadow: 0 0 4px rgba(244, 215, 0, 0.5);
    }
    #banner .cnc-donation-profile-link {
        cursor: pointer;
    }
    #banner .cnc-donation-profile-link > [data-cnc-profile-username] {
        color: #ffffff;
        text-shadow: none;
    }
    #banner .cnc-donation-line,
    #banner .cnc-donation-rank,
    #banner .cnc-donation-last {
        margin: 2px 0;
    }
    #banner .cnc-donation-goal,
    #banner .cnc-donation-name {
        color: #ffffff;
        font-weight: 600;
    }
    #banner .cnc-donation-rank-title {
        color: #9fd896;
        font-weight: 600;
    }
    #banner .cnc-donation-last-label {
        color: #9fd896;
        font-weight: 600;
    }
    #banner .cnc-donation-more {
        margin-left: 4px;
        white-space: nowrap;
    }
    #banner .cnc-donation-thanks {
        margin-top: 5px;
        color: #b9cbb5;
    }
    #banner .cnc-donation-loading,
    #banner .cnc-donation-empty {
        color: #aebdae;
    }
    #banner .cnc-donation-error {
        color: #ffb3a7;
    }
`;

export default class DonationSummary {
    apiUrl = DEFAULT_DONATION_API_URL;
    guideUrl = DEFAULT_DONATION_GUIDE_URL;
    listUrl = DEFAULT_DONATION_LIST_URL;
    goalKrw = DEFAULT_DONATION_GOAL_KRW;
    summaryCache = {};
    updateKey = null;
    ledgerRequest = null;

    getSummaryHTML(locale = 'ko') {
        const texts = this.getTexts(locale);
        const content = this.summaryCache[locale] || `<div class="cnc-donation-loading">${texts.loading}</div>`;
        return `
        <style>${DONATION_SUMMARY_STYLE}</style>
        <div id="cnc-donation-summary" class="cnc-donation-summary" data-donation-locale="${locale}" aria-live="polite">
            ${content}
        </div>
        `;
    }

    scheduleUpdate() {
        clearTimeout(this.updateKey);
        this.updateKey = setTimeout(() => this.update(), 120);
    }

    async update() {
        const container = document.getElementById('cnc-donation-summary');
        if (!container) {
            return;
        }

        try {
            this.ledgerRequest = this.ledgerRequest || fetch(this.apiUrl, {cache: 'no-store'})
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`Donation API returned ${response.status}`);
                    }
                    return response.json();
                })
                .finally(() => {
                    this.ledgerRequest = null;
                });
            const ledger = await this.ledgerRequest;
            const locale = container.dataset.donationLocale || getLocale();
            await this.preloadVisibleDonatorProfiles(ledger, locale);
            const html = this.renderSummary(ledger, locale);
            this.setHTML(locale, html);
        } catch (error) {
            const locale = container.dataset.donationLocale || getLocale();
            const texts = this.getTexts(locale);
            console.error('Failed to update CNC donation summary.', error);
            const html = `
                <div class="cnc-donation-error">
                    ${texts.error}
                    <a href="${this.listUrl}" target="_blank" rel="noopener">${texts.listLink}</a>${texts.errorSuffix}
                </div>
            `;
            this.setHTML(locale, html);
        }
    }

    setHTML(locale, html) {
        this.summaryCache[locale] = html;
        for (const container of document.querySelectorAll('#cnc-donation-summary')) {
            const containerLocale = container.dataset.donationLocale || getLocale();
            if (containerLocale === locale) {
                container.innerHTML = html;
            }
        }
    }

    renderSummary(ledger, locale = getLocale()) {
        const texts = this.getTexts(locale);
        const currentMonthDonations = this.filterCncDonations(ledger?.currentMonth?.donations);
        const overallDonations = this.filterCncDonations(ledger?.overall?.donations);
        const monthlyTotal = currentMonthDonations.reduce((sum, donation) => sum + this.getAmount(donation), 0);
        const monthlyTop = this.getTopDonators(currentMonthDonations, locale);
        const overallTop = this.getTopDonators(overallDonations, locale);
        const latestDonation = this.getLatestDonation(overallDonations, locale);

        return `
            <div class="cnc-donation-line">
                ${texts.supportPrefix}<a href="${this.guideUrl}" target="_blank" rel="noopener">${texts.supportLink}</a>${texts.supportSuffix}
                <span class="cnc-donation-goal">(${texts.goalLabel}: ${this.formatKrw(monthlyTotal, locale)} / ${this.formatKrw(this.goalKrw, locale)}, ${this.formatGoalPercent(monthlyTotal)})</span>
            </div>
            <div class="cnc-donation-rank">
                <span class="cnc-donation-rank-title">${texts.monthlyTopLabel}:</span>
                ${this.renderTopDonators(monthlyTop, locale)}
            </div>
            <div class="cnc-donation-rank">
                <span class="cnc-donation-rank-title">${texts.overallTopLabel}:</span>
                ${this.renderTopDonators(overallTop, locale)}
            </div>
            ${this.renderLatestDonation(latestDonation, locale)}
            <div class="cnc-donation-thanks">
                ${texts.thanks}
                <a class="cnc-donation-more" href="${this.listUrl}" target="_blank" rel="noopener">${texts.moreLink}</a>
            </div>
        `;
    }

    getTexts(locale) {
        if (locale === 'ko') {
            return {
                loading: '후원 정보를 불러오는 중...',
                error: '후원 정보를 불러오지 못했습니다.',
                listLink: '후원 목록',
                errorSuffix: '에서 확인해주세요.',
                supportPrefix: '서버 운영과 오픈소스 개발을 계속 이어갈 수 있도록 ',
                supportLink: '후원',
                supportSuffix: '해주세요.',
                goalLabel: '월간 후원 목표',
                monthlyTopLabel: 'Top 5 (월간)',
                overallTopLabel: 'Top 5 (누적)',
                latestLabel: 'Last',
                empty: '아직 후원 내역이 없습니다.',
                anonymous: '익명',
                thanks: '후원해주신 분들께 감사드립니다. 목록은 매달 1일에 갱신됩니다.',
                moreLink: '(목록 더보기)'
            };
        }

        return {
            loading: 'Loading donation information...',
            error: 'Could not load donation information.',
            listLink: 'donation list',
            errorSuffix: '.',
            supportPrefix: 'Please ',
            supportLink: 'support',
            supportSuffix: ' continued server operations and open-source development.',
            goalLabel: 'monthly donation goal amount',
            monthlyTopLabel: 'Top 5 (monthly)',
            overallTopLabel: 'Top 5 (all time)',
            latestLabel: 'Last',
            empty: 'No donations yet.',
            anonymous: 'Anonymous',
            thanks: 'Thank you to everyone who donated. The list is refreshed on the first day of each month.',
            moreLink: '(view full list)'
        };
    }

    filterCncDonations(donations) {
        return Array.isArray(donations) ? donations.filter(donation => donation?.type === 'CNC') : [];
    }

    getTopDonators(donations, locale = getLocale()) {
        const texts = this.getTexts(locale);
        const totals = new Map();
        for (let index = 0; index < donations.length; index++) {
            const donation = donations[index];
            const username = String(donation?.username || texts.anonymous).trim() || texts.anonymous;
            const amount = this.getAmount(donation);
            const message = String(donation?.donationMessage || '').trim();
            const donationTime = this.getTime(donation);
            const current = totals.get(username) || {
                username,
                amount: 0,
                lastDonationMessage: '',
                lastDonationTime: Number.NEGATIVE_INFINITY,
                lastDonationIndex: -1
            };

            current.amount += amount;
            if (donationTime > current.lastDonationTime || (donationTime === current.lastDonationTime && index > current.lastDonationIndex)) {
                current.lastDonationMessage = message;
                current.lastDonationTime = donationTime;
                current.lastDonationIndex = index;
            }
            totals.set(username, current);
        }

        return [...totals.values()]
            .sort((a, b) =>
                b.amount - a.amount ||
                b.lastDonationTime - a.lastDonationTime ||
                a.username.localeCompare(b.username)
            )
            .slice(0, 5);
    }

    getLatestDonation(donations, locale = getLocale()) {
        const texts = this.getTexts(locale);
        let latest = null;

        for (let index = 0; index < donations.length; index++) {
            const donation = donations[index];
            const donationTime = this.getTime(donation);
            if (!latest || donationTime > latest.donationTime || (donationTime === latest.donationTime && index > latest.index)) {
                latest = {
                    username: String(donation?.username || texts.anonymous).trim() || texts.anonymous,
                    amount: this.getAmount(donation),
                    message: String(donation?.donationMessage || '').trim(),
                    donationTime,
                    index
                };
            }
        }

        return latest;
    }

    renderLatestDonation(donation, locale = getLocale()) {
        if (!donation) {
            return '';
        }

        const texts = this.getTexts(locale);
        const message = this.formatLatestMessage(donation.message);
        return `
            <div class="cnc-donation-last">
                <span class="cnc-donation-last-label">${texts.latestLabel}:</span>
                <span class="cnc-donation-name">${this.renderDonatorUsername(donation.username, locale)}</span>
                (${this.formatKrw(donation.amount, locale)})${message}
            </div>
        `;
    }

    renderTopDonators(donators, locale = getLocale()) {
        const texts = this.getTexts(locale);
        if (!donators.length) {
            return `<span class="cnc-donation-empty">${texts.empty}</span>`;
        }

        return donators
            .map(donator => {
                const message = this.formatMessagePreview(donator.lastDonationMessage);
                return `<span class="cnc-donation-name">${this.renderDonatorUsername(donator.username, locale)}${message}</span> - ${this.formatKrw(donator.amount, locale)}`;
            })
            .join(', ');
    }

    renderDonatorUsername(username, locale = getLocale()) {
        const texts = this.getTexts(locale);
        const normalized = String(username || texts.anonymous).trim() || texts.anonymous;
        if (normalized === texts.anonymous) {
            return escapeHtml(normalized);
        }

        const userinfo = this.getUserinfoModule();
        const renderedUsername = userinfo?.applyStyledUsername
            ? userinfo.applyStyledUsername(normalized)
            : escapeHtml(normalized);

        if (userinfo?.open) {
            return `<a class="cnc-donation-profile-link" href="javascript:void(0);" onclick="DWEM.Modules.CNCUserinfo.open(${escapeHtml(JSON.stringify(normalized))}, event); return false;">${renderedUsername}</a>`;
        }

        return renderedUsername;
    }

    getUserinfoModule() {
        return globalThis.DWEM?.Modules?.CNCUserinfo;
    }

    async preloadVisibleDonatorProfiles(ledger, locale = getLocale()) {
        const userinfo = this.getUserinfoModule();
        if (!userinfo?.preloadProfiles) {
            return;
        }

        const usernames = this.getVisibleDonatorUsernames(ledger, locale);
        if (!usernames.length) {
            return;
        }

        await userinfo.preloadProfiles(usernames);
    }

    getVisibleDonatorUsernames(ledger, locale = getLocale()) {
        const currentMonthDonations = this.filterCncDonations(ledger?.currentMonth?.donations);
        const overallDonations = this.filterCncDonations(ledger?.overall?.donations);
        const latestDonation = this.getLatestDonation(overallDonations, locale);
        const usernames = [
            ...this.getTopDonators(currentMonthDonations, locale).map(donator => donator.username),
            ...this.getTopDonators(overallDonations, locale).map(donator => donator.username),
            latestDonation?.username
        ];

        return [...new Set(usernames
            .map(username => String(username || '').trim())
            .filter(Boolean)
        )];
    }

    formatMessagePreview(message) {
        return this.formatMessage(message, 10, preview => ` (${preview})`);
    }

    formatLatestMessage(message) {
        return this.formatMessage(message, 200, preview => ` - ${preview}`);
    }

    formatMessage(message, previewLength, render) {
        if (!message) {
            return '';
        }

        const normalized = this.normalizeMessage(message);
        if (!normalized) {
            return '';
        }

        const preview = normalized.length > previewLength
            ? `${normalized.slice(0, previewLength)}...`
            : normalized;
        return render(escapeHtml(preview));
    }

    normalizeMessage(message) {
        return String(message)
            .replace(/\\n/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    getTime(donation) {
        const time = Date.parse(donation?.datetimeISO || donation?.datetimeRaw || donation?.date || '');
        return Number.isFinite(time) ? time : 0;
    }

    getAmount(donation) {
        const amount = Number(donation?.amount);
        return Number.isFinite(amount) ? amount : 0;
    }

    formatKrw(value, locale = getLocale()) {
        const amount = Math.max(0, Number(value) || 0).toLocaleString('ko-KR');
        return locale === 'ko' ? `${amount}원` : `KRW ${amount}`;
    }

    formatGoalPercent(monthlyTotal) {
        if (!this.goalKrw) {
            return '0.0%';
        }

        return `${(Math.max(0, Number(monthlyTotal) || 0) / this.goalKrw * 100).toFixed(1)}%`;
    }
}
