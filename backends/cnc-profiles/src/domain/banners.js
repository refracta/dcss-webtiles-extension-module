export const PROFILE_SCHEMA_VERSION = 1;

const CNC_USERINFO_ASSET_BASE = "https://raw.githubusercontent.com/refracta/dcss-webtiles-extension-module/main/modules/cnc-userinfo/images";
const CNC_SECOND_ANNIVERSARY_ASSET_BASE = `${CNC_USERINFO_ASSET_BASE}/cnc-2nd-anniversary`;

export const BANNER_URLS = {
  tournamentResults: "https://refracta.github.io/nemelex.cards/cnc-1st-anniversary-tournament/results.html",
  secondTournamentResults: "https://refracta.github.io/nemelex.cards/cnc-2nd-anniversary-tournament/results.html",
  goonkemon: "https://refracta.github.io/nemelex.cards/goonkemon",
  donation: "https://donation.abstr.net/list",
  logfile: "https://archive.nemelex.cards/meta/crawl-git/logfile",
  logfileViewer: "https://archive.nemelex.cards/meta/crawl-git?file=logfile",
  translation: "https://docs.google.com/document/d/1AFNN3L139L3U9cMPNpFOViutlpaJ2rCdiJtkJ0g2ykY/edit?usp=sharing",
  credits: "https://github.com/crawl/crawl/blob/master/crawl-ref/CREDITS.txt",
  osp: "https://github.com/refracta/dcss-webtiles-extension-module/blob/main/modules/sound-support/README.md",
  tournament: "https://crawl.develz.org/tournament",
  profiles: "https://profiles.nemelex.cards"
};

export const BANNER_ASSETS = {
  donorRecentIcon: `${CNC_USERINFO_ASSET_BASE}/gozag.webp`,
  secondAnniversaryGold: `${CNC_SECOND_ANNIVERSARY_ASSET_BASE}/five-pip-card-small-gold-champion.svg`,
  secondAnniversarySilver: `${CNC_SECOND_ANNIVERSARY_ASSET_BASE}/five-pip-card-small-silver.svg`,
  secondAnniversaryBronze: `${CNC_SECOND_ANNIVERSARY_ASSET_BASE}/five-pip-card-small-bronze.svg`,
  secondAnniversarySpecial: `${CNC_SECOND_ANNIVERSARY_ASSET_BASE}/five-pip-card-small-special.svg`,
  secondTournamentProposer: `${CNC_SECOND_ANNIVERSARY_ASSET_BASE}/tournament-proposer-lightbulb.svg`
};

export const NEMELEX_COLORS = ["#008cc0", "#009800", "#8000ff", "#cad700", "#ff4000"];
export const PSEUDO_CNC_RANKS = [1, 2, 3];
export const PSEUDO_DONOR_AMOUNTS = [20000, 40000, 60000, 80000, 100000, 250000, 500000];
export const PSEUDO_TRANSLATOR_SCORES = [500, 2750, 5000];
const RANKING_EXAMPLES = [
  { id: "rank-1", serverRankLabel: "#1", rank: 1, serverRank: 1, score: 50000000 },
  { id: "rank-2-3", serverRankLabel: "#2-#3", rank: 2, serverRank: 2, score: 45000000 },
  { id: "rank-4-10", serverRankLabel: "#4-#10", rank: 4, serverRank: 4, score: 40000000 },
  { id: "rank-11-25", serverRankLabel: "#11-#25", rank: 11, serverRank: 11, score: 35000000 },
  { id: "rank-26-50", serverRankLabel: "#26-#50", rank: 26, serverRank: 26, score: 30000000 },
  { id: "rank-51-100", serverRankLabel: "#51-#100", rank: 51, serverRank: 51, score: 25000000 }
];
const FASTEST_WIN_EXAMPLES = [
  { id: "rank-1", serverRankLabel: "#1", rank: 1, serverRank: 1, durationSeconds: 5400 },
  { id: "rank-2-3", serverRankLabel: "#2-#3", rank: 2, serverRank: 2, durationSeconds: 7200 },
  { id: "rank-4-5", serverRankLabel: "#4-#5", rank: 4, serverRank: 4, durationSeconds: 9000 },
  { id: "rank-6-10", serverRankLabel: "#6-#10", rank: 6, serverRank: 6, durationSeconds: 10800 }
];
const WIN_STREAK_EXAMPLES = [2, 5, 10, 50];
const CURRENT_WIN_STREAK_EXAMPLES = [2, 5, 10, 50];
const LATEST_TOURNAMENT_EXAMPLES = [
  { id: "rank-7", version: "0.34", rank: 7, score: 7654321, clan: "Nemelex Xobeh" }
];

