//@ts-check
'use strict';
const tools = require('./lib/tools');
module.exports = (red) => {
    function text(config) {
        red.nodes.createNode(this, config);
        const node = this;
        this.on('input', function (msg) {
            msg.text = {};
            msg.text.textString = String(tools.getValue(red, config.intextString, msg));
            msg.text.bigFont = config.inbigFont;
            msg.text.scrollText = config.inscrollText;
            msg.text.scrollTextDelay = Number(tools.getValue(red, config.inscrollTextDelay, msg));
            msg.text.centerText = config.incenterText;
            msg.text.position = {};
            msg.text.position.x = Number(tools.getValue(red, config.inposX, msg));
            msg.text.position.y = Number(tools.getValue(red, config.inposY, msg));
            msg.text.hexColor = tools.getValue(red, config.incolorHex, msg);
            msg.text.color = {};
            msg.text.color.r = Number(tools.getValue(red, config.incolorR, msg));
            msg.text.color.g = Number(tools.getValue(red, config.incolorG, msg));
            msg.text.color.b = Number(tools.getValue(red, config.incolorB, msg));
            node.send(msg)
        });
    }
    red.nodes.registerType("Text", text);
}