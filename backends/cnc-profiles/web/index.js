const state = {
  profile: null
};

const NEMELEX_COLORS = ["#008cc0", "#009800", "#8000ff", "#cad700", "#ff4000"];

const elements = {
  loginPanel: document.querySelector("#login-panel"),
  profilePanel: document.querySelector("#profile-panel"),
  publicProfilePanel: document.querySelector("#public-profile-panel"),
  loginForm: document.querySelector("#login-form"),
  loginStatus: document.querySelector("#login-status"),
  profileStatus: document.querySelector("#profile-status"),
  publicProfileStatus: document.querySelector("#public-profile-status"),
  sessionUser: document.querySelector("#session-user"),
  logoutButton: document.querySelector("#logout-button"),
  profileUsername: document.querySelector("#profile-username"),
  profileUpdated: document.querySelector("#profile-updated"),
  profilePreview: document.querySelector("#profile-preview"),
  bannerList: document.querySelector("#banner-list"),
  publicProfileUsername: document.querySelector("#public-profile-username"),
  publicProfileUpdated: document.querySelector("#public-profile-updated"),
  publicProfilePreview: document.querySelector("#public-profile-preview"),
  publicBannerList: document.querySelector("#public-banner-list")
};

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.loginStatus.textContent = "";

  const formData = new FormData(elements.loginForm);
  const payload = {
    username: formData.get("username"),
    password: formData.get("password")
  };

  try {
    const data = await requestJson("/api/session/login", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    setProfile(data.profile);
    elements.loginForm.reset();
  } catch (error) {
    elements.loginStatus.textContent = error.message;
  }
});

elements.logoutButton.addEventListener("click", async () => {
  await requestJson("/api/session/logout", { method: "POST" });
  setProfile(null);
});

const publicProfileUsername = getPublicProfileUsername();
if (publicProfileUsername) {
  loadPublicProfile(publicProfileUsername);
} else {
  loadMe();
}

async function loadPublicProfile(username) {
  state.profile = null;
  elements.loginPanel.hidden = true;
  elements.profilePanel.hidden = true;
  elements.publicProfilePanel.hidden = false;
  elements.logoutButton.hidden = true;
  elements.sessionUser.textContent = "";
  elements.publicProfileUsername.textContent = username;
  elements.publicProfileUpdated.textContent = "";
  elements.publicProfilePreview.textContent = "";
  elements.publicBannerList.replaceChildren();
  elements.publicProfileStatus.textContent = "Loading profile...";

  try {
    const data = await requestJson(`/api/profile/${encodeURIComponent(username)}`);
    if (!data.profile) {
      document.title = `${username} - CNC Profiles`;
      elements.publicProfileStatus.textContent = "Profile not found.";
      return;
    }

    renderPublicProfile(data.profile);
  } catch (error) {
    elements.publicProfileStatus.textContent = error.message;
  }
}

async function loadMe() {
  const data = await requestJson("/api/me");
  setProfile(data.authenticated ? data.profile : null);
}

async function selectBanner(bannerId) {
  elements.profileStatus.textContent = "";
  try {
    const data = await requestJson("/api/me/current-banner", {
      method: "POST",
      body: JSON.stringify({ bannerId })
    });
    setProfile(data.profile);
    elements.profileStatus.textContent = "Saved.";
  } catch (error) {
    elements.profileStatus.textContent = error.message;
  }
}

function setProfile(profile) {
  state.profile = profile;
  const authenticated = Boolean(profile);
  elements.loginPanel.hidden = authenticated;
  elements.profilePanel.hidden = !authenticated;
  elements.publicProfilePanel.hidden = true;
  elements.logoutButton.hidden = !authenticated;
  elements.sessionUser.textContent = authenticated ? profile.username : "";

  if (!profile) return;
  renderProfile(profile);
}

function renderProfile(profile) {
  elements.profileUsername.textContent = profile.username;
  elements.profileUpdated.textContent = `Last updated: ${formatDate(profile.lastUpdatedAt)}`;
  elements.profilePreview.innerHTML = renderStyledUsername(profile.username, profile.currentBanner?.usernameStyle);

  const banners = [
    {
      id: null,
      title: "No banner",
      url: "",
      usernameStyle: null
    },
    ...profile.banners
  ];

  elements.bannerList.replaceChildren(
    ...banners.map((banner) => createBannerButton(profile, banner))
  );
}