export const BANNER_DEFINITIONS = [
  {
    id: "wizard-account",
    title: "Wizard Account",
    url: BANNER_URLS.tournamentResults,
    usernameStyle: createNemelexUsernameStyle(1)
  },
  {
    id: "cnc-1st-anniversary-skill-champion",
    title: "CNC 1st Anniversary Tournament\nChampion (Skill Category)",
    url: BANNER_URLS.tournamentResults,
    usernameStyle: createNemelexUsernameStyle(1)
  },
  {
    id: "cnc-1st-anniversary-skill-2",
    title: "CNC 1st Anniversary Tournament\n2nd Place (Skill Category)",
    url: BANNER_URLS.tournamentResults,
    usernameStyle: createNemelexUsernameStyle(2)
  },
  {
    id: "cnc-1st-anniversary-skill-3",
    title: "CNC 1st Anniversary Tournament\n3rd Place (Skill Category)",
    url: BANNER_URLS.tournamentResults,
    usernameStyle: createNemelexUsernameStyle(3)
  },
  {
    id: "cnc-1st-anniversary-ent-champion",
    title: "CNC 1st Anniversary Tournament\nChampion (Ent Category)",
    url: BANNER_URLS.tournamentResults,
    usernameStyle: createNemelexUsernameStyle(1)
  },
  {
    id: "cnc-1st-anniversary-ent-2",
    title: "CNC 1st Anniversary Tournament\n2nd Place (Ent Category)",
    url: BANNER_URLS.tournamentResults,
    usernameStyle: createNemelexUsernameStyle(2)
  },
  {
    id: "cnc-1st-anniversary-ent-3",
    title: "CNC 1st Anniversary Tournament\n3rd Place (Ent Category)",
    url: BANNER_URLS.tournamentResults,
    usernameStyle: createNemelexUsernameStyle(3)
  },
  {
    id: "cnc-2nd-anniversary-skill-champion",
    title: "CNC 2nd Anniversary Tournament\nChampion (Skill Category)",
    url: BANNER_URLS.secondTournamentResults,
    usernameStyle: createImagePrefixUsernameStyle(BANNER_ASSETS.secondAnniversaryGold)
  },
  {
    id: "cnc-2nd-anniversary-skill-2",
    title: "CNC 2nd Anniversary Tournament\n2nd Place (Skill Category)",
    url: BANNER_URLS.secondTournamentResults,
    usernameStyle: createImagePrefixUsernameStyle(BANNER_ASSETS.secondAnniversarySilver)
  },
  {
    id: "cnc-2nd-anniversary-skill-3",
    title: "CNC 2nd Anniversary Tournament\n3rd Place (Skill Category)",
    url: BANNER_URLS.secondTournamentResults,
    usernameStyle: createImagePrefixUsernameStyle(BANNER_ASSETS.secondAnniversaryBronze)
  },
  {
    id: "cnc-2nd-anniversary-ent-champion",
    title: "CNC 2nd Anniversary Tournament\nChampion (Ent Category)",
    url: BANNER_URLS.secondTournamentResults,
    usernameStyle: createImagePrefixUsernameStyle(BANNER_ASSETS.secondAnniversaryGold)
  },
  {
    id: "cnc-2nd-anniversary-ent-2",
    title: "CNC 2nd Anniversary Tournament\n2nd Place (Ent Category)",
    url: BANNER_URLS.secondTournamentResults,
    usernameStyle: createImagePrefixUsernameStyle(BANNER_ASSETS.secondAnniversarySilver)
  },
  {
    id: "cnc-2nd-anniversary-ent-3",
    title: "CNC 2nd Anniversary Tournament\n3rd Place (Ent Category)",
    url: BANNER_URLS.secondTournamentResults,
    usernameStyle: createImagePrefixUsernameStyle(BANNER_ASSETS.secondAnniversaryBronze)
  },
  {
    id: "cnc-2nd-anniversary-ent-special",
    title: "CNC 2nd Anniversary Tournament\nSpecial Award (Ent Category)",
    url: BANNER_URLS.secondTournamentResults,
    usernameStyle: createImagePrefixUsernameStyle(BANNER_ASSETS.secondAnniversarySpecial)
  },
  {
    id: "cnc-2nd-tournament-proposer",
    title: "CNC 2rd Tournament Proposer",
    url: BANNER_URLS.secondTournamentResults,
    usernameStyle: createImagePrefixUsernameStyle(BANNER_ASSETS.secondTournamentProposer)
  },
  {
    id: "donor",
    title: "Donor (Cumulative)",
    url: BANNER_URLS.donation,
    detail: createDonationDetail(0, "Cumulative"),
    usernameStyle: { id: "donor", data: { donation: 0 } }
  },
  {
    id: "donor-recent",
    title: "Donor",
    url: BANNER_URLS.donation,
    detail: createDonationDetail(0, "Recent 45 days"),
    usernameStyle: {
      id: "donor-recent",
      data: {
        donation: 0,
        iconUrl: BANNER_ASSETS.donorRecentIcon
      }
    }
  },
  {
    id: "translator",
    title: "Translation Contributor",
    url: BANNER_URLS.translation,
    usernameStyle: { id: "translator", data: { score: 500, intensity: 0 } }
  },
  {
    id: "bot",
    title: "Bot",
    url: BANNER_URLS.profiles,
    usernameStyle: { id: "bot", data: { prefix: "🤖" } }
  },
  {
    id: "ranking",
    title: "Trunk Score Ranking",
    url: BANNER_URLS.logfileViewer,
    usernameStyle: { id: "ranking", data: { rank: 100, badge: getRankingBadge(100) } }
  },
  {
    id: "fastest-win",
    title: "Trunk Fastest Wins",
    url: BANNER_URLS.logfileViewer,
    usernameStyle: { id: "fastest-win", data: { rank: 10, badge: getFastestWinBadge(10) } }
  },
  {
    id: "win-streak",
    title: "Trunk Win Streak",
    url: BANNER_URLS.logfileViewer,
    detail: createWinStreakDetail(1),
    usernameStyle: { id: "win-streak", data: { streak: 1 } }
  },
  {
    id: "current-win-streak",
    title: "Trunk Win Streak",
    url: BANNER_URLS.logfileViewer,
    detail: createCurrentWinStreakDetail(1),
    usernameStyle: { id: "current-win-streak", data: { streak: 1 } }
  },
  {
    id: "dcss-contributor",
    title: "DCSS Contributor\nfrom CREDITS.txt",
    url: BANNER_URLS.credits,
    usernameStyle: { id: "dcss-contributor", data: { badge: "🛠️" } }
  },
  {
    id: "osp-contributor",
    title: "OSP Contributor",
    url: BANNER_URLS.osp,
    usernameStyle: { id: "osp-contributor", data: { count: 1 } }
  },
  {
    id: "latest-tournament",
    title: "Latest Tournament (v0.34)",
    url: `${BANNER_URLS.tournament}/0.34/all-players-ranks.html`,
    detail: createTournamentDetail({ rank: 1, score: 0, clan: "" }),
    usernameStyle: { id: "latest-tournament", data: { badge: "🏁", version: "0.34", rank: 1, score: 0, clan: "" } }
  },
  ...PSEUDO_CNC_RANKS.map((rank) => createPseudoCncBanner(rank)),
  ...PSEUDO_DONOR_AMOUNTS.map((amount, index) => createPseudoDonorBanner(index + 1, amount))
];

