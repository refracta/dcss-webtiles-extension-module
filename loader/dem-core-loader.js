import DEM from "../core/dem.js";

window.DEM = new DEM();
await window.DEM.init();
window?.reloadRequireJS();
