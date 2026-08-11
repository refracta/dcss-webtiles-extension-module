# Map Predictor

Map Predictor compares observed terrain with known fixed maps and predicts
terrain that has not been seen yet. Predictions are shown with subtle gray
diagonal hatching only in the client and do not change the server map or saved
game.

Enable it in the RC file:

```text
map_predictor = true
```

- `Ctrl-M`: pause or resume Map Predictor
- `/reveal`: hide or show the current prediction
- `/reveal_status`: show candidate and matching details
- `/map_predictor reload`: reload map sources for the current game version

`Map (NN.N%)` is terrain similarity, not the probability that a prediction is
correct. Whenever matching has a best candidate with constrained unseen cells,
that candidate's current best terrain estimate is shown automatically with
gray diagonal hatching—even at 100% similarity when acceptance, ambiguity, placement,
or source policy checks are unresolved. A later winner replaces the estimate.
Hatched terrain is always unconfirmed and may be wrong; safe and multi-candidate
consensus counts remain diagnostic information rather than the automatic
display source.

`/reveal` deliberately hides or restores the current estimate and stays hidden
as later winners arrive. `/force_reveal` is a separate explicit override and
remains unavailable for source families whose audit disables force reveal. If
there is no loaded source, no best candidate, or no constrained unseen cell,
nothing is displayed. Map Predictor notices appear in the in-game message log,
not chat.

Spectators follow the watched player's `map_predictor` RC setting. When the
option is absent or `false`, map sources, the matcher, and the worker are not
loaded.
