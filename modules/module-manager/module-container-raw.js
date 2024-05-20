export default class ModuleContainer extends HTMLDivElement {
    constructor(target) {
        super();
        if (!target) {
            return;
        }
        this.target = target;
        if (this.target.hide) {
            this.style.display = 'none';
        }
        this.label = document.createElement('div');
        this.label.classList.add('label');
        this.label.textContent = target.labelTextContent;
        this.label.style.color = target.labelColor;
        this.label.style.backgroundColor = target.labelBackgroundColor;
        this.label.onclick = (e) => {
            downloadURI(this.image.src, (this.image.rawImage || this.image).src.split('/').pop());
        };
        this.appendChild(this.label);

        this.infoLabel = document.createElement('div');
        this.infoLabel.classList.add('info-label');
        this.infoLabel.style.display = 'none';
        this.appendChild(this.infoLabel);

        this.classList.add('image-container');
    }
}
customElements.define('image-container', ModuleContainer, {extends: 'div'});
