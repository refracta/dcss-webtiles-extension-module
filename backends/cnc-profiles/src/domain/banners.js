export const PROFILE_SCHEMA_VERSION = 1;

export const BANNER_URLS = {
  tournamentResults: "https://refracta.github.io/nemelex.cards/cnc-1st-anniversary-tournament/results.html",
  donation: "https://donation.abstr.net/list",
  translation: "https://docs.google.com/document/d/1AFNN3L139L3U9cMPNpFOViutlpaJ2rCdiJtkJ0g2ykY/edit?usp=sharing",
  profiles: "https://profiles.nemelex.cards"
};

export const BANNER_DEFINITIONS = [
  {
    id: "wizard-account",
    title: "Wizard Account",
    url: BANNER_URLS.tournamentResults,
    usernameStyle: { id: "nemelex", data: { split: 1, time: 60 } }
  },
  {
    id: "cnc-1st-anniversary-skill-champion",
    title: "CNC 1st Anniversary Tournament Champion (Skill Category)",
    url: BANNER_URLS.tournamentResults,
    usernameStyle: { id: "nemelex", data: { split: 1, time: 60 } }
  },
  {
    id: "cnc-1st-anniversary-skill-2",
    title: "CNC 1st Anniversary Tournament 2nd Place (Skill Category)",
    url: BANNER_URLS.tournamentResults,
    usernameStyle: { id: "nemelex", data: { split: 2, time: 60 } }
  },
  {
    id: "cnc-1st-anniversary-skill-3",
    title: "CNC 1st Anniversary Tournament 3rd Place (Skill Category)",
    url: BANNER_URLS.tournamentResults,
    usernameStyle: { id: "nemelex", data: { split: 3, time: 60 } }
  },
  {
    id: "cnc-1st-anniversary-ent-champion",
    title: "CNC 1st Anniversary Tournament Champion (Ent Category)",
    url: BANNER_URLS.tournamentResults,
    usernameStyle: { id: "nemelex", data: { split: 1, time: 60 } }
  },
  {
    id: "cnc-1st-anniversary-ent-2",
    title: "CNC 1st Anniversary Tournament 2nd Place (Ent Category)",
    url: BANNER_URLS.tournamentResults,
    usernameStyle: { id: "nemelex", data: { split: 2, time: 60 } }
  },
  {
    id: "cnc-1st-anniversary-ent-3",
    title: "CNC 1st Anniversary Tournament 3rd Place (Ent Category)",
    url: BANNER_URLS.tournamentResults,
    usernameStyle: { id: "nemelex", data: { split: 3, time: 60 } }
  },
  {
    id: "donator",
    title: "Donator",
    url: BANNER_URLS.donation,
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
  }
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
  }
];

export function getBannerDefinition(id) {
  const banner = BANNER_DEFINITIONS.find((item) => item.id === id);
  return banner ? cloneBanner(banner) : null;
}

export function createDonatorBanner(amount) {
  const donation = Math.max(0, Math.floor(Number(amount) || 0));
  return {
    id: "donator",
    title: `Donator (${donation.toLocaleString("en-US")} KRW)`,
    url: BANNER_URLS.donation,
    usernameStyle: {
      id: "donator",
      data: { donation }
    }
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
