import { BANNER_DEFINITIONS } from "../domain/banners.js";
import { normalizeUsernameKey } from "../db/profile-db.js";

export class ProfileService {
  constructor({ database }) {
    this.database = database;
  }

  getBanners() {
    return BANNER_DEFINITIONS;
  }

  getPublicProfile(username) {
    return this.database.toPublicProfile(this.database.getProfile(username));
  }

  getMe(username) {
    const profile = this.database.ensureProfile(username);
    return this.database.toPublicProfile(profile);
  }

  async setCurrentBanner(username, bannerId) {
    const profile = this.database.setCurrentBanner(username, bannerId);
    await this.database.write();
    return this.database.toPublicProfile(profile);
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

      profiles.push(this.database.toPublicProfile(profile));
    }

    return {
      generatedAt: new Date().toISOString(),
      profiles,
      missing,
      unchanged
    };
  }
}
