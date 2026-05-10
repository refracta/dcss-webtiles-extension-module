import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ProfileDatabase } from "../src/db/profile-db.js";
import {
  NEMELEX_COLORS,
  PSEUDO_CNC_RANKS,
  PSEUDO_DONOR_AMOUNTS,
  PSEUDO_TRANSLATOR_SCORES,
  compareBannerByTitle,
  createDonorBanner,
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
  assert.equal(exampleProfile.banners["dcss-contributor"].title, "DCSS Contributor\nfrom CREDITS.txt");
  assert.equal(exampleProfile.banners["dcss-contributor"].url, "https://github.com/crawl/crawl/blob/master/crawl-ref/CREDITS.txt");
  assert.equal(exampleProfile.banners["dcss-contributor"].usernameStyle.id, "dcss-contributor");
  assert.equal(exampleProfile.banners["dcss-contributor"].usernameStyle.data.badge, "🛠️");
  assert.equal(exampleProfile.banners["example-osp-contributor-10"].title, "OSP Contributor (10)");
  assert.equal(exampleProfile.banners["example-osp-contributor-10"].url, "https://github.com/refracta/dcss-webtiles-extension-module/blob/main/modules/sound-support/README.md");
  assert.deepEqual(exampleProfile.banners["example-osp-contributor-10"].usernameStyle, {
    id: "osp-contributor",
    data: { count: 10 }
  });
  assert.equal(exampleProfile.banners["example-latest-tournament-rank-7"].title, "Latest Tournament (v0.34)");
  assert.equal(exampleProfile.banners["example-latest-tournament-rank-7"].url, "https://crawl.develz.org/tournament/0.34/players/bannerexamples.html");
  assert.deepEqual(getBannerDefinition("latest-tournament").detail, {
    value: "#1, Score: 0"
  });
  assert.deepEqual(exampleProfile.banners["example-latest-tournament-rank-7"].detail, {
    value: "#7, Score: 7,654,321",
    subvalue: "Nemelex Xobeh"
  });
  assert.deepEqual(exampleProfile.banners["example-latest-tournament-rank-7"].usernameStyle, {
    id: "latest-tournament",
    data: {
      badge: "🏁",
      version: "0.34",
      rank: 7,
      score: 7654321,
      clan: "Nemelex Xobeh"
    }
  });
  for (const rank of PSEUDO_CNC_RANKS) {
    const banner = exampleProfile.banners[`pseudo-cnc-${rank}`];
    assert.equal(banner.title, getPseudoCncTitle(rank));
    assert.equal(banner.usernameStyle.id, "nemelex");
    assert.equal(banner.usernameStyle.data.split, rank);
    assert.deepEqual(banner.usernameStyle.data.colors, NEMELEX_COLORS);
  }
  for (const [index, amount] of PSEUDO_DONOR_AMOUNTS.entries()) {
    const banner = exampleProfile.banners[`pseudo-donor-${index + 1}`];
    assert.equal(banner.title, `Donor ${index + 1}`);
    assert.deepEqual(banner.detail, {
      label: "This month",
      value: `${amount.toLocaleString("en-US")} KRW`
    });
    assert.equal(banner.usernameStyle.id, "donor");
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
      "Trunk Score Ranking",
      "Trunk Score Ranking",
      "Trunk Score Ranking",
      "Trunk Score Ranking",
      "Trunk Score Ranking",
      "Trunk Score Ranking"
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
      "(CNC Ranking #1)",
      "(CNC Ranking #2-#3)",
      "(CNC Ranking #4-#10)",
      "(CNC Ranking #11-#25)",
      "(CNC Ranking #26-#50)",
      "(CNC Ranking #51-#100)"
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
      "(CNC Ranking #1)",
      "(CNC Ranking #2-#3)",
      "(CNC Ranking #4-#5)",
      "(CNC Ranking #6-#10)"
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
  assert.deepEqual(
    [
      exampleProfile.banners["example-win-streak-2"].detail.value,
      exampleProfile.banners["example-win-streak-5"].detail.value,
      exampleProfile.banners["example-win-streak-10"].detail.value,
      exampleProfile.banners["example-win-streak-50"].detail.value
    ],
    [
      "Best Streak: 2 wins",
      "Best Streak: 5 wins",
      "Best Streak: 10 wins",
      "Best Streak: 50 wins"
    ]
  );
  assert.deepEqual(
    [
      exampleProfile.banners["example-current-win-streak-2"].detail.value,
      exampleProfile.banners["example-current-win-streak-5"].detail.value,
      exampleProfile.banners["example-current-win-streak-10"].detail.value,
      exampleProfile.banners["example-current-win-streak-50"].detail.value
    ],
    [
      "Current Streak: 2 wins",
      "Current Streak: 5 wins",
      "Current Streak: 10 wins",
      "Current Streak: 50 wins"
    ]
  );
  assert.equal(exampleProfile.banners["example-win-streak-1"], undefined);
  assert.deepEqual(
    [
      exampleProfile.banners["example-win-streak-2"].usernameStyle,
      exampleProfile.banners["example-win-streak-5"].usernameStyle,
      exampleProfile.banners["example-win-streak-10"].usernameStyle,
      exampleProfile.banners["example-win-streak-50"].usernameStyle
    ],
    [
      { id: "win-streak", data: { streak: 2 } },
      { id: "win-streak", data: { streak: 5 } },
      { id: "win-streak", data: { streak: 10 } },
      { id: "win-streak", data: { streak: 50 } }
    ]
  );
  assert.deepEqual(
    [
      exampleProfile.banners["example-current-win-streak-2"].usernameStyle,
      exampleProfile.banners["example-current-win-streak-5"].usernameStyle,
      exampleProfile.banners["example-current-win-streak-10"].usernameStyle,
      exampleProfile.banners["example-current-win-streak-50"].usernameStyle
    ],
    [
      { id: "current-win-streak", data: { streak: 2 } },
      { id: "current-win-streak", data: { streak: 5 } },
      { id: "current-win-streak", data: { streak: 10 } },
      { id: "current-win-streak", data: { streak: 50 } }
    ]
  );

  const publicExampleProfile = database.toPublicProfile(exampleProfile);
  assert.deepEqual(
    publicExampleProfile.banners.map((banner) => banner.id),
    [...publicExampleProfile.banners].sort(compareBannerByTitle).map((banner) => banner.id)
  );
});

