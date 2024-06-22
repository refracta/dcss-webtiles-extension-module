class ModuleContainer extends HTMLDivElement {
    constructor() {
        super();
        const span = document.createElement('div');
        span.innerHTML = `
<div class="ui-popup" data-generation-id="3">
    <div class="ui-popup-outer">
        <div class="ui-popup-inner">
            <div class="module-list"></div>
        </div>
    </div>
</div>`;
        this.append(span);
        this.classList.add('module-container');
    }
}

customElements.define('module-container', ModuleContainer, {extends: 'div'});

const style = `
.module-container {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.5);
    z-index: 9999;
    overflow: hidden;
    display: none;
}

.ui-popup + .ui-popup { padding-top: 20px; }
.ui-popup + .ui-popup + .ui-popup { padding-top: 40px; }
.ui-popup + .ui-popup + .ui-popup + .ui-popup { padding-top: 60px; }

.ui-popup-outer {
    margin: 50px;
    max-height: calc(95vh - 100px);
    padding: 20px;
    background-color: #040204;
    border: 1px solid black;
    outline: 2px solid #7d623c;
    display: flex;
    z-index: 0;
    position: relative;
    overflow: hidden;
}

.ui-popup-inner {
    position: relative;
    display: flex;
    max-height: calc(95vh - 100px - 46px);
    overflow-y: auto;
    overflow-x: hidden;
    flex-direction: column;
    width: 100%;
}

.module-info {
    background-color: #333;
    color: #fff;
    padding: 10px;
    margin: 5px 0;
    cursor: pointer;
}
`;

class ModuleContainerStyle extends HTMLStyleElement {
    constructor() {
        super();
        this.textContent = style;
    }
}

customElements.define('module-container-style', ModuleContainerStyle, {extends: 'style'});

export default class ModuleManager {
    static name = 'ModuleManager'
    static version = '1.0'
    static dependencies = []
    static description = 'This module helps to check and control the loading status of multiple modules.'

    onLoad() {
        this.content = document.createElement('div');
        this.shadow = this.content.attachShadow({mode: 'open'});

        this.style = new ModuleContainerStyle();
        this.shadow.append(this.style);

        this.container = new ModuleContainer();
        this.shadow.append(this.container);

        document.body.append(this.content);

        // 초기 상태를 비활성 상태로 설정
        this.toggleVisibility(false);

        document.addEventListener('keydown', (event) => {
            if (event.ctrlKey && event.key === 'F12') {
                this.showModules();
                this.toggleVisibility();
            }
        });
    }

    showModules() {
        const container = this.shadow.querySelector('.module-list');
        container.innerHTML = ''; // Clear previous content
        DWEM.ModuleClasses.forEach((module, index) => {
            const { name, version, dependencies = [], description = '', onMMMClicked } = module;
            const entrypoint = DWEM.Config.Modules[index];
            const moduleDiv = document.createElement('div');
            moduleDiv.classList.add('module-info');

            let dependenciesHTML = '';
            if (dependencies.length > 0) {
                dependenciesHTML = `<div>Dependencies: ${dependencies.join(', ')}</div>`;
            }

            moduleDiv.innerHTML = `
                <div><strong>${name}:${version}</strong></div>
                ${dependenciesHTML}
                <div>Description: ${description}</div>
                <div>Entrypoint: ${entrypoint}</div>
            `;

            moduleDiv.addEventListener('click', () => {
                onMMMClicked?.();
            });

            container.append(moduleDiv);
        });
    }

    toggleVisibility(forceState) {
        const container = this.shadow.querySelector('.module-container');
        if (typeof forceState === 'boolean') {
            container.style.display = forceState ? 'block' : 'none';
        } else {
            container.style.display = container.style.display === 'none' ? 'block' : 'none';
        }
    }
}
