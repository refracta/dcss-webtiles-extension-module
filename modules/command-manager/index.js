export default class CommandManager {
    static name = 'CommandManager';
    static version = '1.0';
    static dependencies = ['IOHook'];
    static description = '(Library, Alpha) This module provides features for creating commands.';

    constructor() {
        this.commands = [];
        this.suggestionDiv = null;
    }

    // 명령어 등록
    addCommand(command, argumentTypes, handler, options = {}) {
        const {
            module = 'Unknown',
            description = '',
            argDescriptions = []
        } = options;
        this.commands.push({ command, argumentTypes, handler, module, description, argDescriptions });
    }

    getCommandsByModule(module) {
        return this.commands.filter(cmd => cmd.module === module);
    }

    formatArguments(cmd) {
        if (!cmd.argDescriptions || !cmd.argDescriptions.length) return '';
        return cmd.argDescriptions.map(d => `[${d}]`).join(' ');
    }

    generateHelpHTML(commands) {
        return commands.map(cmd => `/<b>${cmd.command.slice(1)}</b> ${this.formatArguments(cmd)} - ${cmd.description}`).join('<br>');
    }

    sendChatMessage(content) {
        const { IOHook } = DWEM.Modules;
        IOHook.handle_message({ msg: 'chat', content });
    }

    showSuggestions(prefix) {
        if (!prefix.startsWith('/')) {
            this.hideSuggestions();
            return;
        }
        const suggestions = this.commands.filter(cmd => cmd.command.startsWith(prefix.trim()));
        if (!suggestions.length) {
            this.hideSuggestions();
            return;
        }
        if (!this.suggestionDiv) {
            this.suggestionDiv = document.createElement('div');
            this.suggestionDiv.id = 'command_suggestions';
            Object.assign(this.suggestionDiv.style, {
                position: 'absolute',
                bottom: '35px',
                left: '0',
                background: '#222',
                color: '#fff',
                padding: '4px',
                fontSize: '12px',
                maxHeight: '150px',
                overflowY: 'auto',
                border: '1px solid #555',
                zIndex: 1000
            });
            const chatBody = document.getElementById('chat_body');
            chatBody && chatBody.append(this.suggestionDiv);
        }
        this.suggestionDiv.innerHTML = this.generateHelpHTML(suggestions);
    }

    hideSuggestions() {
        this.suggestionDiv?.remove();
        this.suggestionDiv = null;
    }

    // 타입별 인자 파싱 함수
    parseArguments(args, argumentTypes) {
        const parsedArgs = [];
        let textStarted = false;

        for (let i = 0, argIndex = 1; i < argumentTypes.length; i++) {
            const argType = argumentTypes[i];

            // 'text' 타입인 경우, 그 시점부터 끝까지 모든 텍스트를 하나의 문자열로 묶음
            if (argType === 'text') {
                const remainingArgs = args.slice(argIndex).join(' ');
                parsedArgs.push(remainingArgs);
                textStarted = true; // text가 시작되면 남은 처리는 필요 없음
                break;
            }

            const argValue = args[argIndex];
            if (argValue === undefined) {
                parsedArgs.push(undefined);
                argIndex++;
                continue;
            }

            switch (argType) {
                case 'string':
                    parsedArgs.push(argValue);
                    break;
                case 'integer':
                    const intValue = parseInt(argValue, 10);
                    if (isNaN(intValue)) throw new Error(`Invalid integer value: ${argValue}`);
                    parsedArgs.push(intValue);
                    break;
                case 'float':
                    const floatValue = parseFloat(argValue);
                    if (isNaN(floatValue)) throw new Error(`Invalid float value: ${argValue}`);
                    parsedArgs.push(floatValue);
                    break;
                default:
                    throw new Error(`Unsupported argument type: ${argType}`);
            }
            argIndex++;
        }

        return parsedArgs;
    }

    onLoad() {
        const { IOHook } = DWEM.Modules;

        IOHook.send_message.before.addHandler('command-manager', (msg, data) => {
            if (msg === 'chat_msg') {
                const { text } = data;
                const args = text.trim().split(' ');
                const command = args[0];

                const matchedCommand = this.commands.find(cmd => command.startsWith(cmd.command));

                if (matchedCommand) {
                    try {
                        const parsedArgs = this.parseArguments(args, matchedCommand.argumentTypes);
                        matchedCommand.handler(parsedArgs);
                    } catch (error) {
                        console.error(`Error executing command: ${error.message}`);
                    }
                    return true;
                }
            }
        });

        const chatInput = document.getElementById('chat_input');
        if (chatInput) {
            chatInput.addEventListener('input', () => this.showSuggestions(chatInput.value));
            chatInput.addEventListener('blur', () => this.hideSuggestions());
        }

        this.addCommand('/help', ['text'], ([mod]) => {
            const list = mod ? this.getCommandsByModule(mod) : this.commands;
            const html = `<b>Available Commands${mod ? ' for ' + mod : ''}</b><br>` + this.generateHelpHTML(list);
            this.sendChatMessage(html);
        }, {
            module: CommandManager.name,
            description: 'Show command list',
            argDescriptions: ['module']
        });
    }
}
