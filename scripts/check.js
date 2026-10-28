'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function check(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, item.name);
        if (item.isDirectory()) check(file);
        else if (file.endsWith('.js')) new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file });
        else if (file.endsWith('.html')) {
            for (const match of fs.readFileSync(file, 'utf8').matchAll(/<script type="text\/javascript">([\s\S]*?)<\/script>/g)) {
                new vm.Script(match[1], { filename: file });
            }
        }
    }
}
check('pixelit');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const expected = new Set();
for (const runtime of Object.values(packageJson['node-red'].nodes)) {
    const html = fs.readFileSync(runtime.replace(/\.js$/, '.html'), 'utf8');
    for (const match of html.matchAll(/<script type="text\/javascript">([\s\S]*?)<\/script>/g)) {
        vm.runInNewContext(match[1], { RED: { nodes: { registerType(type, definition) {
            if (definition.category !== 'config') expected.add(type);
        } } } }, { filename: runtime.replace(/\.js$/, '.html') });
    }
}
const used = new Set();
function checkExamples(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, item.name);
        if (item.isDirectory()) { checkExamples(file); continue; }
        if (!file.endsWith('.json')) continue;
        const flow = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!Array.isArray(flow)) throw new Error(`${file}: expected a flow array`);
        const ids = new Set();
        for (const node of flow) {
            if (!node.id || !node.type || ids.has(node.id)) throw new Error(`${file}: missing type/id or duplicate id`);
            ids.add(node.id);
            used.add(node.type);
        }
        for (const node of flow) {
            for (const target of (node.wires || []).flat()) {
                if (!ids.has(target)) throw new Error(`${file}: unknown wire target ${target}`);
            }
        }
    }
}
checkExamples('examples');
const missing = [...expected].filter(type => !used.has(type));
if (missing.length) throw new Error(`Missing example nodes: ${missing.join(', ')}`);
console.log(`Node/editor scripts and example flows are valid; all ${expected.size} package node types have examples.`);
