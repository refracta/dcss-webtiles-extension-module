const NEMELEX_COLORS = ["#008cc0", "#009800", "#8000ff", "#cad700", "#ff4000"];
const CHAT_API_BASE = "https://chat.nemelex.cards";
const WTREC_INDEX_BASE = "https://wtrec-json.nemelex.cards/wtrec";
const WTREC_FILE_BASE = "https://wtrec.nemelex.cards/wtrec";
const WTREC_PLAYER_BASE = "https://crawl.nemelex.cards/";
const WTREC_PAGE_SIZE = 100;
const WTREC_INFINITE_SCROLL_MARGIN = 1200;
const ENTITY_PAGE_SIZES = {
  game: 24,
  item: 24
};
const ENTITY_INFINITE_SCROLL_MARGIN = 1200;
const ENTITY_MAX_RENDERED_ITEMS = 300;

const state = {
  profile: null,
  publicProfile: null,
  entityPages: {
    private: createEntityPageState(),
    public: createEntityPageState()
  },
  wtrecs: {
    private: createWTRecState(),
    public: createWTRecState()
  }
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
  bannerList: document.querySelector("#banner-list"),
  publicProfileUsername: document.querySelector("#public-profile-username"),
  publicProfileUpdated: document.querySelector("#public-profile-updated"),
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

for (const input of document.querySelectorAll("[data-wtrec-search]")) {
  let searchTimer = null;
  input.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      const scope = input.dataset.wtrecSearch;
      const page = state.wtrecs[scope];
      page.q = input.value.trim();
      page.visibleCount = WTREC_PAGE_SIZE;
      renderCurrentWTRecList(scope);
    }, 150);
  });
}

for (const select of document.querySelectorAll("[data-wtrec-sort]")) {
  select.addEventListener("change", () => {
    const scope = select.dataset.wtrecSort;
    const page = state.wtrecs[scope];
    page.sort = select.value;
    page.visibleCount = WTREC_PAGE_SIZE;
    renderCurrentWTRecList(scope);
  });
}

setupEntityInfiniteScroll();
setupWTRecInfiniteScroll();

const publicProfileUsername = getPublicProfileUsername();
loadInitialRoute(publicProfileUsername);

async function loadInitialRoute(publicProfileUsername) {
  if (!publicProfileUsername) {
    await loadMe();
    return;
  }

  try {
    const data = await requestJson("/api/me");
    if (data.authenticated && isSameUsername(data.profile?.username, publicProfileUsername)) {
      setProfile(data.profile);
      return;
    }
  } catch {
  }

  await loadPublicProfile(publicProfileUsername);
}

async function loadPublicProfile(username) {
  state.profile = null;
  state.publicProfile = null;
  resetEntityScope("public");
  resetWTRecScope("public");
  elements.loginPanel.hidden = true;
  elements.profilePanel.hidden = true;
  elements.publicProfilePanel.hidden = false;
  elements.logoutButton.hidden = true;
  elements.sessionUser.textContent = "";
  elements.publicProfileUsername.textContent = username;
  elements.publicProfileUpdated.textContent = "";
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
  resetWTRecScope("private");
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
  elements.profileUsername.innerHTML = renderStyledUsername(profile.username, profile.currentBanner?.usernameStyle);
  elements.profileUpdated.textContent = `Last updated: ${formatDate(profile.lastUpdatedAt)}`;

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
  elements.publicProfileUsername.innerHTML = renderStyledUsername(profile.username, profile.currentBanner?.usernameStyle);
  elements.publicProfileUpdated.textContent = `Last updated: ${formatDate(profile.lastUpdatedAt)}`;
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
  } else if (tabName === "wtrec") {
    loadWTRecs(scope);
  }
}

