const state = {
  profile: null,
  publicProfile: null,
  entityPages: {
    private: createEntityPageState(),
    public: createEntityPageState()
  }
};

const NEMELEX_COLORS = ["#008cc0", "#009800", "#8000ff", "#cad700", "#ff4000"];
const CHAT_API_BASE = "https://chat.nemelex.cards";
const ENTITY_PAGE_SIZES = {
  game: 24,
  item: 12
};

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
  publicBannerList: document.querySelector("#public-banner-list"),
  tabButtons: document.querySelectorAll("[data-tab-scope][data-tab-name]"),
  tabPanels: document.querySelectorAll("[data-tab-panel-scope][data-tab-panel-name]")
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

for (const button of elements.tabButtons) {
  button.addEventListener("click", () => {
    showTab(button.dataset.tabScope, button.dataset.tabName);
  });
}

for (const button of document.querySelectorAll("[data-entity-prev]")) {
  button.addEventListener("click", () => {
    const { scope, type } = parseEntityKey(button.dataset.entityPrev);
    const page = state.entityPages[scope][type];
    loadEntityPage(scope, type, Math.max(0, page.offset - getEntityPageSize(type)));
  });
}

for (const button of document.querySelectorAll("[data-entity-next]")) {
  button.addEventListener("click", () => {
    const { scope, type } = parseEntityKey(button.dataset.entityNext);
    const page = state.entityPages[scope][type];
    loadEntityPage(scope, type, page.offset + getEntityPageSize(type));
  });
}

for (const input of document.querySelectorAll("[data-entity-search]")) {
  let searchTimer = null;
  input.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      const { scope, type } = parseEntityKey(input.dataset.entitySearch);
      const page = state.entityPages[scope][type];
      page.q = input.value.trim();
      loadEntityPage(scope, type, 0);
    }, 250);
  });
}

const publicProfileUsername = getPublicProfileUsername();
if (publicProfileUsername) {
  loadPublicProfile(publicProfileUsername);
} else {
  loadMe();
}

async function loadPublicProfile(username) {
  state.profile = null;
  state.publicProfile = null;
  resetEntityScope("public");
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
  resetEntityScope("private");
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
  showTab("private", "banners");
}

function renderPublicProfile(profile) {
  state.publicProfile = profile;
  const banners = Array.isArray(profile.banners) ? profile.banners : [];
  document.title = `${profile.username} - CNC Profiles`;
  elements.publicProfileUsername.textContent = profile.username;
  elements.publicProfileUpdated.textContent = `Last updated: ${formatDate(profile.lastUpdatedAt)}`;
  elements.publicProfilePreview.innerHTML = renderStyledUsername(profile.username, profile.currentBanner?.usernameStyle);
  elements.publicProfileStatus.textContent = banners.length > 0 ? "" : "No banners.";
  elements.publicBannerList.replaceChildren(
    ...banners.map((banner) => createPublicBannerCard(profile, banner))
  );
  showTab("public", "banners");
}

function showTab(scope, tabName) {
  for (const button of elements.tabButtons) {
    if (button.dataset.tabScope !== scope) continue;
    button.setAttribute("aria-selected", String(button.dataset.tabName === tabName));
  }

  for (const panel of elements.tabPanels) {
    if (panel.dataset.tabPanelScope !== scope) continue;
    panel.hidden = panel.dataset.tabPanelName !== tabName;
  }

  if (tabName === "game" || tabName === "item") {
    const page = state.entityPages[scope][tabName];
    if (!page.loaded) {
      loadEntityPage(scope, tabName, 0);
    }
  }
}

