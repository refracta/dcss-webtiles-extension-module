export default class CommandManager {
    static name = 'CommandManager';
    static version = '1.0';
    static dependencies = ['IOHook'];
    static description = '(Library, Alpha) This module provides features for creating commands.';

    constructor() {
        this.commands = [];
    }

    // 명령어 등록
    addCommand(command, argumentTypes, handler) {
        this.commands.push({ command, argumentTypes, handler });
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
            if (!argValue) throw new Error(`Missing argument for type: ${argType}`);

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
    }
}