const GOONKEMON_HUNTER_EXAMPLE = {
  username: "Rutnb",
  captureId: "20260630T174537Z-Rutnb-Luedatz",
  title: "Luedatz.",
  score: 266
};

const BANNER_EXAMPLE_BANNER_IDS = [
  "bot",
  "dcss-contributor",
  "cnc-2nd-anniversary-skill-champion",
  "cnc-2nd-anniversary-skill-2",
  "cnc-2nd-anniversary-skill-3",
  "cnc-2nd-anniversary-ent-champion",
  "cnc-2nd-anniversary-ent-2",
  "cnc-2nd-anniversary-ent-3",
  "cnc-2nd-anniversary-ent-special",
  "cnc-2nd-tournament-proposer",
  ...PSEUDO_CNC_RANKS.map((rank) => `pseudo-cnc-${rank}`),
  ...PSEUDO_DONOR_AMOUNTS.map((_, index) => `pseudo-donor-${index + 1}`)
];

const BANNER_EXAMPLE_BANNERS = [
  ...BANNER_EXAMPLE_BANNER_IDS.map((id) => getBannerDefinition(id)),
  createGoonkemonHunterBanner(GOONKEMON_HUNTER_EXAMPLE),
  createRecentDonorExampleBanner(5000),
  ...PSEUDO_TRANSLATOR_SCORES.map((score) => createPseudoTranslatorBanner(score)),
  createOspContributorExampleBanner(10),
  ...LATEST_TOURNAMENT_EXAMPLES.map((example) => createLatestTournamentExampleBanner(example)),
  ...RANKING_EXAMPLES.map((example) => createRankingExampleBanner(example)),
  ...FASTEST_WIN_EXAMPLES.map((example) => createFastestWinExampleBanner(example)),
  ...WIN_STREAK_EXAMPLES.map((streak) => createWinStreakExampleBanner(streak)),
  ...CURRENT_WIN_STREAK_EXAMPLES.map((streak) => createCurrentWinStreakExampleBanner(streak))
].filter(Boolean).sort(compareBannerByTitle);

