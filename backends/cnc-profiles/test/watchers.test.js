import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ProfileDatabase } from "../src/db/profile-db.js";
import {
  WatcherService,
  parseCreditsContributorNames,
  parseLatestTournamentVersion,
  parseOspContributorEntries,
  parseTournamentRankingEntries
} from "../src/services/watchers.js";

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
  const donorBanner = database.getProfile("donoruser").banners.donor;
  assert.equal(donorBanner.title, "Donor");
  assert.deepEqual(donorBanner.detail, {
    label: "This month",
    value: "30,000 KRW"
  });
  assert.equal(donorBanner.usernameStyle.data.donation, 30000);
  assert.equal(database.getProfile("DonorUser").currentBannerId, "donor");

  const emptyWatcher = new WatcherService({
    database,
    config: createConfig(),
    fetchImpl: async () => okJson({ currentMonth: { donations: [] } })
  });
  assert.equal(await emptyWatcher.syncDonation(), true);
  assert.equal(database.getProfile("DonorUser").banners.donor, undefined);
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

test("syncAll continues after a watcher fetch failure and writes later changes", async () => {
  const database = await createDatabase();
  const calls = [];
  const errors = [];
  const originalConsoleError = console.error;

  console.error = (...args) => errors.push(args);
  try {
    const watcher = new WatcherService({
      database,
      config: createConfig({
        donation: {
          enabled: true,
          url: "https://example.test/donation"
        },
        translation: {
          enabled: true,
          url: "https://example.test/translation",
          threshold: 500,
          maxScore: 5000
        }
      }),
      fetchImpl: async (url) => {
        calls.push(url);
        if (url === "https://example.test/donation") {
          throw new Error("donation unavailable");
        }
        return okJson({
          users: [
            { username: "TranslatorUser", created: 500, edited: 0, deleted: 0 }
          ]
        });
      }
    });

    await watcher.syncAll();
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(calls, [
    "https://example.test/donation",
    "https://example.test/translation"
  ]);
  assert.match(String(errors[0]?.[0] ?? ""), /donation watcher sync failed/);
  assert.ok(database.getProfile("TranslatorUser").banners.translator);

  const persisted = JSON.parse(await readFile(database.filePath, "utf8"));
  assert.ok(persisted.profiles.TranslatorUser.banners.translator);
});

test("credits watcher grants DCSS contributor banners from credits text", async () => {
  const database = await createDatabase();
  const credits = [
    "The Dungeon Crawl Stone Soup team would like to thank:",
    "",
    "* Linley Henzell, the author of Dungeon Crawl.",
    "* Darshan Shaligram and Erik Piper, for starting the Stone Soup project.",
    "* Other retired members of the development team:",
    "    ASCIIPhilia (crawl.nemelex.cards)",
    "    Medar, Zkyp (crawl.xtahua.com)",
    "    Vitor 'Baconkid' Costa",
    "    valerie \"ploomutoo\"",
    "    William Tanksley, Jr."
  ].join("\n");
  const watcher = new WatcherService({
    database,
    config: createConfig(),
    fetchImpl: async () => okText(credits)
  });

  assert.deepEqual(parseCreditsContributorNames(credits), [
    "ASCIIPhilia",
    "Baconkid",
    "Darshan Shaligram",
    "Erik Piper",
    "Linley Henzell",
    "Medar",
    "ploomutoo",
    "valerie \"ploomutoo\"",
    "Vitor 'Baconkid' Costa",
    "William Tanksley, Jr.",
    "Zkyp"
  ]);

  assert.equal(await watcher.syncCredits(), true);
  const banner = database.getProfile("ASCIIPhilia").banners["dcss-contributor"];
  assert.equal(banner.title, "DCSS Contributor\nfrom CREDITS.txt");
  assert.equal(banner.url, "https://github.com/crawl/crawl/blob/master/crawl-ref/CREDITS.txt");
  assert.equal(banner.usernameStyle.id, "dcss-contributor");
  assert.equal(banner.usernameStyle.data.badge, "🛠️");
  assert.ok(database.getProfile("Baconkid").banners["dcss-contributor"]);

  const emptyWatcher = new WatcherService({
    database,
    config: createConfig(),
    fetchImpl: async () => okText("")
  });
  assert.equal(await emptyWatcher.syncCredits(), true);
  assert.equal(database.getProfile("ASCIIPhilia").banners["dcss-contributor"], undefined);
});

test("osp watcher grants contributor banners from REGISTER counts", async () => {
  const database = await createDatabase();
  const payload = {
    data: [
      createOspRow("ASCIIPhilia", "sound/hit.mp3", "https://osp.nemelex.cards/uploads/hit.mp3"),
      createOspRow("ASCIIPhilia", "sound/zap.mp3", "https://osp.nemelex.cards/uploads/zap.mp3"),
      createOspRow("SingleContributor", "sound/open.mp3", "https://osp.nemelex.cards/uploads/open.mp3"),
      createOspRow("IgnoredUser", "sound/invalid.mp3", "https://example.test/invalid.mp3"),
      createOspRow("", "sound/empty.mp3", "https://osp.nemelex.cards/uploads/empty.mp3")
    ]
  };
  const watcher = new WatcherService({
    database,
    config: createConfig(),
    fetchImpl: async () => okJson(payload)
  });

  assert.deepEqual(parseOspContributorEntries(payload), [
    { username: "ASCIIPhilia", count: 2 },
    { username: "SingleContributor", count: 1 }
  ]);

  assert.equal(await watcher.syncOsp(), true);
  const banner = database.getProfile("ASCIIPhilia").banners["osp-contributor"];
  assert.equal(banner.title, "OSP Contributor (2)");
  assert.equal(banner.url, "https://github.com/refracta/dcss-webtiles-extension-module/blob/main/modules/sound-support/README.md");
  assert.deepEqual(banner.usernameStyle, { id: "osp-contributor", data: { count: 2 } });
  assert.equal(database.getProfile("SingleContributor").banners["osp-contributor"].title, "OSP Contributor");
  assert.equal(database.getProfile("IgnoredUser"), null);

  const emptyWatcher = new WatcherService({
    database,
    config: createConfig(),
    fetchImpl: async () => okJson({ data: [] })
  });
  assert.equal(await emptyWatcher.syncOsp(), true);
  assert.equal(database.getProfile("ASCIIPhilia").banners["osp-contributor"], undefined);
});

test("tournament watcher grants one latest tournament banner without removing older participation", async () => {
  const database = await createDatabase();
  let version = "0.34";
  const watcher = new WatcherService({
    database,
    config: createConfig(),
    fetchImpl: async (url) => {
      if (url === "https://example.test/tournament-branches") {
        return okJson([
          { name: "0.33-tourney" },
          { name: "0.34-tourney" },
          { name: "0.35-tweaks" },
          { name: `${version}-tourney` }
        ]);
      }
      if (url === `https://example.test/tournament/${version}/all-players-ranks.html`) {
        return okText(createTournamentHtml(version));
      }
      throw new Error(`unexpected url: ${url}`);
    }
  });

  assert.equal(parseLatestTournamentVersion([
    { name: "0.31-tourney" },
    { name: "0.30-tourney" },
    { name: "0.31-tweaks" },
    { name: "0.32-tourney" }
  ]), "0.32");
  assert.deepEqual(parseTournamentRankingEntries(createTournamentHtml("0.34"), {
    pageUrl: "https://example.test/tournament/0.34/all-players-ranks.html",
    playerUrlTemplate: "https://example.test/tournament/{version}/players/{username}.html",
    version: "0.34"
  }), [
    {
      username: "Alice",
      version: "0.34",
      rank: 1,
      score: 125695,
      clan: "Bane of Ogre",
      url: "https://example.test/tournament/0.34/players/alice.html"
    },
    {
      username: "Bob",
      version: "0.34",
      rank: 2,
      score: 116222,
      clan: "",
      url: "https://example.test/tournament/0.34/players/bob.html"
    }
  ]);

  assert.equal(await watcher.syncTournament(), true);
  const aliceBanner = database.getProfile("Alice").banners["latest-tournament"];
  assert.equal(aliceBanner.title, "Latest Tournament (v0.34)");
  assert.equal(aliceBanner.detail.value, "#1, Score: 125,695");
  assert.equal(aliceBanner.detail.subvalue, "Bane of Ogre");
  assert.deepEqual(aliceBanner.usernameStyle, {
    id: "latest-tournament",
    data: {
      badge: "🏁",
      version: "0.34",
      rank: 1,
      score: 125695,
      clan: "Bane of Ogre"
    }
  });
  const bobNoClanBanner = database.getProfile("Bob").banners["latest-tournament"];
  assert.equal(bobNoClanBanner.detail.value, "#2, Score: 116,222");
  assert.equal("subvalue" in bobNoClanBanner.detail, false);

  version = "0.35";
  assert.equal(await watcher.syncTournament(), true);
  assert.equal(database.getProfile("Alice").banners["latest-tournament"].title, "Latest Tournament (v0.34)");
  assert.equal(database.getProfile("Bob").banners["latest-tournament"].title, "Latest Tournament (v0.35)");
  assert.equal(database.getProfile("Bob").banners["latest-tournament"].detail.value, "#1, Score: 130,000");
});

test("logfile watcher ranks best scores from range deltas", async () => {
  const database = await createDatabase();
  let logfile = [
    createLogLine("Alice", 1000),
    createLogLine("Bob", 3000),
    createLogLine("Bob", 2500),
    createLogLine("Carol", 2000)
  ].join("\n") + "\n";
  const requests = [];
  const watcher = new WatcherService({
    database,
    config: createConfig({ logfile: { limit: 3 } }),
    fetchImpl: createLogfileFetch(() => logfile, requests)
  });

  assert.equal(await watcher.syncLogfile(), true);
  assert.equal(database.getProfile("Bob").banners.ranking.title, "Trunk Score Ranking #1");
  assert.equal(database.getProfile("Bob").banners.ranking.usernameStyle.data.badge, "👑");
  assert.equal(database.getProfile("Bob").banners.ranking.detail.value, "(Server Ranking #1)");
  assert.equal(database.getProfile("Bob").banners.ranking.detail.subvalue, "Score: 3,000");
  assert.equal(database.getProfile("Carol").banners.ranking.title, "Trunk Score Ranking #3");
  assert.equal(database.getProfile("Carol").banners.ranking.detail.value, "(Server Ranking #2)");
  assert.equal(database.getProfile("Carol").banners.ranking.detail.subvalue, "Score: 2,000");
  assert.equal(database.getProfile("Carol").banners.ranking.usernameStyle.data.badge, "🏆");
  assert.equal(database.getProfile("Alice").banners.ranking.title, "Trunk Score Ranking #4");
  assert.equal(database.getProfile("Alice").banners.ranking.detail.value, "(Server Ranking #3)");

  const offset = database.data.watcherState.logfile.offset;
  logfile += createLogLine("Alice", 4000) + "\n";

  assert.equal(await watcher.syncLogfile(), true);
  assert.equal(requests.at(-1).range, `bytes=${offset}-`);
  assert.equal(database.getProfile("Alice").banners.ranking.title, "Trunk Score Ranking #1");
  assert.equal(database.getProfile("Alice").banners.ranking.usernameStyle.data.badge, "👑");
  assert.equal(database.getProfile("Alice").banners.ranking.detail.subvalue, "Score: 4,000");
  assert.equal(database.getProfile("Bob").banners.ranking.title, "Trunk Score Ranking #2");
  assert.equal(database.getProfile("Bob").banners.ranking.detail.value, "(Server Ranking #2)");
  assert.equal(database.getProfile("Bob").banners.ranking.usernameStyle.data.badge, "🏆");
  assert.equal(database.getProfile("Carol").banners.ranking.title, "Trunk Score Ranking #4");
  assert.equal(database.getProfile("Carol").banners.ranking.detail.value, "(Server Ranking #3)");
});

test("logfile watcher ranks fastest winning games by real time", async () => {
  const database = await createDatabase();
  const logfile = [
    createLogLine("SlowWinner", 5000, { ktyp: "winning", dur: 8000 }),
    createLogLine("FastWinner", 1000, { ktyp: "winning", dur: 3600 }),
    createLogLine("FastWinner", 900, { ktyp: "winning", dur: 4000 }),
    createLogLine("DeathPlayer", 9999, { dur: 1000 }),
    createLogLine("MiddleWinner", 2000, { ktyp: "winning", dur: 7200 })
  ].join("\n") + "\n";
  const watcher = new WatcherService({
    database,
    config: createConfig({ logfile: { limit: 100, fastestLimit: 2 } }),
    fetchImpl: createLogfileFetch(() => logfile)
  });

  assert.equal(await watcher.syncLogfile(), true);

  const fastBanner = database.getProfile("FastWinner").banners["fastest-win"];
  assert.equal(fastBanner.title, "Trunk Fastest Wins");
  assert.equal(fastBanner.detail.value, "(Server Ranking #1)");
  assert.equal(fastBanner.detail.subvalue, "Time: 1:00:00");
  assert.equal(fastBanner.usernameStyle.id, "fastest-win");
  assert.equal(fastBanner.usernameStyle.data.badge, "⚡");
  assert.equal(fastBanner.usernameStyle.data.durationSeconds, 3600);

  const middleBanner = database.getProfile("MiddleWinner").banners["fastest-win"];
  assert.equal(middleBanner.detail.value, "(Server Ranking #2)");
  assert.equal(middleBanner.detail.subvalue, "Time: 2:00:00");
  assert.equal(middleBanner.usernameStyle.data.badge, "🚀");

  assert.equal(database.getProfile("SlowWinner").banners["fastest-win"], undefined);
  assert.equal(database.getProfile("DeathPlayer").banners["fastest-win"], undefined);
});

test("logfile watcher grants best win streak banners and breaks on non-wins", async () => {
  const database = await createDatabase();
  const logfile = [
    createLogLine("Alice", 1000, { ktyp: "winning" }),
    createLogLine("Alice", 2000, { ktyp: "winning" }),
    createLogLine("Alice", 100, { ktyp: "quitting" }),
    createLogLine("Alice", 3000, { ktyp: "winning" }),
    createLogLine("Bob", 1000, { ktyp: "winning" }),
    createLogLine("Bob", 2000, { ktyp: "winning" }),
    createLogLine("Bob", 3000, { ktyp: "winning" }),
    createLogLine("Carol", 1000, { ktyp: "winning" }),
    createLogLine("Carol", 500, { ktyp: "mon" })
  ].join("\n") + "\n";
  const watcher = new WatcherService({
    database,
    config: createConfig({ logfile: { limit: 100, streakMin: 2 } }),
    fetchImpl: createLogfileFetch(() => logfile)
  });

  assert.equal(await watcher.syncLogfile(), true);

  const aliceBanner = database.getProfile("Alice").banners["win-streak"];
  assert.equal(aliceBanner.title, "Trunk Win Streak");
  assert.equal(aliceBanner.detail.value, "Best Streak: 2 wins");
  assert.deepEqual(aliceBanner.usernameStyle, { id: "win-streak", data: { streak: 2 } });

  const bobBanner = database.getProfile("Bob").banners["win-streak"];
  assert.equal(bobBanner.detail.value, "Best Streak: 3 wins");
  assert.deepEqual(bobBanner.usernameStyle, { id: "win-streak", data: { streak: 3 } });

  assert.equal(database.getProfile("Carol").banners["win-streak"], undefined);
  assert.equal(database.data.watcherState.logfile.streakPlayers.alice.currentStreak, 1);
  assert.equal(database.data.watcherState.logfile.streakPlayers.alice.bestStreak, 2);
  assert.equal(database.data.watcherState.logfile.streakPlayers.bob.currentStreak, 3);
  assert.equal(database.data.watcherState.logfile.streakPlayers.bob.bestStreak, 3);
  assert.equal(database.data.watcherState.logfile.streakPlayers.carol.currentStreak, 0);
  assert.equal(database.data.watcherState.logfile.streakPlayers.carol.bestStreak, 1);
});

test("logfile watcher uses the best game rank for duplicate player entries", async () => {
  const database = await createDatabase();
  const logfile = [
    createLogLine("TopPlayer", 5000),
    createLogLine("TopPlayer", 4500),
    createLogLine("TargetPlayer", 4000),
    createLogLine("OtherPlayer", 3000)
  ].join("\n") + "\n";
  const watcher = new WatcherService({
    database,
    config: createConfig({ logfile: { limit: 4 } }),
    fetchImpl: createLogfileFetch(() => logfile)
  });

  assert.equal(await watcher.syncLogfile(), true);
  assert.equal(database.getProfile("TopPlayer").banners.ranking.title, "Trunk Score Ranking #1");
  assert.equal(database.getProfile("TargetPlayer").banners.ranking.title, "Trunk Score Ranking #3");
  assert.equal(database.getProfile("TargetPlayer").banners.ranking.detail.value, "(Server Ranking #2)");
  assert.equal(database.getProfile("TargetPlayer").banners.ranking.detail.subvalue, "Score: 4,000");
  assert.equal(database.getProfile("TargetPlayer").banners.ranking.usernameStyle.data.badge, "🏆");
  assert.equal(database.getProfile("OtherPlayer").banners.ranking.title, "Trunk Score Ranking #4");
  assert.equal(database.getProfile("OtherPlayer").banners.ranking.detail.value, "(Server Ranking #3)");
});

test("logfile watcher resets old unique-player ranking state", async () => {
  const database = await createDatabase();
  database.data.watcherState.logfile = {
    offset: 999,
    partialLine: "",
    players: {
      alice: { username: "Alice", score: 1000 }
    }
  };
  const logfile = createLogLine("Alice", 1000) + "\n";
  const requests = [];
  const watcher = new WatcherService({
    database,
    config: createConfig({ logfile: { limit: 100 } }),
    fetchImpl: createLogfileFetch(() => logfile, requests)
  });

  assert.equal(await watcher.syncLogfile(), true);
  assert.equal(requests.at(-1).range, "bytes=0-");
  assert.deepEqual(database.data.watcherState.logfile.players, {
    alice: {
      key: "alice",
      username: "Alice",
      score: 1000,
      order: 0
    }
  });
  assert.equal(database.data.watcherState.logfile.rankingMode, "server-game-v3");
  assert.equal(database.getProfile("Alice").banners.ranking.title, "Trunk Score Ranking #1");
});

test("logfile watcher keeps partial lines for the next delta", async () => {
  const database = await createDatabase();
  let logfile = createLogLine("Alice", 1000);
  const watcher = new WatcherService({
    database,
    config: createConfig({ logfile: { limit: 100 } }),
    fetchImpl: createLogfileFetch(() => logfile)
  });

  assert.equal(await watcher.syncLogfile(), true);
  assert.equal(database.getProfile("Alice"), null);
  assert.equal(database.data.watcherState.logfile.partialLine, createLogLine("Alice", 1000));

  logfile += "\n";

  assert.equal(await watcher.syncLogfile(), true);
  assert.equal(database.getProfile("Alice").banners.ranking.title, "Trunk Score Ranking #1");
  assert.equal(database.data.watcherState.logfile.partialLine, "");
});

test("logfile watcher refreshes ranking banner definitions without new bytes", async () => {
  const database = await createDatabase();
  const logfile = createLogLine("Alice", 1000) + "\n";
  const watcher = new WatcherService({
    database,
    config: createConfig({ logfile: { limit: 100 } }),
    fetchImpl: createLogfileFetch(() => logfile)
  });

  assert.equal(await watcher.syncLogfile(), true);
  database.getProfile("Alice").banners.ranking.url = "https://archive.nemelex.cards/meta/crawl-git/logfile";

  assert.equal(await watcher.syncLogfile(), true);
  assert.equal(database.getProfile("Alice").banners.ranking.url, "https://archive.nemelex.cards/meta/crawl-git?file=logfile");
});

function createConfig(overrides = {}) {
  return {
    watchers: {
      donation: { url: "https://example.test/donation" },
      translation: {
        url: "https://example.test/translation",
        threshold: 500,
        maxScore: 5000
      },
      credits: {
        url: "https://example.test/credits",
        pullPeriod: 300
      },
      osp: {
        url: "https://example.test/osp",
        uploadPrefix: "https://osp.nemelex.cards/uploads",
        pullPeriod: 300
      },
      tournament: {
        branchesUrl: "https://example.test/tournament-branches",
        rankingsUrlTemplate: "https://example.test/tournament/{version}/all-players-ranks.html",
        playerUrlTemplate: "https://example.test/tournament/{version}/players/{username}.html",
        pullPeriod: 86400,
        ...(overrides.tournament ?? {})
      },
      logfile: {
        url: "https://example.test/logfile",
        pullPeriod: 300,
        limit: 100,
        ...(overrides.logfile ?? {})
      },
      ...Object.fromEntries(
        Object.entries(overrides).filter(([key]) => !["logfile", "tournament"].includes(key))
      )
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

function okText(payload) {
  return {
    ok: true,
    async text() {
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

function createLogLine(username, score, fields = {}) {
  return [
    "v=0.34-a0",
    `name=${username}`,
    `sc=${score}`,
    "race=Human",
    "cls=Fighter",
    ...Object.entries(fields).map(([key, value]) => `${key}=${value}`)
  ].join(":");
}

function createOspRow(register, pathValue, sound) {
  return {
    REGISTER: register,
    REGEX: "hit",
    PATH: pathValue,
    SOUND: sound,
    RCFILE: "init.txt"
  };
}

function createTournamentHtml(version) {
  const rows = version === "0.35"
    ? [
        createTournamentRow({ rank: 1, username: "Bob", clan: "New Clan", score: "130,000" })
      ]
    : [
        createTournamentRow({ rank: 1, username: "Alice", clan: "Bane of Ogre", score: "125,695" }),
        createTournamentRow({ rank: 2, username: "Bob", clan: "", score: "116,222" })
      ];

  return `
    <table>
      <thead>
        <tr><th>#</th><th>Player</th><th>Clan</th><th>Overall Score</th></tr>
      </thead>
      ${rows.join("\n")}
    </table>
  `;
}

function createTournamentRow({ rank, username, clan, score }) {
  const lowerUsername = username.toLocaleLowerCase("en-US");
  const clanCell = clan
    ? `<a href="https://example.test/clans/${clan.toLocaleLowerCase("en-US").replaceAll(" ", "-")}.html">${clan}</a>`
    : "";
  return `
    <tr>
      <th scope="row">${rank}</th>
      <td><a href="players/${lowerUsername}.html">${username}</a></td>
      <td>${clanCell}</td>
      <th scope="row">${score}</th>
    </tr>
  `;
}

function createLogfileFetch(getLogfile, requests = []) {
  return async (url, options = {}) => {
    const logfile = getLogfile();
    const length = Buffer.byteLength(logfile);

    if (options.method === "HEAD") {
      requests.push({ method: "HEAD" });
      return {
        ok: true,
        status: 200,
        headers: {
          "content-length": String(length)
        }
      };
    }

    const range = options.headers?.Range ?? options.headers?.range ?? "bytes=0-";
    const start = Number(/^bytes=(\d+)-$/.exec(range)?.[1] ?? 0);
    requests.push({ method: "GET", range });

    if (start > length) {
      return {
        ok: false,
        status: 416,
        headers: {}
      };
    }

    return {
      ok: true,
      status: 206,
      headers: {
        "content-range": `bytes ${start}-${Math.max(start, length) - 1}/${length}`
      },
      async text() {
        return logfile.slice(start);
      }
    };
  };
}
