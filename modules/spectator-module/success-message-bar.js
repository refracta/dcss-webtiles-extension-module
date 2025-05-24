export default class SpectatorModule {
    static name = 'SpectatorModule';
    static version = '0.1';
    static dependencies = ['IOHook'];
    static description = 'Simplified spectator view mode.';

    constructor() {
        this.losDiameter = 15;
        this.player = null;
        this.old_hp = null;
        this.old_mp = null;
    }

    onLoad() {
        const {IOHook} = DWEM.Modules;
        const hideUI = () => {
            const rc = document.getElementById('right_column');
            if (rc) {
                rc.style.visibility = 'hidden';
                rc.style.pointerEvents = 'none';
            }
            const mp = document.getElementById('message_pane');
            if (mp) mp.style.display = 'none';
            const chat = document.getElementById('chat');
            if (chat) chat.style.display = 'none';
            const chatHidden = document.getElementById('chat_hidden');
            if (chatHidden) chatHidden.style.display = 'none';
        };

        const style = document.createElement('style');
        style.textContent = `
            #spectator_topbar{position:fixed;top:0;left:0;right:0;z-index:4000;background:rgba(0,0,0,0.7);font-size:0;padding:2px 0;}
            #spectator_topbar .bar{position:relative;width:100%;height:4px;background:var(--color-8);margin:1px 0;}
            #spectator_topbar .bar span{position:absolute;left:0;top:0;height:100%;}
            #spectator_hp_bar_full{background:var(--color-10);}
            #spectator_hp_bar_poison{background:var(--color-14);}
            #spectator_hp_bar_decrease{background:var(--color-4);}
            #spectator_hp_bar_increase{background:var(--color-2);}
            #spectator_mp_bar_full{background:var(--color-9);}
            #spectator_mp_bar_decrease{background:var(--color-5);}
            #spectator_mp_bar_increase{background:var(--color-1);}
            #spectator_info{position:fixed;top:10px;right:10px;z-index:4000;color:white;font-size:12px;}
            #spectator_msg{position:fixed;bottom:0;left:0;right:0;height:1.2em;font-size:12px;background:rgba(0,0,0,0.7);color:white;z-index:4000;padding-left:4px;}
            #spectator_menu_icon{position:fixed;bottom:5px;right:5px;z-index:4000;display:none;}
        `;
        document.head.append(style);

        const topBar = document.createElement('div');
        topBar.id = 'spectator_topbar';
        topBar.innerHTML = `
            <div id="spectator_hp_bar" class="bar">
                <span id="spectator_hp_bar_full"></span>
                <span id="spectator_hp_bar_poison"></span>
                <span id="spectator_hp_bar_decrease"></span>
                <span id="spectator_hp_bar_increase"></span>
            </div>
            <div id="spectator_mp_bar" class="bar">
                <span id="spectator_mp_bar_full"></span>
                <span id="spectator_mp_bar_decrease"></span>
                <span id="spectator_mp_bar_increase"></span>
            </div>`;
        document.body.append(topBar);

        const info = document.createElement('div');
        info.id = 'spectator_info';
        document.body.append(info);

        const msgBar = document.createElement('div');
        msgBar.id = 'spectator_msg';
        document.body.append(msgBar);

        const menuIcon = document.createElement('canvas');
        menuIcon.id = 'spectator_menu_icon';
        menuIcon.width = 16;
        menuIcon.height = 16;
        document.body.append(menuIcon);

        const uiStack = document.getElementById('ui-stack');
        if (uiStack) {
            new MutationObserver(() => {
                menuIcon.style.display = uiStack.children.length ? 'block' : 'none';
            }).observe(uiStack, {childList: true});
        }

        const {SourceMapperRegistry: SMR} = DWEM;

        function patchShowDiameter() {
            show_diameter = DWEM.Modules.SpectatorModule.losDiameter;
        }
        const showDiameterMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${patchShowDiameter.toString()}()`);
        SMR.add('./game', showDiameterMapper);

        function exposeGameHelpers() {
            DWEM.Modules.SpectatorModule.toggleFullWindowDungeonView = toggle_full_window_dungeon_view;
        }
        const exposeHelpersMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${exposeGameHelpers.toString()}()`);
        SMR.add('./game', exposeHelpersMapper, -1);

        function exposePlayer() {
            DWEM.Modules.SpectatorModule.player = player;
        }
        const exposePlayerMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${exposePlayer.toString()}()`);
        SMR.add('./player', exposePlayerMapper);

        let player = null;

        const hpFull = topBar.querySelector('#spectator_hp_bar_full');
        const hpPoison = topBar.querySelector('#spectator_hp_bar_poison');
        const hpDec = topBar.querySelector('#spectator_hp_bar_decrease');
        const hpInc = topBar.querySelector('#spectator_hp_bar_increase');
        const mpFull = topBar.querySelector('#spectator_mp_bar_full');
        const mpDec = topBar.querySelector('#spectator_mp_bar_decrease');
        const mpInc = topBar.querySelector('#spectator_mp_bar_increase');

        function updateHp() {
            if (!player) return;
            const max = player.hp_max || 1;
            const val = Math.max(0, player.hp);
            const old = (DWEM.Modules.SpectatorModule.old_hp ?? val);
            const increase = val > old;
            let fullVal = increase ? old : val;
            let changeVal = Math.abs(val - old);
            let poisonVal = 0;
            if (player.poison_survival < val) {
                poisonVal = val - player.poison_survival;
                fullVal = Math.min(old, player.poison_survival);
            }
            let fullPct = Math.round(100 * fullVal / max);
            let poisonPct = Math.round(100 * poisonVal / max);
            let changePct = Math.floor(100 * changeVal / max);
            if (fullPct + poisonPct + changePct > 100)
                changePct = 100 - fullPct - poisonPct;
            hpFull.style.width = fullPct + '%';
            hpPoison.style.width = poisonPct + '%';
            hpInc.style.width = increase ? changePct + '%' : '0%';
            hpDec.style.width = increase ? '0%' : changePct + '%';
            DWEM.Modules.SpectatorModule.old_hp = val;
        }

        function updateMp() {
            if (!player) return;
            const max = player.mp_max || 1;
            const val = Math.max(0, player.mp);
            const old = (DWEM.Modules.SpectatorModule.old_mp ?? val);
            const increase = val > old;
            let fullVal = increase ? old : val;
            let changeVal = Math.abs(val - old);
            let fullPct = Math.round(100 * fullVal / max);
            let changePct = Math.floor(100 * changeVal / max);
            if (fullPct + changePct > 100)
                changePct = 100 - fullPct;
            mpFull.style.width = fullPct + '%';
            mpInc.style.width = increase ? changePct + '%' : '0%';
            mpDec.style.width = increase ? '0%' : changePct + '%';
            DWEM.Modules.SpectatorModule.old_mp = val;
        }

        function formattedStringToHtml(str) {
            const cols = {
                "black":0,"blue":1,"green":2,"cyan":3,"red":4,"magenta":5,"brown":6,
                "lightgrey":7,"lightgray":7,"darkgrey":8,"darkgray":8,
                "lightblue":9,"lightgreen":10,"lightcyan":11,"lightred":12,
                "lightmagenta":13,"yellow":14,"h":14,"white":15,"w":15
            };
            function escape_html(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
            let cur_fg=[];let bg_open=false;
            let filtered=str.replace(/<?<(\/?(bg:)?[a-z]*)>?|>|&/ig,function(m,p1){
                if(p1===undefined)p1="";let closing=false,bg=false;
                if(p1.match(/^\//)){p1=p1.substr(1);closing=true;}
                if(p1.match(/^bg:/)){bg=true;p1=p1.substr(3);}
                if(p1 in cols&&!m.match(/^<</)&&m.match(/>$/)){
                    if(closing){
                        if(bg&&bg_open){bg_open=false;return "</span>";}
                        else if(cur_fg.length>0){cur_fg.pop();
                            if(cur_fg.length>0){return "</span><span class='fg"+cur_fg[cur_fg.length-1]+"'>";}
                            else return "</span>";}
                        return "";
                    } else if(bg){
                        let text="<span class='bg"+cols[p1]+"'>"; if(bg_open) text="</span>"+text;
                        if(cur_fg.length>0) text="</span>"+text+"<span class='fg"+cur_fg[cur_fg.length-1]+"'>";
                        bg_open=true; return text;
                    } else {
                        let text="<span class='fg"+cols[p1]+"'>"; if(cur_fg.length>0) text="</span>"+text;
                        cur_fg.push(cols[p1]); return text;
                    }
                } else {
                    if(m.match(/^<</)) return escape_html(m.substr(1)); else return escape_html(m);
                }
            });
            if(cur_fg.length>0) filtered+="</span>"; if(bg_open) filtered+="</span>"; return filtered;
        }

        IOHook.handle_message.after.addHandler('spectator-module', (data) => {
            if (data.msg === 'player') {
                player = data;
                info.textContent = `${player.name} (${player.species}${player.god ? '^' + player.god : ''})`;
                updateHp();
                updateMp();
            } else if (data.msg === 'msgs' && data.messages?.length) {
                msgBar.innerHTML = formattedStringToHtml(data.messages[data.messages.length - 1].text);
            }
        });

        hideUI();
        document.addEventListener('game_init', () => {
            hideUI();
            DWEM.Modules.SpectatorModule.toggleFullWindowDungeonView?.(true);
        });
    }
}
