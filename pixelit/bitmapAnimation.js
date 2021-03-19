//@ts-check
'use strict';
const tools = require('./lib/tools');
module.exports = (red) => {
    function bitmapAnimation(config) {
        red.nodes.createNode(this, config);
        const node = this;
        this.on('input', function (msg) {
            msg.bitmapAnimation = {};
            msg.bitmapAnimation.data = tools.getValue(red, config.indata, msg);
            msg.bitmapAnimation.animationDelay = tools.getValue(red, config.inanimationDelay, msg);
            msg.bitmapAnimation.rubberbanding = config.inrubberbanding;
            msg.bitmapAnimation.limitLoops = tools.getValue(red, config.inlimitLoops, msg);
            node.send(msg)
        });
    }
    red.nodes.registerType("Bitmap Animation", bitmapAnimation);
}