export const SECOND_ANNIVERSARY_AWARD_RECIPIENTS = [
  { username: "Sapher", bannerId: "cnc-2nd-anniversary-skill-champion" },
  { username: "Wong", bannerId: "cnc-2nd-anniversary-skill-2" },
  { username: "Tanach", bannerId: "cnc-2nd-anniversary-skill-3" },
  { username: "Rutnb", bannerId: "cnc-2nd-anniversary-ent-champion" },
  { username: "sekai", bannerId: "cnc-2nd-anniversary-ent-2" },
  { username: "Wong", bannerId: "cnc-2nd-anniversary-ent-3" },
  { username: "vayu", bannerId: "cnc-2nd-anniversary-ent-special" }
];

export const GOONKEMON_HUNTERS = [
  GOONKEMON_HUNTER_EXAMPLE,
  { username: "sekai", captureId: "20260622T153834Z-sekai-Diosoekej", title: "Diosoekej.", score: 258 },
  { username: "Wong", captureId: "20260627T145501Z-Wong-Aptuad", title: "Aptuad.", score: 206 },
  { username: "sasameki", captureId: "20260628T021220Z-sasameki-Vejouc", title: "Vejouc.", score: 184 },
  { username: "fbynet", captureId: "20260627T095723Z-fbynet-Bebos", title: "Bebos.", score: 178 },
  { username: "Tanach", captureId: "20260620T113133Z-Tanach-Hud_Mal", title: "Hud Mal.", score: 174 },
  { username: "eachpiece", captureId: "20260621T044638Z-eachpiece-Iquerahe", title: "Iquerahe.", score: 156 },
  { username: "vayu", captureId: "20260619T014959Z-vayu-Yxexats", title: "Yxexats.", score: 35 },
  { username: "malfuriongg", captureId: "20260620T060625Z-malfuriongg-Acax", title: "Acax.", score: 149 },
  { username: "zonber", captureId: "20260620T124649Z-zonber-Qarcho", title: "Qarcho.", score: 126 },
  { username: "bizarrehands", captureId: "20260620T144139Z-bizarrehands-Lablunt", title: "Lablunt.", score: 124 },
  { username: "jk645200", captureId: "20260620T232125Z-jk645200-Ceukk", title: "Ceukk.", score: 120 },
  { username: "dilly", captureId: "20260620T073116Z-dilly-Faneots", title: "Faneots.", score: 118 },
  { username: "Asidra", captureId: "20260625T165518Z-Asidra-Josche_Jyif", title: "Josche Jyif.", score: 111 },
  { username: "opking", captureId: "20260619T042055Z-opking-Qieg", title: "Qieg.", score: 108 },
  { username: "Dogchiho", captureId: "20260619T142159Z-Dogchiho-Zixa", title: "Zixa.", score: 103 },
  { username: "De02", captureId: "20260619T130809Z-De02-Utzead", title: "Utzead.", score: 102 }
];