async function loadEntityPage(scope, type, offset) {
  const profile = scope === "private" ? state.profile : state.publicProfile;
  if (!profile?.username) return;

  const page = state.entityPages[scope][type];
  page.offset = Math.max(0, offset);
  const list = getEntityListElement(scope, type);
  const status = getEntityStatusElement(scope, type);
  status.textContent = "Loading...";
  const pageSize = getEntityPageSize(type);

  try {
    const params = new URLSearchParams({
      type,
      limit: String(pageSize),
      offset: String(page.offset),
      order: "desc"
    });
    if (type === "item" && page.q) {
      params.set("q", page.q);
    }

    const data = await requestPublicJson(`${CHAT_API_BASE}/users/${encodeURIComponent(profile.username)}/entities?${params}`);
    page.loaded = true;
    page.total = data.total || 0;
    page.offset = data.offset || 0;
    renderEntityPage(scope, type, data.entities || []);
    status.textContent = "";
  } catch (error) {
    list.replaceChildren();
    renderPager(scope, type);
    status.textContent = error.message;
  }
}

function renderEntityPage(scope, type, entities) {
  const list = getEntityListElement(scope, type);
  if (!entities.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = type === "game" ? "No game images." : "No items.";
    list.replaceChildren(empty);
  } else {
    list.replaceChildren(...entities.map((entity) => createEntityCard(entity, type, scope)));
  }
  renderPager(scope, type);
}

function createEntityCard(entity, type, scope) {
  if (type === "game") {
    return createGameEntityCard(entity);
  }

  if (type === "item") {
    return createItemEntityCard(entity, scope);
  }

  return document.createElement("article");
}

function createItemEntityCard(entity, scope) {
  const profile = scope === "private" ? state.profile : state.publicProfile;
  const username = entity.user || profile?.username || "";

  const card = document.createElement("article");
  card.className = "item-chat-row";

  const author = document.createElement("span");
  author.className = "chat-sender";
  author.innerHTML = `${renderStyledUsername(username, profile?.currentBanner?.usernameStyle)}'s Item`;

  const separator = document.createTextNode(": ");
  const message = document.createElement("span");
  message.className = "chat-message";

  const media = document.createElement("a");
  media.className = "item-chat-media";
  media.href = entity.file;
  media.target = "_blank";
  media.rel = "noopener noreferrer";
  media.download = getEntityDownloadName(entity, "item");
  media.addEventListener("click", (event) => {
    event.preventDefault();
    downloadImage(entity.file, getEntityDownloadName(entity, "item"));
  });

  const image = document.createElement("img");
  image.src = entity.file;
  image.alt = entity.item || "Item image";
  image.loading = "lazy";
  media.append(image);

  const item = document.createElement("span");
  item.className = "item-chat-name";
  item.style.color = isSafeCssColor(entity.color) ? entity.color : "#20231f";
  item.textContent = entity.item || `Item #${entity.number}`;

  const meta = document.createElement("span");
  meta.className = "item-chat-meta";
  meta.textContent = formatDate(entity.timestamp);

  message.append(media, item);
  card.append(author, separator, message, meta);
  return card;
}

function createGameEntityCard(entity) {
  const card = document.createElement("article");
  card.className = "game-card";

  const media = document.createElement("a");
  media.className = "entity-media";
  media.href = entity.file;
  media.target = "_blank";
  media.rel = "noopener noreferrer";
  media.download = getEntityDownloadName(entity, "game");
  media.addEventListener("click", (event) => {
    event.preventDefault();
    openImagePopup(entity.file, getEntityDownloadName(entity, "game"));
  });

  const image = document.createElement("img");
  image.src = entity.file;
  image.alt = "Game image";
  image.loading = "lazy";
  media.append(image);

  const body = document.createElement("div");
  body.className = "game-card-body";

  const title = document.createElement("div");
  title.className = "entity-title";
  title.textContent = `Game #${entity.number}`;

  const meta = document.createElement("span");
  meta.className = "entity-meta";
  meta.textContent = formatDate(entity.timestamp);

  body.append(title, meta);
  card.append(media, body);
  return card;
}

function getEntityDownloadName(entity, type) {
  const number = Number(entity.number) || Date.now();
  return `cnc-${type}-${number}.png`;
}

