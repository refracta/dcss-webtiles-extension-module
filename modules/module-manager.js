export default class ModuleManager {
    static name = 'ModuleManager'
    static version = '1.0'
    static dependencies = []
    static description = ''

    onLoad() {
        this.createUI();
        this.toggleUI();
        this.addEventListeners();
    }

    createUI() {
        this.content = document.createElement('div');
        this.shadow = this.content.attachShadow({mode: 'open'});

        const style = document.createElement('style');
        style.textContent = `
      :host { all: initial; } /* Reset all styles */

      .panel {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.5);
        display: none;
        z-index: 9999;
      }

      .container {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background-color: white;
        padding: 20px;
        border-radius: 5px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      }

      h1 {
        margin-top: 0;
      }

      ul {
        list-style-type: none;
        padding: 0;
      }

      li {
        margin-bottom: 10px;
      }

      button {
        margin-left: 10px;
      }
    `;
        this.shadow.appendChild(style);

        this.panel = document.createElement('div');
        this.panel.classList.add('panel');

        this.container = document.createElement('div');
        this.container.classList.add('container');

        this.header = document.createElement('h1');
        this.header.textContent = 'DWEM v0.1';

        this.list = document.createElement('ul');

        // config button
        const items = [{
            name: 'IOHook', version: 'v1.0', url: 'https://localhost/io-hook', description: 'This is IOHook Description'
        }, {
            name: 'TestModule',
            version: 'v1.0',
            url: 'https://localhost/test-module',
            description: 'This is TestModule Description'
        }, {
            name: 'AnotherModule',
            version: 'v1.2',
            url: 'https://localhost/another-module',
            description: 'This is AnotherModule Description'
        }, {
            name: 'YetAnotherModule',
            version: 'v0.9',
            url: 'https://localhost/yet-another-module',
            description: 'This is YetAnotherModule Description'
        }, {
            name: 'FinalModule',
            version: 'v2.0',
            url: 'https://localhost/final-module',
            description: 'This is FinalModule Description'
        },];

        items.forEach(item => {
            const listItem = document.createElement('li');

            const itemHeader = document.createElement('h3');
            itemHeader.innerHTML = `${item.name} ${item.version} (<a href="${item.url}" target="_blank">${item.url}</a>)`;

            const itemDescription = document.createElement('p');
            itemDescription.textContent = item.description;

            const deleteButton = document.createElement('button');
            deleteButton.textContent = 'Delete';
            deleteButton.addEventListener('click', () => listItem.remove());

            listItem.appendChild(itemHeader);
            listItem.appendChild(itemDescription);
            listItem.appendChild(deleteButton);

            this.list.appendChild(listItem);
        });

        this.addButton = document.createElement('button');
        this.addButton.textContent = 'Add Item';
        this.addButton.addEventListener('click', this.addItem.bind(this));

        this.container.appendChild(this.header);
        this.container.appendChild(this.list);
        this.container.appendChild(this.addButton);

        this.panel.appendChild(this.container);
        this.shadow.appendChild(this.panel);

        document.body.appendChild(this.content);
    }

    toggleUI() {
        document.addEventListener('keydown', (event) => {
            if (event.ctrlKey && event.keyCode === 123) {
                this.panel.style.display = this.panel.style.display === 'none' ? 'block' : 'none';
            }
        });
    }

    addItem() {
        const name = prompt('Enter item name');
        const version = prompt('Enter item version');
        const url = prompt('Enter item URL');
        const description = prompt('Enter item description');

        if (name && version && url && description) {
            const listItem = document.createElement('li');

            const itemHeader = document.createElement('h3');
            itemHeader.innerHTML = `${name} ${version} (<a href="${url}" target="_blank">${url}</a>)`;

            const itemDescription = document.createElement('p');
            itemDescription.textContent = description;

            const deleteButton = document.createElement('button');
            deleteButton.textContent = 'Delete';
            deleteButton.addEventListener('click', () => listItem.remove());

            listItem.appendChild(itemHeader);
            listItem.appendChild(itemDescription);
            listItem.appendChild(deleteButton);

            this.list.appendChild(listItem);
        }
    }

    addEventListeners() {
        // Add any additional event listeners here
    }
}