export const INITIAL_PROFILES = [
  {
    username: "WizardModePhilia",
    banner: getBannerDefinition("wizard-account")
  },
  {
    username: "sasameki",
    banner: getBannerDefinition("cnc-1st-anniversary-skill-champion")
  },
  {
    username: "opking",
    banner: getBannerDefinition("cnc-1st-anniversary-skill-2")
  },
  {
    username: "sekai",
    banner: getBannerDefinition("cnc-1st-anniversary-skill-3")
  },
  {
    username: "unreal",
    banner: getBannerDefinition("cnc-1st-anniversary-ent-champion")
  },
  {
    username: "Mumonspawn",
    banner: getBannerDefinition("cnc-1st-anniversary-ent-2")
  },
  {
    username: "Dogchiho",
    banner: getBannerDefinition("cnc-1st-anniversary-ent-3")
  },
  ...SECOND_ANNIVERSARY_AWARD_RECIPIENTS.map(({ username, bannerId }) => ({
    username,
    banner: getBannerDefinition(bannerId)
  })),
  ...GOONKEMON_HUNTERS.map((hunter) => ({
    username: hunter.username,
    banner: createGoonkemonHunterBanner(hunter)
  })),
  {
    username: "opking",
    banner: getBannerDefinition("cnc-2nd-tournament-proposer")
  },
  {
    username: "beem",
    banner: getBannerDefinition("bot")
  },
  {
    username: "CNCPublicChat",
    banner: getBannerDefinition("bot")
  },
  {
    username: "wtrec",
    banner: getBannerDefinition("bot")
  },
  ...BANNER_EXAMPLE_BANNERS.map((banner) => ({
    username: "BannerExamples",
    banner
  }))
];

export function getBannerDefinition(id) {
  const banner = BANNER_DEFINITIONS.find((item) => item.id === id);
  return banner ? cloneBanner(banner) : null;
}

function createNemelexUsernameStyle(split, time = 60) {
  return {
    id: "nemelex",
    data: {
      split,
      time,
      colors: [...NEMELEX_COLORS]
    }
  };
}

function createImagePrefixUsernameStyle(iconUrl, { pixelated = false } = {}) {
  return {
    id: "image-prefix",
    data: {
      iconUrl,
      ...(pixelated ? { pixelated: true } : {})
    }
  };
}

