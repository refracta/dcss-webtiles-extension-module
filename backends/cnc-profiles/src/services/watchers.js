import {
  createCurrentWinStreakBanner,
  createDcssContributorBanner,
  createDonorBanner,
  createFastestWinBanner,
  createLatestTournamentBanner,
  createOspContributorBanner,
  createRankingBanner,
  createTranslatorBanner,
  createWinStreakBanner
} from "../domain/banners.js";
import { normalizeUsernameKey } from "../db/profile-db.js";

const WATCHER_SOURCES = {
  credits: "watcher:credits",
  donation: "watcher:donation",
  logfile: "watcher:logfile",
  osp: "watcher:osp",
  tournament: "watcher:tournament",
  translation: "watcher:translation"
};

const LOGFILE_RANKING_MODE = "server-game-v3";

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
        changed = (await this.#runWatcher("donation", () => this.syncDonation())) || changed;
      }

      if (this.config.watchers?.translation?.enabled) {
        changed = (await this.#runWatcher("translation", () => this.syncTranslation())) || changed;
      }

      if (this.config.watchers?.credits?.enabled && this.#shouldRun("credits", this.config.watchers.credits.pullPeriod)) {
        changed = (await this.#runWatcher("credits", () => this.syncCredits())) || changed;
      }

      if (this.config.watchers?.osp?.enabled && this.#shouldRun("osp", this.config.watchers.osp.pullPeriod)) {
        changed = (await this.#runWatcher("osp", () => this.syncOsp())) || changed;
      }

      if (this.config.watchers?.tournament?.enabled && this.#shouldRun("tournament", this.config.watchers.tournament.pullPeriod)) {
        changed = (await this.#runWatcher("tournament", () => this.syncTournament())) || changed;
      }

      if (this.config.watchers?.logfile?.enabled && this.#shouldRun("logfile", this.config.watchers.logfile.pullPeriod)) {
        changed = (await this.#runWatcher("logfile", () => this.syncLogfile())) || changed;
      }

      if (changed) {
        await this.database.write();
      }
    } finally {
      this.running = false;
    }
  }

  async #runWatcher(name, sync) {
    try {
      return await sync();
    } catch (error) {
      console.error(`Profile ${name} watcher sync failed:`, error);
      return false;
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
    const resolveUsername = createExistingUsernameResolver(this.database);

    for (const donation of payload.currentMonth?.donations ?? []) {
      if (donation.type !== "CNC" || !donation.username) continue;

      const key = normalizeUsernameKey(donation.username);
      const current = totals.get(key) ?? {
        username: donation.username,
        amount: 0
      };
      current.amount += Number(donation.amount) || 0;
      current.username = resolveUsername(donation.username) ?? current.username;
      totals.set(key, current);
    }

    const legacyChanged = this.#removeManagedBanners({
      source: WATCHER_SOURCES.donation,
      bannerId: "donator"
    });

    return this.#replaceManagedBanners({
      source: WATCHER_SOURCES.donation,
      bannerId: "donor",
      activeEntries: [...totals.values()].filter((entry) => entry.amount > 0),
      createBanner: (entry) => createDonorBanner(entry.amount)
    }) || legacyChanged;
  }

  async syncCredits() {
    const watcherConfig = this.config.watchers.credits;
    const response = await this.fetch(watcherConfig.url, { headers: { Accept: "text/plain" } });
    if (!response.ok) {
      throw new Error(`Credits watcher failed: ${response.status}`);
    }

    const names = parseCreditsContributorNames(await response.text());
    return this.#replaceManagedBanners({
      source: WATCHER_SOURCES.credits,
      bannerId: "dcss-contributor",
      activeEntries: names.map((username) => ({ username })),
      createBanner: () => createDcssContributorBanner()
    });
  }

  async syncOsp() {
    const watcherConfig = this.config.watchers.osp;
    const response = await this.fetch(watcherConfig.url, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`OSP watcher failed: ${response.status}`);
    }

    const resolveUsername = createExistingUsernameResolver(this.database);
    const entries = parseOspContributorEntries(await response.json(), {
      uploadPrefix: watcherConfig.uploadPrefix
    }).map((entry) => ({
      ...entry,
      username: resolveUsername(entry.username) ?? entry.username
    }));

    return this.#replaceManagedBanners({
      source: WATCHER_SOURCES.osp,
      bannerId: "osp-contributor",
      activeEntries: entries,
      createBanner: (entry) => createOspContributorBanner(entry.count)
    });
  }

  async syncTournament() {
    const watcherConfig = this.config.watchers.tournament;
    const version = await this.#getLatestTournamentVersion(watcherConfig);
    if (!version) {
      return false;
    }

    const rankingsUrl = formatTournamentUrl(watcherConfig.rankingsUrlTemplate, { version });
    const response = await this.fetch(rankingsUrl, { headers: { Accept: "text/html" } });
    if (!response.ok) {
      throw new Error(`Tournament watcher failed: ${response.status}`);
    }

    const entries = parseTournamentRankingEntries(await response.text(), {
      pageUrl: rankingsUrl,
      playerUrlTemplate: watcherConfig.playerUrlTemplate,
      version
    });
    const resolveUsername = createExistingUsernameResolver(this.database);
    let changed = false;
    for (const entry of entries) {
      const username = resolveUsername(entry.username) ?? entry.username;
      changed = this.database.upsertBanner(username, createLatestTournamentBanner(entry), {
        source: WATCHER_SOURCES.tournament,
        autoEquip: true
      }).changed || changed;
    }

    return changed;
  }

  async syncLogfile() {
    const watcherConfig = this.config.watchers.logfile;
    const state = this.#getLogfileState();
    const limit = Math.max(1, Math.floor(Number(watcherConfig.limit) || 100));
    const fastestLimit = Math.max(1, Math.floor(Number(watcherConfig.fastestLimit) || 10));
    const streakMin = Math.max(1, Math.floor(Number(watcherConfig.streakMin) || 2));
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
      return this.#replaceLogfileBannersFromState(state, { limit, gameLimit, fastestLimit, fastestGameLimit, streakMin });
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

    const bannersChanged = this.#replaceLogfileBannersFromState(state, { limit, gameLimit, fastestLimit, fastestGameLimit, streakMin });

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
    const resolveUsername = createExistingUsernameResolver(this.database);

    for (const user of payload.users ?? []) {
      const score = (Number(user.created) || 0) + (Number(user.edited) || 0) + (Number(user.deleted) || 0);
      if (score < threshold || !user.username) continue;

      activeEntries.push({
        username: resolveUsername(user.username) ?? user.username,
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

  #removeManagedBanners({ source, bannerId }) {
    let changed = false;

    for (const profile of Object.values(this.database.data.profiles)) {
      if (profile.sources?.[bannerId]?.source === source) {
        changed = this.database.removeManagedBanner(profile.username, bannerId, source).changed || changed;
      }
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

  async #getLatestTournamentVersion(watcherConfig) {
    if (watcherConfig.version) {
      return String(watcherConfig.version).trim();
    }

    const response = await this.fetch(watcherConfig.branchesUrl, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`Tournament branch watcher failed: ${response.status}`);
    }

    return parseLatestTournamentVersion(await response.json());
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
      state.streakPlayers = state.streakPlayers && typeof state.streakPlayers === "object" ? state.streakPlayers : {};
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
    state.streakPlayers = {};
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
        if (state.nextGameOrder > 0 && state.nextGameOrder % 1000 === 0) {
          await yieldToEventLoop();
        }
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
    state.streakPlayers = state.streakPlayers && typeof state.streakPlayers === "object" ? state.streakPlayers : {};
    let changed = false;

    const entry = {
      key,
      username: game.username,
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

    const previousStreakPlayer = state.streakPlayers[key] ?? {
      key,
      username: entry.username,
      currentStreak: 0,
      bestStreak: 0,
      order
    };
    const currentStreak = game.isWin ? Number(previousStreakPlayer.currentStreak || 0) + 1 : 0;
    const bestStreak = Math.max(Number(previousStreakPlayer.bestStreak || 0), currentStreak);
    if (
      previousStreakPlayer.username !== entry.username ||
      Number(previousStreakPlayer.currentStreak || 0) !== currentStreak ||
      Number(previousStreakPlayer.bestStreak || 0) !== bestStreak
    ) {
      state.streakPlayers[key] = {
        key,
        username: entry.username,
        currentStreak,
        bestStreak,
        order
      };
      changed = true;
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

  #getWinStreakEntries(state, streakMin) {
    return Object.values(state.streakPlayers ?? {})
      .filter((entry) => entry?.username && Number(entry.bestStreak) >= streakMin)
      .sort(compareWinStreakPlayers)
      .map((entry) => ({
        username: entry.username,
        streak: Number(entry.bestStreak)
      }));
  }

  #getCurrentWinStreakEntries(state, streakMin) {
    return Object.values(state.streakPlayers ?? {})
      .filter((entry) => entry?.username && Number(entry.currentStreak) >= streakMin)
      .sort(compareCurrentWinStreakPlayers)
      .map((entry) => ({
        username: entry.username,
        streak: Number(entry.currentStreak)
      }));
  }

  #replaceLogfileBannersFromState(state, { limit, gameLimit, fastestLimit, fastestGameLimit, streakMin }) {
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
    const streakChanged = this.#replaceManagedBanners({
      source: WATCHER_SOURCES.logfile,
      bannerId: "win-streak",
      activeEntries: this.#getWinStreakEntries(state, streakMin),
      createBanner: (entry) => createWinStreakBanner(entry)
    });
    const currentStreakChanged = this.#replaceManagedBanners({
      source: WATCHER_SOURCES.logfile,
      bannerId: "current-win-streak",
      activeEntries: this.#getCurrentWinStreakEntries(state, streakMin),
      createBanner: (entry) => createCurrentWinStreakBanner(entry)
    });
    return rankingChanged || fastestChanged || streakChanged || currentStreakChanged;
  }
}

