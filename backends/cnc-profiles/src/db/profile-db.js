import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import {
  INITIAL_PROFILES,
  PROFILE_SCHEMA_VERSION,
  cloneBanner,
  compareBannerByTitle
} from "../domain/banners.js";

export function createDefaultProfileDatabase() {
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    profiles: {},
    watcherState: {}
  };
}

export class ProfileDatabase {
  constructor(filePath) {
    this.filePath = filePath;
    this.db = null;
    this.profileKeyIndex = new Map();
    this.profileKeyIndexReady = false;
  }

  async init() {
    await mkdir(path.dirname(this.filePath), { recursive: true });

    this.db = new Low(new JSONFile(this.filePath), createDefaultProfileDatabase());
    await this.db.read();
    this.db.data ??= createDefaultProfileDatabase();
    this.#migrate();
    this.#rebuildProfileKeyIndex();
    this.#seedInitialProfiles();
    await this.write();
  }

  get data() {
    if (!this.db) {
      throw new Error("ProfileDatabase is not initialized");
    }

    return this.db.data;
  }

  async write() {
    if (!this.db) {
      throw new Error("ProfileDatabase is not initialized");
    }

    await this.db.write();
  }

  findProfileKey(username) {
    const target = normalizeUsernameKey(username);
    if (!target) return null;

    if (!this.profileKeyIndexReady) {
      this.#rebuildProfileKeyIndex();
    }

    const cachedKey = this.profileKeyIndex.get(target);
    if (cachedKey && this.data.profiles[cachedKey]) {
      return cachedKey;
    }

    if (cachedKey) {
      this.profileKeyIndex.delete(target);
    }
    return null;
  }

  getProfile(username) {
    const key = this.findProfileKey(username);
    return key ? this.data.profiles[key] : null;
  }

  ensureProfile(username, now = new Date()) {
    const cleanUsername = normalizeUsername(username);
    if (!cleanUsername) {
      const error = new Error("username is required");
      error.statusCode = 400;
      throw error;
    }

    const existingKey = this.findProfileKey(cleanUsername);
    if (existingKey) {
      const profile = this.data.profiles[existingKey];
      if (profile.username !== cleanUsername) {
        profile.username = cleanUsername;
        this.#rememberProfileKey(existingKey, cleanUsername);
        this.touchProfile(profile, now);
      }
      return profile;
    }

    const profile = {
      username: cleanUsername,
      banners: {},
      currentBannerId: null,
      selectionMode: "auto",
      sources: {},
      createdAt: now.toISOString(),
      lastUpdatedAt: now.toISOString()
    };
    this.data.profiles[cleanUsername] = profile;
    this.#rememberProfileKey(cleanUsername, cleanUsername);
    return profile;
  }

  upsertBanner(username, banner, { source = "manual", autoEquip = true, now = new Date() } = {}) {
    const profile = this.ensureProfile(username, now);
    const previous = profile.banners[banner.id];
    const next = cloneBanner(banner);
    let changed = JSON.stringify(previous) !== JSON.stringify(next);

    profile.banners[banner.id] = next;
    profile.sources[banner.id] = {
      source,
      updatedAt: now.toISOString()
    };

    if (autoEquip && profile.selectionMode === "auto" && !profile.currentBannerId) {
      profile.currentBannerId = banner.id;
      changed = true;
    }

    if (changed) {
      this.touchProfile(profile, now);
    }

    return { profile, changed };
  }

  removeManagedBanner(username, bannerId, source, now = new Date()) {
    const profile = this.getProfile(username);
    if (!profile || !profile.banners[bannerId]) {
      return { profile, changed: false };
    }

    if (source && profile.sources[bannerId]?.source !== source) {
      return { profile, changed: false };
    }

    delete profile.banners[bannerId];
    delete profile.sources[bannerId];

    if (profile.currentBannerId === bannerId) {
      profile.currentBannerId = null;
    }

    this.touchProfile(profile, now);
    return { profile, changed: true };
  }

  setCurrentBanner(username, bannerId, now = new Date()) {
    const profile = this.ensureProfile(username, now);

    if (bannerId !== null && !profile.banners[bannerId]) {
      const error = new Error("banner is not owned by this profile");
      error.statusCode = 400;
      throw error;
    }

    if (profile.currentBannerId !== bannerId || profile.selectionMode !== "manual") {
      profile.currentBannerId = bannerId;
      profile.selectionMode = "manual";
      this.touchProfile(profile, now);
    }

    return profile;
  }

  touchProfile(profile, now = new Date()) {
    profile.lastUpdatedAt = now.toISOString();
  }

  toPublicProfile(profile) {
    if (!profile) return null;

    const banners = Object.values(profile.banners ?? {}).map(cloneBanner);
    if (normalizeUsernameKey(profile.username) === "bannerexamples") {
      banners.sort(compareBannerByTitle);
    }
    const currentBanner = profile.currentBannerId
      ? cloneBanner(profile.banners?.[profile.currentBannerId] ?? null)
      : null;

    return {
      username: profile.username,
      banners,
      currentBannerId: profile.currentBannerId ?? null,
      currentBanner,
      selectionMode: profile.selectionMode ?? "auto",
      lastUpdatedAt: profile.lastUpdatedAt
    };
  }

  #migrate() {
    const now = new Date();
    this.db.data.schemaVersion ??= PROFILE_SCHEMA_VERSION;
    this.db.data.profiles ??= {};
    this.db.data.watcherState ??= {};

