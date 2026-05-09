import { readFile } from "node:fs/promises";
import path from "node:path";

export const rootDir = path.resolve(new URL(".", import.meta.url).pathname, "..");

const DEFAULT_CONFIG = {
  server: {
    host: "0.0.0.0",
    port: 3000
  },
  siteUrl: "https://profiles.nemelex.cards",
  database: {
    file: "data/profiles.json"
  },
  session: {
    secret: "change-me-before-production",
    maxAgeSeconds: 7 * 24 * 60 * 60,
    secureCookie: true
  },
  cors: {
    allowedOrigins: [
      "https://crawl.nemelex.cards",
      "https://profiles.nemelex.cards"
    ]
  },
  watchers: {
    pullPeriod: 30,
    donation: {
      enabled: true,
      url: "https://donation.abstr.net/api/donation"
    },
    translation: {
      enabled: true,
      url: "https://translation.nemelex.cards/statistics",
      threshold: 500,
      maxScore: 5000
    },
    logfile: {
      enabled: true,
      url: "https://archive.nemelex.cards/meta/crawl-git/logfile",
      pullPeriod: 300,
      limit: 100
    }
  },
  auth: {
    cnc: {
      origin: "https://crawl.nemelex.cards",
      timeoutMs: 12000
    }
  }
};

export async function loadConfig(configPath = path.join(rootDir, "config.json")) {
  let config = {};

  try {
    config = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  const merged = mergeConfig(DEFAULT_CONFIG, config);
  merged.session.secret = process.env.CNC_PROFILES_SESSION_SECRET || merged.session.secret;
  merged.session.secureCookie = parseBooleanEnv(process.env.CNC_PROFILES_SECURE_COOKIE, merged.session.secureCookie);
  return merged;
}

function mergeConfig(base, override) {
  const merged = { ...base };

  for (const [key, value] of Object.entries(override ?? {})) {
    if (isPlainObject(value) && isPlainObject(base[key])) {
      merged[key] = mergeConfig(base[key], value);
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function parseBooleanEnv(value, fallback) {
  if (value === undefined) return fallback;
  return value === "true";
}
