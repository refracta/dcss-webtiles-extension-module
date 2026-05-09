import {
  createDonatorBanner,
  createFastestWinBanner,
  createRankingBanner,
  createTranslatorBanner
} from "../domain/banners.js";
import { normalizeUsernameKey } from "../db/profile-db.js";

const WATCHER_SOURCES = {
  donation: "watcher:donation",
  logfile: "watcher:logfile",
  translation: "watcher:translation"
};

const LOGFILE_RANKING_MODE = "server-game-v2";

export class WatcherService {
  constructor({ database, config, fetchImpl = fetch }) {
    this.database = database;
    this.config = config;
    this.fetch = fetchImpl;
    this.timer = null;
    this.running = false;
    this.lastWatcherRuns = new Map();
  }

  start() {
    const period = Math.max(5, Number(this.config.watchers?.pullPeriod) || 30);
    this.syncAll().catch((error) => console.error("Initial profile watcher sync failed:", error));
    this.timer = setInterval(() => {
      this.syncAll().catch((error) => console.error("Profile watcher sync failed:", error));
    }, period * 1000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async syncAll() {
    if (this.running) return;
    this.running = true;

    try {
      let changed = false;

      if (this.config.watchers?.donation?.enabled) {
        changed = (await this.syncDonation()) || changed;
      }

      if (this.config.watchers?.translation?.enabled) {
        changed = (await this.syncTranslation()) || changed;
      }

      if (this.config.watchers?.logfile?.enabled && this.#shouldRun("logfile", this.config.watchers.logfile.pullPeriod)) {
        changed = (await this.syncLogfile()) || changed;
      }

      if (changed) {
        await this.database.write();
      }
    } finally {
      this.running = false;
    }
  }

  async syncDonation() {
    const url = this.config.watchers.donation.url;
    const response = await this.fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`Donation watcher failed: ${response.status}`);
    }

    const payload = await response.json();
    const totals = new Map();

    for (const donation of payload.currentMonth?.donations ?? []) {
      if (donation.type !== "CNC" || !donation.username) continue;

      const key = normalizeUsernameKey(donation.username);
      const current = totals.get(key) ?? {
        username: donation.username,
        amount: 0
      };
      current.amount += Number(donation.amount) || 0;
      current.username = resolveExistingUsername(this.database, donation.username) ?? current.username;
      totals.set(key, current);
    }

    return this.#replaceManagedBanners({
      source: WATCHER_SOURCES.donation,
      bannerId: "donator",
      activeEntries: [...totals.values()].filter((entry) => entry.amount > 0),
      createBanner: (entry) => createDonatorBanner(entry.amount)
    });
  }

  async syncLogfile() {
    const watcherConfig = this.config.watchers.logfile;
    const state = this.#getLogfileState();
    const limit = Math.max(1, Math.floor(Number(watcherConfig.limit) || 100));
    const fastestLimit = Math.max(1, Math.floor(Number(watcherConfig.fastestLimit) || 10));
    const gameLimit = Math.max(limit, Math.floor(Number(watcherConfig.gameLimit) || 1000));
    const fastestGameLimit = Math.max(fastestLimit, Math.floor(Number(watcherConfig.fastestGameLimit) || 1000));
    const url = watcherConfig.url;
    let stateChanged = false;

    const remoteLength = await this.#getRemoteLogfileLength(url);
    if (Number.isFinite(remoteLength) && state.offset > remoteLength) {
      this.#resetLogfileState(state);
      stateChanged = true;
    }

    if (Number.isFinite(remoteLength) && state.offset === remoteLength) {
      return this.#replaceLogfileBannersFromState(state, { limit, gameLimit, fastestLimit, fastestGameLimit });
    }

    const response = await this.fetch(url, {
      headers: {
        Accept: "text/plain",
        "Accept-Encoding": "identity",
        Range: `bytes=${state.offset}-`
      }
    });

    if (response.status === 416) {
      this.#resetLogfileState(state);
      stateChanged = true;
      return (await this.syncLogfile()) || stateChanged;
    }

    if (!response.ok || (response.status !== 200 && response.status !== 206)) {
      throw new Error(`Logfile watcher failed: ${response.status}`);
    }

    const startOffset = response.status === 200 ? 0 : state.offset;
    if (startOffset === 0 && state.offset !== 0) {
      this.#resetLogfileState(state);
      stateChanged = true;
    }

    const processed = await this.#processLogfileResponse(response, state, startOffset, { gameLimit, fastestGameLimit });
    stateChanged = processed.changed || stateChanged;
    state.lastSyncAt = new Date().toISOString();

    const bannersChanged = this.#replaceLogfileBannersFromState(state, { limit, gameLimit, fastestLimit, fastestGameLimit });

    return stateChanged || bannersChanged;
  }

  async syncTranslation() {
    const watcherConfig = this.config.watchers.translation;
    const response = await this.fetch(watcherConfig.url, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`Translation watcher failed: ${response.status}`);
    }

    const payload = await response.json();
    const threshold = Number(watcherConfig.threshold) || 500;
    const maxScore = Number(watcherConfig.maxScore) || 5000;
    const activeEntries = [];

    for (const user of payload.users ?? []) {
      const score = (Number(user.created) || 0) + (Number(user.edited) || 0) + (Number(user.deleted) || 0);
      if (score < threshold || !user.username) continue;

      activeEntries.push({
        username: resolveExistingUsername(this.database, user.username) ?? user.username,
        score
      });
    }

    return this.#replaceManagedBanners({
      source: WATCHER_SOURCES.translation,
      bannerId: "translator",
      activeEntries,
      createBanner: (entry) => createTranslatorBanner(entry.score, { threshold, maxScore })
    });
  }

  #replaceManagedBanners({ source, bannerId, activeEntries, createBanner }) {
    let changed = false;
    const activeKeys = new Set(activeEntries.map((entry) => normalizeUsernameKey(entry.username)));

    for (const profile of Object.values(this.database.data.profiles)) {
      if (profile.sources?.[bannerId]?.source === source && !activeKeys.has(normalizeUsernameKey(profile.username))) {
        changed = this.database.removeManagedBanner(profile.username, bannerId, source).changed || changed;
      }
    }

    for (const entry of activeEntries) {
      const banner = createBanner(entry);
      changed = this.database.upsertBanner(entry.username, banner, {
        source,
        autoEquip: true
      }).changed || changed;
    }

    return changed;
  }

  #shouldRun(name, periodSeconds) {
    const period = Math.max(5, Number(periodSeconds) || 30) * 1000;
    const now = Date.now();
    const lastRun = this.lastWatcherRuns.get(name) ?? 0;
    if (now - lastRun < period) {
      return false;
    }

    this.lastWatcherRuns.set(name, now);
    return true;
  }

  async #getRemoteLogfileLength(url) {
    const response = await this.fetch(url, {
      method: "HEAD",
      headers: {
        Accept: "text/plain",
        "Accept-Encoding": "identity"
      }
    });
    if (!response.ok) {
      throw new Error(`Logfile watcher HEAD failed: ${response.status}`);
    }

    const length = Number(getHeader(response.headers, "content-length"));
    return Number.isFinite(length) && length >= 0 ? length : null;
  }

  #getLogfileState() {
    this.database.data.watcherState ??= {};
    const state = this.database.data.watcherState.logfile ??= {};
    if (state.rankingMode !== LOGFILE_RANKING_MODE) {
      this.#resetLogfileState(state);
    } else {
      state.offset = Math.max(0, Math.floor(Number(state.offset) || 0));
      state.partialLine = String(state.partialLine ?? "");
      state.games = Array.isArray(state.games) ? state.games : [];
      state.players = state.players && typeof state.players === "object" ? state.players : {};
      state.fastestGames = Array.isArray(state.fastestGames) ? state.fastestGames : [];
      state.fastestPlayers = state.fastestPlayers && typeof state.fastestPlayers === "object" ? state.fastestPlayers : {};
      state.nextGameOrder = Math.max(0, Math.floor(Number(state.nextGameOrder) || 0));
    }
    return state;
  }

  #resetLogfileState(state) {
    state.rankingMode = LOGFILE_RANKING_MODE;
    state.offset = 0;
    state.partialLine = "";
    state.games = [];
    state.players = {};
    state.fastestGames = [];
    state.fastestPlayers = {};
    state.nextGameOrder = 0;
  }

  async #processLogfileResponse(response, state, startOffset, rankingLimits) {
    let receivedBytes = 0;
    let lineBuffer = startOffset === 0 ? "" : state.partialLine;
    let changed = false;

    for await (const chunk of readResponseTextChunks(response)) {
      if (!chunk.text) continue;

      receivedBytes += chunk.bytes;
      lineBuffer += chunk.text;
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";

      for (const line of lines) {
        changed = this.#updateLogfileGame(state, line.replace(/\r$/, ""), rankingLimits) || changed;
      }
    }

    state.offset = startOffset + receivedBytes;
    state.partialLine = lineBuffer;
    return { changed: changed || receivedBytes > 0 };
  }

  #updateLogfileGame(state, line, { gameLimit, fastestGameLimit }) {
    const game = parseLogfileLine(line);
    if (!game) {
      return false;
    }

    const key = normalizeUsernameKey(game.username);
    if (!key) {
      return false;
    }

    const order = state.nextGameOrder;
    state.nextGameOrder += 1;
    state.games = Array.isArray(state.games) ? state.games : [];
    state.players = state.players && typeof state.players === "object" ? state.players : {};
    state.fastestGames = Array.isArray(state.fastestGames) ? state.fastestGames : [];
    state.fastestPlayers = state.fastestPlayers && typeof state.fastestPlayers === "object" ? state.fastestPlayers : {};
    let changed = false;

    const entry = {
      key,
      username: resolveExistingUsername(this.database, game.username) ?? game.username,
      score: game.score,
      durationSeconds: game.durationSeconds,
      order
    };

    if (game.score > 0) {
      const previousPlayer = state.players[key];
      if (!previousPlayer || Number(previousPlayer.score) < game.score) {
        state.players[key] = {
          key,
          username: entry.username,
          score: game.score,
          order
        };
        changed = true;
      }

      if (state.games.length < gameLimit || game.score > Number(state.games.at(-1)?.score)) {
        state.games.push({
          key,
          username: entry.username,
          score: game.score,
          order
        });
        this.#pruneLogfileGames(state, gameLimit);
        changed = true;
      }
    }

    if (game.isWin && game.durationSeconds > 0) {
      const fastestEntry = {
        key,
        username: entry.username,
        score: game.score,
        durationSeconds: game.durationSeconds,
        order
      };
      const previousFastestPlayer = state.fastestPlayers[key];
      if (!previousFastestPlayer || compareFastestWinGames(fastestEntry, previousFastestPlayer) < 0) {
        state.fastestPlayers[key] = fastestEntry;
        changed = true;
      }

      if (
        state.fastestGames.length < fastestGameLimit ||
        compareFastestWinGames(fastestEntry, state.fastestGames.at(-1)) < 0
      ) {
        state.fastestGames.push(fastestEntry);
        this.#pruneFastestWinGames(state, fastestGameLimit);
        changed = true;
      }
    }

    return changed;
  }

  #pruneLogfileGames(state, gameLimit) {
    state.games = (Array.isArray(state.games) ? state.games : [])
      .filter((entry) => entry?.username && Number(entry.score) > 0)
      .sort(compareLogfileGames)
      .slice(0, gameLimit);
  }

  #pruneFastestWinGames(state, fastestGameLimit) {
    state.fastestGames = (Array.isArray(state.fastestGames) ? state.fastestGames : [])
      .filter((entry) => entry?.username && Number(entry.durationSeconds) > 0)
      .sort(compareFastestWinGames)
      .slice(0, fastestGameLimit);
  }

  #getTopRankingEntries(state, limit) {
    const games = (Array.isArray(state.games) ? state.games : [])
      .filter((entry) => entry?.username && Number(entry.score) > 0)
      .sort(compareLogfileGames);

    return Object.values(state.players ?? {})
      .filter((entry) => entry?.username && Number(entry.score) > 0)
      .sort(compareLogfileGames)
      .slice(0, limit)
      .map((entry, index) => ({
        username: entry.username,
        score: Number(entry.score),
        rank: getGameRank(games, entry) ?? index + 1,
        serverRank: index + 1
      }));
  }

  #getFastestWinEntries(state, fastestLimit) {
    const games = (Array.isArray(state.fastestGames) ? state.fastestGames : [])
      .filter((entry) => entry?.username && Number(entry.durationSeconds) > 0)
      .sort(compareFastestWinGames);

    return Object.values(state.fastestPlayers ?? {})
      .filter((entry) => entry?.username && Number(entry.durationSeconds) > 0)
      .sort(compareFastestWinGames)
      .slice(0, fastestLimit)
      .map((entry, index) => ({
        username: entry.username,
        durationSeconds: Number(entry.durationSeconds),
        rank: getFastestWinGameRank(games, entry) ?? index + 1,
        serverRank: index + 1
      }));
  }

  #replaceLogfileBannersFromState(state, { limit, gameLimit, fastestLimit, fastestGameLimit }) {
    this.#pruneLogfileGames(state, gameLimit);
    this.#pruneFastestWinGames(state, fastestGameLimit);
    const rankingChanged = this.#replaceManagedBanners({
      source: WATCHER_SOURCES.logfile,
      bannerId: "ranking",
      activeEntries: this.#getTopRankingEntries(state, limit),
      createBanner: (entry) => createRankingBanner(entry)
    });
    const fastestChanged = this.#replaceManagedBanners({
      source: WATCHER_SOURCES.logfile,
      bannerId: "fastest-win",
      activeEntries: this.#getFastestWinEntries(state, fastestLimit),
      createBanner: (entry) => createFastestWinBanner(entry)
    });
    return rankingChanged || fastestChanged;
  }
}

