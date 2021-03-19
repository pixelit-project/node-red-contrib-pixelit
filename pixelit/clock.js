//@ts-check
'use strict';
const tools = require('./lib/tools');
module.exports = (red) => {
    function clock(config) {
        red.nodes.createNode(this, config);
        const node = this;
        this.on('input', function (msg) {
            msg.clock = {};
            msg.clock.show = true;
            msg.clock.switchAktiv = config.inswitchAktiv;
            msg.clock.switchSec = tools.getValue(red, config.inswitchSec);
            msg.clock.withSeconds = config.inwithSeconds;
            msg.clock.color = {};
            msg.clock.color.r = tools.getValue(red, config.incolorR, msg);
            msg.clock.color.g = tools.getValue(red, config.incolorG, msg);
            msg.clock.color.b = tools.getValue(red, config.incolorB, msg);
            node.send(msg)
        });
    }
    red.nodes.registerType("Clock", clock);
}