function openImagePopup(url, filename) {
  const initialWidth = Math.min(960, Math.max(360, (window.screen.availWidth || window.innerWidth || 960) - 80));
  const initialHeight = Math.min(720, Math.max(360, (window.screen.availHeight || window.innerHeight || 720) - 100));
  const initialLeft = window.screenX + Math.max(0, (window.innerWidth - initialWidth) / 2);
  const initialTop = window.screenY + Math.max(0, (window.innerHeight - initialHeight) / 2);
  const popup = window.open("", "_blank", `width=${initialWidth},height=${initialHeight},left=${initialLeft},top=${initialTop},resizable=yes,scrollbars=yes`);

  if (!popup) {
    window.open(url, "_blank");
    return;
  }

  popup.document.title = filename || "Image viewer";
  popup.document.body.style.margin = "0";
  popup.document.body.style.minHeight = "100vh";
  popup.document.body.style.display = "grid";
  popup.document.body.style.placeItems = "center";
  popup.document.body.style.background = "#000";

  const image = new Image();
  image.src = url;
  image.onload = () => {
    const width = image.naturalWidth || image.width || 960;
    const height = image.naturalHeight || image.height || 720;
    const maxWidth = Math.max(360, (window.screen.availWidth || window.innerWidth || width) - 80);
    const maxHeight = Math.max(360, (window.screen.availHeight || window.innerHeight || height) - 100);
    const popupWidth = Math.min(width, maxWidth);
    const popupHeight = Math.min(height, maxHeight);
    const left = window.screenX + Math.max(0, (window.innerWidth - popupWidth) / 2);
    const top = window.screenY + Math.max(0, (window.innerHeight - popupHeight) / 2);
    if (!popup.closed) {
      popup.resizeTo(popupWidth, popupHeight);
      popup.moveTo(left, top);
    }

    const popupImage = popup.document.createElement("img");
    popupImage.src = url;
    popupImage.alt = filename || "Game image";
    popupImage.style.display = "block";
    popupImage.style.maxWidth = "100%";
    popupImage.style.maxHeight = "100vh";
    popupImage.style.cursor = "pointer";
    popupImage.addEventListener("click", () => popup.close());
    popup.document.body.append(popupImage);
  };
  image.onerror = () => {
    popup.location.href = url;
  };
}

