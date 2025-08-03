export default class CommandManager {
    static name = 'CommandManager';
    static version = '1.0';
    static dependencies = ['IOHook'];
    static description = '(Library, Alpha) This module provides features for creating commands.';

    constructor() {
        this.commands = [];
        this.aliasMap = {}; // Maps aliases to command names
        this.suggestionDiv = null;
    }

    // 명령어 등록
    addCommand(command, argumentTypes, handler, options = {}) {
        const {
            module = 'Unknown',
            description = '',
            argDescriptions = [],
            aliases = []
        } = options;
        this.commands.push({command, argumentTypes, handler, module, description, argDescriptions});
        
        // Register aliases
        aliases.forEach(alias => {
            this.aliasMap[alias] = command;
        });
    }

    getCommandsByModule(module) {
        return this.commands.filter(cmd => cmd.module === module);
    }

    formatArguments(cmd) {
        if (!cmd.argDescriptions || !cmd.argDescriptions.length) return '';
        return cmd.argDescriptions.map(d => `[${d}]`).join(' ');
    }

    generateHelpHTML(commands) {
        return commands.map(cmd => {
            const displayName = cmd.displayName || cmd.command;
            let formattedName;
            if (displayName.includes(' → ')) {
                // For aliases, remove the leading / from both parts
                const [alias, target] = displayName.split(' → ');
                formattedName = `${alias.slice(1)} → ${target.slice(1)}`;
            } else {
                // For regular commands, just remove the leading /
                formattedName = displayName.slice(1);
            }
            return `/<b>${formattedName}</b> ${this.formatArguments(cmd)} - ${cmd.description}`;
        }).join('<br>');
    }

    sendChatMessage(content) {
        const {IOHook} = DWEM.Modules;
        IOHook.handle_message({msg: 'chat', content});
    }

    showSuggestions(input) {
        if (!input.startsWith('/')) {
            this.hideSuggestions();
            return;
        }
        
        // Find matching commands and their aliases
        const suggestions = [];
        const matchingCommands = new Set();
        
        // First, find commands that match the input
        this.commands.forEach(cmd => {
            if (cmd.command.startsWith(input)) {
                suggestions.push({...cmd, displayName: cmd.command});
                matchingCommands.add(cmd.command);
            }
        });
        
        // Then, find aliases that match
        Object.entries(this.aliasMap).forEach(([alias, target]) => {
            if (alias.startsWith(input) && !matchingCommands.has(target)) {
                const originalCommand = this.commands.find(cmd => cmd.command === target);
                if (originalCommand) {
                    suggestions.push({...originalCommand, displayName: alias + ' → ' + target});
                }
            }
        });
        
        // If no exact command match, check if we're typing arguments for a command
        if (!suggestions.length) {
            // Find the best matching command for the current input
            const bestMatch = this.commands.find(cmd => input.startsWith(cmd.command + ' '));
            if (bestMatch) {
                suggestions.push({...bestMatch, displayName: bestMatch.command});
            } else {
                // Check aliases too
                const aliasMatch = Object.entries(this.aliasMap).find(([alias]) => input.startsWith(alias + ' '));
                if (aliasMatch) {
                    const originalCommand = this.commands.find(cmd => cmd.command === aliasMatch[1]);
                    if (originalCommand) {
                        suggestions.push({...originalCommand, displayName: aliasMatch[0] + ' → ' + originalCommand.command});
                    }
                }
            }
        }
        
        if (!suggestions.length) {
            this.hideSuggestions();
            return;
        }
        if (!this.suggestionDiv) {
            this.suggestionDiv = document.createElement('div');
            this.suggestionDiv.id = 'command_suggestions';
            Object.assign(this.suggestionDiv.style, {
                position: 'absolute',
                bottom: '100%',
                left: '0',
                marginBottom: '4px',
                background: '#222',
                color: '#fff',
                padding: '4px',
                fontSize: '12px',
                maxHeight: '150px',
                overflowY: 'auto',
                border: '1px solid #555',
                zIndex: 1000
            });
            const chat = document.getElementById('chat');
            if (chat) {
                if (getComputedStyle(chat).position === 'static') {
                    chat.style.position = 'relative';
                }
                chat.append(this.suggestionDiv);
            }
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

        for (let i = 0, argIndex = 0; i < argumentTypes.length; i++) {
            let argType = argumentTypes[i];
            let isOptional = false;
            
            // Check if argument is optional (ends with ?)
            if (argType.endsWith('?')) {
                isOptional = true;
                argType = argType.slice(0, -1); // Remove the ?
            }

            // 'text' 타입인 경우, 그 시점부터 끝까지 모든 텍스트를 하나의 문자열로 묶음
            if (argType === 'text') {
                const remainingArgs = args.slice(argIndex).join(' ');
                parsedArgs.push(remainingArgs);
                textStarted = true; // text가 시작되면 남은 처리는 필요 없음
                break;
            }

            const argValue = args[argIndex];
            if (argValue === undefined || argValue === '') {
                if (isOptional) {
                    parsedArgs.push(undefined);
                } else {
                    throw new Error(`Missing required argument for type: ${argType}`);
                }
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
        const {IOHook} = DWEM.Modules;

        IOHook.send_message.before.addHandler('command-manager', (msg, data) => {
            if (msg === 'chat_msg') {
                const {text} = data;
                const fullCommand = text.trim();
                const args = fullCommand.split(' ');
                const command = args[0];
                
                // First check if it's an alias
                let targetCommand = command;
                if (this.aliasMap[command]) {
                    targetCommand = this.aliasMap[command];
                }
                
                const matchedCommand = this.commands.find(cmd => fullCommand.startsWith(cmd.command) || 
                    (targetCommand !== command && fullCommand.replace(command, targetCommand).startsWith(cmd.command)));
                
                if (matchedCommand) {
                    // Extract params correctly whether it's alias or direct command
                    const commandToReplace = fullCommand.startsWith(matchedCommand.command) ? 
                        matchedCommand.command : command;
                    const params = fullCommand.replace(commandToReplace, '').trim().split(' ').filter(p => p);
                    try {
                        const parsedArgs = this.parseArguments(params, matchedCommand.argumentTypes);
                        matchedCommand.handler(...parsedArgs);
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

        this.addCommand('/help', ['text'], (mod) => {
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
