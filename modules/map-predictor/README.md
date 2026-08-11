# Map Predictor

Map Predictor identifies fixed DCSS layouts from terrain received by
WebTiles, then can feed inferred cells back through the normal client-side
`map` message path. It never changes server knowledge, travel state, or the
saved game.

The module reads `Version::Long`, resolves the exact Crawl commit, downloads
only the relevant DES sources, and caches the manifest, source, and parsed
artifacts in IndexedDB. The immutable short-to-full commit resolution is also
cached, so ordinary reloads do not spend another GitHub API request. Candidate
identity is determined from map terrain; chat text is not used to choose a map.

Enable it in the active character's RC file:

```text
map_predictor = true
```

Spectators follow the watched player's RC setting. When that player's RC
enables Map Predictor, the spectator runs the same terrain matcher over the
same received WebTiles map knowledge. `Ctrl-M` remains a local pause for that
browser. No lobby metadata or watcher-specific RC override is used.

Sprint uses the same matcher path. The received `Dungeon`/depth-zero player
state selects the audited nine-map Sprint catalog, while observed terrain
alone determines placement, candidate consensus, and whether anything is safe
to display. Game IDs, URL hashes, lobby entries, and chat messages are ignored.

The default is `false`. While disabled, the module does not install WebTiles or
keyboard hooks, create a worker/cache, download sources, retain observations,
or run matching. With the RC option enabled, `Ctrl-M` pauses or resumes the
runtime. Pausing immediately removes inferred cells and releases source,
matcher, worker, observation, and cache state; resuming rebuilds from the live
WebTiles knowledge.

Accepted safe matches are displayed automatically using an orange translucent
client-only marker. Orange terrain is inferred and can be wrong. When identity
is still ambiguous, only cells shared by every plausible candidate may be
displayed as a safe consensus; the tooltip labels that state explicitly.
Rejected, below-threshold, and detection-only candidates are never displayed
automatically.

The `Map (NN.N%)` status percentage is observed-terrain similarity, not the
probability that the prediction is correct. Candidate count, evidence,
coverage, safety reason, and predicted-cell counts are available in its
tooltip and through `/reveal_status`.

## Local development

Serve the repository root on port 6060, then set these values on the WebTiles
origin and reload:

```js
localStorage.DWEM_DEBUG = 'true';
localStorage.DWEM_DEBUG_LOADER =
    'http://localhost:6060/modules/map-predictor/debug-loader.js';
location.reload();
```

When HTTP localhost is blocked as mixed content, use an HTTPS tunnel that
serves the same repository root and point `DWEM_DEBUG_LOADER` at its
`modules/map-predictor/debug-loader.js` URL.

## Commands

- `/reveal` manually hides or shows predictions accepted by the conservative
  matcher. A manual hide is preserved until the next level/runtime transition.
- `/force_reveal` toggles the best available placement even when it is below
  threshold, ambiguous, or normal-reveal-disabled. A failed source audit can
  disable force as well. This command is deliberately unsafe: a symmetric map
  can have a high-scoring but wrong placement.
- `/reveal_status` shows the best candidate, score, margin, evidence,
  coverage, transform, offset, placement-search mode, plausible candidate
  count, and safe/force cell counts.
- `/map_predictor status` shows the current status (`/automap status` remains
  as a compatibility alias).
- `/map_predictor reload` reloads the current exact-version source set
  (`/automap reload` remains as a compatibility alias).

Matcher defaults can be tightened or relaxed for local experiments. These
values affect normal matching; `/force_reveal` still bypasses acceptance:

```js
localStorage.DWEM_MAP_PREDICTOR = JSON.stringify({
    minScore: 0.95,
    minEvidenceCells: 24,
    minWinnerMargin: 0.01
});
location.reload();
```

Per-map source-audit policies remain fail-closed and cannot be disabled by
this storage setting.

Only singleton terrain is injected. Void/unknown cells are skipped and wall
interiors are filtered like Crawl magic mapping. Doors, water, and lava use
the exact active-client terrain constants, while observed samples preserve
native floor/wall flavour. A real server map delta always restores and
supersedes synthetic client knowledge.

## Wizard testing

Wizard `&P <map name>` is useful for exact forced-map checks, but recreating a
level does not prove the natural entry coordinate. Consequently an anchored
normal reveal can remain `placement-unverified` while `/force_reveal` is still
available for diagnostics.

A game naturally creates at most one Wizard Laboratory. Quit/delete that game
before testing another naturally generated WizLab; keep `&P` results labelled
as forced-map tests.
