import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ProfileDatabase } from "../src/db/profile-db.js";
import { WatcherService, parseCreditsContributorNames } from "../src/services/watchers.js";

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
  assert.equal(banner.title, "DCSS Contributor");
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
  assert.equal(database.getProfile("Bob").banners.ranking.title, "Trunk Game Ranking #1");
  assert.equal(database.getProfile("Bob").banners.ranking.usernameStyle.data.badge, "👑");
  assert.equal(database.getProfile("Bob").banners.ranking.detail.value, "(Server Ranking #1)");
  assert.equal(database.getProfile("Bob").banners.ranking.detail.subvalue, "Score: 3,000");
  assert.equal(database.getProfile("Carol").banners.ranking.title, "Trunk Game Ranking #3");
  assert.equal(database.getProfile("Carol").banners.ranking.detail.value, "(Server Ranking #2)");
  assert.equal(database.getProfile("Carol").banners.ranking.detail.subvalue, "Score: 2,000");
  assert.equal(database.getProfile("Carol").banners.ranking.usernameStyle.data.badge, "🏆");
  assert.equal(database.getProfile("Alice").banners.ranking.title, "Trunk Game Ranking #4");
  assert.equal(database.getProfile("Alice").banners.ranking.detail.value, "(Server Ranking #3)");

  const offset = database.data.watcherState.logfile.offset;
  logfile += createLogLine("Alice", 4000) + "\n";

  assert.equal(await watcher.syncLogfile(), true);
  assert.equal(requests.at(-1).range, `bytes=${offset}-`);
  assert.equal(database.getProfile("Alice").banners.ranking.title, "Trunk Game Ranking #1");
  assert.equal(database.getProfile("Alice").banners.ranking.usernameStyle.data.badge, "👑");
  assert.equal(database.getProfile("Alice").banners.ranking.detail.subvalue, "Score: 4,000");
  assert.equal(database.getProfile("Bob").banners.ranking.title, "Trunk Game Ranking #2");
  assert.equal(database.getProfile("Bob").banners.ranking.detail.value, "(Server Ranking #2)");
  assert.equal(database.getProfile("Bob").banners.ranking.usernameStyle.data.badge, "🏆");
  assert.equal(database.getProfile("Carol").banners.ranking.title, "Trunk Game Ranking #4");
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
  assert.equal(database.getProfile("TopPlayer").banners.ranking.title, "Trunk Game Ranking #1");
  assert.equal(database.getProfile("TargetPlayer").banners.ranking.title, "Trunk Game Ranking #3");
  assert.equal(database.getProfile("TargetPlayer").banners.ranking.detail.value, "(Server Ranking #2)");
  assert.equal(database.getProfile("TargetPlayer").banners.ranking.detail.subvalue, "Score: 4,000");
  assert.equal(database.getProfile("TargetPlayer").banners.ranking.usernameStyle.data.badge, "🏆");
  assert.equal(database.getProfile("OtherPlayer").banners.ranking.title, "Trunk Game Ranking #4");
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
  assert.equal(database.data.watcherState.logfile.rankingMode, "server-game-v2");
  assert.equal(database.getProfile("Alice").banners.ranking.title, "Trunk Game Ranking #1");
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
  assert.equal(database.getProfile("Alice").banners.ranking.title, "Trunk Game Ranking #1");
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
      logfile: {
        url: "https://example.test/logfile",
        pullPeriod: 300,
        limit: 100,
        ...(overrides.logfile ?? {})
      },
      ...Object.fromEntries(
        Object.entries(overrides).filter(([key]) => key !== "logfile")
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
