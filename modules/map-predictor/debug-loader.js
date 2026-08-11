const moduleUrl = new URL('./index.js', import.meta.url).href;
const modules = new Set(JSON.parse(localStorage.DWEM_MODULES || '[]'));

modules.add(moduleUrl);
localStorage.DWEM_MODULES = JSON.stringify([...modules]);

await import('../../loader/dwem-core-loader.js');
