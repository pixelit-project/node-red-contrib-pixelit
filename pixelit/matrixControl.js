//@ts-check
'use strict';
module.exports = (red) => {
    function matrixControl(config) {
        red.nodes.createNode(this, config);
        const node = this;
        this.on('input', function (msg) {
            msg.topic = "matrix_control";
            node.send(msg);
        });
    }

    red.nodes.registerType("Matrix Control", matrixControl);
}