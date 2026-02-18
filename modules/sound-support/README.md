# SoundSupport

The SoundSupport module provides sound functionality in a web tile environment. With this module, various sounds can be
played within the game, and sound packs can be added through RC configuration.

You can host a sound pack on your personal server that supports CORS, or you can use the /SoundSupport register command
to register and use a sound pack.

- [CNC Server Sound Pack Archive](https://sound-packs.nemelex.cards)

# RC example
```bash
# Recommended settings
sound_on = true
sound_pack += https://sound-packs.nemelex.cards/DCSS-UST/v1.0.1.zip
sound_pack += https://osp.nemelex.cards/build/latest.zip:["init.txt"]
one_SDL_sound_channel = true
sound_fade_time = 0.5
bgm_volume = 0.5
```

```bash
# OSP + BindTheEarth example settings
sound_on = true
# CNC Open Sound Pack
sound_pack += https://osp.nemelex.cards/build/latest.zip:["init.txt"]
# BindTheEarth Sound Pack
sound_pack += https://sound-packs.nemelex.cards/Autofire/BindTheEarth/BindTheEarth.zip
```

## RC Configuration

The following settings can be read from the RC file:

To use the SoundSupport module effectively, specific settings in the RC file must be configured. Below are the main
sound-related settings that can be used in the RC configuration:

- **sound_on**
    - **Description:** Determines whether the sound feature is enabled.
    - **Value:** true or false
    - **Default:** false
    - **Example:** `sound_on = true`

- **sound_volume**
    - **Description:** Sets the volume of the sound.
    - **Value:** A decimal between 0 and 1
    - **Default:** 1
    - **Example:** `sound_volume = 0.8`

- **bgm_volume**
    - **Description:** Sets the volume of the BGM (background music). This only affects BGM playback.
    - **Value:** A decimal between 0 and 1
    - **Default:** `sound_volume`
    - **Example:** `bgm_volume = 0.8`

- **one_SDL_sound_channel**
    - **Description:** Determines whether to use a single SDL sound channel. If a single channel is used, only one sound
      can be played at a time.
    - **Value:** true or false
    - **Default:** false
    - **Example:** `one_SDL_sound_channel = true`

- **sound_fade_time**
  - **Description:** Sets the fade-out time for sounds. This represents the time it takes for the sound to gradually
    decrease in volume at the end. It only works when one_SDL_sound_channel is true
  - **Value:** Number (in seconds)
  - **Default:** 0
  - **Example:** `sound_fade_time = 0.5`

- **sound_pack**
    - **Description:** Adds the URL of the sound pack and the match file configuration within that sound pack.
    - **Value:** URL and match file configuration
    - **Example:** `sound_pack += https://example.com/soundpack.zip:["match1.txt", "match2.txt"]`
    - **Explanation:** After the URL, the match file configuration is in JSON array format, specifying specific match
      files within the sound pack. If no match files are specified, all text files within the sound pack are used.

- **sound_debug**
  - **Description:** Prints sound debugging information to the browser developer tools console window.
  - **Value:** true or false
  - **Default:** false
  - **Example:** `sound_debug = true`


A sound pack is a compressed format that includes configuration settings in the form of an init.txt file and the associated sound files used in the downloaded version of Crawl. 

For example:
```plaintext
init.txt
sound/quit.mp3
sound/hit.mp3
```
```plaintext
[init.txt]
sound ^= quit:sound/quit.mp3
sound_file_path = sound/
sound ^= hit:hit.mp3
```
Refer to the [options_guide](https://raw.githubusercontent.com/crawl/crawl/master/crawl-ref/docs/options_guide.txt)

 - The contents of the `sound-pack-info` file are displayed in the message.
 - Match file is prioritized according to the order in which the user loads it in RC, and if it's the same file, the sound of the match clause (`sound ^= ...`) positioned earlier has a higher match priority.

## SoundSupport sound pack spec (Experimental BGM)

BGM support is experimental. Syntax and trigger mapping may change and may behave differently depending on the Webtiles
version / server.

### Supported config lines

- `dwem_bgm += (<Place>, <weight>, "<path>")`
- `dwem_bgm += (<Place>:<Depth>, <weight>, "<path>")`
- `dwem_bgm_trigger += (StartGame|EndGame|Orb, <weight>, "<path>")`

### BGM selection rules

- On place/depth change, SoundSupport selects one BGM by weighted random among matching entries.
- `Place` entries apply to both `Place` and `Place:N`. `Place:N` entries apply only to that depth.
- Selected BGM loops. If the selected path equals the currently playing one, playback continues without restart.

### Trigger mapping (DWEM-specific)

- `StartGame`: Treated as `Dungeon:0` (the only special Dungeon depth).
- `EndGame`: `ui-push` message with `type: "game-over"` (game over screen).
- `Orb`: `player.status[]` contains an entry with `light: "Orb"` and `col: 13` (holding the Orb).
- While holding the Orb, SoundSupport suppresses all BGM transitions.
- BGM is stopped on lobby.

### Example Configuration

```plaintext
# Enable sound feature
sound_on = true

# Set sound volume (between 0 and 1)
sound_volume = 0.8

# Enable single SDL sound channel
one_SDL_sound_channel = true

# Set sound fade-out time (in seconds)
sound_fade_time = 1.0

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
/SoundSupport volume (0-1 | fx 0-1 | bgm 0-1): Set FX/BGM volume
/SoundSupport reload: Force reload sound pack
/SoundSupport test [message]: Output a message for sound testing
```

# CNC Open Sound Pack
We are initiating a project to develop a new sound patch for Webtiles. The current sound patch (Crawler's Sound Patch) has not been updated since version 0.22 and does not reflect recent monsters. We aim to update and enhance it with your participation.

## How to Contribute

### 1. Uploading Sound Files

Visit the CNC server's [Open Sound Pack page](https://osp.nemelex.cards/) to upload sound files. The page allows you to select and upload up to 20 sound files (MP3 or WAV format) at a time. Each file should be no larger than 5MB, and each IP can upload up to 20 files per hour.

For those who wish to contribute more extensively, an unlimited upload limit can be granted upon request. Please contact us via the CNC server contact information to obtain an authorization code.

Once uploaded, you will receive an accessible link for each file. You can also check all uploaded files by clicking on "View Uploaded Files."

### 2. Editing the Sound Pack List

Access the [CNC Open Sound Pack sheet](https://docs.google.com/spreadsheets/d/1ePlT10S0uyhqyBm4bZixnGSkfnHmcfUa8JViuDqE0Ow/edit?gid=155014829#gid=155014829). This sheet allows you to edit the list of files to be included in the sound patch.

Based on the contents of this sheet, a ZIP file of the sound pack will be automatically built. The process is as follows:

1. Automatically generates RC match syntax (`sound ^= REGEX:PATH`) based on the REGEX and PATH columns.
2. Adds the generated RC match syntax to the RCFILE.
3. The SOUND link should be in the format `https://osp.nemelex.cards/uploads/*.mp3|wav`, and the corresponding file will be automatically inserted into the ZIP file's PATH.

The sheet is editable by anyone, and by clicking the [real-time build request URL](https://osp.nemelex.cards/request-build) and waiting a bit, the sound pack will be built and available at: `https://osp.nemelex.cards/build/latest.zip`

To use this link in RC, add: `sound_pack += https://osp.nemelex.cards/build/latest.zip`

This allows everyone to use the collaboratively created sound pack. The webtiles sound pack is designed to be compatible with offline sound settings, so it can be used in offline versions as well.

## Notes and Guidelines

- The current Open Sound Pack sheet data is based on Crawler's 22 version sound pack.
- Most of the incorrect data has been corrected during my review.
- Entries labeled as `NEED_PATH_INFO` only have REGEX added by Crawler without the sound file. Please add appropriate files if possible.
- While WAV and MP3 file uploads are supported, please use MP3 files to reduce file size. I've converted all WAV files to MP3 (192kbps), reducing the size to 1/4, which is better for frequent web use.
- Avoid uploading duplicate files to prevent unnecessary increases in file size.
- Fill in the UPLOADER, SOURCE, and NOTE columns to facilitate collaboration.
- The basic part of Crawler's sound patch is set in `init.txt`, and the Zin's sermon sound patch part is set in `zin.txt`. For DWEM users, using `sound_pack += URL:["init.txt"]` will apply only the basic patch. If the RCFILE list is not manually specified, the sermon patch will also be applied.
- The Webtiles SoundSupport module uses locally stored sound patches after downloading from the URL. To update, use the `/SoundSupport clear` command, refresh, and download the new sound pack.
- Download the local sound pack from [here](https://osp.nemelex.cards/downloader.html), overwrite `settings/init.txt`, and place the `se` folder in the root of the game. You may need to edit some regex entries that are causing errors.

Let's work together to create a new, updated sound patch for Webtiles!