function renderPublicProfile(profile) {
  const banners = Array.isArray(profile.banners) ? profile.banners : [];
  document.title = `${profile.username} - CNC Profiles`;
  elements.publicProfileUsername.textContent = profile.username;
  elements.publicProfileUpdated.textContent = `Last updated: ${formatDate(profile.lastUpdatedAt)}`;
  elements.publicProfilePreview.innerHTML = renderStyledUsername(profile.username, profile.currentBanner?.usernameStyle);
  elements.publicProfileStatus.textContent = banners.length > 0 ? "" : "No banners.";
  elements.publicBannerList.replaceChildren(
    ...banners.map((banner) => createPublicBannerCard(profile, banner))
  );
}

function createBannerButton(profile, banner) {
  const button = document.createElement("button");
  button.className = "banner-button";
  button.type = "button";
  button.dataset.active = String(profile.currentBannerId === banner.id);
  button.addEventListener("click", () => selectBanner(banner.id));

  const titleRow = createBannerTitleRow(banner);

  const preview = document.createElement("span");
  preview.className = "banner-preview";
  preview.innerHTML = renderStyledUsername(profile.username, banner.usernameStyle);

  button.append(titleRow, preview);
  return button;
}

function createPublicBannerCard(profile, banner) {
  const card = document.createElement("article");
  card.className = "banner-card";
  card.dataset.active = String(profile.currentBannerId === banner.id);

  const titleRow = createBannerTitleRow(banner, { linkTitle: true });

  const preview = document.createElement("span");
  preview.className = "banner-preview";
  preview.innerHTML = renderStyledUsername(profile.username, banner.usernameStyle);

  card.append(titleRow, preview);
  return card;
}

function createBannerTitleRow(banner, { linkTitle = false } = {}) {
  const row = document.createElement("span");
  row.className = "banner-title-row";

  const title = linkTitle && banner.url ? document.createElement("a") : document.createElement("span");
  title.className = "banner-title";
  title.textContent = banner.title;
  if (linkTitle && banner.url) {
    title.href = banner.url;
    title.target = "_blank";
    title.rel = "noopener noreferrer";
  }
  row.append(title);

  for (const line of getBannerDetailLines(banner.detail)) {
    const detail = document.createElement("span");
    detail.className = "banner-detail";
    detail.textContent = line;
    row.append(detail);
  }

  return row;
}

function getBannerDetailLines(detail) {
  if (!detail?.value) return [];

  const lines = [
    `${detail.label ? `${detail.label}: ` : ""}${detail.value}`
  ];
  if (detail.subvalue) {
    lines.push(String(detail.subvalue));
  }
  if (Array.isArray(detail.lines)) {
    lines.push(...detail.lines.map((line) => String(line)));
  }
  return lines;
}

function renderStyledUsername(username, usernameStyle) {
  if (!usernameStyle) return escapeHtml(username);

  if (usernameStyle.id === "nemelex") {
    return createNemelexSpan(username, usernameStyle.data);
  }

  if (usernameStyle.id === "donator") {
    return `<span style="${styleToText(getDonatorStyle(usernameStyle.data?.donation))}">${escapeHtml(username)}</span>`;
  }

  if (usernameStyle.id === "translator") {
    return `<span style="${styleToText(getTranslatorStyle(usernameStyle.data?.intensity))}">${escapeHtml(username)}</span>`;
  }

  if (usernameStyle.id === "bot") {
    return `${escapeHtml(usernameStyle.data?.prefix || "🤖")}${escapeHtml(username)}`;
  }

  if (usernameStyle.id === "ranking") {
    return `${escapeHtml(usernameStyle.data?.badge || getRankingBadge(usernameStyle.data?.rank))}${escapeHtml(username)}`;
  }

  return escapeHtml(username);
}

function getRankingBadge(rank) {
  const safeRank = Math.max(1, Math.floor(Number(rank) || 1));
  if (safeRank === 1) return "👑";
  if (safeRank <= 3) return "🏆";
  if (safeRank <= 10) return "🥇";
  if (safeRank <= 25) return "💎";
  if (safeRank <= 50) return "🌟";
  if (safeRank <= 100) return "⭐";
  return "";
}

