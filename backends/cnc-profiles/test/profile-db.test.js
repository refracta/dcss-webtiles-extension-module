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
  PSEUDO_TRANSLATOR_SCORES,
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

  assert.equal(database.getProfile("asciiphilia"), null);

  const exampleProfile = database.getProfile("bannerexamples");
  assert.equal(exampleProfile.username, "BannerExamples");
  assert.equal(exampleProfile.currentBannerId, "bot");
  assert.equal(exampleProfile.banners.bot.usernameStyle.id, "bot");
  for (const rank of PSEUDO_CNC_RANKS) {
    const banner = exampleProfile.banners[`pseudo-cnc-${rank}`];
    assert.equal(banner.title, getPseudoCncTitle(rank));
    assert.equal(banner.usernameStyle.id, "nemelex");
    assert.equal(banner.usernameStyle.data.split, rank);
    assert.deepEqual(banner.usernameStyle.data.colors, NEMELEX_COLORS);
  }
  for (const [index, amount] of PSEUDO_DONATOR_AMOUNTS.entries()) {
    const banner = exampleProfile.banners[`pseudo-donator-${index + 1}`];
    assert.equal(banner.title, `Donator ${index + 1}`);
    assert.deepEqual(banner.detail, {
      label: "This month",
      value: `${amount.toLocaleString("en-US")} KRW`
    });
    assert.equal(banner.usernameStyle.id, "donator");
    assert.equal(banner.usernameStyle.data.donation, amount);
  }
  assert.equal(exampleProfile.banners.translator, undefined);
  for (const score of PSEUDO_TRANSLATOR_SCORES) {
    const banner = exampleProfile.banners[`pseudo-translator-${score}`];
    assert.equal(banner.title, `Translation Contributor (${score.toLocaleString("en-US")})`);
    assert.equal(banner.usernameStyle.id, "translator");
    assert.equal(banner.usernameStyle.data.score, score);
  }
  assert.deepEqual(
    PSEUDO_TRANSLATOR_SCORES.map((score) => exampleProfile.banners[`pseudo-translator-${score}`].usernameStyle.data.intensity),
    [0, 0.5, 1]
  );
  assert.deepEqual(
    [
      exampleProfile.banners["example-ranking-rank-1"].usernameStyle.data.badge,
      exampleProfile.banners["example-ranking-rank-2-3"].usernameStyle.data.badge,
      exampleProfile.banners["example-ranking-rank-4-10"].usernameStyle.data.badge,
      exampleProfile.banners["example-ranking-rank-11-25"].usernameStyle.data.badge,
      exampleProfile.banners["example-ranking-rank-26-50"].usernameStyle.data.badge,
      exampleProfile.banners["example-ranking-rank-51-100"].usernameStyle.data.badge
    ],
    ["👑", "🏆", "🥇", "💎", "🌟", "⭐"]
  );
  assert.deepEqual(
    [
      exampleProfile.banners["example-ranking-rank-1"].title,
      exampleProfile.banners["example-ranking-rank-2-3"].title,
      exampleProfile.banners["example-ranking-rank-4-10"].title,
      exampleProfile.banners["example-ranking-rank-11-25"].title,
      exampleProfile.banners["example-ranking-rank-26-50"].title,
      exampleProfile.banners["example-ranking-rank-51-100"].title
    ],
    [
      "Trunk Game Ranking",
      "Trunk Game Ranking",
      "Trunk Game Ranking",
      "Trunk Game Ranking",
      "Trunk Game Ranking",
      "Trunk Game Ranking"
    ]
  );
  assert.deepEqual(
    [
      exampleProfile.banners["example-ranking-rank-1"].detail.value,
      exampleProfile.banners["example-ranking-rank-2-3"].detail.value,
      exampleProfile.banners["example-ranking-rank-4-10"].detail.value,
      exampleProfile.banners["example-ranking-rank-11-25"].detail.value,
      exampleProfile.banners["example-ranking-rank-26-50"].detail.value,
      exampleProfile.banners["example-ranking-rank-51-100"].detail.value
    ],
    [
      "(Server Ranking #1)",
      "(Server Ranking #2-#3)",
      "(Server Ranking #4-#10)",
      "(Server Ranking #11-#25)",
      "(Server Ranking #26-#50)",
      "(Server Ranking #51-#100)"
    ]
  );
  assert.deepEqual(
    [
      exampleProfile.banners["example-fastest-win-rank-1"].title,
      exampleProfile.banners["example-fastest-win-rank-2-3"].title,
      exampleProfile.banners["example-fastest-win-rank-4-5"].title,
      exampleProfile.banners["example-fastest-win-rank-6-10"].title
    ],
    [
      "Trunk Fastest Wins",
      "Trunk Fastest Wins",
      "Trunk Fastest Wins",
      "Trunk Fastest Wins"
    ]
  );
  assert.deepEqual(
    [
      exampleProfile.banners["example-fastest-win-rank-1"].detail.value,
      exampleProfile.banners["example-fastest-win-rank-2-3"].detail.value,
      exampleProfile.banners["example-fastest-win-rank-4-5"].detail.value,
      exampleProfile.banners["example-fastest-win-rank-6-10"].detail.value
    ],
    [
      "(Server Ranking #1)",
      "(Server Ranking #2-#3)",
      "(Server Ranking #4-#5)",
      "(Server Ranking #6-#10)"
    ]
  );
  assert.deepEqual(
    [
      exampleProfile.banners["example-fastest-win-rank-1"].usernameStyle.data.badge,
      exampleProfile.banners["example-fastest-win-rank-2-3"].usernameStyle.data.badge,
      exampleProfile.banners["example-fastest-win-rank-4-5"].usernameStyle.data.badge,
      exampleProfile.banners["example-fastest-win-rank-6-10"].usernameStyle.data.badge
    ],
    ["⚡", "🚀", "🏎️", "💨"]
  );
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

test("removes obsolete seed-managed banners after moving examples", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cnc-profiles-"));
  const filePath = path.join(dir, "profiles.json");
  const botBanner = getBannerDefinition("bot");

  await writeFile(filePath, JSON.stringify({
    schemaVersion: 1,
    profiles: {
      ASCIIPhilia: {
        username: "ASCIIPhilia",
        banners: {
          bot: botBanner,
          ranking: {
            id: "ranking",
            title: "Trunk Game Ranking #31",
            url: "https://archive.nemelex.cards/meta/crawl-git?file=logfile",
            usernameStyle: { id: "ranking", data: { rank: 31, serverRank: 13, badge: "💎" } }
          }
        },
        currentBannerId: "bot",
        selectionMode: "auto",
        sources: {
          bot: {
            source: "seed",
            updatedAt: "2026-01-01T00:00:00.000Z"
          },
          ranking: {
            source: "watcher:logfile",
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

  const profile = database.getProfile("ASCIIPhilia");
  assert.equal(profile.banners.bot, undefined);
  assert.equal(profile.sources.bot, undefined);
  assert.ok(profile.banners.ranking);
  assert.equal(profile.currentBannerId, null);
});

async function createDatabase() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cnc-profiles-"));
  const database = new ProfileDatabase(path.join(dir, "profiles.json"));
  await database.init();
  return database;
}

function getPseudoCncTitle(rank) {
  if (rank === 1) return "CNC (1st) Champion";
  if (rank === 2) return "CNC (1st) Runner-up";
  if (rank === 3) return "CNC (1st) Third Place";
  return `CNC (1st) Rank ${rank}`;
}
