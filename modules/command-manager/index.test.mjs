import assert from 'node:assert/strict';
import test from 'node:test';

import CommandManager from './index.js';

test('removing one module rebuilds command and alias indexes', () => {
    const manager = new CommandManager();
    const first = () => {};
    const second = () => {};

    manager.addCommand('/map_predictor status', [], first, {
        module: 'MapPredictor',
        aliases: ['/automap status']
    });
    manager.addCommand('/keep', [], second, {
        module: 'OtherModule',
        aliases: ['/keep_alias']
    });

    assert.equal(manager.removeCommandsByModule('MapPredictor'), 1);
    assert.equal(manager.commandTrie.find('/map_predictor status'), null);
    assert.equal(manager.commandTrie.find('/automap status'), null);
    assert.equal(manager.commandTrie.find('/keep').targetCommand.handler, second);
    assert.equal(manager.commandTrie.find('/keep_alias').targetCommand.handler, second);
});

test('removeCommand reports whether it removed a command', () => {
    const manager = new CommandManager();
    manager.addCommand('/one', [], () => {}, {module: 'Test'});

    assert.equal(manager.removeCommand('/one'), true);
    assert.equal(manager.removeCommand('/one'), false);
    assert.equal(manager.commands.length, 0);
});
