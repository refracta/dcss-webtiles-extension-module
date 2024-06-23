import DWEM from "../core/dwem.js";

window.DWEM = new DWEM();
await window.DWEM.init();
window?.startMainScript();
