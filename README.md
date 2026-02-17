# dcss-webtiles-extension-module

dcss-webtiles-extension-module (DWEM) is a framework designed to extend the functionality of Dungeon Crawl Stone Soup
Webtiles.

This framework hooks into RequireJS, allowing the injection of user code snippets before the Webtiles JavaScript code is
loaded.

# Installation (User)

1. Install a script manager such as [Tampermonkey](https://www.tampermonkey.net)
   or [Greasemonkey](https://www.greasespot.net).
2. Install [Greasy Fork (loader/dwem-base-loader.js)](https://greasyfork.org/ko/scripts/493267-dcss-webtiles-extension-module-loader).

Warning: DWEM is already applied to the CNC server (so you can use the already applied modules directly), and these
steps are for using DWEM on servers where it is not yet applied.
![image](https://github.com/user-attachments/assets/9d408e9d-5ccd-4382-a227-91fa5272b9b5)

The default loading modules include ModuleManager. To check if DWEM has loaded correctly, you can press Ctrl + F12 (toggle) to view the Module Manager UI.
## Custom module loading

After installation, you can uncomment the following section of the script and enter the URLs of the desired module
scripts to load the modules you want.

```js
// localStorage.DWEM_MODULES = JSON.stringify(['https://example.org/module.js', ...]);
```

If no additional modifications are made, the utility modules posted in this repository, excluding the CNC
server-specific modules, will be loaded by [default](https://github.com/refracta/dcss-webtiles-extension-module/blob/main/loader/dwem-base-loader.js#L81).

# Installation (Webtiles Server)

```html

<script type="text/javascript">
    var socket_server = "{{ socket_server }}";
    localStorage.DWEM_MODULES = ['https://example.org/module1.js', 'https://example.org/module2.js'];
</script>
<script src="https://cdn.jsdelivr.net/gh/refracta/dcss-webtiles-extension-module/loader/dwem-base-loader.js"></script>
```

[Modify](https://github.com/refracta/dcss-server/blob/a92995a8ac4a14c08fcc48483f43c871941607e8/server/scripts/utils/setup-cnc-config.sh#L10) `webserver/templates/client.html` like the code above. You can define the URLs of the modules you want to load by
default in `localStorage.DWEM_MODULES`.

# How to develop Module?

## Defining the Module Class

```javascript
export default class BasicModule {
    static name = 'BasicModule'
    static version = '1.0'
    static dependencies = []
    static description = ''

    onLoad() {

    }
}
```

- The `name` and `version` properties are essential attributes required by the DWEM loader to function correctly.
- The `dependencies` property specifies the dependencies on other modules. If defined, the DWEM loader will load the
  dependent modules first, then load the current module. (Example: `dependencies = ['Module1', 'Module2:1.0'];`)
- The `description` property allows you to provide a brief description of the module, which can be displayed in the
  module manager.
- The DWEM loader pauses the loading of `RequireJS`, loads itself and the classes of other modules, and then executes
  the `onLoad()` function of each module. In this step, you can define the initialization logic required for each
  module.

# Source Remapping and Basic Example (Documentation in Progress)

- You can refer to the examples in `modules/io-hook/index.js` and `modules/test-module1/index.js`.

# Module list
- [`ModuleManager:1.0`](modules/module-manager)
  - Description: This module helps to check and control the loading status of multiple modules.

- [`SoundSupport:0.1`](modules/sound-support)
  - Description: (Beta) This module implements sound effects and (Experimental) BGM in the webtiles environment. You can
    use it by adding a sound pack to the RC configuration.

- [`ConvenienceModule:0.1`](modules/convenience-module)
    - Description: (Beta) This module provides convenience features.

- [`IOHook:1.0`](modules/io-hook)
    - Description: (Library) This module allows users to add hooks before and after sending and receiving WebSocket
      data.

- [`SiteInformation:1.0`](modules/site-information)
    - Description: (Library) This module returns site information to other modules.

- [`WebSocketFactory:1.0`](modules/websocket-factory)
    - Description: (Library) This module simulates a WebSocket that replicates the user's session.

- [`CNCUserinfo:0.1`](modules/cnc-userinfo)
    - Description: (Beta) This module provides advanced CNC user information.

- [`RCManager:1.0`](modules/rc-manager)
    - Description: (Library) This module provides features for creating custom RC trigger logic.

- [`CNCBanner:1.0`](modules/cnc-banner)
    - Description: This module sets the banner for the CNC server.

- [`CNCPublicChat:0.1`](modules/cnc-public-chat)
    - Description: (Beta) This module provides CNC server public chat.

## SoundSupport sound pack spec (Experimental BGM)

BGM support is experimental. Syntax and trigger mapping may change and may behave differently depending on the Webtiles
version / server.

### RC options

- `sound_on` (bool): Enable SoundSupport.
- `sound_volume` (float, 0..1): Sound effects volume.
- `bgm_volume` (float, 0..1): BGM volume. Default: `sound_volume`.
- `sound_debug` (bool): Print sound/BGM matching and selection details to the browser console.

### Sound pack file format

Sound packs are ZIP files that contain one or more `.txt` config files and the referenced audio files.

Supported config lines:

- `sound_file_path = <path>`: Base path (inside the ZIP) for subsequent audio paths.
- `sound += <regex>:<path>`: Play a sound effect when a message matches `<regex>`.
- `dwem_bgm += (<Place>, <weight>, <path>)`
- `dwem_bgm += (<Place>:<Depth>, <weight>, <path>)`
- `dwem_bgm_trigger += (StartGame|EndGame|Orb, <weight>, "<path>")`

### BGM selection rules

- On place/depth change, SoundSupport selects one BGM by weighted random among matching entries.
- `Place` entries apply to both `Place` and `Place:N`. `Place:N` entries apply only to that depth.
- Selected BGM loops. If the selected path equals the currently playing one, playback continues without restart.

### Trigger mapping (DWEM-specific)

- `StartGame`: Treated as `Dungeon:0` (the only special Dungeon depth).
- `EndGame`: `ui-push` message with `type: "game-over"` (game over screen).
- `Orb`: `player.status[]` contains an entry with `light: "Orb"` and `col: 13` (holding the Orb).
- While holding the Orb, SoundSupport suppresses all BGM transitions except leaving the game (BGM is stopped on lobby).

# Notes

DWEM is currently in the development and testing phase.




