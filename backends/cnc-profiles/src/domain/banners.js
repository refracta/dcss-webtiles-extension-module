export const PROFILE_SCHEMA_VERSION = 1;

export const BANNER_URLS = {
  tournamentResults: "https://refracta.github.io/nemelex.cards/cnc-1st-anniversary-tournament/results.html",
  donation: "https://donation.abstr.net/list",
  logfile: "https://archive.nemelex.cards/meta/crawl-git/logfile",
  logfileViewer: "https://archive.nemelex.cards/meta/crawl-git?file=logfile",
  translation: "https://docs.google.com/document/d/1AFNN3L139L3U9cMPNpFOViutlpaJ2rCdiJtkJ0g2ykY/edit?usp=sharing",
  profiles: "https://profiles.nemelex.cards"
};

export const NEMELEX_COLORS = ["#008cc0", "#009800", "#8000ff", "#cad700", "#ff4000"];
export const PSEUDO_CNC_RANKS = [1, 2, 3];
export const PSEUDO_DONATOR_AMOUNTS = [20000, 40000, 60000, 80000, 100000];

export const BANNER_DEFINITIONS = [
  {
    id: "wizard-account",
    title: "Wizard Account",
    url: BANNER_URLS.tournamentResults,
    usernameStyle: createNemelexUsernameStyle(1)
  },
  {
    id: "cnc-1st-anniversary-skill-champion",
    title: "CNC 1st Anniversary Tournament Champion (Skill Category)",
    url: BANNER_URLS.tournamentResults,
    usernameStyle: createNemelexUsernameStyle(1)
  },
  {
    id: "cnc-1st-anniversary-skill-2",
    title: "CNC 1st Anniversary Tournament 2nd Place (Skill Category)",
    url: BANNER_URLS.tournamentResults,
    usernameStyle: createNemelexUsernameStyle(2)
  },
  {
    id: "cnc-1st-anniversary-skill-3",
    title: "CNC 1st Anniversary Tournament 3rd Place (Skill Category)",
    url: BANNER_URLS.tournamentResults,
    usernameStyle: createNemelexUsernameStyle(3)
  },
  {
    id: "cnc-1st-anniversary-ent-champion",
    title: "CNC 1st Anniversary Tournament Champion (Ent Category)",
    url: BANNER_URLS.tournamentResults,
    usernameStyle: createNemelexUsernameStyle(1)
  },
  {
    id: "cnc-1st-anniversary-ent-2",
    title: "CNC 1st Anniversary Tournament 2nd Place (Ent Category)",
    url: BANNER_URLS.tournamentResults,
    usernameStyle: createNemelexUsernameStyle(2)
  },
  {
    id: "cnc-1st-anniversary-ent-3",
    title: "CNC 1st Anniversary Tournament 3rd Place (Ent Category)",
    url: BANNER_URLS.tournamentResults,
    usernameStyle: createNemelexUsernameStyle(3)
  },
  {
    id: "donator",
    title: "Donator",
    url: BANNER_URLS.donation,
    detail: createDonationDetail(0),
    usernameStyle: { id: "donator", data: { donation: 0 } }
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
    title: "Trunk Game Ranking",
    url: BANNER_URLS.logfileViewer,
    usernameStyle: { id: "ranking", data: { rank: 100, badge: getRankingBadge(100) } }
  },
  ...PSEUDO_CNC_RANKS.map((rank) => createPseudoCncBanner(rank)),
  ...PSEUDO_DONATOR_AMOUNTS.map((amount, index) => createPseudoDonatorBanner(index + 1, amount))
];

const ASCII_PHILIA_ADMIN_BANNER_IDS = [
  "bot",
  ...PSEUDO_CNC_RANKS.map((rank) => `pseudo-cnc-${rank}`),
  ...PSEUDO_DONATOR_AMOUNTS.map((_, index) => `pseudo-donator-${index + 1}`)
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
  ...ASCII_PHILIA_ADMIN_BANNER_IDS.map((id) => ({
    username: "ASCIIPhilia",
    banner: getBannerDefinition(id)
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

function createPseudoCncBanner(rank) {
  return {
    id: `pseudo-cnc-${rank}`,
    title: getPseudoCncTitle(rank),
    url: BANNER_URLS.tournamentResults,
    usernameStyle: createNemelexUsernameStyle(rank)
  };
}

function getPseudoCncTitle(rank) {
  if (rank === 1) return "Pseudo CNC Champion";
  if (rank === 2) return "Pseudo CNC Runner-up";
  if (rank === 3) return "Pseudo CNC Third Place";
  return `Pseudo CNC Rank ${rank}`;
}

function createPseudoDonatorBanner(index, amount) {
  const donation = Math.max(0, Math.floor(Number(amount) || 0));
  return {
    id: `pseudo-donator-${index}`,
    title: `Pseudo Donator ${index}`,
    url: BANNER_URLS.donation,
    detail: createDonationDetail(donation),
    usernameStyle: {
      id: "donator",
      data: { donation }
    }
  };
}

export function createDonatorBanner(amount) {
  const donation = Math.max(0, Math.floor(Number(amount) || 0));
  return {
    id: "donator",
    title: "Donator",
    url: BANNER_URLS.donation,
    detail: createDonationDetail(donation),
    usernameStyle: {
      id: "donator",
      data: { donation }
    }
  };
}

export function createRankingBanner({ rank, score }) {
  const safeRank = Math.max(1, Math.floor(Number(rank) || 1));
  const safeScore = Math.max(0, Math.floor(Number(score) || 0));
  return {
    id: "ranking",
    title: `Trunk Game Ranking #${safeRank}`,
    url: BANNER_URLS.logfileViewer,
    detail: {
      label: "Score",
      value: safeScore.toLocaleString("en-US")
    },
    usernameStyle: {
      id: "ranking",
      data: {
        rank: safeRank,
        score: safeScore,
        badge: getRankingBadge(safeRank)
      }
    }
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

function createDonationDetail(donation) {
  return {
    label: "This month",
    value: `${donation.toLocaleString("en-US")} KRW`
  };
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
