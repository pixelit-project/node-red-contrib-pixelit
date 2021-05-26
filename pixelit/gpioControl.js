//@ts-check
'use strict';
const tools = require('./lib/tools');
module.exports = (red) => {
    function gpioControl(config) {
        red.nodes.createNode(this, config);
        const node = this;
        this.on('input', function (msg) {
            msg.setGpio = {};
            msg.setGpio.gpio = config.gpio;
            msg.setGpio.set = config.set;   
            if (config.duration) {        
                msg.setGpio.duration = Number(tools.getValue(red, config.duration, msg));
            }
            node.send(msg)
        });
    }
    red.nodes.registerType("GPIO Control", gpioControl);
}