async function loadWTRecs(scope) {
  const profile = scope === "private" ? state.profile : state.publicProfile;
  if (!profile?.username) return;

  const stateForScope = state.wtrecs[scope];
  if (stateForScope.loading || stateForScope.loaded) return;

  const list = getWTRecListElement(scope);
  const status = getWTRecStatusElement(scope);
  stateForScope.loading = true;
  status.textContent = "Loading...";
  list.replaceChildren();

  try {
    const entries = await requestWTRecIndex(profile.username);
    const wtrecs = entries
      .filter((entry) => entry?.type === "file" && String(entry.name || "").endsWith(".wtrec"))
      .sort(compareWTRecEntries);

    stateForScope.entries = wtrecs;
    stateForScope.loaded = true;
    renderCurrentWTRecList(scope);
  } catch (error) {
    status.textContent = error.message;
  } finally {
    stateForScope.loading = false;
  }
}

function renderCurrentWTRecList(scope) {
  const profile = scope === "private" ? state.profile : state.publicProfile;
  const page = state.wtrecs[scope];
  if (!profile?.username || !page.loaded) return;

  const entries = getFilteredWTRecEntries(page);
  const visibleEntries = entries.slice(0, page.visibleCount);
  const emptyText = page.entries.length > 0 ? "No matching WTRECs." : "No WTRECs.";
  renderWTRecList(scope, profile.username, visibleEntries, { emptyText, total: entries.length });
  getWTRecStatusElement(scope).textContent = entries.length > 0 ? "" : emptyText;
  queueWTRecInfiniteScrollCheck();
}

function getFilteredWTRecEntries(page) {
  const query = page.q.toLowerCase();
  const entries = query
    ? page.entries.filter((entry) => String(entry.name || "").toLowerCase().includes(query))
    : [...page.entries];

  return entries.sort((a, b) => compareWTRecEntriesBySort(a, b, page.sort));
}

function renderWTRecList(scope, username, entries, { emptyText = "No WTRECs.", total = entries.length } = {}) {
  const list = getWTRecListElement(scope);
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = emptyText;
    list.replaceChildren(empty);
    return;
  }

  const rows = entries.map((entry) => createWTRecRow(username, entry));

  if (total > entries.length) {
    const notice = document.createElement("div");
    notice.className = "wtrec-limit-notice";
    notice.textContent = `Showing ${entries.length} of ${total} WTRECs.`;
    rows.push(notice);
  }

  list.replaceChildren(...rows);
}

function createWTRecRow(username, entry) {
  const row = document.createElement("a");
  row.className = "wtrec-row";
  row.href = getWTRecPlayerURL(username, entry.name);
  row.target = "_blank";
  row.rel = "noopener noreferrer";

  const title = document.createElement("span");
  title.className = "wtrec-title";
  title.textContent = formatWTRecTitle(entry.name);

  const meta = document.createElement("span");
  meta.className = "wtrec-meta";
  meta.textContent = `${formatDate(entry.mtime)} · ${formatBytes(entry.size)}`;

  const action = document.createElement("span");
  action.className = "wtrec-action";
  action.textContent = "Play";

  const text = document.createElement("span");
  text.className = "wtrec-text";
  text.append(title, meta);

  row.append(text, action);
  return row;
}

function getWTRecPlayerURL(username, filename) {
  const params = new URLSearchParams({
    wtrec_url: getWTRecFileURL(username, filename)
  });
  return `${WTREC_PLAYER_BASE}?${params}`;
}

function getWTRecFileURL(username, filename) {
  return `${WTREC_FILE_BASE}/${encodeURIComponent(username)}/${encodeURIComponent(filename)}`;
}

function formatWTRecTitle(filename) {
  return String(filename || "").replace(/\.wtrec$/i, "");
}

function compareWTRecEntries(a, b) {
  const timeDiff = new Date(b.mtime).getTime() - new Date(a.mtime).getTime();
  if (timeDiff !== 0) return timeDiff;
  return String(b.name || "").localeCompare(String(a.name || ""));
}

function compareWTRecEntriesBySort(a, b, sort) {
  if (sort === "size-desc") {
    const sizeDiff = (Number(b.size) || 0) - (Number(a.size) || 0);
    return sizeDiff || compareWTRecEntries(a, b);
  }

  if (sort === "size-asc") {
    const sizeDiff = (Number(a.size) || 0) - (Number(b.size) || 0);
    return sizeDiff || compareWTRecEntries(a, b);
  }

  return compareWTRecEntries(a, b);
}

