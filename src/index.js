// src/index.js
function importAll(r) {
    r.keys().forEach((key) => {
        console.log(key);
        const module = r(key);
        console.log(module);
        const moduleName = key.replace('./', '').replace('/index.js', '').replace(/\//g, '-');
        window.MyModules = window.MyModules || {};
        window.MyModules[moduleName] = module.default;
    });
}

importAll(require.context('../modules', true, /\.js$/));
console.log('All modules loaded');
