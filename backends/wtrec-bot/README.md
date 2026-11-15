# WTREC bot

The bot watches selected WebTiles lobby players and saves server-side WTREC
archives. `ASCIIPhilia` and configured eligible donors are always selected;
other players retain the configured random/tournament selection rules.

The [DCSS 0.35 tournament](https://crawl.develz.org/wordpress/0-35-trunk-update-and-tournament-announcement)
enables 100% selection for all gameplay sessions from **2026-12-04 20:00 UTC**
(inclusive) until **2026-12-20 20:00 UTC** (exclusive), matching the CNC banner.
In Korea this is **December 5, 05:00 through December 21, 05:00 KST**.
Players already in the lobby are picked up when the period starts, without a
restart or reconnect. After it ends, new recordings return to donor/random
selection; recordings already underway finish normally. `CNCPublicChat` remains
excluded because it is a chat session. The built-in tournament period also
applies when `config.specialRecordingPeriods` supplies other custom periods.

## Connection recovery

Both lobby and recording connections have a connection deadline and an incoming
message watchdog. Server application pings count as activity, so an idle game is
still healthy. A connection that receives nothing for 90 seconds is forcibly
closed, even if TCP still reports it as established. The lobby reconnects after
10 seconds. Failed recordings are retried against the current lobby without
waiting for the player to leave and rejoin, and active recordings are deduplicated.

Login, the first game client message, individual resource downloads, and total
resource preparation also have deadlines. Resource failures release the player
for retry instead of leaving an unresolved preparation promise. On a recording
disconnect, any captured messages with a complete resource bundle are saved as
a WTREC archive with `interrupted: true`, before starting the next segment.
This preserves captured data; it cannot recover frames missed while disconnected.

Optional `config.json` settings (milliseconds):

| Setting | Default |
| --- | ---: |
| `socketConnectTimeoutMs` | 20000 |
| `socketIdleTimeoutMs` | 90000 |
| `socketLoginTimeoutMs` | 30000 |
| `recordingStartTimeoutMs` | 30000 |
| `resourceFetchTimeoutMs` | 15000 |
| `resourcePreparationTimeoutMs` | 120000 |
| `reconnectDelayMs` | 10000 |
| `recordingRetryDelayMs` | 10000 |
| `queueIntervalMs` | 1000 |

Non-positive or non-finite values fall back to the defaults. Keep the receive
timeout above the server's normal heartbeat interval. Logs distinguish lobby
login/synchronization, connection timeouts, recording preparation failures,
completed recordings, and saved partial recordings. Donation refresh logs alone
do not establish recording health.

## Tests

Run `npm install` and `npm test` with Node.js 22 or newer. Tests use local HTTP and
WebSocket servers and temporary recordings; no live account or production data
is needed. They cover stalled handshakes, receive inactivity, live heartbeats,
handler failures, donor recording/save, lobby reconnect deduplication, partial
save/retry, failed or hung resource requests, and stalled login/watch startup.
