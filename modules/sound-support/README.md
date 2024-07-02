# SoundSupport

The SoundSupport module provides sound functionality in a web tile environment. With this module, various sounds can be
played within the game, and sound packs can be added through RC configuration.

You can host a sound pack on your personal server that supports CORS, or you can use the /SoundSupport register command to register and use a sound pack.

```
# BindTheEarth Sound Pack
sound_pack += https://sound-packs.nemelex.cards/Autofire/BindTheEarth/BindTheEarth.zip

# Crawler's Sound Pack
sound_pack += https://sound-packs.nemelex.cards/crawler/2018-03-27/DCSS.22.zip
```

## RC Configuration

The following settings can be read from the RC file:

To use the SoundSupport module effectively, specific settings in the RC file must be configured. Below are the main
sound-related settings that can be used in the RC configuration:

- **sound_on**
    - **Description:** Determines whether the sound feature is enabled.
    - **Value:** true or false
    - **Example:** `sound_on = true`

- **sound_fade_time**
    - **Description:** Sets the fade-out time for sounds. This represents the time it takes for the sound to gradually
      decrease in volume at the end.
    - **Value:** Number (in seconds)
    - **Default:** 0.5
    - **Example:** `sound_fade_time = 1.0`

- **sound_volume**
    - **Description:** Sets the volume of the sound.
    - **Value:** A decimal between 0 and 1
    - **Default:** 1
    - **Example:** `sound_volume = 0.8`

- **one_SDL_sound_channel**
    - **Description:** Determines whether to use a single SDL sound channel. If a single channel is used, only one sound
      can be played at a time.
    - **Value:** true or false
    - **Example:** `one_SDL_sound_channel = true`

- **sound_pack**
    - **Description:** Adds the URL of the sound pack and the match file configuration within that sound pack.
    - **Value:** URL and match file configuration
    - **Example:** `sound_pack += https://example.com/soundpack.zip:["match1.txt", "match2.txt"]`
    - **Explanation:** After the URL, the match file configuration is in JSON array format, specifying specific match
      files within the sound pack. If no match files are specified, all text files within the sound pack are used.

### Example Configuration

```plaintext
# Enable sound feature
sound_on = true

# Set sound fade-out time (in seconds)
sound_fade_time = 1.0

# Set sound volume (between 0 and 1)
sound_volume = 0.8

# Enable single SDL sound channel
one_SDL_sound_channel = true

# Add sound pack
sound_pack += https://example.com/soundpack.zip:["match1.txt", "match2.txt"]
```

# SoundSupport Commands

Various functions can be accessed in the game chat window using the /SoundSupport command:

```plaintext
/SoundSupport list: Lists all registered local sound packs.
/SoundSupport register: Registers a local sound pack. A file selection window will open, and the selected zip file will be registered as a sound pack.
/SoundSupport remove [URL]: Removes the local sound pack from the specified URL.
/SoundSupport clear: Removes all local sound packs.
```
