'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function build(file, config = {}, credentials, fetchImpl = async () => { throw new Error("Unexpected HTTP request"); }) {
    let Constructor, registration;
    const handlers = {}, store = new Map(), timers = new Map();
    const sent = [], errors = [], statuses = [], warnings = [];
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
                node.warn = warning => warnings.push(warning);
                node.status = status => statuses.push(status);
            }
        },
        util: { getMessageProperty: (msg, key) => key.split('.').reduce((obj, part) => obj?.[part], msg) }
    };
    const source = fs.readFileSync(path.join(__dirname, '../pixelit', file), 'utf8');
    const sandbox = {
        module: { exports: {} }, console: { log() {} },
        require: () => require('../pixelit/lib/tools'),
        fetch: fetchImpl, AbortController, AbortSignal, Buffer,
        setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
        clearTimeout: id => timers.delete(id)
    };
    vm.runInNewContext(source, sandbox, { filename: file });
    sandbox.module.exports(red);
    new Constructor(config);
    return { handlers, store, timers, sent, errors, statuses, warnings, registration };
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
    const n = build('core.js', {}, undefined, () => new Promise(r => { resolve = r; }));
    const pending = n.handlers.input({ topic: 'alert_screen', duration: 2, bitmap: { data: 42 } });
    n.handlers.close();
    resolve(new Response(JSON.stringify({ id: 42, rgB565Array: '[1,2]' })));
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
        const n = build('core.js', {}, undefined, async () => new Response(JSON.stringify(response)));
        await n.handlers.input({ topic: 'matrix_control', switchAnimation: { aktiv: true, data: 42 } });
        assert.equal(n.errors.length, 0);
        assert.equal(JSON.parse(n.sent[0].payload).switchAnimation.data.length, 64);
    });
}

test('failed bitmap downloads use fallback and can be retried', async () => {
    let calls = 0;
    const n = build('core.js', {}, undefined, async () => { calls++; throw new Error('offline'); });
    for (let i = 0; i < 2; i++) {
        await n.handlers.input({ topic: 'matrix_control', switchAnimation: { aktiv: true, data: 42 } });
    }
    assert.equal(calls, 2);
    assert.equal(n.errors.length, 0);
    assert.equal(JSON.parse(n.sent[0].payload).switchAnimation.data.length, 64);
});

test('valid bitmap downloads are cached', async () => {
    let calls = 0;
    const n = build('core.js', {}, undefined, async () => { calls++; return new Response(JSON.stringify({ id: 42, rgB565Array: '[1,2]' })); });
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
    const n = build('core.js', { ip: '192.0.2.1', masterTopic: 'pixelit/' }, undefined, async (...args) => { calls.push(args); return new Response('OK'); });
    await n.handlers.input({ topic: 'matrix_control', brightness: '20' });
    await n.handlers.input({ topic: 'matrix_config', mqttPassword: 'secret', matrixtBrightness: '85', matrixType: '1' });
    assert.equal(calls[0][0], 'http://192.0.2.1/api/screen');
    assert.equal(JSON.parse(calls[0][1].body).brightness, 20);
    assert.equal(calls[1][0], 'http://192.0.2.1/api/config');
    assert.equal(JSON.parse(calls[1][1].body).mqttPassword, 'secret');
    assert.equal(n.sent[0].topic, 'pixelit/setScreen');
    assert.equal(n.sent[1].topic, 'pixelit/setConfig');
});

for (const topic of ['matrix_control', 'matrix_config']) {
    test(`${topic}: HTTP errors set warning status while MQTT still sends`, async () => {
        let cancelled = false;
        const n = build('core.js', { ip: '192.0.2.1' }, undefined, async () => ({
            ok: false, status: 500, body: { cancel: async () => { cancelled = true; } }
        }));
        await n.handlers.input({ topic });
        assert.equal(cancelled, true);
        assert.equal(n.sent.length, 1);
        assert.equal(n.statuses.at(-1).fill, 'yellow');
        assert.equal(n.errors.length, 0);
    });
}

test('bitmap HTTP errors and invalid JSON use fallback without caching', async () => {
    for (const response of [() => new Response('Not found', { status: 404 }), () => new Response('invalid JSON')]) {
        let calls = 0;
        const n = build('core.js', {}, undefined, async () => { calls++; return response(); });
        for (let i = 0; i < 2; i++) await n.handlers.input({ topic: 'matrix_control', bitmap: { data: 42 } });
        assert.equal(calls, 2);
        assert.equal(JSON.parse(n.sent[0].payload).bitmap.data.length, 64);
        assert.equal(n.errors.length, 0);
    }
});