async function requestWTRecIndex(username) {
  const response = await fetch(`${WTREC_INDEX_BASE}/${encodeURIComponent(username)}/`);
  if (response.status === 404) {
    return [];
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`WTRec index HTTP ${response.status}`);
  }
  if (!Array.isArray(data)) {
    throw new Error("Invalid WTRec index response.");
  }
  return data;
}

async function loadEntityPage(scope, type, offset, { append = false, prepend = false, limit = null } = {}) {
  const profile = scope === "private" ? state.profile : state.publicProfile;
  if (!profile?.username) return;

  const page = state.entityPages[scope][type];
  if (page.loading) return;

  page.loading = true;
  page.offset = Math.max(0, offset);
  const list = getEntityListElement(scope, type);
  const status = getEntityStatusElement(scope, type);
  status.textContent = append || prepend ? "Loading more..." : "Loading...";
  const pageSize = getEntityPageSize(type);
  const requestLimit = limit || pageSize;

  try {
    const params = new URLSearchParams({
      type,
      limit: String(requestLimit),
      offset: String(page.offset),
      order: "desc"
    });
    if (type === "item" && page.q) {
      params.set("q", page.q);
    }

    const data = await requestPublicJson(`${CHAT_API_BASE}/users/${encodeURIComponent(profile.username)}/entities?${params}`);
    const entities = data.entities || [];
    page.loaded = true;
    page.total = data.total || 0;
    page.offset = data.offset || 0;
    if (type === "game" || type === "item") {
      if (!append && !prepend) {
        page.renderedStart = page.offset;
        page.renderedEnd = page.offset + entities.length;
        page.loadedCount = page.renderedEnd;
        page.topSpacerHeight = 0;
        page.bottomSpacerHeight = 0;
      }
    }
    renderEntityPage(scope, type, entities, { append, prepend, offset: page.offset });
    status.textContent = "";
  } catch (error) {
    if (!append && !prepend) {
      list.replaceChildren();
    }
    renderPager(scope, type);
    status.textContent = error.message;
  } finally {
    page.loading = false;
    if (type === "game" || type === "item") {
      queueEntityInfiniteScrollCheck();
    }
  }
}

function renderEntityPage(scope, type, entities, { append = false, prepend = false, offset = 0 } = {}) {
  const list = getEntityListElement(scope, type);
  if (!entities.length && !append && !prepend) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = type === "game" ? "No game images." : "No items.";
    list.replaceChildren(empty);
  } else if (prepend) {
    renderPrependedEntities(scope, type, entities, offset);
  } else if (append) {
    renderAppendedEntities(scope, type, entities, offset);
  } else {
    renderInitialEntities(scope, type, entities, offset);
  }
  renderPager(scope, type);
}

function renderInitialEntities(scope, type, entities, offset) {
  const list = getEntityListElement(scope, type);
  list.replaceChildren();

  const page = state.entityPages[scope][type];
  page.renderedStart = offset;
  page.renderedEnd = offset + entities.length;
  page.loadedCount = page.renderedEnd;
  page.topSpacerHeight = 0;
  page.bottomSpacerHeight = 0;

  const { bottom } = ensureEntitySpacers(scope, type);
  bottom.before(...createEntityCards(scope, type, entities, offset));
  updateEntitySpacerHeights(scope, type);
}

function renderAppendedEntities(scope, type, entities, offset) {
  if (!entities.length) return;

  const page = state.entityPages[scope][type];
  const { bottom } = ensureEntitySpacers(scope, type);
  const cards = createEntityCards(scope, type, entities, offset);
  bottom.before(...cards);

  const insertedHeight = measureEntityBlock(cards);
  page.renderedEnd = Math.max(page.renderedEnd, offset + entities.length);
  page.loadedCount = page.renderedEnd;
  page.bottomSpacerHeight = Math.max(0, page.bottomSpacerHeight - insertedHeight);
  trimEntityWindow(scope, type, "top");
  updateEntitySpacerHeights(scope, type);
}