export function createGoonkemonHunterBanner({ captureId, title, score }) {
  const safeCaptureId = String(captureId ?? "").trim();
  const safeTitle = String(title ?? "Goonkemon").trim() || "Goonkemon";
  const safeScore = Math.max(0, Math.floor(Number(score) || 0));
  const encodedCaptureId = encodeURIComponent(safeCaptureId);

  return {
    id: "goonkemon-hunter",
    title: "Goonkemon Hunter",
    url: `${BANNER_URLS.goonkemon}/${encodedCaptureId}`,
    detail: {
      value: `${safeTitle} (${safeScore} pts)`
    },
    usernameStyle: createImagePrefixUsernameStyle(
      `${CNC_SECOND_ANNIVERSARY_ASSET_BASE}/goonkemon/${encodedCaptureId}-upper.png`,
      { pixelated: true }
    )
  };
}

function createPseudoCncBanner(rank) {
  return {
    id: `pseudo-cnc-${rank}`,
    title: getPseudoCncTitle(rank),
    url: BANNER_URLS.tournamentResults,
    usernameStyle: createNemelexUsernameStyle(rank)
  };
}

function getPseudoCncTitle(rank) {
  if (rank === 1) return "CNC (1st) Champion";
  if (rank === 2) return "CNC (1st) Runner-up";
  if (rank === 3) return "CNC (1st) Third Place";
  return `CNC (1st) Rank ${rank}`;
}

function createPseudoDonorBanner(index, amount) {
  const donation = Math.max(0, Math.floor(Number(amount) || 0));
  return {
    id: `pseudo-donor-${index}`,
    title: `Donor ${index}`,
    url: BANNER_URLS.donation,
    detail: createDonationDetail(donation, "Cumulative"),
    usernameStyle: {
      id: "donor",
      data: { donation }
    }
  };
}

function createPseudoTranslatorBanner(score) {
  const banner = createTranslatorBanner(score);
  return {
    ...banner,
    id: `pseudo-translator-${score}`,
    title: `Translation Contributor (${score.toLocaleString("en-US")})`
  };
}

export function createDonorBanner(amount) {
  const donation = Math.max(0, Math.floor(Number(amount) || 0));
  return {
    id: "donor",
    title: "Donor (Cumulative)",
    url: BANNER_URLS.donation,
    detail: createDonationDetail(donation, "Cumulative"),
    usernameStyle: {
      id: "donor",
      data: { donation }
    }
  };
}

export function createRecentDonorBanner(amount, { lookbackDays = 45 } = {}) {
  const donation = Math.max(0, Math.floor(Number(amount) || 0));
  const safeLookbackDays = Math.max(1, Math.floor(Number(lookbackDays) || 45));
  return {
    id: "donor-recent",
    title: "Donor",
    url: BANNER_URLS.donation,
    detail: createDonationDetail(donation, `Recent ${safeLookbackDays} days`),
    usernameStyle: {
      id: "donor-recent",
      data: {
        donation,
        iconUrl: BANNER_ASSETS.donorRecentIcon
      }
    }
  };
}

export function createRankingBanner({ rank, serverRank, score }) {
  const safeRank = Math.max(1, Math.floor(Number(rank) || 1));
  const safeServerRank = Math.max(1, Math.floor(Number(serverRank) || safeRank));
  const safeScore = Math.max(0, Math.floor(Number(score) || 0));
  return {
    id: "ranking",
    title: `Trunk Score Ranking #${safeRank}`,
    url: BANNER_URLS.logfileViewer,
    detail: {
      value: `(CNC Ranking #${safeServerRank})`,
      subvalue: `Score: ${safeScore.toLocaleString("en-US")}`
    },
    usernameStyle: {
      id: "ranking",
      data: {
        rank: safeRank,
        serverRank: safeServerRank,
        score: safeScore,
        badge: getRankingBadge(safeServerRank)
      }
    }
  };
}

