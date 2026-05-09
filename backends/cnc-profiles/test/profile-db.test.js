import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ProfileDatabase } from "../src/db/profile-db.js";
import {
  NEMELEX_COLORS,
  PSEUDO_CNC_RANKS,
  PSEUDO_DONATOR_AMOUNTS,
  createDonatorBanner,
  getBannerDefinition
} from "../src/domain/banners.js";

test("seeds initial profiles preserving username casing", async () => {
  const database = await createDatabase();

  const profile = database.getProfile("wizardmodephilia");

  assert.equal(profile.username, "WizardModePhilia");
  assert.equal(profile.currentBannerId, "wizard-account");
  assert.deepEqual(profile.banners["wizard-account"].usernameStyle.data.colors, NEMELEX_COLORS);

  const botProfile = database.getProfile("cncpublicchat");
  assert.equal(botProfile.username, "CNCPublicChat");
  assert.equal(botProfile.currentBannerId, "bot");
  assert.equal(botProfile.banners.bot.title, "Bot");
  assert.equal(botProfile.banners.bot.usernameStyle.id, "bot");
  assert.equal(botProfile.banners.bot.usernameStyle.data.prefix, "🤖");

  const adminProfile = database.getProfile("asciiphilia");
  assert.equal(adminProfile.username, "ASCIIPhilia");
  assert.equal(adminProfile.currentBannerId, "bot");
  assert.equal(adminProfile.banners.bot.usernameStyle.id, "bot");
  for (const rank of PSEUDO_CNC_RANKS) {
    const banner = adminProfile.banners[`pseudo-cnc-${rank}`];
    assert.equal(banner.title, getPseudoCncTitle(rank));
    assert.equal(banner.usernameStyle.id, "nemelex");
    assert.equal(banner.usernameStyle.data.split, rank);
    assert.deepEqual(banner.usernameStyle.data.colors, NEMELEX_COLORS);
  }
  for (const [index, amount] of PSEUDO_DONATOR_AMOUNTS.entries()) {
    const banner = adminProfile.banners[`pseudo-donator-${index + 1}`];
    assert.equal(banner.title, `Pseudo Donator ${index + 1} (${amount.toLocaleString("en-US")} KRW)`);
    assert.equal(banner.usernameStyle.id, "donator");
    assert.equal(banner.usernameStyle.data.donation, amount);
  }
});

test("manual none selection blocks auto equip", async () => {
  const database = await createDatabase();

  database.setCurrentBanner("ExampleUser", null);
  database.upsertBanner("ExampleUser", createDonatorBanner(30000), {
    source: "watcher:donation",
    autoEquip: true
  });

  const profile = database.getProfile("exampleuser");
  assert.equal(profile.currentBannerId, null);
  assert.equal(profile.selectionMode, "manual");
  assert.ok(profile.banners.donator);
});

test("updates seed-managed banners when definitions change", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cnc-profiles-"));
  const filePath = path.join(dir, "profiles.json");
  const legacyBanner = getBannerDefinition("wizard-account");
  delete legacyBanner.usernameStyle.data.colors;

  await writeFile(filePath, JSON.stringify({
    schemaVersion: 1,
    profiles: {
      WizardModePhilia: {
        username: "WizardModePhilia",
        banners: {
          [legacyBanner.id]: legacyBanner
        },
        currentBannerId: legacyBanner.id,
        selectionMode: "auto",
        sources: {
          [legacyBanner.id]: {
            source: "seed",
            updatedAt: "2026-01-01T00:00:00.000Z"
          }
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        lastUpdatedAt: "2026-01-01T00:00:00.000Z"
      }
    }
  }));

  const database = new ProfileDatabase(filePath);
  await database.init();

  const profile = database.getProfile("WizardModePhilia");
  assert.deepEqual(profile.banners["wizard-account"].usernameStyle.data.colors, NEMELEX_COLORS);
});

async function createDatabase() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cnc-profiles-"));
  const database = new ProfileDatabase(path.join(dir, "profiles.json"));
  await database.init();
  return database;
}

function getPseudoCncTitle(rank) {
  if (rank === 1) return "Pseudo CNC Champion";
  if (rank === 2) return "Pseudo CNC Runner-up";
  if (rank === 3) return "Pseudo CNC Third Place";
  return `Pseudo CNC Rank ${rank}`;
}