function renderPrependedEntities(scope, type, entities, offset) {
  if (!entities.length) return;

  const page = state.entityPages[scope][type];
  const { top } = ensureEntitySpacers(scope, type);
  const cards = createEntityCards(scope, type, entities, offset);
  top.after(...cards);

  const insertedHeight = measureEntityBlock(cards);
  page.renderedStart = Math.min(page.renderedStart, offset);
  page.topSpacerHeight = Math.max(0, page.topSpacerHeight - insertedHeight);
  trimEntityWindow(scope, type, "bottom");
  updateEntitySpacerHeights(scope, type);
}

function createEntityCards(scope, type, entities, offset) {
  return entities.map((entity, index) => {
    const card = createEntityCard(entity, type, scope);
    card.dataset.entityCard = `${scope}:${type}`;
    card.dataset.entityIndex = String(offset + index);
    return card;
  });
}

function ensureEntitySpacers(scope, type) {
  const list = getEntityListElement(scope, type);
  let top = getEntitySpacer(scope, type, "top");
  let bottom = getEntitySpacer(scope, type, "bottom");

  if (!top) {
    top = document.createElement("div");
    top.className = "entity-spacer";
    top.dataset.entitySpacer = `${scope}:${type}:top`;
    list.prepend(top);
  }

  if (!bottom) {
    bottom = document.createElement("div");
    bottom.className = "entity-spacer";
    bottom.dataset.entitySpacer = `${scope}:${type}:bottom`;
    list.append(bottom);
  }

  return { top, bottom };
}

function getEntitySpacer(scope, type, position) {
  return getEntityListElement(scope, type)
    .querySelector(`[data-entity-spacer="${scope}:${type}:${position}"]`);
}

function getRenderedEntityCards(scope, type) {
  return Array.from(getEntityListElement(scope, type)
    .querySelectorAll(`[data-entity-card="${scope}:${type}"]`));
}

function updateEntitySpacerHeights(scope, type) {
  const page = state.entityPages[scope][type];
  const { top, bottom } = ensureEntitySpacers(scope, type);
  top.style.height = `${Math.max(0, Math.round(page.topSpacerHeight || 0))}px`;
  bottom.style.height = `${Math.max(0, Math.round(page.bottomSpacerHeight || 0))}px`;
}

function trimEntityWindow(scope, type, side) {
  const page = state.entityPages[scope][type];
  let cards = getRenderedEntityCards(scope, type);

  while (cards.length > ENTITY_MAX_RENDERED_ITEMS) {
    const removeCount = Math.min(getEntityPageSize(type), cards.length - ENTITY_MAX_RENDERED_ITEMS);
    const removed = side === "bottom"
      ? cards.slice(-removeCount)
      : cards.slice(0, removeCount);
    const height = measureEntityBlock(removed);

    for (const card of removed) {
      card.remove();
    }

    if (side === "bottom") {
      page.renderedEnd = Math.max(page.renderedStart, page.renderedEnd - removed.length);
      page.bottomSpacerHeight += height;
    } else {
      page.renderedStart += removed.length;
      page.topSpacerHeight += height;
    }

    cards = getRenderedEntityCards(scope, type);
  }
}

function measureEntityBlock(nodes) {
  const visibleNodes = nodes.filter((node) => node.isConnected);
  if (!visibleNodes.length) return 0;

  const first = visibleNodes[0].getBoundingClientRect();
  const last = visibleNodes[visibleNodes.length - 1].getBoundingClientRect();
  return Math.max(0, last.bottom - first.top);
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

function createItemEntityCard(entity) {
  const card = document.createElement("article");
  card.className = "item-chat-row";

  const time = document.createElement("span");
  time.className = "item-chat-time";
  time.textContent = formatDate(entity.timestamp);

  const separator = document.createElement("span");
  separator.className = "item-chat-separator";
  separator.textContent = ":";
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

  message.append(media, item);
  card.append(time, separator, message);
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

  const text = document.createElement("div");
  text.className = "game-card-text";
  text.append(title, meta);

  const download = document.createElement("button");
  download.className = "game-download-button";
  download.type = "button";
  download.textContent = "Download";
  download.title = "Download image";
  download.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    downloadImage(entity.file, getEntityDownloadName(entity, "game"));
  });

  body.append(text, download);
  card.append(media, body);
  return card;
}

