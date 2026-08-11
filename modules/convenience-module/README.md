# ConvenienceModule

This module provides various convenience RC commands:
- `disable_clear_chat = true`: Disables the feature that clears chat when exiting the game.
- `show_gold_status = true`: Displays the current gold in the right status interface when you are not a follower of Gozag.
  ![image](https://github.com/user-attachments/assets/12d4c182-e84e-4394-8407-8f1164453eb3)
- When MapPredictor is loaded, enabled with `map_predictor = true`, and running, the right status interface displays `Map (NN.N%)`. The percentage is terrain similarity, not the probability that the prediction is correct. Its multiline tooltip identifies the current automatic best guess and lists ambiguity, evidence, candidate counts, selected cells, and controls. The indicator is removed when MapPredictor is unavailable, disabled in RC, or paused with Ctrl-M.
- `redirect_chat = true`: Simultaneously outputs chat messages in the game message window.
  ![image](https://github.com/user-attachments/assets/009cec7a-4060-408d-bdaa-f36a68f61da7)
- `/arc`: Enable auto reconnect feature (play, watch)