function resolveExistingUsername(database, username) {
  const profile = database.getProfile(username);
  return profile?.username ?? null;
}

function compareLogfileGames(a, b) {
  return Number(b.score) - Number(a.score) ||
    Number(a.order ?? 0) - Number(b.order ?? 0) ||
    String(a.username).localeCompare(String(b.username));
}

function compareFastestWinGames(a, b) {
  return Number(a.durationSeconds) - Number(b.durationSeconds) ||
    Number(a.order ?? 0) - Number(b.order ?? 0) ||
    String(a.username).localeCompare(String(b.username));
}

function getGameRank(games, target) {
  const targetKey = target.key ?? normalizeUsernameKey(target.username);
  const targetScore = Number(target.score);
  const targetOrder = Number(target.order ?? 0);
  const index = games.findIndex((entry) => {
    const key = entry.key ?? normalizeUsernameKey(entry.username);
    return key === targetKey &&
      Number(entry.score) === targetScore &&
      Number(entry.order ?? 0) === targetOrder;
  });
  return index >= 0 ? index + 1 : null;
}

function getFastestWinGameRank(games, target) {
  const targetKey = target.key ?? normalizeUsernameKey(target.username);
  const targetDurationSeconds = Number(target.durationSeconds);
  const targetOrder = Number(target.order ?? 0);
  const index = games.findIndex((entry) => {
    const key = entry.key ?? normalizeUsernameKey(entry.username);
    return key === targetKey &&
      Number(entry.durationSeconds) === targetDurationSeconds &&
      Number(entry.order ?? 0) === targetOrder;
  });
  return index >= 0 ? index + 1 : null;
}

