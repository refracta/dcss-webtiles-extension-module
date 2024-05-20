import ModuleContainer from "./module-container.js";
import ModuleContainerStyle from "./module-container-style.js";

export default class ModuleManager {
    static name = 'ModuleManager'
    static version = '1.0'
    static dependencies = []
    static description = ''

    onLoad() {
        this.content = document.createElement('div');
        this.shadow = this.content.attachShadow({mode: 'open'});

        this.style = new ModuleContainerStyle();
        this.shadow.append(this.style);

        this.container = new ModuleContainer();
        this.shadow.append(this.container);

        document.body.append(this.content);
    }
}
