import {
  BANNER_DEFINITIONS,
  getSelfServiceStatusBanner,
  getSelfServiceStatusBanners,
  isSelfServiceStatusBannerId
} from "../domain/banners.js";
import { normalizeUsernameKey } from "../db/profile-db.js";

export class ProfileService {
  constructor({ database }) {
    this.database = database;
  }

  getBanners() {
    return BANNER_DEFINITIONS;
  }

  getPublicProfile(username) {
    return this.#toPublicProfile(this.database.getProfile(username));
  }

  getMe(username) {
    const profile = this.database.ensureProfile(username);
    return this.#toOwnerProfile(profile);
  }

  async setCurrentBanner(username, bannerId) {
    const statusBanner = getSelfServiceStatusBanner(bannerId);
    if (statusBanner) {
      this.database.upsertBanner(username, statusBanner, {
        source: "self-service:status",
        autoEquip: false
      });
    }

    const profile = this.database.setCurrentBanner(username, bannerId);
    await this.database.write();
    return this.#toOwnerProfile(profile);
  }

  getBatchProfiles(requestedProfiles) {
    const profiles = [];
    const missing = [];
    const unchanged = [];
    const seen = new Set();

    for (const item of requestedProfiles) {
      const username = String(item?.username ?? "").trim();
      const key = normalizeUsernameKey(username);
      if (!username || seen.has(key)) continue;
      seen.add(key);

      const profile = this.database.getProfile(username);
      if (!profile) {
        missing.push(username);
        continue;
      }

      if (item.lastUpdatedAt && item.lastUpdatedAt === profile.lastUpdatedAt) {
        unchanged.push(profile.username);
        continue;
      }

      profiles.push(this.#toPublicProfile(profile));
    }

    return {
      generatedAt: new Date().toISOString(),
      profiles,
      missing,
      unchanged
    };
  }

  #toOwnerProfile(profile) {
    const result = this.database.toPublicProfile(profile);
    if (!result) return null;

    const banners = new Map(result.banners.map((banner) => [banner.id, banner]));
    for (const banner of getSelfServiceStatusBanners()) {
      banners.set(banner.id, banner);
    }

    result.banners = [...banners.values()];
    if (isSelfServiceStatusBannerId(result.currentBannerId)) {
      result.currentBanner = banners.get(result.currentBannerId) ?? result.currentBanner;
    }
    return result;
  }

  #toPublicProfile(profile) {
    const result = this.database.toPublicProfile(profile);
    if (!result) return null;

    const currentStatusBanner = getSelfServiceStatusBanner(result.currentBannerId);
    if (currentStatusBanner) {
      result.currentBanner = currentStatusBanner;
      result.banners = result.banners.map((banner) => (
        banner.id === result.currentBannerId ? currentStatusBanner : banner
      ));
    }

    result.banners = result.banners.filter((banner) => (
      !isSelfServiceStatusBannerId(banner.id) || banner.id === result.currentBannerId
    ));
    return result;
  }
}