export function createFastestWinBanner({ rank, serverRank, durationSeconds }) {
  const safeRank = Math.max(1, Math.floor(Number(rank) || 1));
  const safeServerRank = Math.max(1, Math.floor(Number(serverRank) || safeRank));
  const safeDurationSeconds = Math.max(0, Math.floor(Number(durationSeconds) || 0));
  return {
    id: "fastest-win",
    title: "Trunk Fastest Wins",
    url: BANNER_URLS.logfileViewer,
    detail: {
      value: `(CNC Ranking #${safeServerRank})`,
      subvalue: `Time: ${formatDurationSeconds(safeDurationSeconds)}`
    },
    usernameStyle: {
      id: "fastest-win",
      data: {
        rank: safeRank,
        serverRank: safeServerRank,
        durationSeconds: safeDurationSeconds,
        badge: getFastestWinBadge(safeServerRank)
      }
    }
  };
}

export function createWinStreakBanner({ streak }) {
  const safeStreak = Math.max(1, Math.floor(Number(streak) || 1));
  return {
    id: "win-streak",
    title: "Trunk Win Streak",
    url: BANNER_URLS.logfileViewer,
    detail: createWinStreakDetail(safeStreak),
    usernameStyle: {
      id: "win-streak",
      data: {
        streak: safeStreak
      }
    }
  };
}

export function createCurrentWinStreakBanner({ streak }) {
  const safeStreak = Math.max(1, Math.floor(Number(streak) || 1));
  return {
    id: "current-win-streak",
    title: "Trunk Win Streak",
    url: BANNER_URLS.logfileViewer,
    detail: createCurrentWinStreakDetail(safeStreak),
    usernameStyle: {
      id: "current-win-streak",
      data: {
        streak: safeStreak
      }
    }
  };
}

export function createDcssContributorBanner({ lineNumber } = {}) {
  const banner = getBannerDefinition("dcss-contributor");
  const safeLineNumber = Math.floor(Number(lineNumber) || 0);
  if (safeLineNumber > 0) {
    banner.url = `${BANNER_URLS.credits}#L${safeLineNumber}`;
  }
  return banner;
}

export function createOspContributorBanner(count) {
  const safeCount = Math.max(1, Math.floor(Number(count) || 1));
  return {
    id: "osp-contributor",
    title: safeCount > 1 ? `OSP Contributor (${safeCount.toLocaleString("en-US")})` : "OSP Contributor",
    url: BANNER_URLS.osp,
    usernameStyle: {
      id: "osp-contributor",
      data: {
        count: safeCount
      }
    }
  };
}

export function createLatestTournamentBanner({ version, rank, score, clan, url }) {
  const safeVersion = String(version || "").trim();
  const safeRank = Math.max(1, Math.floor(Number(rank) || 1));
  const safeScore = Math.max(0, Math.floor(Number(score) || 0));
  const safeClan = String(clan || "").trim();
  const safeUrl = String(url || "").trim() || `${BANNER_URLS.tournament}/${encodeURIComponent(safeVersion)}/all-players-ranks.html`;
  return {
    id: "latest-tournament",
    title: `Latest Tournament (v${safeVersion})`,
    url: safeUrl,
    detail: createTournamentDetail({
      rank: safeRank,
      score: safeScore,
      clan: safeClan
    }),
    usernameStyle: {
      id: "latest-tournament",
      data: {
        badge: "🏁",
        version: safeVersion,
        rank: safeRank,
        score: safeScore,
        clan: safeClan
      }
    }
  };
}

function createRankingExampleBanner({ id, serverRankLabel, rank, serverRank, score }) {
  const banner = createRankingBanner({ rank, serverRank, score });
  return {
    ...banner,
    id: `example-ranking-${id}`,
    title: "Trunk Score Ranking",
    detail: {
      ...banner.detail,
      value: `(CNC Ranking ${serverRankLabel})`
    }
  };
}

function createFastestWinExampleBanner({ id, serverRankLabel, rank, serverRank, durationSeconds }) {
  const banner = createFastestWinBanner({ rank, serverRank, durationSeconds });
  return {
    ...banner,
    id: `example-fastest-win-${id}`,
    title: "Trunk Fastest Wins",
    detail: {
      ...banner.detail,
      value: `(CNC Ranking ${serverRankLabel})`
    }
  };
}

