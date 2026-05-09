import WebSocket from "ws";

export class CncAuthenticator {
  constructor({ origin, timeoutMs = 12000 }) {
    this.origin = origin;
    this.timeoutMs = timeoutMs;
    this.url = `${origin.replace(/^http/, "ws")}/socket`;
  }

  async authenticate({ username, password }) {
    const loginUsername = String(username ?? "").trim();
    if (!loginUsername || !password) {
      const error = new Error("Enter your CNC ID and password.");
      error.statusCode = 400;
      throw error;
    }

    return this.#withSocket(async ({ send, waitForMessage }) => {
      send({ msg: "login", username: loginUsername, password });

      return this.#waitForLogin(waitForMessage, loginUsername);
    });
  }

  async authenticateWithToken({ token, refreshLoginCookie = false }) {
    const loginCookie = String(token ?? "").trim();
    if (!loginCookie) {
      const error = new Error("CNC login token is missing.");
      error.statusCode = 400;
      throw error;
    }

    return this.#withSocket(async ({ send, waitForMessage }) => {
      send({ msg: "token_login", cookie: loginCookie });
      const user = await this.#waitForLogin(waitForMessage);

      if (!refreshLoginCookie) {
        return user;
      }

      send({ msg: "set_login_cookie" });
      const refreshedLoginCookie = await this.#waitForLoginCookie(waitForMessage);
      return {
        ...user,
        refreshedLoginCookie
      };
    });
  }

  async #withSocket(task) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const pendingMessages = [];
      const waiters = [];
      const socket = new WebSocket(this.url, ["no-compression"], {
        headers: {
          Origin: this.origin
        }
      });

      const timeout = setTimeout(() => {
        const error = new Error("CNC login response timed out.");
        error.statusCode = 504;
        finishReject(error);
      }, this.timeoutMs);

      const finishResolve = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.close();
        resolve(value);
      };

      const finishReject = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.close();
        reject(error);
      };

      const waitForMessage = () => {
        if (pendingMessages.length > 0) {
          return Promise.resolve(pendingMessages.shift());
        }
        return new Promise((resolveMessage) => waiters.push(resolveMessage));
      };

      const emitMessage = (message) => {
        const waiter = waiters.shift();
        if (waiter) {
          waiter(message);
          return;
        }
        pendingMessages.push(message);
      };

      socket.on("open", () => {
        const send = (payload) => socket.send(JSON.stringify(payload));
        task({ send, waitForMessage }).then(finishResolve, finishReject);
      });

      socket.on("message", (data) => {
        try {
          for (const message of parseIncomingMessages(data)) {
            emitMessage(message);
          }
        } catch {
          // Ignore non-JSON frames from WebTiles.
        }
      });

      socket.on("error", () => {
        const error = new Error("Could not connect to the CNC login server.");
        error.statusCode = 502;
        finishReject(error);
      });
    });
  }

  async #waitForLogin(waitForMessage, fallbackUsername = "") {
    while (true) {
      const message = await waitForMessage();

      if (message.msg === "login_success") {
        return {
          username: message.username || fallbackUsername
        };
      }

      if (message.msg === "login_fail" || message.msg === "auth_error") {
        const error = new Error(message.reason || "CNC login failed.");
        error.statusCode = 401;
        throw error;
      }
    }
  }

  async #waitForLoginCookie(waitForMessage) {
    while (true) {
      const message = await waitForMessage();

      if (message.msg === "login_cookie") {
        return {
          cookie: message.cookie,
          expires: message.expires
        };
      }

      if (message.msg === "login_fail" || message.msg === "auth_error") {
        const error = new Error(message.reason || "Could not refresh the CNC login cookie.");
        error.statusCode = 401;
        throw error;
      }
    }
  }
}

function parseIncomingMessages(data) {
  const parsed = JSON.parse(data.toString("utf8"));

  if (Array.isArray(parsed.msgs)) {
    return parsed.msgs;
  }

  if (Array.isArray(parsed)) {
    return parsed;
  }

  return [parsed];
}
