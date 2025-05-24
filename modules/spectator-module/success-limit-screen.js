export default class SpectatorModule {
    static name = 'SpectatorModule';
    static version = '0.2';
    static dependencies = ['IOHook', 'SiteInformation'];
    static description = 'Simplified spectator view mode.';

    onLoad() {
        const {IOHook, SiteInformation} = DWEM.Modules;
        // hide right column UI when watching
        const hideUI = () => {
            if (SiteInformation.watching) {
                const rc = document.getElementById('right_column');
                if (rc) rc.style.display = 'none';
                const mp = document.getElementById('message_pane');
                if (mp) mp.style.display = 'none';
                const mm = document.getElementById('minimap_block');
                if (mm) mm.style.display = 'none';
                if (typeof toggle_full_window_dungeon_view === 'function')
                    toggle_full_window_dungeon_view(true);
            }
        };

        const topBar = document.createElement('div');
        topBar.id = 'spectator_topbar';
        topBar.style.position = 'fixed';
        topBar.style.top = '0';
        topBar.style.left = '0';
        topBar.style.right = '0';
        topBar.style.height = '10px';
        topBar.style.zIndex = '4000';
        topBar.style.backgroundColor = 'rgba(0,0,0,0.7)';
        topBar.innerHTML = '<div id="spectator_hp" style="height:100%;background:#0f0;width:0%"></div>' +
            '<div id="spectator_mp" style="height:100%;background:#00f;width:0%"></div>';
        document.body.append(topBar);

        const info = document.createElement('div');
        info.id = 'spectator_info';
        info.style.position = 'fixed';
        info.style.top = '12px';
        info.style.right = '10px';
        info.style.zIndex = '4000';
        info.style.color = 'white';
        info.style.fontSize = '12px';
        document.body.append(info);

        const msgBar = document.createElement('div');
        msgBar.id = 'spectator_msg';
        msgBar.style.position = 'fixed';
        msgBar.style.bottom = '0';
        msgBar.style.left = '0';
        msgBar.style.right = '0';
        msgBar.style.height = '1.2em';
        msgBar.style.fontSize = '12px';
        msgBar.style.backgroundColor = 'rgba(0,0,0,0.7)';
        msgBar.style.color = 'white';
        msgBar.style.zIndex = '4000';
        msgBar.style.paddingLeft = '4px';
        document.body.append(msgBar);

        const menuIcon = document.createElement('canvas');
        menuIcon.id = 'spectator_menu_icon';
        menuIcon.width = 16;
        menuIcon.height = 16;
        menuIcon.style.position = 'fixed';
        menuIcon.style.bottom = '5px';
        menuIcon.style.right = '5px';
        menuIcon.style.zIndex = '4000';
        menuIcon.style.display = 'none';
        document.body.append(menuIcon);

        const uiStack = document.getElementById('ui-stack');
        if (uiStack) {
            new MutationObserver(() => {
                menuIcon.style.display = uiStack.children.length ? 'block' : 'none';
            }).observe(uiStack, {childList: true});
        }

        // Use source mappers to tweak internal behaviour
        const {SourceMapperRegistry: SMR} = DWEM;

        // let losDiameter = 15;
        function patchShowDiameter() {
            show_diameter = 15;
        }

        const showDiameterMapper = SMR.getSourceMapper('BeforeReturnInjection',
            `!${patchShowDiameter.toString()}()`);
        SMR.add('./game', showDiameterMapper);

        function disableMinimap() {
            enabled = false;
        }

        const minimapMapper = SMR.getSourceMapper('BeforeReturnInjection',
            `!${disableMinimap.toString()}()`);
        SMR.add('./minimap', minimapMapper);

        function limitView() {
            const original = renderer.fit_to;
            renderer.fit_to = function (w, h, d) {
                original.call(this, w, h, d);
                this.set_size(d, d);
            };
        }

        const fitToMapper = SMR.getSourceMapper('BeforeReturnInjection',
            `!${limitView.toString()}()`);
        SMR.add('./dungeon_renderer', fitToMapper);

        let player = {};

        IOHook.handle_message.after.addHandler('spectator-module', (data) => {
            if (!SiteInformation.watching) return;

            if (data.hp !== undefined) player.hp = data.hp;
            if (data.hp_max !== undefined) player.hp_max = data.hp_max;
            if (data.mp !== undefined) player.mp = data.mp;
            if (data.mp_max !== undefined) player.mp_max = data.mp_max;

            if (data.name) player.name = data.name;
            if (data.char) player.char = data.char;
            if (data.god) player.god = data.god;

            if (data.los !== undefined) losDiameter = data.los * 2 + 1;
            else if (data.los_radius !== undefined) losDiameter = data.los_radius * 2 + 1;
            else if (data.los_diameter !== undefined) losDiameter = data.los_diameter;

            if (player.hp_max) {
                const hpPct = (player.hp / player.hp_max) * 100;
                topBar.querySelector('#spectator_hp').style.width = hpPct + '%';
            }
            if (player.mp_max) {
                const mpPct = (player.mp / player.mp_max) * 100;
                topBar.querySelector('#spectator_mp').style.width = mpPct + '%';
            }
            if (player.name) {
                info.textContent = `${player.name} (${player.char || ''}^${player.god || ''})`;
            }

            if (data.msg === 'msgs' && data.messages?.length) {
                msgBar.textContent = data.messages[data.messages.length - 1].text;
            }
        });

        // initial hide
        setTimeout(_ => {
            hideUI();
        }, 1000)
    }
}