    for (const [key, profile] of Object.entries(this.db.data.profiles)) {
      profile.username = normalizeUsername(profile.username || key);
      profile.banners = normalizeBanners(profile.banners);
      profile.currentBannerId ??= null;
      profile.selectionMode = profile.selectionMode === "manual" ? "manual" : "auto";
      profile.sources ??= {};
      profile.createdAt ??= new Date().toISOString();
      profile.lastUpdatedAt ??= profile.createdAt;
      const donorMigrated = migrateLegacyDonorBanner(profile);

      if (profile.currentBannerId && !profile.banners[profile.currentBannerId]) {
        profile.currentBannerId = null;
      }

      if (donorMigrated) {
        this.touchProfile(profile, now);
      }
    }

    this.db.data.schemaVersion = PROFILE_SCHEMA_VERSION;
  }

  #rebuildProfileKeyIndex() {
    this.profileKeyIndex.clear();
    for (const [key, profile] of Object.entries(this.data.profiles ?? {})) {
      this.#rememberProfileKey(key, profile?.username || key);
    }
    this.profileKeyIndexReady = true;
  }

  #rememberProfileKey(profileKey, username) {
    const normalizedProfileKey = normalizeUsernameKey(profileKey);
    if (normalizedProfileKey) {
      this.profileKeyIndex.set(normalizedProfileKey, profileKey);
    }

    const normalizedUsername = normalizeUsernameKey(username);
    if (normalizedUsername) {
      this.profileKeyIndex.set(normalizedUsername, profileKey);
    }
  }

  #seedInitialProfiles() {
    const now = new Date();
    const seedKeys = new Set(
      INITIAL_PROFILES
        .filter((seed) => seed.banner)
        .map((seed) => getSeedKey(seed.username, seed.banner.id))
    );

    this.#pruneObsoleteSeedBanners(seedKeys, now);

    for (const seed of INITIAL_PROFILES) {
      if (!seed.banner) continue;

      const profile = this.ensureProfile(seed.username, now);
      const bannerId = seed.banner.id;
      const nextBanner = cloneBanner(seed.banner);
      const previousBanner = profile.banners[bannerId];
      const source = profile.sources[bannerId]?.source;
      let changed = false;

      if (!previousBanner || !source || source === "seed") {
        if (JSON.stringify(previousBanner) !== JSON.stringify(nextBanner) || source !== "seed") {
          profile.banners[bannerId] = nextBanner;
          profile.sources[bannerId] = {
            source: "seed",
            updatedAt: now.toISOString()
          };
          changed = true;
        }
      }

      profile.selectionMode = profile.selectionMode ?? "auto";
      if (!profile.currentBannerId && profile.selectionMode !== "manual") {
        profile.currentBannerId = bannerId;
        changed = true;
      }

      if (changed) {
        this.touchProfile(profile, now);
      }
    }
  }

  #pruneObsoleteSeedBanners(seedKeys, now) {
    for (const profile of Object.values(this.data.profiles)) {
      let changed = false;

      for (const [bannerId, source] of Object.entries(profile.sources ?? {})) {
        if (source?.source !== "seed" || seedKeys.has(getSeedKey(profile.username, bannerId))) {
          continue;
        }

        delete profile.banners[bannerId];
        delete profile.sources[bannerId];
        if (profile.currentBannerId === bannerId) {
          profile.currentBannerId = null;
        }
        changed = true;
      }

      if (changed) {
        this.touchProfile(profile, now);
      }
    }
  }
}

export function normalizeUsername(value) {
  return String(value ?? "").trim();
}

export function normalizeUsernameKey(value) {
  return normalizeUsername(value).toLocaleLowerCase("en-US");
}

function getSeedKey(username, bannerId) {
  return `${normalizeUsernameKey(username)}\0${bannerId}`;
}

function normalizeBanners(value) {
  if (Array.isArray(value)) {
    return Object.fromEntries(
      value
        .filter((banner) => banner?.id)
        .map((banner) => [banner.id, cloneBanner(banner)])
    );
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, banner]) => banner?.id)
        .map(([id, banner]) => [id, { ...cloneBanner(banner), id: banner.id ?? id }])
    );
  }

  return {};
}

function migrateLegacyDonorBanner(profile) {
  let changed = false;

  for (const [bannerId, banner] of Object.entries(profile.banners ?? {})) {
    const migrated = migrateLegacyDonorBannerFields(banner);
    if (JSON.stringify(migrated) !== JSON.stringify(banner)) {
      profile.banners[bannerId] = migrated;
      changed = true;
    }
  }

  if (profile.banners.donator) {
    const donorBanner = migrateLegacyDonorBannerFields(profile.banners.donor ?? profile.banners.donator);
    donorBanner.id = "donor";
    profile.banners.donor = donorBanner;
    delete profile.banners.donator;
    changed = true;
  }

  if (profile.sources?.donator) {
    profile.sources.donor ??= profile.sources.donator;
    delete profile.sources.donator;
    changed = true;
  }

  if (profile.currentBannerId === "donator") {
    profile.currentBannerId = profile.banners.donor ? "donor" : null;
    changed = true;
  }

  return changed;
}

function migrateLegacyDonorBannerFields(banner) {
  const next = cloneBanner(banner);

  if (next.id === "donator") {
    next.id = "donor";
  }
  if (typeof next.title === "string") {
    next.title = next.title.replaceAll("Donator", "Donor");
  }
  if (next.usernameStyle?.id === "donator") {
    next.usernameStyle = {
      ...next.usernameStyle,
      id: "donor"
    };
  }

  return next;
}
