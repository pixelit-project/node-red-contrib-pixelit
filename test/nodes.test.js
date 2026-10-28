'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function build(file, config = {}, credentials, axios = {}) {
    let Constructor, registration;
    const handlers = {}, store = new Map(), timers = new Map();
    const sent = [], errors = [], statuses = [];
    let timerId = 0;
    const red = {
        nodes: {
            registerType(name, ctor, options) { Constructor = ctor; registration = options; },
            createNode(node) {
                node.credentials = credentials;
                node.on = (event, fn) => { handlers[event] = fn; };
                node.context = () => ({ get: key => store.get(key), set: (key, value) => store.set(key, value) });
                node.send = msg => sent.push(msg);
                node.error = error => errors.push(error);
                node.status = status => statuses.push(status);
            }
        },
        util: { getMessageProperty: (msg, key) => key.split('.').reduce((obj, part) => obj?.[part], msg) }
    };
    const source = fs.readFileSync(path.join(__dirname, '../pixelit', file), 'utf8');
    const sandbox = {
        module: { exports: {} }, console: { log() {} },
        require: name => name === 'axios' ? axios : require('../pixelit/lib/tools'),
        setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
        clearTimeout: id => timers.delete(id)
    };
    vm.runInNewContext(source, sandbox, { filename: file });
    sandbox.module.exports(red);
    new Constructor(config);
    return { handlers, store, timers, sent, errors, statuses, registration };
}

for (const payload of [undefined, null, {}, [null], [{ screenName: 'ok' }, {}]]) {
    test(`invalid playlist ${JSON.stringify(payload)} is reported without replacing playback`, async () => {
        const n = build('core.js');
        const original = [{ screenName: 'existing' }];
        n.store.set('screenPlayList', original);
        await n.handlers.input({ topic: 'playlist_update', payload });
        assert.equal(n.store.get('screenPlayList'), original);
        assert.equal(n.statuses.at(-1).fill, 'red');
    });
}

test('empty playlist stops playback and clears its timer', async () => {
    const n = build('core.js');
    n.store.set('hello', { screenName: 'hello', duration: 10 });
    await n.handlers.input({ topic: 'playlist_update', payload: [{ screenName: 'hello' }] });
    assert.equal(n.sent.length, 1);
    assert.equal(n.timers.size, 1);
    await n.handlers.input({ topic: 'playlist_update', payload: [] });
    assert.equal(n.timers.size, 0);
});

test('close clears timers and prevents callbacks from sending again', async () => {
    const n = build('core.js');
    n.store.set('hello', { duration: 10 });
    await n.handlers.input({ topic: 'playlist_update', payload: [{ screenName: 'hello' }] });
    const callback = [...n.timers.values()][0].fn;
    n.handlers.close();
    assert.equal(n.timers.size, 0);
    await callback();
    assert.equal(n.sent.length, 1);
});

test('close during an icon request prevents late sends', async () => {
    let resolve;
    const n = build('core.js', {}, undefined, { get: () => new Promise(r => { resolve = r; }) });
    const pending = n.handlers.input({ topic: 'alert_screen', duration: 2, bitmap: { data: 42 } });
    n.handlers.close();
    resolve({ data: { id: 42, rgB565Array: '[1,2]' } });
    await pending;
    assert.equal(n.sent.length, 0);
    assert.equal(n.timers.size, 0);
});

test('invalid alert durations are reported through done without scheduling', async () => {
    for (const duration of [undefined, 0, -1, 'bad', Infinity, 2147484]) {
        const n = build('core.js');
        let error;
        await n.handlers.input({ topic: 'alert_screen', duration }, undefined, e => { error = e; });
        assert.match(error.message, /duration/);
        assert.equal(n.timers.size, 0);
        assert.equal(n.sent.length, 0);
    }
});

for (const response of [null, {}, { id: 0 }, { id: 42 }]) {
    test(`malformed bitmap response ${JSON.stringify(response)} uses fallback`, async () => {
        const n = build('core.js', {}, undefined, { get: async () => ({ data: response }) });
        await n.handlers.input({ topic: 'matrix_control', switchAnimation: { aktiv: true, data: 42 } });
        assert.equal(n.errors.length, 0);
        assert.equal(JSON.parse(n.sent[0].payload).switchAnimation.data.length, 64);
    });
}

test('failed bitmap downloads use fallback and can be retried', async () => {
    let calls = 0;
    const n = build('core.js', {}, undefined, { get: async () => { calls++; throw new Error('offline'); } });
    for (let i = 0; i < 2; i++) {
        await n.handlers.input({ topic: 'matrix_control', switchAnimation: { aktiv: true, data: 42 } });
    }
    assert.equal(calls, 2);
    assert.equal(n.errors.length, 0);
    assert.equal(JSON.parse(n.sent[0].payload).switchAnimation.data.length, 64);
});

