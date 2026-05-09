import {
  createDonatorBanner,
  createTranslatorBanner
} from "../domain/banners.js";
import { normalizeUsernameKey } from "../db/profile-db.js";

const WATCHER_SOURCES = {
  donation: "watcher:donation",
  translation: "watcher:translation"
};

export class WatcherService {
  constructor({ database, config, fetchImpl = fetch }) {
    this.database = database;
    this.config = config;
    this.fetch = fetchImpl;
    this.timer = null;
    this.running = false;
  }

  start() {
    const period = Math.max(5, Number(this.config.watchers?.pullPeriod) || 30);
    this.syncAll().catch((error) => console.error("Initial profile watcher sync failed:", error));
    this.timer = setInterval(() => {
      this.syncAll().catch((error) => console.error("Profile watcher sync failed:", error));
    }, period * 1000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async syncAll() {
    if (this.running) return;
    this.running = true;

    try {
      let changed = false;

      if (this.config.watchers?.donation?.enabled) {
        changed = (await this.syncDonation()) || changed;
      }

      if (this.config.watchers?.translation?.enabled) {
        changed = (await this.syncTranslation()) || changed;
      }

      if (changed) {
        await this.database.write();
      }
    } finally {
      this.running = false;
    }
  }

  async syncDonation() {
    const url = this.config.watchers.donation.url;
    const response = await this.fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`Donation watcher failed: ${response.status}`);
    }

    const payload = await response.json();
    const totals = new Map();

    for (const donation of payload.currentMonth?.donations ?? []) {
      if (donation.type !== "CNC" || !donation.username) continue;

      const key = normalizeUsernameKey(donation.username);
      const current = totals.get(key) ?? {
        username: donation.username,
        amount: 0
      };
      current.amount += Number(donation.amount) || 0;
      current.username = resolveExistingUsername(this.database, donation.username) ?? current.username;
      totals.set(key, current);
    }

    return this.#replaceManagedBanners({
      source: WATCHER_SOURCES.donation,
      bannerId: "donator",
      activeEntries: [...totals.values()].filter((entry) => entry.amount > 0),
      createBanner: (entry) => createDonatorBanner(entry.amount)
    });
  }

  async syncTranslation() {
    const watcherConfig = this.config.watchers.translation;
    const response = await this.fetch(watcherConfig.url, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`Translation watcher failed: ${response.status}`);
    }

    const payload = await response.json();
    const threshold = Number(watcherConfig.threshold) || 500;
    const maxScore = Number(watcherConfig.maxScore) || 5000;
    const activeEntries = [];

    for (const user of payload.users ?? []) {
      const score = (Number(user.created) || 0) + (Number(user.edited) || 0) + (Number(user.deleted) || 0);
      if (score < threshold || !user.username) continue;

      activeEntries.push({
        username: resolveExistingUsername(this.database, user.username) ?? user.username,
        score
      });
    }

    return this.#replaceManagedBanners({
      source: WATCHER_SOURCES.translation,
      bannerId: "translator",
      activeEntries,
      createBanner: (entry) => createTranslatorBanner(entry.score, { threshold, maxScore })
    });
  }

  #replaceManagedBanners({ source, bannerId, activeEntries, createBanner }) {
    let changed = false;
    const activeKeys = new Set(activeEntries.map((entry) => normalizeUsernameKey(entry.username)));

    for (const profile of Object.values(this.database.data.profiles)) {
      if (profile.sources?.[bannerId]?.source === source && !activeKeys.has(normalizeUsernameKey(profile.username))) {
        changed = this.database.removeManagedBanner(profile.username, bannerId, source).changed || changed;
      }
    }

    for (const entry of activeEntries) {
      const banner = createBanner(entry);
      changed = this.database.upsertBanner(entry.username, banner, {
        source,
        autoEquip: true
      }).changed || changed;
    }

    return changed;
  }
}

function resolveExistingUsername(database, username) {
  const profile = database.getProfile(username);
  return profile?.username ?? null;
}