test("manual none selection blocks auto equip", async () => {
  const database = await createDatabase();

  database.setCurrentBanner("ExampleUser", null);
  database.upsertBanner("ExampleUser", createDonorBanner(30000), {
    source: "watcher:donation",
    autoEquip: true
  });

  const profile = database.getProfile("exampleuser");
  assert.equal(profile.currentBannerId, null);
  assert.equal(profile.selectionMode, "manual");
  assert.ok(profile.banners.donor);
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
            title: "Trunk Score Ranking #31",
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

test("migrates legacy donator banners to donor preserving manual selection", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cnc-profiles-"));
  const filePath = path.join(dir, "profiles.json");

  await writeFile(filePath, JSON.stringify({
    schemaVersion: 1,
    profiles: {
      DonorUser: {
        username: "DonorUser",
        banners: {
          donator: {
            id: "donator",
            title: "Donator",
            url: "https://donation.abstr.net/list",
            detail: {
              label: "This month",
              value: "30,000 KRW"
            },
            usernameStyle: {
              id: "donator",
              data: { donation: 30000 }
            }
          }
        },
        currentBannerId: "donator",
        selectionMode: "manual",
        sources: {
          donator: {
            source: "watcher:donation",
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

  const profile = database.getProfile("DonorUser");
  assert.equal(profile.banners.donator, undefined);
  assert.equal(profile.sources.donator, undefined);
  assert.equal(profile.currentBannerId, "donor");
  assert.equal(profile.selectionMode, "manual");
  assert.equal(profile.banners.donor.title, "Donor");
  assert.equal(profile.banners.donor.usernameStyle.id, "donor");
  assert.equal(profile.banners.donor.usernameStyle.data.donation, 30000);
  assert.equal(profile.sources.donor.source, "watcher:donation");
});

test("migrates legacy latest tournament banner detail text", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cnc-profiles-"));
  const filePath = path.join(dir, "profiles.json");

  await writeFile(filePath, JSON.stringify({
    schemaVersion: 1,
    profiles: {
      TournamentUser: {
        username: "TournamentUser",
        banners: {
          "latest-tournament": {
            id: "latest-tournament",
            title: "Latest Tournament (v0.34)",
            url: "https://crawl.develz.org/tournament/0.34/players/tournamentuser.html",
            detail: {
              value: "#7 Score: 7,654,321",
              subvalue: "Clan: Nemelex Xobeh"
            },
            usernameStyle: {
              id: "latest-tournament",
              data: {
                badge: "🏁",
                version: "0.34",
                rank: 7,
                score: 7654321,
                clan: "Nemelex Xobeh"
              }
            }
          }
        },
        currentBannerId: "latest-tournament",
        selectionMode: "manual",
        sources: {
          "latest-tournament": {
            source: "watcher:tournament",
            updatedAt: "2026-01-01T00:00:00.000Z"
          }
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        lastUpdatedAt: "2026-01-01T00:00:00.000Z"
      },
      NoClanTournamentUser: {
        username: "NoClanTournamentUser",
        banners: {
          "latest-tournament": {
            id: "latest-tournament",
            title: "Latest Tournament (v0.34)",
            url: "https://crawl.develz.org/tournament/0.34/players/noclantournamentuser.html",
            detail: {
              value: "#8 Score: 6,543,210",
              subvalue: "-"
            },
            usernameStyle: {
              id: "latest-tournament",
              data: {
                badge: "🏁",
                version: "0.34",
                rank: 8,
                score: 6543210,
                clan: ""
              }
            }
          }
        },
        currentBannerId: "latest-tournament",
        selectionMode: "manual",
        sources: {
          "latest-tournament": {
            source: "watcher:tournament",
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

  const profile = database.getProfile("TournamentUser");
  assert.equal(profile.currentBannerId, "latest-tournament");
  assert.deepEqual(profile.banners["latest-tournament"].detail, {
    value: "#7, Score: 7,654,321",
    subvalue: "Nemelex Xobeh"
  });
  assert.equal(profile.banners["latest-tournament"].usernameStyle.data.clan, "Nemelex Xobeh");

  const noClanProfile = database.getProfile("NoClanTournamentUser");
  assert.deepEqual(noClanProfile.banners["latest-tournament"].detail, {
    value: "#8, Score: 6,543,210"
  });
  assert.equal(noClanProfile.banners["latest-tournament"].usernameStyle.data.clan, "");
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
