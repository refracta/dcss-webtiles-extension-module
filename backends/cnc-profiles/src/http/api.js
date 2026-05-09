const MAX_JSON_BODY_BYTES = 64 * 1024;

export function createApiHandler({ profileService, authenticator, sessionManager, config }) {
  return async function handleApi(request, response) {
    const url = new URL(request.url ?? "/", "http://localhost");

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

export function sendJson(response, statusCode, value, headers = {}) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    ...headers
  });
  response.end(JSON.stringify(value));
}

export async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_JSON_BODY_BYTES) {
      const error = new Error("JSON body is too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Invalid JSON body");
    error.statusCode = 400;
    throw error;
  }
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
