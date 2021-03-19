//@ts-check
'use strict';
module.exports = (red) => {
    // Alert Screen
    function alertScreen(config) {
        red.nodes.createNode(this, config);
        const node = this;
        this.on('input', function (msg) {
            msg.topic = "alert_screen";
            node.send(msg);
        });
    }

    red.nodes.registerType("Alert Screen", alertScreen);
}