function getEntityDownloadName(entity, type) {
  const number = Number(entity.number) || Date.now();
  const extension = getEntityFileExtension(entity.file);
  return `cnc-${type}-${number}.${extension}`;
}

function getEntityFileExtension(file) {
  try {
    const pathname = new URL(file, window.location.href).pathname;
    const match = pathname.match(/\.([A-Za-z0-9]+)$/);
    return match ? match[1].toLowerCase() : "png";
  } catch (error) {
    return "png";
  }
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

  if (type === "game" || type === "item") {
    const start = page.total === 0 ? 0 : page.renderedStart + 1;
    const end = Math.min(page.renderedEnd || 0, page.total);
    pageText.textContent = `${start}-${end} / ${page.total}`;
    prev.hidden = true;
    next.hidden = true;
    return;
  }

  const start = page.total === 0 ? 0 : page.offset + 1;
  const end = Math.min(page.offset + pageSize, page.total);

  pageText.textContent = `${start}-${end} / ${page.total}`;
  prev.hidden = false;
  next.hidden = false;
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

function resetWTRecScope(scope) {
  state.wtrecs[scope] = createWTRecState();
  getWTRecListElement(scope)?.replaceChildren();
  const status = getWTRecStatusElement(scope);
  if (status) {
    status.textContent = "";
  }
  const search = document.querySelector(`[data-wtrec-search="${scope}"]`);
  if (search) {
    search.value = "";
  }
  const sort = document.querySelector(`[data-wtrec-sort="${scope}"]`);
  if (sort) {
    sort.value = "mtime-desc";
  }
}

function getWTRecListElement(scope) {
  return document.querySelector(`[data-wtrec-list="${scope}"]`);
}

function getWTRecStatusElement(scope) {
  return document.querySelector(`[data-wtrec-status="${scope}"]`);
}

function createWTRecState() {
  return {
    loaded: false,
    loading: false,
    entries: [],
    q: "",
    sort: "mtime-desc",
    visibleCount: WTREC_PAGE_SIZE
  };
}

function createEntityPageState() {
  return {
    game: createSingleEntityPageState(),
    item: createSingleEntityPageState()
  };
}

function createSingleEntityPageState() {
  return {
    offset: 0,
    total: 0,
    loaded: false,
    loading: false,
    retryScheduled: false,
    loadedCount: 0,
    renderedStart: 0,
    renderedEnd: 0,
    topSpacerHeight: 0,
    bottomSpacerHeight: 0,
    q: ""
  };
}

function setupEntityInfiniteScroll() {
  const sentinels = Array.from(document.querySelectorAll("[data-entity-sentinel]"));
  if (!sentinels.length) return;

  window.addEventListener("scroll", queueEntityInfiniteScrollCheck, { passive: true });
  window.addEventListener("resize", queueEntityInfiniteScrollCheck, { passive: true });

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          loadMoreEntityFromSentinel(entry.target);
        }
      }
    }, { rootMargin: `${ENTITY_INFINITE_SCROLL_MARGIN}px 0px` });

    for (const sentinel of sentinels) {
      observer.observe(sentinel);
    }
  }
}

function setupWTRecInfiniteScroll() {
  const sentinels = Array.from(document.querySelectorAll("[data-wtrec-sentinel]"));
  if (!sentinels.length) return;

  window.addEventListener("scroll", queueWTRecInfiniteScrollCheck, { passive: true });
  window.addEventListener("resize", queueWTRecInfiniteScrollCheck, { passive: true });

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          loadMoreWTRecs(entry.target.dataset.wtrecSentinel);
        }
      }
    }, { rootMargin: `${WTREC_INFINITE_SCROLL_MARGIN}px 0px` });

    for (const sentinel of sentinels) {
      observer.observe(sentinel);
    }
  }
}

function queueWTRecInfiniteScrollCheck() {
  if (queueWTRecInfiniteScrollCheck.pending) return;

  queueWTRecInfiniteScrollCheck.pending = true;
  window.requestAnimationFrame(() => {
    queueWTRecInfiniteScrollCheck.pending = false;
    checkVisibleWTRecSentinels();
  });
}

