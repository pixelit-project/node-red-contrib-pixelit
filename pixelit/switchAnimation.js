//@ts-check
'use strict';
const tools = require('./lib/tools');
module.exports = (red) => {
    function switchAnimation(config) {
        red.nodes.createNode(this, config);
        const node = this;
        this.on('input', function (msg) {
            msg.switchAnimation = {};
            msg.switchAnimation.aktiv = config.aktiv;
            msg.switchAnimation.animation = config.animation;
            msg.switchAnimation.data = tools.getValue(red, config.indata, msg);
            msg.switchAnimation.width = tools.getValue(red, config.inwidth, msg);
            msg.switchAnimation.hexColor = tools.getValue(red, config.incolorHex, msg);
            msg.switchAnimation.color = {};
            msg.switchAnimation.color.r = Number(tools.getValue(red, config.incolorR, msg));
            msg.switchAnimation.color.g = Number(tools.getValue(red, config.incolorG, msg));
            msg.switchAnimation.color.b = Number(tools.getValue(red, config.incolorB, msg));
            node.send(msg)
        });
    }
    red.nodes.registerType("Switch Animation", switchAnimation);
}