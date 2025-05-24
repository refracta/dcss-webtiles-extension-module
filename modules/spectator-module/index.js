export default class SpectatorModule {
    static name = 'SpectatorModule';
    static version = '0.1';
    static dependencies = ['IOHook', 'SiteInformation'];
    static description = 'Simplified spectator view mode.';

    onLoad() {
        const {IOHook, SiteInformation} = DWEM.Modules;
        const {SourceMapperRegistry: SMR} = DWEM;

        // expose needed locals from game modules
        function exposeGameHelpers() {
            window.toggle_full_window_dungeon_view = toggle_full_window_dungeon_view;
        }
        SMR.add('./game', SMR.getSourceMapper('BeforeReturnInjection', `!(${exposeGameHelpers.toString()})();`));

        function exposeOptions() {
            DWEM.Modules.SpectatorModule.options = { get: get_option, set: set_option };
        }
        SMR.add('./options', SMR.getSourceMapper('BeforeReturnInjection', `!(${exposeOptions.toString()})();`));

        const topBar = document.createElement('div');
        topBar.id = 'spectator_topbar';
        Object.assign(topBar.style, {
            position: 'fixed', top: '0', left: '0', right: '0', height: '10px',
            zIndex: 4000, backgroundColor: 'rgba(0,0,0,0.7)'
        });
        topBar.innerHTML = '<div id="spectator_hp" style="height:100%;background:#0f0;width:0%"></div>' +
            '<div id="spectator_mp" style="height:100%;background:#00f;width:0%"></div>';
        document.body.append(topBar);

        const info = document.createElement('div');
        info.id = 'spectator_info';
        Object.assign(info.style, {
            position: 'fixed', top: '12px', right: '10px', zIndex: 4000,
            color: 'white', fontSize: '12px'
        });
        document.body.append(info);

        const msgBar = document.createElement('div');
        msgBar.id = 'spectator_msg';
        Object.assign(msgBar.style, {
            position: 'fixed', bottom: '0', left: '0', right: '0', height: '1.2em',
            fontSize: '12px', backgroundColor: 'rgba(0,0,0,0.7)', color: 'white',
            zIndex: 4000, paddingLeft: '4px'
        });
        document.body.append(msgBar);

        const menuIcon = document.createElement('canvas');
        menuIcon.id = 'spectator_menu_icon';
        menuIcon.width = 16;
        menuIcon.height = 16;
        Object.assign(menuIcon.style, {
            position: 'fixed', bottom: '5px', right: '5px', zIndex: 4000,
            display: 'none'
        });
        document.body.append(menuIcon);

        const uiStack = document.getElementById('ui-stack');
        if (uiStack) {
            new MutationObserver(() => {
                menuIcon.style.display = uiStack.children.length ? 'block' : 'none';
            }).observe(uiStack, {childList: true});
        }

        let watching = false;
        let player = null;

        function applySpectatorUI() {
            const rc = document.getElementById('right_column');
            const mp = document.getElementById('message_pane');
            if (rc) rc.style.display = 'none';
            if (mp) mp.style.display = 'none';
            if (SpectatorModule.options) {
                SpectatorModule.options.set('tile_level_map_hide_sidebar', true, false);
                SpectatorModule.options.set('tile_level_map_hide_messages', true, false);
            }
            if (window.toggle_full_window_dungeon_view) {
                window.toggle_full_window_dungeon_view(true);
            }
        }

        if (SiteInformation.watching) {
            watching = true;
        }
        document.addEventListener('game_init', () => {
            if (watching) applySpectatorUI();
        });

        window.addEventListener('resize', () => {
            if (watching && window.toggle_full_window_dungeon_view) {
                window.toggle_full_window_dungeon_view(true);
            }
        });

        IOHook.handle_message.after.addHandler('spectator-module', (data) => {
            if (data.msg === 'watching_started') {
                watching = true;
                applySpectatorUI();
            }
            if (!watching) return;

            if (data.msg === 'player') {
                player = data;
                if (data.los) {
                    show_diameter = data.los * 2 + 1;
                }
                const hpPct = player.hp_max ? (player.hp / player.hp_max * 100) : 0;
                const mpPct = player.mp_max ? (player.mp / player.mp_max * 100) : 0;
                topBar.querySelector('#spectator_hp').style.width = hpPct + '%';
                topBar.querySelector('#spectator_mp').style.width = mpPct + '%';
                info.textContent = `${player.name} (${player.char}^${player.god})`;
            } else if (data.msg === 'msgs' && data.messages && data.messages.length) {
                msgBar.textContent = data.messages[data.messages.length - 1].text;
            } else if (!data.msg && data.status) {
                // update status-only packet
                player = Object.assign(player || {}, data);
            }
        });
    }
}