async function* readResponseTextChunks(response) {
  if (response.body?.getReader) {
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield {
        text: decoder.decode(value, { stream: true }),
        bytes: value.byteLength
      };
    }

    const tail = decoder.decode();
    if (tail) {
      yield {
        text: tail,
        bytes: 0
      };
    }
    return;
  }

  if (response.body?.[Symbol.asyncIterator]) {
    const decoder = new TextDecoder();
    for await (const value of response.body) {
      yield {
        text: decoder.decode(value, { stream: true }),
        bytes: value.byteLength
      };
    }

    const tail = decoder.decode();
    if (tail) {
      yield {
        text: tail,
        bytes: 0
      };
    }
    return;
  }

  const text = await response.text();
  yield {
    text,
    bytes: Buffer.byteLength(text)
  };
}

function parseLogfileLine(line) {
  if (!line) return null;

  let username = "";
  let score = 0;
  let durationSeconds = 0;
  let isWin = false;
  for (const field of line.split(":")) {
    const separator = field.indexOf("=");
    if (separator < 0) continue;

    const key = field.slice(0, separator);
    const value = field.slice(separator + 1);
    if (key === "name") {
      username = value.trim();
    } else if (key === "sc") {
      score = Number.parseInt(value, 10) || 0;
    } else if (key === "dur") {
      durationSeconds = Number.parseInt(value, 10) || 0;
    } else if (key === "ktyp") {
      isWin = value === "winning";
    }
  }

  return username ? { username, score, durationSeconds, isWin } : null;
}

function getHeader(headers, name) {
  if (headers?.get) {
    return headers.get(name);
  }

  return headers?.[name] ?? headers?.[name.toLowerCase()];
}
