const style =
`
.module-container {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.5);
    z-index: 9999;
}

.ui-popup + .ui-popup { padding-top: 20px; }
.ui-popup + .ui-popup + .ui-popup { padding-top: 40px; }
.ui-popup + .ui-popup + .ui-popup + .ui-popup { padding-top: 60px; }

.ui-popup.centred {
    padding-top: 0;
    -webkit-box-align: center;
    -ms-flex-align: center;
    align-items: center;
}

.ui-popup-outer {
    margin: 50px;
    max-height: calc(95vh - 100px);

    padding: 20px;
    background-color: #040204;
    border: 1px solid black;
    outline: 2px solid #7d623c;

    display: -webkit-box;
    display: -ms-flexbox;
    display: flex;
    z-index: 0;
    position: relative;
}

.ui-popup-inner {
    position: relative; /* positioned so that it renders on top of bg */
    display: -webkit-box;
    display: -ms-flexbox;
    display: flex;
    max-height: calc(95vh - 100px - 46px); /* for IE11 */
}
.ui-popup-inner:after {
    display: block;
    content: "";
    clear:both;
}

.ui-popup-inner .bg0 {
    background-color: transparent;
}
`;
export default class ModuleContainerStyle extends HTMLStyleElement {
    constructor() {
        super();
        this.textContent = style;
    }
}
customElements.define('module-container-style', ModuleContainerStyle, {extends: 'style'});
