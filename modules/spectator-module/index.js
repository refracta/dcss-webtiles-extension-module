export default class SpectatorModule {
    static name = 'SpectatorModule';
    static version = '0.1';
    static dependencies = ['IOHook', 'RCManager'];
    static description = 'Simplified spectator view mode.';

    onLoad() {
        const {IOHook, RCManager} = DWEM.Modules;
        const {SourceMapperRegistry: SMR} = DWEM;

        const style = document.createElement('style');
        style.id = 'spectator_styles';
        style.textContent = `
            #spectator_topbar { display:flex; flex-direction:column; height:20px; background:rgba(0,0,0,0.7); position:fixed; top:0; left:0; right:0; z-index:4000; }
            .spectator_bar { position:relative; width:100%; height:10px; background:var(--color-8); }
            .spectator_bar > div { position:absolute; height:100%; width:0%; }
            #spectator_hp_full { background:var(--color-10); }
            #spectator_hp_poison { background:var(--color-14); }
            #spectator_hp_decrease { background:var(--color-4); right:0; left:auto; }
            #spectator_hp_increase { background:var(--color-2); }
            #spectator_mp_full { background:var(--color-9); }
            #spectator_mp_decrease { background:var(--color-5); right:0; left:auto; }
            #spectator_mp_increase { background:var(--color-1); }
        `;
        document.head.append(style);

        function exposeFormatter() {
            DWEM.Modules.SpectatorModule.formatter = formatted_string_to_html;
        }
        SMR.add('util', SMR.getSourceMapper('BeforeReturnInjection', `!(${exposeFormatter.toString()})();`));

        // expose needed locals from game modules
        function exposeGameHelpers() {
            window.toggle_full_window_dungeon_view = toggle_full_window_dungeon_view;
        }
        SMR.add('./game', SMR.getSourceMapper('BeforeReturnInjection', `!(${exposeGameHelpers.toString()})();`));

        function exposeShowDiameter() {
            Object.defineProperty(DWEM.Modules.SpectatorModule, 'losDiameter', {
                get: () => show_diameter,
                set: (v) => { show_diameter = v; }
            });
        }
        SMR.add('./game', SMR.getSourceMapper('BeforeReturnInjection', `!(${exposeShowDiameter.toString()})();`));

        function patchShowDiameter() {
            show_diameter = 15;
        }
        const showDiameterMapper = SMR.getSourceMapper('BeforeReturnInjection',
            `!${patchShowDiameter.toString()}()`);
        SMR.add('./game', showDiameterMapper);

        function exposeOptions() {
            DWEM.Modules.SpectatorModule.options = { get: get_option, set: set_option };
        }
        SMR.add('./options', SMR.getSourceMapper('BeforeReturnInjection', `!(${exposeOptions.toString()})();`));

        function patchMapOptions() {
            if (typeof set_option === 'function') {
                set_option('tile_level_map_hide_sidebar', true, false);
                set_option('tile_level_map_hide_messages', true, false);
            }
        }
        SMR.add('./options', SMR.getSourceMapper('BeforeReturnInjection', `!(${patchMapOptions.toString()})();`));

        const topBar = document.createElement('div');
        topBar.id = 'spectator_topbar';
        topBar.innerHTML = `
            <div id="spectator_hp" class="spectator_bar">
                <div id="spectator_hp_full"></div>
                <div id="spectator_hp_poison"></div>
                <div id="spectator_hp_decrease"></div>
                <div id="spectator_hp_increase"></div>
            </div>
            <div id="spectator_mp" class="spectator_bar">
                <div id="spectator_mp_full"></div>
                <div id="spectator_mp_decrease"></div>
                <div id="spectator_mp_increase"></div>
            </div>`;
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
            zIndex: 4000, paddingLeft: '4px', pointerEvents: 'none'
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

        let player = null;

        function updateSpectatorBar(name) {
            if (!player || player[name + '_max'] === 0) return;
            let value = player[name];
            let max = player[name + '_max'];
            let oldValue = player['old_' + name] ?? value;
            if (value < 0) value = 0;
            if (oldValue > max) oldValue = max;
            player['old_' + name] = value;
            const increase = oldValue < value;
            let full = Math.round(10000 * (increase ? oldValue : value) / max);
            let change = Math.floor(10000 * Math.abs(oldValue - value) / max);
            let poison = 0;
            if (name === 'hp') {
                const ps = player.poison_survival ?? value;
                document.getElementById('spectator_hp_poison').style.width = '0%';
                if (ps < value) {
                    poison = Math.round(10000 * (value - ps) / max);
                    full = Math.round(10000 * ps / max);
                    document.getElementById('spectator_hp_poison').style.width = (poison / 100) + '%';
                }
                if (full + poison + change > 10000)
                    change = 10000 - poison - full;
            } else if (full + change > 10000) {
                change = 10000 - full;
            }
            document.getElementById(`spectator_${name}_full`).style.width = (full / 100) + '%';
            document.getElementById(`spectator_${name}_${increase ? 'increase' : 'decrease'}`).style.width = (change / 100) + '%';
            document.getElementById(`spectator_${name}_${increase ? 'decrease' : 'increase'}`).style.width = '0%';
        }

        function applySpectatorUI() {
            const rc = document.getElementById('right_column');
            const mp = document.getElementById('message_pane');
            const chat = document.getElementById('chat');
            const chatHidden = document.getElementById('chat_hidden');
            if (rc) rc.style.display = 'none';
            if (mp) mp.style.display = 'none';
            if (chat) chat.style.display = 'none';
            if (chatHidden) chatHidden.style.display = 'none';
            if (window.toggle_full_window_dungeon_view) {
                window.toggle_full_window_dungeon_view(true);
            }
        }

        RCManager.addHandlers('spectator-module', { onGameInitialize: applySpectatorUI });


        window.addEventListener('resize', () => {
            if (window.toggle_full_window_dungeon_view) {
                window.toggle_full_window_dungeon_view(true);
            }
        });

        IOHook.handle_message.after.addHandler('spectator-module', (data) => {
            if ('hp' in data || 'mp' in data || data.msg === 'player') {
                player = Object.assign(player || {}, data);
                updateSpectatorBar('hp');
                updateSpectatorBar('mp');
                if (player.name) {
                    info.textContent = `${player.name} (${player.char}^${player.god})`;
                }
            }
            if (data.msg === 'msgs' && data.messages && data.messages.length && SpectatorModule.formatter) {
                msgBar.innerHTML = SpectatorModule.formatter(data.messages[data.messages.length - 1].text);
            }
            if (!data.msg && data.status) {
                player = Object.assign(player || {}, data);
            }
        });
    }
}
