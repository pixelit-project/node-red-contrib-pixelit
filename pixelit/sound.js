//@ts-check
'use strict';
const tools = require('./lib/tools');
module.exports = (red) => {
    function sound(config) {
        red.nodes.createNode(this, config);
        const node = this;
        this.on('input', function (msg) {
            msg.sound = {};
            msg.sound.volume = Number(tools.getValue(red, config.inVolume));
            msg.sound.control = tools.getValue(red, config.inControl);
            msg.sound.folder = Number(tools.getValue(red, config.inFolder));
            msg.sound.file = Number(tools.getValue(red, config.inFile));
            node.send(msg)
        });
    }
    red.nodes.registerType("Sound", sound);
}