function createNemelexSpan(text, data = {}) {
  const colors = getNemelexColors(data.colors);
  const split = Math.max(1, Number(data.split) || 1);
  const time = Number(data.time) || 60;
  const intervalMs = Math.abs(time) * 1000;
  const offset = intervalMs > 0 ? Math.floor(Date.now() / intervalMs) % colors.length : 0;
  const rollOffset = time < 0 ? offset : (colors.length - offset) % colors.length;
  const rotated = colors.map((_, index) => colors[(index + rollOffset) % colors.length]);
  const parts = [];

  for (let i = 0; i < text.length; i += split) {
    parts.push(text.substring(i, Math.min(i + split, text.length)));
  }

  return parts.map((part, index) =>
    `<span style="color: ${rotated[index % rotated.length]}">${escapeHtml(part)}</span>`
  ).join("");
}

function getNemelexColors(colors) {
  const safeColors = Array.isArray(colors)
    ? colors
      .map((color) => String(color || "").trim())
      .filter((color) => /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(color))
    : [];
  return safeColors.length > 0 ? safeColors : NEMELEX_COLORS;
}

function getDonatorStyle(amount) {
  const maxAmount = 500000;
  const clamped = Math.max(0, Math.min(maxAmount, Number(amount) || 0));
  const progress = clamped / maxAmount;
  const color = mixGoldColor(Math.pow(progress, 0.72));
  const glowSize = 5 + progress * 18;
  const style = {
    color,
    "font-weight": "800",
    "text-shadow": `0 0 ${glowSize}px rgba(255, 216, 94, ${0.18 + progress * 0.5}), 0 1px 0 rgba(70, 42, 0, ${progress * 0.25})`,
    filter: `drop-shadow(0 0 ${glowSize}px rgba(255, 211, 72, ${0.08 + progress * 0.25}))`
  };

  if (progress >= 0.18) {
    style["background-image"] = `linear-gradient(115deg, ${color} 0%, #fff8d8 ${28 + progress * 18}%, ${color} ${60 + progress * 12}%, #8f6400 100%)`;
    style["-webkit-background-clip"] = "text";
    style["background-clip"] = "text";
    style["-webkit-text-fill-color"] = "transparent";
  }

  return style;
}

function getTranslatorStyle(intensity) {
  const t = Math.max(0, Math.min(1, Number(intensity) || 0));
  const redStop = 8 + t * 16;
  const whiteStop = 50 - t * 20;
  const blueStop = 72 - t * 14;
  return {
    color: "#0f4aa0",
    "font-weight": "800",
    "background-image": `linear-gradient(${110 + t * 20}deg, #c91f37 0%, #c91f37 ${redStop}%, #f5f7fb ${whiteStop}%, #174ea6 ${blueStop}%, #0b2f73 100%)`,
    "-webkit-background-clip": "text",
    "background-clip": "text",
    "-webkit-text-fill-color": "transparent",
    "text-shadow": `0 0 ${3 + t * 9}px rgba(201, 31, 55, ${0.08 + t * 0.2}), 0 0 ${4 + t * 12}px rgba(23, 78, 166, ${0.12 + t * 0.28})`
  };
}

function mixGoldColor(t) {
  const stops = [
    [0, "#ffffff"],
    [0.08, "#fff9e8"],
    [0.18, "#ffefbd"],
    [0.38, "#ffd95f"],
    [0.68, "#efb72e"],
    [1, "#b8860b"]
  ];
  let left = stops[0];
  let right = stops.at(-1);

  for (let i = 0; i < stops.length - 1; i += 1) {
    if (t >= stops[i][0] && t <= stops[i + 1][0]) {
      left = stops[i];
      right = stops[i + 1];
      break;
    }
  }

  const localT = right[0] === left[0] ? 0 : (t - left[0]) / (right[0] - left[0]);
  return mixColor(left[1], right[1], localT);
}

function mixColor(from, to, t) {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  return rgbToHex({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t
  });
}

function hexToRgb(hex) {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255
  };
}

function rgbToHex({ r, g, b }) {
  const toHex = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function styleToText(style) {
  return Object.entries(style).map(([key, value]) => `${key}: ${value}`).join("; ");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value) {
  return new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function getPublicProfileUsername() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts.length !== 1 || parts[0].includes(".")) return "";

  try {
    return decodeURIComponent(parts[0]).trim();
  } catch {
    return "";
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}