function checkVisibleWTRecSentinels() {
  for (const sentinel of document.querySelectorAll("[data-wtrec-sentinel]")) {
    if (sentinel.getBoundingClientRect().top < window.innerHeight + WTREC_INFINITE_SCROLL_MARGIN) {
      loadMoreWTRecs(sentinel.dataset.wtrecSentinel);
    }
  }
}

function loadMoreWTRecs(scope) {
  const panel = document.querySelector(`[data-tab-panel-scope="${scope}"][data-tab-panel-name="wtrec"]`);
  if (!panel || panel.hidden) return;

  const page = state.wtrecs[scope];
  if (!page?.loaded || page.loading) return;

  const total = getFilteredWTRecEntries(page).length;
  if (page.visibleCount >= total) return;

  page.visibleCount = Math.min(total, page.visibleCount + WTREC_PAGE_SIZE);
  renderCurrentWTRecList(scope);
}

function queueEntityInfiniteScrollCheck() {
  if (queueEntityInfiniteScrollCheck.pending) return;

  queueEntityInfiniteScrollCheck.pending = true;
  window.requestAnimationFrame(() => {
    queueEntityInfiniteScrollCheck.pending = false;
    checkVisibleEntitySentinels();
    window.setTimeout(checkVisibleEntitySentinels, 100);
  });
}

function checkVisibleEntitySentinels() {
  for (const sentinel of document.querySelectorAll("[data-entity-sentinel]")) {
    if (sentinel.getBoundingClientRect().top < window.innerHeight + ENTITY_INFINITE_SCROLL_MARGIN) {
      loadMoreEntityFromSentinel(sentinel);
    }
  }

  for (const panel of document.querySelectorAll('[data-tab-panel-scope][data-tab-panel-name="game"], [data-tab-panel-scope][data-tab-panel-name="item"]')) {
    if (!panel.hidden) {
      loadPreviousEntityIfVisible(panel.dataset.tabPanelScope, panel.dataset.tabPanelName);
    }
  }
}

function scheduleEntityInfiniteScrollRetry(scope, type) {
  const page = state.entityPages[scope]?.[type];
  if (!page || page.retryScheduled) return;

  page.retryScheduled = true;
  for (const delay of [100, 350, 800]) {
    window.setTimeout(() => {
      const sentinel = document.querySelector(`[data-entity-sentinel="${scope}:${type}"]`);
      if (sentinel) {
        loadMoreEntityFromSentinel(sentinel);
      }
    }, delay);
  }
  window.setTimeout(() => {
    page.retryScheduled = false;
  }, 900);
}

function loadMoreEntityFromSentinel(sentinel) {
  const { scope, type } = parseEntityKey(sentinel.dataset.entitySentinel);
  if (type !== "game" && type !== "item") return;

  const panel = sentinel.closest("[data-tab-panel-scope][data-tab-panel-name]");
  if (!panel || panel.hidden) return;

  const page = state.entityPages[scope]?.[type];
  if (!page?.loaded || page.renderedEnd >= page.total) return;
  if (page.loading) {
    scheduleEntityInfiniteScrollRetry(scope, type);
    return;
  }

  loadEntityPage(scope, type, page.renderedEnd, { append: true });
}

function loadPreviousEntityIfVisible(scope, type) {
  const page = state.entityPages[scope]?.[type];
  if (!page?.loaded || page.loading || page.renderedStart <= 0) return;

  const firstCard = getRenderedEntityCards(scope, type)[0];
  if (!firstCard || firstCard.getBoundingClientRect().top < -ENTITY_INFINITE_SCROLL_MARGIN) return;

  const previousOffset = Math.max(0, page.renderedStart - getEntityPageSize(type));
  const limit = page.renderedStart - previousOffset;
  loadEntityPage(scope, type, previousOffset, { prepend: true, limit });
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

  if (usernameStyle.id === "donor") {
    return `<span style="${styleToText(getDonorStyle(usernameStyle.data?.donation))}">${escapeHtml(username)}</span>`;
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

  if (usernameStyle.id === "latest-tournament") {
    return `${escapeHtml(usernameStyle.data?.badge || "🏁")}${escapeHtml(username)}`;
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

function getDonorStyle(amount) {
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

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
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

function isSameUsername(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
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
