import 'https://cdn.jsdelivr.net/npm/ace-builds@1.36.2/src-noconflict/ace.js';
import 'https://cdn.jsdelivr.net/npm/ace-builds@1.36.2/src-noconflict/theme-tomorrow_night_bright.js';
import 'https://cdn.jsdelivr.net/npm/ace-builds@1.36.2/src-noconflict/mode-lua.js';
import 'https://cdn.jsdelivr.net/npm/ace-builds@1.36.2/src-noconflict/ext-language_tools.js';

export default class AdvancedRCEditor {
    static name = 'AdvancedRCEditor';
    static version = '1.0';
    static dependencies = ['IOHook', 'SiteInformation'];
    static description = '(Library) This module provides advanced rc editor.';

    onLoad() {
        const {IOHook, SiteInformation} = DWEM.Modules;

        ace.config.set('basePath', 'https://cdn.jsdelivr.net/npm/ace-builds@1.36.2/src-noconflict');
        ace.require('ace/ext/language_tools');
        const completionsPath = import.meta.url.substring(0, import.meta.url.lastIndexOf('/')) + '/completions.json';
        fetch(completionsPath).then(r => r.json()).then(completions => {
            const customCompleter = {
                getCompletions: function (editor, session, pos, prefix, callback) {
                    if (prefix.length === 0) {
                        return callback(null, []);
                    }
                    callback(null, completions.map(c => ({...c, score: 9999})));
                }
            };
            ace.require("ace/ext/language_tools").addCompleter(customCompleter);
        });

        const style = document.createElement('style');
        style.innerHTML = `
            .ace_editor.fullScreen {
                height: 100%;
                width: 100%;
                border: 0;
                margin: 0;
                position: fixed !important;
                top: 0;
                bottom: 0;
                left: 0;
                right: 0;
                z-index: 9999;
            }

            body.fullScreen {
                overflow: hidden;
            }

            #editor.fullScreen {
                width: 100% !important;
                height: 100% !important;
            }
        `;
        document.head.appendChild(style);

        document.querySelector('#rc_edit').style.zIndex = 9999;
        const editorParent = document.querySelector('#rc_edit_form');
        const textarea = editorParent.querySelector('textarea');

        const editorDiv = document.createElement('div');
        editorDiv.id = 'editor';
        editorParent.prepend(editorDiv);
        const br = editorParent.querySelector('br');
        const helpSpan = document.createElement('span');
        const downloadButton = document.createElement('input');
        downloadButton.classList.add('button');
        downloadButton.value = 'Download';
        downloadButton.type = 'button';
        downloadButton.style.float = 'right';
        downloadButton.style.marginRight = '5px';
        downloadButton.onclick = () => {
            const rcfile = this.editor.getValue();
            const name = `${SiteInformation.current_user}.rc`; // 파일 이름 지정
            const blob = new Blob([rcfile], { type: 'text/plain' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = name;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
        helpSpan.textContent = 'F11: Toggle FullScreen Mode';
        br.insertAdjacentElement('afterend', helpSpan);
        editorParent.append(downloadButton);

        const {SourceMapperRegistry: SMR, MatcherRegistry: MR} = DWEM;

        function clientInjector() {
            const {AdvancedRCEditor} = DWEM.Modules;
            send_rc = function () {
                console.log()
                send_message("set_rc", {
                    game_id: editing_rc, contents: AdvancedRCEditor.editor.getValue()
                });
                hide_dialog();
                return false;
            }
            $("#rc_edit_form").unbind("submit").bind("submit", send_rc);
        }

        const clientMapper = SMR.getSourceMapper('BeforeReturnInjection', `!${clientInjector.toString()}()`);
        SMR.add('client', clientMapper);

        IOHook.handle_message.after.addHandler('rc-manager', async (data) => {
            if (data.msg === 'rcfile_contents') {
                textarea.style.display = '';
                const rcfile = data.contents;
                this?.editor?.destory?.();
                this.editor = ace.edit("editor");

                this.editor.setTheme("ace/theme/tomorrow_night_bright");
                this.editor.session.setMode("ace/mode/lua");
                this.editor.session.setOption('useWorker', false);

                this.editor.setOptions({
                    enableBasicAutocompletion: true, enableLiveAutocompletion: true, enableSnippets: true, wrap: true
                });

                this.editor.setValue(rcfile);

                const rect = textarea.getBoundingClientRect();
                editorDiv.style.width = `${rect.width}px`;
                editorDiv.style.height = `${rect.height}px`;
                this.editor.resize();

                this.editor.renderer.once("afterRender", () => {
                    const lastRow = this.editor.session.getLength() - 1;
                    const lastColumn = this.editor.session.getLine(lastRow).length;
                    this.editor.gotoLine(lastRow + 1, lastColumn);
                    this.editor.renderer.scrollCursorIntoView();
                    this.editor.focus();
                });

                this.editor.commands.addCommand({
                    name: "Toggle Fullscreen", bindKey: {win: "F11", mac: "F11"}, exec: function (editor) {
                        const isFullScreen = document.body.classList.toggle("fullScreen");
                        editor.container.classList.toggle("fullScreen", isFullScreen);
                        document.getElementById("editor").classList.toggle("fullScreen", isFullScreen);
                        editor.resize();
                    }
                });

                textarea.style.display = 'none';
            }
        });
    }
}
