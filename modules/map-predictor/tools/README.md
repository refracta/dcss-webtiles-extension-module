# MapPredictor WTRec benchmark

This harness replays a fixed WebTiles recording in an anonymous browser
context. It does not log in, edit RC files, resume a save, or send game input.

It records the candidate identity, score, reason, plausible count, safe and
provisional predictions, rendered/native counts, identity flips, first stable
point, first automatic display, server-known/observed counts, and level-reset
audits. A sidecar can mark the
instant immediately before a final wizard mapping command (`&{`) so predicted
terrain can be compared with subsequently observed terrain.

## Run a recording

Install Playwright without adding it to this repository, then pass a WTRec and
its sidecar:

```sh
npm install --no-save playwright
node modules/map-predictor/tools/wtrec-benchmark.mjs \
  --recording /path/to/run.wtrec \
  --sidecar /path/to/run.json \
  --commit <dwem-commit> \
  --output /tmp/map-predictor-report.json
```

`MAP_PREDICTOR_CHROME=/usr/bin/google-chrome` uses an existing Chrome binary.
`MAP_PREDICTOR_PLAYWRIGHT=/absolute/path/to/playwright` selects an existing
Playwright installation.

For a target with `fromTime`, the runner crops at the latest full `map clear`
packet no later than that target and reconstructs cumulative player/inventory
state. Menu-only packets are omitted because they do not affect MapPredictor.
The exact cutoff and retained/dropped counts are included in `playback.crop`.
Source loading uses GitHub; an API rate limit or any MapPredictor runtime error
makes the command exit non-zero before it writes a report.

Public, external recordings are represented by the small sidecars in
`fixtures/`. Run one without downloading it first:

```sh
sidecar=modules/map-predictor/tools/fixtures/public-pandemonium.json
url=$(node -p "require('./' + process.argv[1]).recordingUrl" "$sidecar")
node modules/map-predictor/tools/wtrec-benchmark.mjs \
  --recording-url "$url" --sidecar "$sidecar"
```

## Capture a seeded exploration

Use a disposable Seeded slot. Preserve the previous RC text, temporarily set
the following values, and restore the original text after the recording:

```text
game_seed = 123456789
map_predictor = true
record_wtrec = true
```

1. Start the fixed `game_seed`, enter wizard mode with `&` and confirm `wiz`.
2. Use `&~` to enter the target level.
3. Use `&G`, then Enter, to dismiss all monsters.
4. Press `o` repeatedly until exploration no longer adds observed cells.
5. In DevTools, record the pre-truth WTRec time:

   ```js
   DWEM.Modules.WTRec._rec.data.at(-1)?.wtrec?.timing
   ```

6. Use `&{` once, wait for the full map update, then leave/end the disposable
   game so WTRec saves it. Download it with `/wtrec download`.
7. Put the recorded number in the target's `truthAt` field. Set `fromTime` and
   `toTime` to isolate the target level. The benchmark snapshots predictions
   before the first event at or after `truthAt`, then uses later reliable
   observations as truth.

Example sidecar:

```json
{
  "schemaVersion": 1,
  "name": "seed-12345-vaults5",
  "startTime": 0,
  "endTime": 90000,
  "speed": 10,
  "targets": [
    {
      "id": "vaults5",
      "place": "Vaults",
      "depth": 5,
      "fromTime": 10000,
      "toTime": 80000,
      "truthAt": 70000
    }
  ]
}
```

Keep WTRec files outside Git. Only compact sidecars and synthetic metric
fixtures belong in the repository.