function createWinStreakExampleBanner(streak) {
  return {
    ...createWinStreakBanner({ streak }),
    id: `example-win-streak-${streak}`
  };
}

function createCurrentWinStreakExampleBanner(streak) {
  return {
    ...createCurrentWinStreakBanner({ streak }),
    id: `example-current-win-streak-${streak}`
  };
}

function createOspContributorExampleBanner(count) {
  return {
    ...createOspContributorBanner(count),
    id: `example-osp-contributor-${count}`
  };
}

function createRecentDonorExampleBanner(amount) {
  return {
    ...createRecentDonorBanner(amount),
    id: "example-donor-recent"
  };
}

function createLatestTournamentExampleBanner({ id, version, rank, score, clan }) {
  return {
    ...createLatestTournamentBanner({
      version,
      rank,
      score,
      clan,
      url: `${BANNER_URLS.tournament}/${encodeURIComponent(version)}/players/bannerexamples.html`
    }),
    id: `example-latest-tournament-${id}`
  };
}

export function getRankingBadge(rank) {
  const safeRank = Math.max(1, Math.floor(Number(rank) || 1));
  if (safeRank === 1) return "👑";
  if (safeRank <= 3) return "🏆";
  if (safeRank <= 10) return "🥇";
  if (safeRank <= 25) return "💎";
  if (safeRank <= 50) return "🌟";
  if (safeRank <= 100) return "⭐";
  return "";
}

export function getFastestWinBadge(rank) {
  const safeRank = Math.max(1, Math.floor(Number(rank) || 1));
  if (safeRank === 1) return "⚡";
  if (safeRank <= 3) return "🚀";
  if (safeRank <= 5) return "🏎️";
  if (safeRank <= 10) return "💨";
  return "";
}

export function formatDurationSeconds(value) {
  const totalSeconds = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (part) => String(part).padStart(2, "0");
  return `${hours}:${pad(minutes)}:${pad(seconds)}`;
}

function createDonationDetail(donation, label) {
  return {
    label,
    value: `${donation.toLocaleString("en-US")} KRW`
  };
}

function createWinStreakDetail(streak) {
  return {
    value: `Best Streak: ${streak.toLocaleString("en-US")} ${streak === 1 ? "win" : "wins"}`
  };
}

function createCurrentWinStreakDetail(streak) {
  return {
    value: `Current Streak: ${streak.toLocaleString("en-US")} ${streak === 1 ? "win" : "wins"}`
  };
}

function createTournamentDetail({ rank, score, clan }) {
  const detail = {
    value: `#${rank.toLocaleString("en-US")}, Score: ${score.toLocaleString("en-US")}`
  };
  if (clan) {
    detail.subvalue = clan;
  }
  return detail;
}

export function createTranslatorBanner(score, { threshold = 500, maxScore = 5000 } = {}) {
  const safeScore = Math.max(0, Math.floor(Number(score) || 0));
  const denominator = Math.max(1, maxScore - threshold);
  const intensity = Math.max(0, Math.min(1, (safeScore - threshold) / denominator));
  return {
    id: "translator",
    title: `Translation Contributor (${safeScore.toLocaleString("en-US")})`,
    url: BANNER_URLS.translation,
    usernameStyle: {
      id: "translator",
      data: {
        score: safeScore,
        threshold,
        maxScore,
        intensity
      }
    }
  };
}

export function cloneBanner(banner) {
  return JSON.parse(JSON.stringify(banner));
}

export function compareBannerByTitle(a, b) {
  return getBannerTitleSortKey(a).localeCompare(getBannerTitleSortKey(b), "en-US", {
    numeric: true,
    sensitivity: "base"
  }) || String(a?.id ?? "").localeCompare(String(b?.id ?? ""), "en-US", {
    numeric: true,
    sensitivity: "base"
  });
}

function getBannerTitleSortKey(banner) {
  return String(banner?.title ?? "").replace(/\s+/g, " ").trim();
}
