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
for (const file of fs.readdirSync('examples')) JSON.parse(fs.readFileSync(path.join('examples', file), 'utf8'));
console.log('Node scripts, editor scripts and example JSON are valid.');
