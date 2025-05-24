export default class SpectatorModule {
    static name = 'SpectatorModule';
    static version = '0.1';
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

        // Reduce visible map size to approximate LOS only
        const {SourceMapperRegistry: SMR} = DWEM;
        function patchShowDiameter() {
            show_diameter = 15;
        }
        const showDiameterMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${patchShowDiameter.toString()}()`);
        SMR.add('./game', showDiameterMapper);

        let player = null;

        IOHook.handle_message.after.addHandler('spectator-module', (data) => {
            if (!SiteInformation.watching) return;
            if (data.msg === 'player') {
                player = data;
                const hpPct = player.hp_max ? (player.hp / player.hp_max * 100) : 0;
                const mpPct = player.mp_max ? (player.mp / player.mp_max * 100) : 0;
                topBar.querySelector('#spectator_hp').style.width = hpPct + '%';
                topBar.querySelector('#spectator_mp').style.width = mpPct + '%';
                info.textContent = `${player.name} (${player.char}^${player.god})`;
            } else if (data.msg === 'msgs' && data.messages?.length) {
                msgBar.textContent = data.messages[data.messages.length - 1].text;
            }
        });

        // initial hide
        hideUI();
        document.addEventListener('game_init', hideUI);
    }
}