function createExistingUsernameResolver(database) {
  const usernames = new Map();
  for (const profile of Object.values(database.data.profiles ?? {})) {
    const key = normalizeUsernameKey(profile?.username);
    if (key && !usernames.has(key)) {
      usernames.set(key, profile.username);
    }
  }

  return (username) => usernames.get(normalizeUsernameKey(username)) ?? null;
}

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
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

function compareWinStreakPlayers(a, b) {
  return Number(b.bestStreak) - Number(a.bestStreak) ||
    Number(a.order ?? 0) - Number(b.order ?? 0) ||
    String(a.username).localeCompare(String(b.username));
}

function compareCurrentWinStreakPlayers(a, b) {
  return Number(b.currentStreak) - Number(a.currentStreak) ||
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

export function parseCreditsContributorNames(text) {
  const names = new Map();

  const addName = (name) => {
    const cleaned = cleanCreditName(name);
    const key = normalizeUsernameKey(cleaned);
    if (key && !names.has(key)) {
      names.set(key, cleaned);
    }
  };

  const addNameCandidates = (value) => {
    const cleaned = cleanCreditName(value);
    if (!cleaned) return;

    for (const alias of extractQuotedAliases(cleaned)) {
      addName(alias);
    }

    for (const part of splitCreditNameList(cleaned)) {
      addName(part);
    }
  };

  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, "");
    if (/^\s{4,}\S/.test(line)) {
      addNameCandidates(line.trim());
      continue;
    }

    const bullet = /^\*\s+(.+)$/.exec(line);
    if (!bullet) continue;

    const lead = /^(.+?),\s+/.exec(bullet[1])?.[1];
    if (!lead || /^(Additional|Members|Other|The)\b/i.test(lead)) continue;

    for (const part of lead.split(/\s+and\s+/i)) {
      addNameCandidates(part);
    }
  }

  return [...names.values()].sort((a, b) => a.localeCompare(b, "en-US"));
}

