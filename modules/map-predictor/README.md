# Map Predictor

Map Predictor compares observed terrain with known fixed maps and predicts
terrain that has not been seen yet. Predictions are shown in orange only in
the client and do not change the server map or saved game.

Enable it in the RC file:

```text
map_predictor = true
```

- `Ctrl-M`: pause or resume Map Predictor
- `/reveal`: hide or show the current prediction
- `/reveal_status`: show candidate and matching details
- `/map_predictor reload`: reload map sources for the current game version

`Map (NN.N%)` is terrain similarity, not the probability that a prediction is
correct. Orange terrain is unconfirmed and may be wrong. When several maps
match, the module shows only their shared terrain. A best candidate is shown
automatically only when it is the sole retained placement.

Spectators follow the watched player's `map_predictor` RC setting. When the
option is absent or `false`, map sources, the matcher, and the worker are not
loaded.