test('valid bitmap downloads are cached', async () => {
    let calls = 0;
    const n = build('core.js', {}, undefined, { get: async () => { calls++; return { data: { id: 42, rgB565Array: '[1,2]' } }; } });
    for (let i = 0; i < 2; i++) await n.handlers.input({ topic: 'matrix_control', bitmap: { data: 42 } });
    assert.equal(calls, 1);
    assert.deepEqual(JSON.parse(n.sent[1].payload).bitmap.data, [1, 2]);
});

test('Clock and Sound resolve message references', () => {
    const clock = build('clock.js', { inswitchSec: '{{msg.payload.seconds}}' });
    clock.handlers.input({ payload: { seconds: 7 } });
    assert.equal(clock.sent[0].clock.switchSec, 7);
    const sound = build('sound.js', { inVolume: '{{msg.payload.volume}}', inControl: '{{msg.payload.control}}', inFolder: '{{msg.payload.folder}}', inFile: '{{msg.payload.file}}' });
    sound.handlers.input({ payload: { volume: 20, control: 'play', folder: 2, file: 3 } });
    assert.equal(sound.sent[0].sound.volume, 20);
    assert.equal(sound.sent[0].sound.control, 'play');
    assert.equal(sound.sent[0].sound.folder, 2);
    assert.equal(sound.sent[0].sound.file, 3);
});

test('Matrix Config prefers credentials, including explicitly cleared passwords', () => {
    for (const password of ['secret', '']) {
        const n = build('matrixConfig.js', { mqttPassword: 'legacy' }, { mqttPassword: password });
        n.handlers.input({});
        assert.equal(n.sent[0].mqttPassword, password);
        assert.equal(n.registration.credentials.mqttPassword.type, 'password');
    }
    const legacy = build('matrixConfig.js', { mqttPassword: 'legacy' });
    legacy.handlers.input({});
    assert.equal(legacy.sent[0].mqttPassword, 'legacy');
});

test('editor migrates a legacy password and removes the flow property on save', () => {
    let definition, input;
    const html = fs.readFileSync(path.join(__dirname, '../pixelit/matrixConfig.html'), 'utf8');
    vm.runInNewContext(html.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)[1], {
        RED: { nodes: { registerType(name, value) { definition = value; } } },
        $: () => ({ val: value => { input = value; } })
    });
    assert.equal(definition.defaults.mqttPassword, undefined);
    const node = { mqttPassword: 'legacy', credentials: {} };
    definition.oneditprepare.call(node);
    assert.equal(input, 'legacy');
    definition.oneditsave.call(node);
    assert.equal(Object.hasOwn(node, 'mqttPassword'), false);
});

test('sleep pauses rotation, completes input and wake resumes playback', async () => {
    const n = build('core.js');
    n.store.set('hello', { duration: 10 });
    await n.handlers.input({ topic: 'playlist_update', payload: [{ screenName: 'hello' }] });
    await n.handlers.input({ topic: 'matrix_control', sleepMode: true });
    assert.equal(n.timers.size, 0);
    let completed = false;
    await n.handlers.input({ topic: 'matrix_control' }, undefined, () => { completed = true; });
    assert.equal(completed, true);
    assert.equal(n.sent.length, 2);
    await n.handlers.input({ topic: 'matrix_control', sleepMode: false });
    assert.equal(n.timers.size, 1);
    assert.equal(n.sent.length, 4);
});

test('configured HTTP transport receives screens and configuration', async () => {
    const calls = [];
    const n = build('core.js', { ip: '192.0.2.1', masterTopic: 'pixelit/' }, undefined, {
        post: async (...args) => calls.push(args)
    });
    await n.handlers.input({ topic: 'matrix_control', brightness: '20' });
    await n.handlers.input({ topic: 'matrix_config', mqttPassword: 'secret', matrixtBrightness: '85', matrixType: '1' });
    assert.equal(calls[0][0], 'http://192.0.2.1/api/screen');
    assert.equal(JSON.parse(calls[0][1]).brightness, 20);
    assert.equal(calls[1][0], 'http://192.0.2.1/api/config');
    assert.equal(calls[1][1].mqttPassword, 'secret');
    assert.equal(n.sent[0].topic, 'pixelit/setScreen');
    assert.equal(n.sent[1].topic, 'pixelit/setConfig');
});
