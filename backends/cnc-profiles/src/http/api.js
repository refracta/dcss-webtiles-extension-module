const MAX_JSON_BODY_BYTES = 64 * 1024;
const TOKEN_LOGIN_PATH = "/session/cnc-token";

export function createApiHandler({ profileService, authenticator, sessionManager, config }) {
  return async function handleApi(request, response) {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (url.pathname === TOKEN_LOGIN_PATH) {
      await handleTokenLogin({ request, response, profileService, authenticator, sessionManager, config });
      return true;
    }

    if (!url.pathname.startsWith("/api/")) {
      return false;
    }

    const corsHeaders = getCorsHeaders(request, config);

    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Cache-Control": "no-store",
        ...corsHeaders
      });
      response.end();
      return true;
    }

    try {
      if (request.method === "GET" && url.pathname === "/api/banners") {
        sendJson(response, 200, { banners: profileService.getBanners() }, corsHeaders);
        return true;
      }

      if (request.method === "GET" && url.pathname.startsWith("/api/profile/")) {
        const username = decodeURIComponent(url.pathname.slice("/api/profile/".length));
        sendJson(response, 200, { profile: profileService.getPublicProfile(username) }, corsHeaders);
        return true;
      }

      if (request.method === "POST" && url.pathname === "/api/profiles/batch") {
        const body = await readJsonBody(request);
        const profiles = Array.isArray(body.profiles) ? body.profiles : [];
        sendJson(response, 200, profileService.getBatchProfiles(profiles), corsHeaders);
        return true;
      }

      if (request.method === "POST" && url.pathname === "/api/session/login") {
        const body = await readJsonBody(request);
        const user = await authenticator.authenticate({
          username: body.username,
          password: body.password
        });
        const profile = profileService.getMe(user.username);
        sendJson(response, 200, { authenticated: true, profile }, {
          ...corsHeaders,
          "Set-Cookie": sessionManager.createCookie({ username: profile.username })
        });
        return true;
      }

      if (request.method === "POST" && url.pathname === "/api/session/logout") {
        sendJson(response, 200, { authenticated: false }, {
          ...corsHeaders,
          "Set-Cookie": sessionManager.clearCookie()
        });
        return true;
      }

      if (request.method === "GET" && url.pathname === "/api/me") {
        const session = sessionManager.readSession(request);
        if (!session) {
          sendJson(response, 200, { authenticated: false, profile: null }, corsHeaders);
          return true;
        }

        sendJson(response, 200, {
          authenticated: true,
          profile: profileService.getMe(session.username)
        }, corsHeaders);
        return true;
      }

      if (request.method === "POST" && url.pathname === "/api/me/current-banner") {
        const session = requireSession(request, sessionManager);
        const body = await readJsonBody(request);
        const bannerId = body.bannerId === null ? null : String(body.bannerId ?? "");
        if (bannerId !== null && !bannerId) {
          const error = new Error("bannerId is required");
          error.statusCode = 400;
          throw error;
        }

        sendJson(response, 200, {
          profile: await profileService.setCurrentBanner(session.username, bannerId)
        }, corsHeaders);
        return true;
      }

      sendJson(response, 404, { error: "API endpoint not found" }, corsHeaders);
      return true;
    } catch (error) {
      const statusCode = error.statusCode ?? 500;
      if (statusCode >= 500) {
        console.error(error);
      }
      sendJson(response, statusCode, { error: error.message }, corsHeaders);
      return true;
    }
  };
}

async function handleTokenLogin({ request, response, profileService, authenticator, sessionManager, config }) {
  if (request.method !== "POST") {
    sendRedirect(response, "/", {
      "Cache-Control": "no-store"
    });
    return;
  }

  try {
    const form = await readFormBody(request);
    const user = await authenticator.authenticateWithToken({
      token: form.get("token"),
      refreshLoginCookie: true
    });
    const profile = profileService.getMe(user.username);
    const targetOrigin = getAllowedOpenerOrigin(form.get("openerOrigin"), config);
    const redirectPath = getSafeRedirectPath(form.get("next"));
    const payload = user.refreshedLoginCookie?.cookie
      ? {
          type: "cnc-profiles-login-cookie",
          cookie: user.refreshedLoginCookie.cookie,
          expires: user.refreshedLoginCookie.expires
        }
      : null;

    sendHtml(response, 200, createTokenLoginSuccessHtml({ payload, targetOrigin, redirectPath }), {
      "Set-Cookie": sessionManager.createCookie({ username: profile.username })
    });
  } catch (error) {
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) {
      console.error(error);
    }
    sendHtml(response, statusCode, createTokenLoginErrorHtml(error.message));
  }
}

export function sendJson(response, statusCode, value, headers = {}) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    ...headers
  });
  response.end(JSON.stringify(value));
}

export async function readJsonBody(request) {
  const body = await readTextBody(request);
  if (!body) return {};

  try {
    return JSON.parse(body);
  } catch {
    const error = new Error("Invalid JSON body");
    error.statusCode = 400;
    throw error;
  }
}

async function readFormBody(request) {
  return new URLSearchParams(await readTextBody(request));
}

async function readTextBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_JSON_BODY_BYTES) {
      const error = new Error("Request body is too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  return chunks.length ? Buffer.concat(chunks).toString("utf8") : "";
}

function requireSession(request, sessionManager) {
  const session = sessionManager.readSession(request);
  if (session) return session;

  const error = new Error("login required");
  error.statusCode = 401;
  throw error;
}

function getCorsHeaders(request, config) {
  const origin = request.headers.origin;
  const allowedOrigins = new Set(config.cors?.allowedOrigins ?? []);
  allowedOrigins.add(config.siteUrl);

  const allowOrigin = origin && allowedOrigins.has(origin) ? origin : "*";
  const headers = {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };

  if (allowOrigin !== "*") {
    headers["Access-Control-Allow-Credentials"] = "true";
  }

  return headers;
}

function sendRedirect(response, location, headers = {}) {
  response.writeHead(303, {
    Location: location,
    ...headers
  });
  response.end();
}

function sendHtml(response, statusCode, html, headers = {}) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "text/html; charset=utf-8",
    ...headers
  });
  response.end(html);
}

function getAllowedOpenerOrigin(value, config) {
  const origin = String(value ?? "");
  const allowedOrigins = new Set(config.cors?.allowedOrigins ?? []);
  allowedOrigins.add(config.siteUrl);
  return allowedOrigins.has(origin) ? origin : "";
}

function getSafeRedirectPath(value) {
  const path = String(value || "/");
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    return "/";
  }
  return path;
}

function createTokenLoginSuccessHtml({ payload, targetOrigin, redirectPath }) {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <title>CNC Profiles</title>
</head>
<body>
  <p>CNC Profiles로 이동 중입니다.</p>
  <script>
    const payload = ${toScriptJson(payload)};
    const targetOrigin = ${toScriptJson(targetOrigin)};
    if (payload && targetOrigin && window.opener) {
      window.opener.postMessage(payload, targetOrigin);
    }
    window.location.replace(${toScriptJson(redirectPath)});
  </script>
</body>
</html>`;
}

function createTokenLoginErrorHtml(message) {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <title>CNC Profiles Login Failed</title>
</head>
<body>
  <p>프로필 자동 로그인에 실패했습니다: ${escapeHtml(message)}</p>
  <p><a href="/">CNC Profiles에서 직접 로그인하기</a></p>
</body>
</html>`;
}

function toScriptJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
