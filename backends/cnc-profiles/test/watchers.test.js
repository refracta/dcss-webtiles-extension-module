import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ProfileDatabase } from "../src/db/profile-db.js";
import { WatcherService } from "../src/services/watchers.js";

test("donation watcher creates and removes conditional donor banners", async () => {
  const database = await createDatabase();
  const watcher = new WatcherService({
    database,
    config: createConfig(),
    fetchImpl: async () => okJson({
      currentMonth: {
        donations: [
          { type: "CNC", username: "DonorUser", amount: 10000 },
          { type: "CNC", username: "DonorUser", amount: 20000 }
        ]
      }
    })
  });

  assert.equal(await watcher.syncDonation(), true);
  const donorBanner = database.getProfile("donoruser").banners.donator;
  assert.equal(donorBanner.title, "Donator");
  assert.deepEqual(donorBanner.detail, {
    label: "This month",
    value: "30,000 KRW"
  });
  assert.equal(donorBanner.usernameStyle.data.donation, 30000);
  assert.equal(database.getProfile("DonorUser").currentBannerId, "donator");

  const emptyWatcher = new WatcherService({
    database,
    config: createConfig(),
    fetchImpl: async () => okJson({ currentMonth: { donations: [] } })
  });
  assert.equal(await emptyWatcher.syncDonation(), true);
  assert.equal(database.getProfile("DonorUser").banners.donator, undefined);
  assert.equal(database.getProfile("DonorUser").currentBannerId, null);
});

test("translation watcher grants threshold banner", async () => {
  const database = await createDatabase();
  const watcher = new WatcherService({
    database,
    config: createConfig(),
    fetchImpl: async () => okJson({
      users: [
        { username: "TranslatorUser", created: 250, edited: 250, deleted: 1 },
        { username: "SmallUser", created: 10, edited: 10, deleted: 10 }
      ]
    })
  });

  assert.equal(await watcher.syncTranslation(), true);
  assert.ok(database.getProfile("TranslatorUser").banners.translator);
  assert.equal(database.getProfile("SmallUser"), null);
});

function createConfig() {
  return {
    watchers: {
      donation: { url: "https://example.test/donation" },
      translation: {
        url: "https://example.test/translation",
        threshold: 500,
        maxScore: 5000
      }
    }
  };
}

function okJson(payload) {
  return {
    ok: true,
    async json() {
      return payload;
    }
  };
}

async function createDatabase() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cnc-profiles-"));
  const database = new ProfileDatabase(path.join(dir, "profiles.json"));
  await database.init();
  return database;
}
