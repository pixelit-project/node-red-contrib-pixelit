//@ts-check
'use strict';
const tools = require('./lib/tools');
module.exports = (red) => {
    function bitmap(config) {
        red.nodes.createNode(this, config);        
        const node = this;
        this.on('input', function (msg) {
            msg.bitmap = {};
            msg.bitmap.data = tools.getValue(red, config.indata, msg);
            msg.bitmap.position = {};
            msg.bitmap.position.x = tools.getValue(red, config.inposX, msg);
            msg.bitmap.position.y = tools.getValue(red, config.inposY, msg);
            msg.bitmap.size = {};
            msg.bitmap.size.width = tools.getValue(red, config.inwidth, msg);
            msg.bitmap.size.height = tools.getValue(red, config.inheight, msg);
            node.send(msg)
        });
    }
    red.nodes.registerType("Bitmap", bitmap);
}