async function downloadImage(url, filename) {
  try {
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename || "image.png";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (error) {
    window.open(url, "_blank");
  }
}

function renderPager(scope, type) {
  const page = state.entityPages[scope][type];
  const pageText = getEntityPageElement(scope, type);
  const prev = document.querySelector(`[data-entity-prev="${scope}:${type}"]`);
  const next = document.querySelector(`[data-entity-next="${scope}:${type}"]`);
  const pageSize = getEntityPageSize(type);
  const start = page.total === 0 ? 0 : page.offset + 1;
  const end = Math.min(page.offset + pageSize, page.total);

  pageText.textContent = `${start}-${end} / ${page.total}`;
  prev.disabled = page.offset <= 0;
  next.disabled = page.offset + pageSize >= page.total;
}

function getEntityPageSize(type) {
  return ENTITY_PAGE_SIZES[type] || 12;
}

function resetEntityScope(scope) {
  state.entityPages[scope] = createEntityPageState();
  for (const type of ["game", "item"]) {
    getEntityListElement(scope, type).replaceChildren();
    getEntityStatusElement(scope, type).textContent = "";
    renderPager(scope, type);
    const search = document.querySelector(`[data-entity-search="${scope}:${type}"]`);
    if (search) {
      search.value = "";
    }
  }
}

function createEntityPageState() {
  return {
    game: { offset: 0, total: 0, loaded: false, q: "" },
    item: { offset: 0, total: 0, loaded: false, q: "" }
  };
}

function parseEntityKey(value) {
  const [scope, type] = String(value || "").split(":");
  return { scope, type };
}

function getEntityListElement(scope, type) {
  return document.querySelector(`[data-entity-list="${scope}:${type}"]`);
}

function getEntityStatusElement(scope, type) {
  return document.querySelector(`[data-entity-status="${scope}:${type}"]`);
}

function getEntityPageElement(scope, type) {
  return document.querySelector(`[data-entity-page="${scope}:${type}"]`);
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
  const titleParts = getBannerTitleParts(banner);
  title.textContent = titleParts.title;
  if (linkTitle && banner.url) {
    title.href = banner.url;
    title.target = "_blank";
    title.rel = "noopener noreferrer";
  }
  row.append(title);

  for (const line of [...titleParts.detailLines, ...getBannerDetailLines(banner.detail)]) {
    const detail = document.createElement("span");
    detail.className = "banner-detail";
    detail.textContent = line;
    row.append(detail);
  }

  return row;
}

function getBannerTitleParts(banner) {
  const titleLines = String(banner.title ?? "").split("\n");
  if (banner.id === "dcss-contributor" && titleLines.length > 1) {
    return {
      title: titleLines[0],
      detailLines: titleLines.slice(1).filter(Boolean)
    };
  }

  return {
    title: banner.title,
    detailLines: []
  };
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

  if (usernameStyle.id === "fastest-win") {
    return `${escapeHtml(usernameStyle.data?.badge || getFastestWinBadge(usernameStyle.data?.rank))}${escapeHtml(username)}`;
  }

  if (usernameStyle.id === "dcss-contributor") {
    return `${escapeHtml(usernameStyle.data?.badge || "🛠️")}${escapeHtml(username)}`;
  }

  if (usernameStyle.id === "osp-contributor") {
    return createOspContributorSpan(username);
  }

  if (usernameStyle.id === "win-streak") {
    return `${escapeHtml(getWinStreakBadge(usernameStyle.data?.streak))}${escapeHtml(username)}`;
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

function getFastestWinBadge(rank) {
  const safeRank = Math.max(1, Math.floor(Number(rank) || 1));
  if (safeRank === 1) return "⚡";
  if (safeRank <= 3) return "🚀";
  if (safeRank <= 5) return "🏎️";
  if (safeRank <= 10) return "💨";
  return "";
}

function getWinStreakBadge(streak) {
  const safeStreak = Math.max(1, Math.floor(Number(streak) || 1));
  const keycaps = {
    0: "0️⃣",
    1: "1️⃣",
    2: "2️⃣",
    3: "3️⃣",
    4: "4️⃣",
    5: "5️⃣",
    6: "6️⃣",
    7: "7️⃣",
    8: "8️⃣",
    9: "9️⃣"
  };
  return String(safeStreak)
    .split("")
    .map((digit) => keycaps[digit] || digit)
    .join("");
}

function createOspContributorSpan(username) {
  const chars = Array.from(String(username || ""));
  if (chars.length === 0) return "";

  const lastIndex = chars.length - 1;
  return chars.map((char, index) => {
    const isLast = index === lastIndex;
    const color = isLast ? "#ff3b30" : "#a8ff3e";
    const shadow = isLast
      ? "0 0 4px rgba(255, 59, 48, 0.55)"
      : "0 0 3px rgba(168, 255, 62, 0.45)";
    return `<span style="color: ${color}; font-weight: 800; text-shadow: ${shadow};">${escapeHtml(char)}</span>`;
  }).join("");
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
  const chroma = Math.pow(t, 1.6);
  const red = mixColor("#607088", "#d61f3c", chroma);
  const paper = mixColor("#dce5ee", "#f8fbff", t);
  const blue = mixColor("#4d6681", "#1457b8", Math.pow(t, 1.1));
  const navy = mixColor("#3b526d", "#0b2f73", t);
  const redStop = 2 + t * 22;
  const whiteStop = 56 - t * 28;
  const blueStop = 76 - t * 18;
  return {
    color: "#4d6681",
    "font-weight": "800",
    "background-image": `linear-gradient(${108 + t * 24}deg, ${red} 0%, ${red} ${redStop}%, ${paper} ${whiteStop}%, ${blue} ${blueStop}%, ${navy} 100%)`,
    "-webkit-background-clip": "text",
    "background-clip": "text",
    "-webkit-text-fill-color": "transparent",
    "text-shadow": `0 0 ${2 + t * 10}px rgba(214, 31, 60, ${t * 0.32}), 0 0 ${3 + t * 12}px rgba(20, 87, 184, ${0.08 + t * 0.34})`
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

function isSafeCssColor(value) {
  return /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(String(value || "").trim());
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

async function requestPublicJson(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}
