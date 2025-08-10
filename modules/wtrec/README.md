# WTRec (WebTiles Recording)

WTRec is a DWEM module that records DCSS WebTiles sessions in the browser and lets you list, download, and delete them from local IndexedDB.

## Usage
- RC option: `record_wtrec = true`
  - Collects messages from the moment you Play/Watch, and automatically saves the session when you return to the lobby.
  - Session names are saved as `username__YYYY-MM-DD_HH.mm.ss`.

- CNC Lobby playback
  - On the CNC lobby page, right‑click a wtrec entry to play it directly.

## Commands
- `/wtrec`: Show a quick summary of WTRec commands.
- `/wtrec status`: Show current recording state, message count, resource fetch status, and storage usage.
- `/wtrec list`: List saved sessions with indices. Shows message count and size (MB) per session, and total IndexedDB quota/used/free.
- `/wtrec download [all|name|index]`: Download the selected session(s) as a zip. The zip includes `wtrec.json` and, when available, resources (scripts/styles/images).
- `/wtrec delete [all|name|index]`: Delete the selected session(s).

Arguments
- `name`: Session name like `username__YYYY-MM-DD_HH.mm.ss`
- `index`: The index shown by `/wtrec list` (0-based)
- If omitted, the target defaults to `all`.

## Storage and quota
- Storage: Browser IndexedDB (`dwem-wtrec` / object store `sessions`).
- `/wtrec list` shows total quota, used, and free space at the end.
