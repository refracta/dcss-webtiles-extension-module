import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CncAuthenticator } from "./auth/cnc-authenticator.js";
import { loadConfig, rootDir } from "./config.js";
import { ProfileDatabase } from "./db/profile-db.js";
import { createApiHandler } from "./http/api.js";
import { SessionManager } from "./http/session.js";
import { ProfileService } from "./services/profile-service.js";
import { WatcherService } from "./services/watchers.js";

const webDir = path.join(rootDir, "web");
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".webp", "image/webp"]
]);

function send(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(body);
}

function resolveStaticPath(urlPath) {
  const safePath = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  const requestedPath = urlPath === "/" ? "index.html" : safePath.replace(/^[/\\]/, "");
  const filePath = path.join(webDir, requestedPath);

  if (!filePath.startsWith(webDir)) {
    return null;
  }

  return filePath;
}

async function serveStatic(request, response) {
  const url = new URL(request.url ?? "/", "http://localhost");
  const filePath = resolveStaticPath(url.pathname);

  if (!filePath) {
    send(response, 403, "Forbidden", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }

  try {
    const body = await readFile(filePath);
    const contentType = contentTypes.get(path.extname(filePath)) ?? "application/octet-stream";
    send(response, 200, body, { "Content-Type": contentType });
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      send(response, 404, "Not Found", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }

    console.error(error);
    send(response, 500, "Internal Server Error", { "Content-Type": "text/plain; charset=utf-8" });
  }
}

const config = await loadConfig();
const database = new ProfileDatabase(path.resolve(rootDir, config.database.file));
await database.init();

const profileService = new ProfileService({ database });
const authenticator = new CncAuthenticator(config.auth.cnc);
const sessionManager = new SessionManager(config.session);
const watcherService = new WatcherService({ database, config });
const handleApi = createApiHandler({
  profileService,
  authenticator,
  sessionManager,
  config
});

const server = createServer(async (request, response) => {
  if (await handleApi(request, response)) {
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    send(response, 405, "Method Not Allowed", {
      Allow: "GET, HEAD",
      "Content-Type": "text/plain; charset=utf-8"
    });
    return;
  }

  await serveStatic(request, response);
});

const { host, port } = config.server;
server.listen(port, host, () => {
  console.log(`CNC profiles server listening at http://${host}:${port}`);
  watcherService.start();
});