function cleanCreditName(value) {
  return String(value ?? "")
    .replace(/\s*\([^)]*\)\s*$/g, "")
    .trim();
}

function extractQuotedAliases(value) {
  return [...String(value).matchAll(/['"]([^'"]+)['"]/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

function splitCreditNameList(value) {
  const name = cleanCreditName(value);
  if (!name) return [];

  if (/,\s+/.test(name) && !/,\s*(Jr\.|Sr\.|II|III|IV)\.?$/i.test(name)) {
    return name.split(",").map((part) => part.trim()).filter(Boolean);
  }

  return [name];
}

export function parseOspContributorEntries(payload, { uploadPrefix = "https://osp.nemelex.cards/uploads" } = {}) {
  const counts = new Map();
  const rows = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload) ? payload : []);

  for (const row of rows) {
    if (!isValidOspSoundRow(row, uploadPrefix)) continue;

    const username = String(row.REGISTER ?? "").trim();
    const key = normalizeUsernameKey(username);
    if (!key) continue;

    const current = counts.get(key) ?? {
      username,
      count: 0
    };
    current.count += 1;
    counts.set(key, current);
  }

  return [...counts.values()]
    .filter((entry) => entry.count > 0)
    .sort((a, b) => Number(b.count) - Number(a.count) || a.username.localeCompare(b.username, "en-US"));
}

export function parseLatestTournamentVersion(payload) {
  const branches = Array.isArray(payload) ? payload : [];
  const versions = branches
    .map((branch) => String(branch?.name ?? branch ?? ""))
    .map((name) => /^v?(\d+(?:\.\d+)+)-tourney$/i.exec(name)?.[1] ?? "")
    .filter(Boolean)
    .sort(compareVersionStrings);

  return versions.at(-1) ?? "";
}

export function parseTournamentRankingEntries(html, {
  pageUrl = "",
  playerUrlTemplate = "https://crawl.develz.org/tournament/{version}/players/{username}.html",
  version = ""
} = {}) {
  const entries = [];
  let headers = [];

  for (const rowMatch of String(html ?? "").matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = extractTournamentCells(rowMatch[1]);
    if (!cells.length) continue;

    const normalizedHeaders = cells.map((cell) => normalizeTournamentHeader(cell.text));
    if (normalizedHeaders.includes("player") && normalizedHeaders.some((header) => header === "#" || header === "ranking")) {
      headers = normalizedHeaders;
      continue;
    }
    if (!headers.length) continue;

    const rankCell = cells[getTournamentColumnIndex(headers, ["#", "ranking"], 0)];
    const playerCell = cells[getTournamentColumnIndex(headers, ["player"], 1)];
    const clanCell = cells[getTournamentColumnIndex(headers, ["clan"], 2)];
    const scoreCell = cells[getTournamentColumnIndex(headers, ["overall score", "score"], 3)];
    const username = playerCell?.text?.trim() ?? "";
    const rank = parseIntegerText(rankCell?.text ?? rankCell?.dataSort);
    const score = parseIntegerText(scoreCell?.text ?? scoreCell?.dataSort);
    if (!username || !rank) continue;

    entries.push({
      username,
      version,
      rank,
      score,
      clan: clanCell?.text?.trim() ?? "",
      url: resolveTournamentUrl(
        formatTournamentUrl(playerUrlTemplate, { version, username }) || playerCell?.href,
        pageUrl
      )
    });
  }

  return entries.sort((a, b) => a.rank - b.rank || a.username.localeCompare(b.username, "en-US"));
}

function isValidOspSoundRow(row, uploadPrefix) {
  if (!row || typeof row !== "object") return false;

  const regex = String(row.REGEX ?? "").trim();
  const pathValue = String(row.PATH ?? "").trim();
  const sound = String(row.SOUND ?? "").trim();
  const rcfile = String(row.RCFILE ?? "").trim();
  const register = String(row.REGISTER ?? "").trim();

  return Boolean(regex && pathValue && sound && rcfile && register && sound.startsWith(uploadPrefix));
}

function compareVersionStrings(left, right) {
  const leftParts = String(left).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = String(right).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (leftParts[i] ?? 0) - (rightParts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return String(left).localeCompare(String(right), "en-US");
}

function extractTournamentCells(rowHtml) {
  const cells = [];
  for (const cellMatch of String(rowHtml ?? "").matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)) {
    const attrs = cellMatch[1];
    const inner = cellMatch[2];
    const anchorAttrs = /<a\b([^>]*)>/i.exec(inner)?.[1] ?? "";
    cells.push({
      dataSort: decodeHtml(getHtmlAttribute(attrs, "data-sort")),
      href: decodeHtml(getHtmlAttribute(anchorAttrs, "href")),
      text: normalizeWhitespace(decodeHtml(stripHtmlTags(inner)))
    });
  }
  return cells;
}

function normalizeTournamentHeader(value) {
  const normalized = normalizeWhitespace(value).toLowerCase();
  return normalized === "overall score" ? "overall score" : normalized;
}

function getTournamentColumnIndex(headers, names, fallback) {
  const index = headers.findIndex((header) => names.includes(header));
  return index >= 0 ? index : fallback;
}

function parseIntegerText(value) {
  return Number.parseInt(String(value ?? "").replace(/[^\d-]/g, ""), 10) || 0;
}

function stripHtmlTags(value) {
  return String(value ?? "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, "");
}

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function getHtmlAttribute(attrs, name) {
  const match = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

function decodeHtml(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\""
  };
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (_, name) => named[name.toLowerCase()] ?? `&${name};`);
}

function formatTournamentUrl(template, values = {}) {
  const safeTemplate = template || "https://crawl.develz.org/tournament/{version}/all-players-ranks.html";
  return safeTemplate
    .replaceAll("{version}", encodeURIComponent(values.version ?? ""))
    .replaceAll("{username}", encodeURIComponent(String(values.username ?? "").toLocaleLowerCase("en-US")));
}

function resolveTournamentUrl(url, baseUrl) {
  try {
    return new URL(url, baseUrl || undefined).toString();
  } catch {
    return String(url || "");
  }
}

function getHeader(headers, name) {
  if (headers?.get) {
    return headers.get(name);
  }

  return headers?.[name] ?? headers?.[name.toLowerCase()];
}
