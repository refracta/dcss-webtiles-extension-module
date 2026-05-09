import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import {
  INITIAL_PROFILES,
  PROFILE_SCHEMA_VERSION,
  cloneBanner
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
  }

  async init() {
    await mkdir(path.dirname(this.filePath), { recursive: true });

    this.db = new Low(new JSONFile(this.filePath), createDefaultProfileDatabase());
    await this.db.read();
    this.db.data ??= createDefaultProfileDatabase();
    this.#migrate();
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

    return Object.keys(this.data.profiles).find((key) => normalizeUsernameKey(key) === target) ?? null;
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

      if (profile.currentBannerId && !profile.banners[profile.currentBannerId]) {
        profile.currentBannerId = null;
      }
    }

    this.db.data.schemaVersion = PROFILE_SCHEMA_VERSION;
  }

  #seedInitialProfiles() {
    const now = new Date();

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
}

export function normalizeUsername(value) {
  return String(value ?? "").trim();
}

export function normalizeUsernameKey(value) {
  return normalizeUsername(value).toLocaleLowerCase("en-US");
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
