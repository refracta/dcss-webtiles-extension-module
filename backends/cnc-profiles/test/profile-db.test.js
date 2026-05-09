import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ProfileDatabase } from "../src/db/profile-db.js";
import { createDonatorBanner } from "../src/domain/banners.js";

test("seeds initial profiles preserving username casing", async () => {
  const database = await createDatabase();

  const profile = database.getProfile("wizardmodephilia");

  assert.equal(profile.username, "WizardModePhilia");
  assert.equal(profile.currentBannerId, "wizard-account");

  const botProfile = database.getProfile("cncpublicchat");
  assert.equal(botProfile.username, "CNCPublicChat");
  assert.equal(botProfile.currentBannerId, "bot");
  assert.equal(botProfile.banners.bot.title, "Bot");
  assert.equal(botProfile.banners.bot.usernameStyle.id, "bot");
  assert.equal(botProfile.banners.bot.usernameStyle.data.prefix, "🤖");
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

async function createDatabase() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cnc-profiles-"));
  const database = new ProfileDatabase(path.join(dir, "profiles.json"));
  await database.init();
  return database;
}
