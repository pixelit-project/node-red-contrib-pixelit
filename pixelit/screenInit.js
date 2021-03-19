//@ts-check
'use strict';
const tools = require('./lib/tools');
module.exports = (red) => {
    function screenInit(config) {
        red.nodes.createNode(this, config);
        const node = this;
        this.on('input', function (msg) {
            msg.screenName = config.inscreenName;
            msg.duration = Number(tools.getValue(red, config.induration, msg));
            node.send(msg)
        });
    }
    red.nodes.registerType("Screen Init", screenInit);
}