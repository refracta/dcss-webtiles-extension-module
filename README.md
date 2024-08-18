# dcss-webtiles-extension-module (Korean)

> This document will soon be available in English.

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

## Custom module loading

After installation, you can uncomment the following section of the script and enter the URLs of the desired module
scripts to load the modules you want.

```js
// localStorage.DWEM_MODULES = JSON.stringify(['https://example.org/module.js', ...]);
```

If no additional modifications are made, the utility modules posted in this repository, excluding the CNC
server-specific modules, will be loaded by default.

# Installation (Webtiles Server)

```html

<script type="text/javascript">
    var socket_server = "{{ socket_server }}";
    localStorage.DWEM_MODULES = ['https://example.org/module1.js', 'https://example.org/module2.js'];
</script>
<script src="https://cdn.jsdelivr.net/gh/refracta/dcss-webtiles-extension-module/loader/dwem-base-loader.js"></script>
```

Modify `webserver/templates/client.html` like the code above. You can define the URLs of the modules you want to load by
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

- `ModuleManager:1.0`: View the list of modules with Ctrl + F12 (in development)
- `IOHook:1.0`: A module that assists with input/output hooking

# Notes

DWEM is currently in the development and testing phase.




