//@ts-check
'use strict';
module.exports = (red) => {
    function screenDatatUpdate(config) {
        red.nodes.createNode(this, config);
        const node = this;
        this.on('input', function (msg) {
            msg.topic = "screen_data_update";
            node.send(msg);
        });
    }

    red.nodes.registerType("Screen Data Update", screenDatatUpdate);
}