function untilAborted(signal) {
    return new Promise((resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
}

test('one-second timeout also aborts a stalled response body', async () => {
    let signal;
    const n = build('core.js', {}, undefined, async (url, options) => {
        signal = options.signal;
        return { ok: true, json: () => untilAborted(signal) };
    });
    // Native timeout signals do not keep the event loop alive by themselves.
    const keepAlive = setTimeout(() => {}, 2000);
    try {
        await n.handlers.input({ topic: 'matrix_control', bitmap: { data: 42 } });
        assert.equal(signal.aborted, true);
        assert.equal(signal.reason.name, 'TimeoutError');
        assert.equal(JSON.parse(n.sent[0].payload).bitmap.data.length, 64);
    } finally {
        clearTimeout(keepAlive);
    }
});

test('close aborts concurrent HTTP requests without warning statuses or late sends', async () => {
    const signals = [];
    const n = build('core.js', { ip: '192.0.2.1' }, undefined, (url, options) => {
        signals.push(options.signal);
        return untilAborted(options.signal);
    });
    const bitmap = n.handlers.input({ topic: 'alert_screen', duration: 2, bitmap: { data: 42 } });
    const config = n.handlers.input({ topic: 'matrix_config' });
    assert.equal(signals.length, 2);
    const statusesBeforeClose = n.statuses.length;
    const sentBeforeClose = n.sent.length;
    n.handlers.close();
    await Promise.all([bitmap, config]);
    assert.ok(signals.every(signal => signal.aborted));
    assert.equal(n.statuses.length, statusesBeforeClose);
    assert.equal(n.sent.length, sentBeforeClose);
    assert.equal(n.timers.size, 0);
    assert.equal(n.errors.length, 0);
});

for (const file of fs.readdirSync(path.join(__dirname, '../examples')).filter(file => file.endsWith('.json'))) {
    test(`example ${file}: all manual paths execute and produce valid Core output`, async () => {
        const flow = JSON.parse(fs.readFileSync(path.join(__dirname, '../examples', file), 'utf8'));
        const runtimeByType = {};
        for (const runtime of Object.values(require('../package.json')['node-red'].nodes)) {
            require('../' + runtime)({ nodes: { registerType(type) { runtimeByType[type] = path.basename(runtime); } } });
        }
        const instances = new Map(flow.filter(node => runtimeByType[node.type]).map(node => [node.id, build(runtimeByType[node.type], node)]));
        const nodes = new Map(flow.map(node => [node.id, node]));
        async function deliver(id, msg) {
            const instance = instances.get(id);
            if (!instance) return;
            const previous = instance.sent.length;
            await instance.handlers.input(msg);
            assert.equal(instance.errors.length, 0, `${file}: ${nodes.get(id).type}`);
            for (const output of instance.sent.slice(previous)) {
                if (nodes.get(id).type === 'Core') {
                    if (typeof output.payload === 'string') JSON.parse(output.payload);
                    assert.match(output.topic, /^pixelit\/set(Screen|Config)$/);
                }
                for (const target of (nodes.get(id).wires || []).flat()) {
                    await deliver(target, structuredClone(output));
                }
            }
        }
        for (const inject of flow.filter(node => node.type === 'inject')) {
            assert.equal(inject.once, false);
            const msg = { payload: inject.payloadType === 'json' ? JSON.parse(inject.payload) : inject.payload };
            for (const prop of inject.props) {
                if (prop.p !== 'payload') msg[prop.p] = prop.vt === 'bool' ? prop.v === 'true' : prop.vt === 'num' ? Number(prop.v) : prop.v;
            }
            for (const target of inject.wires.flat()) await deliver(target, structuredClone(msg));
        }
        const cores = flow.filter(node => node.type === 'Core');
        assert.ok(cores.every(node => instances.get(node.id).sent.length > 0));
        for (const instance of instances.values()) instance.handlers.close?.();
    });
}

test('bitmap cache evicts the least recently used ID at 100 entries', async () => {
    const calls = [];
    const n = build('core.js', {}, undefined, async url => {
        const id = Number(url.match(/GetBMPByID\/(\d+)/)[1]);
        calls.push(id);
        return new Response(JSON.stringify({ id, rgB565Array: '[1,2]' }));
    });
    async function show(id) { await n.handlers.input({ topic: 'matrix_control', bitmap: { data: id } }); }
    for (let id = 1; id <= 100; id++) await show(id);
    await show(1); // Refresh oldest entry.
    await show(101);
    await show(1);
    assert.equal(calls.filter(id => id === 1).length, 1);
    await show(2);
    assert.equal(calls.filter(id => id === 2).length, 2);
    assert.equal(n.errors.length, 0);
});

test('bitmap cache also enforces the total byte budget', async () => {
    let calls = 0;
    const data = '[' + '1,'.repeat(300000) + '1]';
    const n = build('core.js', {}, undefined, async () => {
        calls++;
        return new Response(JSON.stringify({ id: 1, rgB565Array: data }));
    });
    for (const id of [1, 1, 2, 1]) await n.handlers.input({ topic: 'matrix_control', bitmap: { data: id } });
    assert.equal(calls, 3);
});

test('a late bitmap response cannot overwrite a newer screen or enter the cache', async () => {
    let resolve, signal, calls = 0;
    const n = build('core.js', {}, undefined, async (url, options) => {
        calls++;
        signal = options.signal;
        if (calls === 1) return new Promise(r => { resolve = r; });
        return new Response(JSON.stringify({ id: 42, rgB565Array: '[1,2]' }));
    });
    const old = n.handlers.input({ topic: 'alert_screen', duration: 5, bitmap: { data: 42 } });
    await n.handlers.input({ topic: 'alert_screen', duration: 5, text: { textString: 'new' } });
    assert.equal(signal.aborted, true);
    resolve(new Response(JSON.stringify({ id: 42, rgB565Array: '[3,4]' })));
    await old;
    assert.equal(n.sent.length, 1);
    assert.equal(JSON.parse(n.sent[0].payload).text.textString, 'new');
    assert.equal(n.warnings.length, 0);
    await n.handlers.input({ topic: 'matrix_control', bitmap: { data: 42 } });
    assert.equal(calls, 2);
});

for (const action of ['stop', 'sleep', 'alert']) {
    test(`${action} invalidates an in-flight playlist download`, async () => {
        let signal;
        const n = build('core.js', {}, undefined, (url, options) => {
            signal = options.signal;
            return untilAborted(signal);
        });
        n.store.set('old', { duration: 5, bitmap: { data: 42 } });
        const old = n.handlers.input({ topic: 'playlist_update', payload: [{ screenName: 'old' }] });
        if (action === 'stop') await n.handlers.input({ topic: 'playlist_update', payload: [] });
        if (action === 'sleep') await n.handlers.input({ topic: 'matrix_control', sleepMode: true });
        if (action === 'alert') await n.handlers.input({ topic: 'alert_screen', duration: 5, text: { textString: 'alert' } });
        await old;
        assert.equal(signal.aborted, true);
        assert.equal(n.sent.length, action === 'stop' ? 0 : 1);
        assert.equal(n.warnings.length, 0);
    });
}

test('late screen HTTP errors do not overwrite a newer status', async () => {
    let reject, calls = 0;
    const n = build('core.js', { ip: '192.0.2.1' }, undefined, () => {
        if (++calls === 1) return new Promise((resolve, r) => { reject = r; });
        return Promise.resolve(new Response('OK'));
    });
    const old = n.handlers.input({ topic: 'matrix_control', brightness: 10 });
    // Let the first request reach fetch before sending a second command.
    await Promise.resolve();
    await n.handlers.input({ topic: 'matrix_control', brightness: 20 });
    const status = n.statuses.at(-1);
    reject(new TypeError('fetch failed'));
    await old;
    assert.equal(n.statuses.at(-1), status);
    assert.equal(n.warnings.length, 0);
});

test('diagnostics distinguish HTTP, timeout, connection and invalid JSON without leaking secrets', async () => {
    const cases = [
        [async () => new Response('', { status: 503 }), 'HTTP 503'],
        [async () => { const e = new Error('secret uuid password'); e.name = 'TimeoutError'; throw e; }, 'Timeout after 1000 ms'],
        [async () => { throw new TypeError('secret uuid password'); }, 'Connection failed'],
        [async () => new Response('invalid'), 'Invalid bitmap response']
    ];
    for (const [fetchImpl, expected] of cases) {
        const n = build('core.js', { uuid: 'secret uuid password' }, undefined, fetchImpl);
        await n.handlers.input({ topic: 'matrix_control', bitmap: { data: 42 } });
        assert.equal(n.warnings.length, 1);
        assert.ok(n.warnings[0].includes(expected));
        assert.equal(n.warnings[0].includes('secret'), false);
        assert.equal(n.statuses.at(-1).text, n.warnings[0]);
    }
});
